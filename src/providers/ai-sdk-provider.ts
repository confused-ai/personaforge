/**
 * @personaforge/providers — AI SDK provider adapter.
 *
 * Wraps any `@ai-sdk/provider` LanguageModel into personaforge's LLMProvider
 * interface, unlocking ~300 provider packages (OpenAI, Anthropic, Google,
 * Groq, Mistral, Cohere, Fireworks, Together, DeepSeek, xAI, Perplexity,
 * Replicate, ElevenLabs, and many more) without per-provider maintenance.
 *
 * The step/tool loop remains personaforge's own (guardrails, cost tracking,
 * HITL, etc.), but the provider protocol layer is delegated to the AI SDK
 * — a battle-tested, ecosystem-wide foundation.
 *
 * @example
 * ```ts
 * import { createAiSdkProvider } from 'personaforge/providers';
 * import { createOpenAI } from '@ai-sdk/openai';  // user-installed
 *
 * const provider = createAiSdkProvider(
 *   createOpenAI({ apiKey: process.env.OPENAI_API_KEY }),
 *   'gpt-4o',
 * );
 *
 * const agent = createAgent({
 *   name: 'ai-sdk-agent',
 *   instructions: 'You are helpful.',
 *   model: provider,
 * });
 * ```
 */

import type { LLMProvider } from '../core/types.js';
import type { GenerateResult, GenerateOptions as PFGenerateOptions } from '../core/types.js';
import type { Message as PFMessage } from '../core/types.js';

// ── Type-only imports from @ai-sdk/provider (not bundled) ─────────────────

interface AiSdkLanguageModelV1 {
    readonly modelId: string;
    readonly provider: string;
    doGenerate(
        options: AiSdkCallOptions,
    ): Promise<AiSdkCallResult>;
    doStream(
        options: AiSdkCallOptions,
    ): Promise<AiSdkStreamResult>;
}

interface AiSdkCallOptions {
    inputFormat: 'messages' | 'prompt';
    mode: {
        type: 'regular' | 'object-json' | 'object-tool' | 'object-grammar';
        tools?: Record<string, AiSdkToolDefinition>;
        toolChoice?: AiSdkToolChoice;
    };
    prompt: AiSdkMessage[];
    maxTokens?: number;
    temperature?: number;
    stopSequences?: string[];
    abortSignal?: AbortSignal;
}

type AiSdkToolChoice = 'auto' | 'none' | 'required' | { type: 'tool'; name: string };

interface AiSdkToolDefinition {
    type?: 'function';
    description?: string;
    parameters: unknown;
}

interface AiSdkCallResult {
    text: string | undefined;
    toolCalls: Array<{
        toolCallId: string;
        toolName: string;
        args: Record<string, unknown>;
    }>;
    finishReason: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other' | 'unknown';
    usage: {
        promptTokens: number;
        completionTokens: number;
    };
}

interface AiSdkStreamResult {
    stream: ReadableStream<AiSdkStreamChunk>;
    rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> };
}

type AiSdkStreamChunk =
    | { type: 'text-delta'; textDelta: string }
    | { type: 'tool-call-delta'; toolCallId: string; toolName: string; argsTextDelta: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown> }
    | { type: 'finish'; finishReason: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other' | 'unknown'; usage?: { promptTokens: number; completionTokens: number } }
    | { type: 'error'; error: unknown }
    | { type: 'tool-call-result'; toolCallId: string; result: unknown };

type AiSdkMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: Array<AiSdkMessagePart>;
};

type AiSdkMessagePart =
    | { type: 'text'; text: string }
    | { type: 'tool-call'; toolCallId: string; toolName: string; args: Record<string, unknown> }
    | { type: 'tool-result'; toolCallId: string; toolName: string; result: unknown };

// ── Option bag ─────────────────────────────────────────────────────────────

export interface AiSdkProviderOptions {
    /** Model ID override (defaults to base model's modelId). */
    modelId?: string;
}

// ── Adapter ─────────────────────────────────────────────────────────────────

const MISSING_PROVIDER_MSG =
    '[personaforge] @ai-sdk/provider not found.\n' +
    'Install it: npm install @ai-sdk/provider\n' +
    'Then install a model package: npm install @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google\n';

/**
 * Create a personaforge LLMProvider that delegates to any `@ai-sdk/provider`
 * LanguageModel. The model object comes from provider packages like
 * `@ai-sdk/openai` or `@ai-sdk/anthropic`.
 *
 * @param model - An `@ai-sdk/provider` `LanguageModelV1` instance
 *   (e.g. `openai('gpt-4o')` or `anthropic('claude-3-5-sonnet')`).
 * @param options - Optional overrides.
 */
export function createAiSdkProvider(
    model: AiSdkLanguageModelV1,
    options?: AiSdkProviderOptions,
): LLMProvider {
    const modelId = options?.modelId ?? model.modelId;
    const providerName = model.provider;

    const generateText = async (
        pfMessages: PFMessage[],
        pfOpts?: PFGenerateOptions,
    ): Promise<GenerateResult> => {
        const messages = pfToAiMessages(pfMessages);
        const tools = pfToAiTools(pfOpts?.tools);

        const result = await model.doGenerate({
            inputFormat: 'messages',
            mode: {
                type: 'regular',
                ...(tools && Object.keys(tools).length > 0
                    ? { tools, toolChoice: pfToAiToolChoice(pfOpts?.toolChoice) }
                    : {}),
            },
            prompt: messages,
            maxTokens: pfOpts?.maxTokens,
            temperature: pfOpts?.temperature,
            stopSequences: pfOpts?.stop,
            abortSignal: pfOpts?.signal,
        });

        return {
            text: result.text ?? '',
            toolCalls: result.toolCalls?.map((tc) => ({
                id: tc.toolCallId,
                name: tc.toolName,
                arguments: tc.args,
            })),
            finishReason: aiToPfFinishReason(result.finishReason),
            usage: {
                promptTokens: result.usage?.promptTokens,
                completionTokens: result.usage?.completionTokens,
                totalTokens: (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0),
            },
        };
    };

    const streamText = async (
        pfMessages: PFMessage[],
        pfOpts?: PFGenerateOptions,
    ): Promise<GenerateResult> => {
        const messages = pfToAiMessages(pfMessages);
        const tools = pfToAiTools(pfOpts?.tools);

        const { stream } = await model.doStream({
            inputFormat: 'messages',
            mode: {
                type: 'regular',
                ...(tools && Object.keys(tools).length > 0
                    ? { tools, toolChoice: pfToAiToolChoice(pfOpts?.toolChoice) }
                    : {}),
            },
            prompt: messages,
            maxTokens: pfOpts?.maxTokens,
            temperature: pfOpts?.temperature,
            stopSequences: pfOpts?.stop,
            abortSignal: pfOpts?.signal,
        });

        return collectStreamToResult(stream, pfOpts?.onChunk);
    };

    return {
        name: `${providerName}:${modelId}`,
        generateText,
        streamText,
    } as LLMProvider & { name: string };
}

// ── Message conversion ──────────────────────────────────────────────────────

function pfToAiMessages(pf: PFMessage[]): AiSdkMessage[] {
    const result: AiSdkMessage[] = [];

    for (const msg of pf) {
        if (msg.role === 'system') {
            result.push({
                role: 'system',
                content: [{ type: 'text', text: contentToString(msg.content) }],
            });
        } else if (msg.role === 'user') {
            result.push({
                role: 'user',
                content: contentToParts(msg.content),
            });
        } else if (msg.role === 'assistant') {
            const parts: AiSdkMessagePart[] = [];
            // If the assistant message has text content
            const text = contentToString(msg.content);
            if (text) parts.push({ type: 'text', text });
            // If there's a tool call in conversation history, it's in metadata or content
            result.push({ role: 'assistant', content: parts });
        } else if (msg.role === 'tool') {
            result.push({
                role: 'tool',
                content: [{
                    type: 'tool-result',
                    toolCallId: msg.toolCallId ?? 'unknown',
                    toolName: msg.name ?? 'unknown',
                    result: msg.content,
                }],
            });
        }
    }

    return result;
}

function contentToString(content: string | unknown[] | undefined): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        return content
            .map((part: unknown) => {
                if (typeof part === 'string') return part;
                if (part && typeof part === 'object') {
                    const p = part as Record<string, unknown>;
                    return typeof p.text === 'string' ? p.text : '';
                }
                return '';
            })
            .join('')
            .trim();
    }
    return '';
}

function contentToParts(content: string | unknown[] | undefined): AiSdkMessagePart[] {
    if (typeof content === 'string') {
        return [{ type: 'text', text: content }];
    }
    if (Array.isArray(content)) {
        return content.map((part: unknown) => {
            if (typeof part === 'string') return { type: 'text' as const, text: part };
            const p = part as Record<string, unknown>;
            if (p.type === 'image' || p.type === 'file') {
                return { type: 'text' as const, text: JSON.stringify(p) };
            }
            return { type: 'text' as const, text: JSON.stringify(p) };
        });
    }
    return [];
}

// ── Tool conversion ─────────────────────────────────────────────────────────

function pfToAiTools(
    tools: PFGenerateOptions['tools'],
): Record<string, AiSdkToolDefinition> | undefined {
    if (!tools || tools.length === 0) return undefined;
    const result: Record<string, AiSdkToolDefinition> = {};
    for (const t of tools) {
        result[t.name] = {
            description: t.description,
            parameters: t.parameters,
        };
    }
    return result;
}

function pfToAiToolChoice(
    tc: PFGenerateOptions['toolChoice'],
): AiSdkToolChoice | undefined {
    if (!tc || tc === 'auto' || tc === 'none' || tc === 'required') return tc;
    if (typeof tc === 'object' && 'name' in tc) {
        return { type: 'tool', name: tc.name };
    }
    return undefined;
}

// ── Finish reason conversion ────────────────────────────────────────────────

function aiToPfFinishReason(
    reason: AiSdkCallResult['finishReason'],
): GenerateResult['finishReason'] {
    switch (reason) {
        case 'stop': return 'stop';
        case 'length': return 'max_tokens';
        case 'content-filter': return 'error';
        case 'tool-calls': return 'tool_calls';
        case 'error': return 'error';
        default: return 'stop';
    }
}

// ── Stream result collection ────────────────────────────────────────────────

async function collectStreamToResult(
    stream: ReadableStream<AiSdkStreamChunk>,
    onChunk?: (text: string) => void,
): Promise<GenerateResult> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    let text = '';
    let toolCalls: GenerateResult['toolCalls'] = [];
    let finishReason: GenerateResult['finishReason'] = 'stop';
    let usage: GenerateResult['usage'] = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!value) continue;

            switch (value.type) {
                case 'text-delta':
                    text += value.textDelta;
                    onChunk?.(value.textDelta);
                    break;
                case 'tool-call':
                    toolCalls.push({
                        id: value.toolCallId,
                        name: value.toolName,
                        arguments: value.args,
                    });
                    break;
                case 'tool-call-delta':
                    // Accumulate partial args — AI SDK sends deltas for long args
                    const existing = toolCalls.find(
                        (tc) => tc.id === value.toolCallId,
                    );
                    if (existing) {
                        existing.arguments = {
                            ...existing.arguments,
                            ...JSON.parse(value.argsTextDelta || '{}'),
                        };
                    } else {
                        toolCalls.push({
                            id: value.toolCallId,
                            name: value.toolName,
                            arguments: JSON.parse(value.argsTextDelta || '{}'),
                        });
                    }
                    break;
                case 'finish':
                    finishReason = aiToPfFinishReason(value.finishReason);
                    usage = {
                        promptTokens: value.usage?.promptTokens ?? 0,
                        completionTokens: value.usage?.completionTokens ?? 0,
                        totalTokens: (value.usage?.promptTokens ?? 0) + (value.usage?.completionTokens ?? 0),
                    };
                    break;
                case 'error':
                    throw value.error instanceof Error
                        ? value.error
                        : new Error(String(value.error));
                case 'tool-call-result':
                    // Tool results are fed back in subsequent messages — ignore here
                    break;
            }
        }
    } finally {
        reader.releaseLock();
    }

    return { text, toolCalls, finishReason, usage };
}
