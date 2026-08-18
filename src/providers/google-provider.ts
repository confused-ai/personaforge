/**
 * Google Gemini LLM provider (native SDK).
 * Requires: npm install @google/generative-ai
 *
 * Supports: gemini-2.5-pro-preview, gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash, etc.
 */

import type {
    LLMProvider,
    Message,
    GenerateResult,
    GenerateOptions,
    LLMToolDefinition,
    ToolCall,
} from './types.js';
import { normalizeFinishReason } from './types.js';
import { createDebugLogger, type DebugLogger } from '../shared/index.js';
import { createRequire } from 'node:module';
// ESM-safe require: tsup's ESM bundle turns bare require() into a shim that
// throws "Dynamic require not supported". createRequire restores sync peer-dep loading.
const _require = createRequire(import.meta.url);

// ── Minimal SDK types (compile-time only; runtime: @google/generative-ai) ──

interface GoogleGenerativeAIClient {
    getGenerativeModel(params: GetModelParams): GoogleModel;
}

interface GetModelParams {
    model: string;
    systemInstruction?: string;
    generationConfig?: GenerationConfig;
    tools?: GoogleTool[];
}

interface GenerationConfig {
    temperature?: number;
    maxOutputTokens?: number;
    stopSequences?: string[];
}

interface GoogleModel {
    generateContent(request: GoogleRequest, requestOptions?: { signal?: AbortSignal; headers?: Record<string, string> }): Promise<{ response: GoogleResponse }>;
    generateContentStream(request: GoogleRequest, requestOptions?: { signal?: AbortSignal; headers?: Record<string, string> }): Promise<{ stream: AsyncIterable<GoogleStreamChunk> }>;
}

interface GoogleRequest {
    contents: GoogleContent[];
    tools?: GoogleTool[];
    toolConfig?: { functionCallingConfig: { mode?: 'AUTO' | 'NONE' | 'ANY'; allowedFunctionNames?: string[] } };
}

interface GoogleContent {
    role: 'user' | 'model';
    parts: GooglePart[];
}

type GooglePart =
    | { text: string }
    | { functionCall: { name: string; args: Record<string, unknown> } }
    | { functionResponse: { name: string; response: { output: unknown } } }
    | { inlineData: { mimeType: string; data: string } };

interface GoogleTool {
    functionDeclarations: Array<{
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    }>;
}

interface GoogleResponse {
    text(): string;
    candidates?: Array<{
        content: { parts: GooglePart[]; role: string };
        finishReason?: string;
    }>;
    usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
    };
}

interface GoogleStreamChunk {
    text(): string;
    candidates?: Array<{
        content: { parts: GooglePart[] };
        finishReason?: string;
    }>;
    usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        totalTokenCount?: number;
    };
}

// ── Config ──

export interface GoogleProviderConfig {
    /** @google/generative-ai client instance (optional; constructed from apiKey if omitted) */
    client?: GoogleGenerativeAIClient;
    /** Model id (default: gemini-2.0-flash) */
    model?: string;
    /** API key (or GOOGLE_API_KEY / GEMINI_API_KEY env var) */
    apiKey?: string;
    /** Enable debug logging */
    debug?: boolean;
}

// ── Message conversion ──

function toGeminiContents(messages: Message[]): GoogleContent[] {
    const contents: GoogleContent[] = [];

    for (const m of messages) {
        if (m.role === 'system') continue; // handled via systemInstruction

        if (m.role === 'tool') {
            const toolMsg = m as Message & { toolCallId?: string; toolCallId2?: string; toolName?: string; name?: string; tool_call_id?: string };
            const text = typeof m.content === 'string' ? m.content
                : Array.isArray(m.content) ? (m.content.find((p: { type: string }) => p.type === 'text') as { text?: string } | undefined)?.text ?? '' : '';
            contents.push({
                role: 'user',
                parts: [{
                    functionResponse: {
                        // Gemini keys functionResponse by the FUNCTION NAME — prefer
                        // the tool call name over the (generated) call id.
                        name: toolMsg.toolName ?? toolMsg.name ?? toolMsg.toolCallId ?? toolMsg.tool_call_id ?? 'tool',
                        response: { output: text },
                    },
                }],
            });
            continue;
        }

        if (m.role === 'assistant') {
            const asst = m as Message & { toolCalls?: ToolCall[]; tool_calls?: Array<{ id: string; type?: string; function?: { name?: string; arguments?: string } }> };
            const parts: GooglePart[] = [];
            const textContent = typeof asst.content === 'string' ? asst.content : '';
            if (textContent) parts.push({ text: textContent });
            const calls = Array.isArray(asst.toolCalls)
                ? asst.toolCalls
                : (asst.tool_calls ?? []).map((tc) => {
                      let args: Record<string, unknown> = {};
                      const raw = tc.function?.arguments;
                      if (typeof raw === 'string' && raw) {
                          try { args = JSON.parse(raw) as Record<string, unknown>; } catch { args = {}; }
                      }
                      return { id: tc.id, name: tc.function?.name ?? 'unknown', arguments: args };
                  });
            for (const tc of calls) {
                parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
            }
            if (parts.length > 0) contents.push({ role: 'model', parts });
            continue;
        }

        // user message
        const parts: GooglePart[] = Array.isArray(m.content)
            ? m.content.map((part) => {
                if (part.type === 'text') return { text: part.text };
                if (part.type === 'image_url' && 'image_url' in part) {
                    const url = (part.image_url as { url: string }).url;
                    // base64 data URL
                    const b64Match = url.match(/^data:([^;]+);base64,(.+)$/);
                    if (b64Match) {
                        return { inlineData: { mimeType: b64Match[1], data: b64Match[2] } };
                    }
                }
                return { text: typeof part === 'string' ? part : JSON.stringify(part) };
            })
            : [{ text: typeof m.content === 'string' ? m.content : '' }];

        contents.push({ role: 'user', parts });
    }

    return contents;
}

function extractSystemInstruction(messages: Message[]): string | undefined {
    const sys = messages.find((m) => m.role === 'system');
    return sys ? (typeof sys.content === 'string' ? sys.content : '') : undefined;
}

function toGeminiTools(tools?: LLMToolDefinition[]): GoogleTool[] | undefined {
    if (!tools?.length) return undefined;
    return [{
        functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters as Record<string, unknown>,
        })),
    }];
}

/** Map personforge toolChoice → Gemini functionCallingConfig. */
function toGeminiToolConfig(toolChoice: GenerateOptions['toolChoice']): GoogleRequest['toolConfig'] {
    if (!toolChoice || toolChoice === 'auto') return { functionCallingConfig: { mode: 'AUTO' } };
    if (toolChoice === 'none') return { functionCallingConfig: { mode: 'NONE' } };
    if (toolChoice === 'required') return { functionCallingConfig: { mode: 'ANY' } };
    // { type: 'tool', name }
    return {
        functionCallingConfig: {
            mode: 'ANY',
            allowedFunctionNames: [toolChoice.name],
        },
    };
}

// Module-level monotonic counter for stable tool-call ids. Gemini responses do
// not carry an id for `functionCall` parts — the runner needs a stable id to
// pair tool results. A monotonic counter guarantees uniqueness even when the
// model emits multiple parallel calls with the same name in one response.
let toolCallSeq = 0;

function extractToolCalls(candidates: GoogleResponse['candidates']): ToolCall[] {
    if (!candidates?.length) return [];
    const calls: ToolCall[] = [];
    for (const candidate of candidates) {
        for (const part of candidate.content?.parts ?? []) {
            if ('functionCall' in part) {
                calls.push({
                    id: `${part.functionCall.name}-${toolCallSeq++}`,
                    name: part.functionCall.name,
                    arguments: part.functionCall.args,
                });
            }
        }
    }
    return calls;
}

// ── Provider ──

export class GoogleProvider implements LLMProvider {
    private client: GoogleGenerativeAIClient;
    private model: string;
    private logger: DebugLogger;

    constructor(config: GoogleProviderConfig = {}) {
        this.logger = createDebugLogger('GoogleProvider', config.debug ?? false);

        if (config.client) {
            this.client = config.client;
        } else {
            const apiKey = config.apiKey
                ?? (typeof process !== 'undefined' && (process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY))
                ?? '';
            if (!apiKey) {
                throw new Error('GoogleProvider requires apiKey or GOOGLE_API_KEY / GEMINI_API_KEY env var');
            }
            const { GoogleGenerativeAI } = _require('@google/generative-ai') as {
                GoogleGenerativeAI: new (key: string) => GoogleGenerativeAIClient;
            };
            this.client = new GoogleGenerativeAI(apiKey);
        }

        this.model = config.model ?? 'gemini-2.0-flash';
        this.logger.debug('GoogleProvider initialized', undefined, { model: this.model });
    }

    async generateText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
        const startTime = Date.now();
        this.logger.logStart('Gemini generateText', { messageCount: messages.length, model: this.model });

        const systemInstruction = extractSystemInstruction(messages);
        const contents = toGeminiContents(messages);
        const geminiTools = toGeminiTools(options?.tools);

        const geminiModel = this.client.getGenerativeModel({
            model: this.model,
            ...(systemInstruction && { systemInstruction }),
            generationConfig: {
                temperature: options?.temperature ?? 0.7,
                ...(options?.maxTokens && { maxOutputTokens: options.maxTokens }),
                ...(options?.stop?.length && { stopSequences: options.stop }),
            },
            ...(geminiTools && { tools: geminiTools }),
        });

        const result = await geminiModel.generateContent(
            {
                contents,
                ...(geminiTools && { tools: geminiTools }),
                ...(geminiTools && { toolConfig: toGeminiToolConfig(options?.toolChoice) }),
            },
            {
                ...(options?.signal && { signal: options.signal }),
                ...(options?.headers && { headers: options.headers }),
            },
        );
        const response = result.response;

        const text = response.text() ?? '';
        const toolCalls = extractToolCalls(response.candidates);
        const finishReason = normalizeFinishReason(response.candidates?.[0]?.finishReason) ?? 'stop';
        const usage = response.usageMetadata ? {
            promptTokens: response.usageMetadata.promptTokenCount,
            completionTokens: response.usageMetadata.candidatesTokenCount,
            totalTokens: response.usageMetadata.totalTokenCount,
        } : undefined;

        const duration = Date.now() - startTime;
        this.logger.logComplete('Gemini generateText', duration, { textLength: text.length, toolCallsCount: toolCalls.length });

        return { text, toolCalls: toolCalls.length ? toolCalls : undefined, finishReason, usage };
    }

    async streamText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
        const startTime = Date.now();

        const systemInstruction = extractSystemInstruction(messages);
        const contents = toGeminiContents(messages);
        const geminiTools = toGeminiTools(options?.tools);

        const geminiModel = this.client.getGenerativeModel({
            model: this.model,
            ...(systemInstruction && { systemInstruction }),
            generationConfig: {
                temperature: options?.temperature ?? 0.7,
                ...(options?.maxTokens && { maxOutputTokens: options.maxTokens }),
                ...(options?.stop?.length && { stopSequences: options.stop }),
            },
            ...(geminiTools && { tools: geminiTools }),
        });

        const streamResult = await geminiModel.generateContentStream(
            {
                contents,
                ...(geminiTools && { tools: geminiTools }),
                ...(geminiTools && { toolConfig: toGeminiToolConfig(options?.toolChoice) }),
            },
            {
                ...(options?.signal && { signal: options.signal }),
                ...(options?.headers && { headers: options.headers }),
            },
        );

        let fullText = '';
        const toolCalls: ToolCall[] = [];
        let finishReason: GenerateResult['finishReason'];
        let usage: GenerateResult['usage'];

        for await (const chunk of streamResult.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
                fullText += chunkText;
                options?.onChunk?.(chunkText);
            }

            const chunkToolCalls = extractToolCalls(chunk.candidates as GoogleResponse['candidates']);
            toolCalls.push(...chunkToolCalls);

            if (chunk.candidates?.[0]?.finishReason) {
                finishReason = normalizeFinishReason(chunk.candidates[0].finishReason);
            }
            if (chunk.usageMetadata) {
                usage = {
                    promptTokens: chunk.usageMetadata.promptTokenCount,
                    completionTokens: chunk.usageMetadata.candidatesTokenCount,
                    totalTokens: chunk.usageMetadata.totalTokenCount,
                };
            }
        }

        const duration = Date.now() - startTime;
        this.logger.logComplete('Gemini streamText', duration, { textLength: fullText.length, toolCallsCount: toolCalls.length });

        return { text: fullText, toolCalls: toolCalls.length ? toolCalls : undefined, finishReason, usage };
    }
}
