/**
 * Amazon Bedrock Converse API — optional peer: `@aws-sdk/client-bedrock-runtime`.
 *
 * Supports text + function tools via the Converse `toolUse`/`toolResult` blocks,
 * non-streaming and streaming, with abort-signal forwarding and usage capture.
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

// Minimal Bedrock response shapes — avoids importing the heavy AWS SDK at compile time

/** Text or toolUse content block in a Converse response. */
interface BedrockContentBlock {
    text?: string;
    toolUse?: { toolUseId?: string; name?: string; input?: Record<string, unknown> };
}

interface BedrockConverseResponse {
    output?: { message?: { role?: string; content?: BedrockContentBlock[] } };
    usage?: { inputTokens?: number; outputTokens?: number };
    stopReason?: string;
}

/** Request content block — text, toolUse (assistant hint), or toolResult (tool output). */
type BedrockRequestBlock =
    | { text: string }
    | { toolUse: { toolUseId: string; name: string; input: Record<string, unknown> } }
    | {
          toolResult: {
              toolUseId: string;
              content: Array<{ text?: string }>;
              status?: 'success' | 'error';
          };
      };

interface BedrockRequestMessage {
    role: 'user' | 'assistant';
    content: BedrockRequestBlock[];
}

interface BedrockStreamEvent {
    contentBlockStart?: {
        start?: { toolUse?: { toolUseId?: string; name?: string; input?: Record<string, unknown> } };
    };
    contentBlockDelta?: {
        delta?: { text?: string; toolUse?: { input?: string } };
    };
    usage?: { inputTokens?: number; outputTokens?: number };
    metadata?: { usage?: { inputTokens?: number; outputTokens?: number } };
    messageStop?: { stopReason?: string };
}

interface BedrockConverseStreamResponse {
    stream?: AsyncIterable<BedrockStreamEvent>;
}

// Minimal Bedrock client interface — avoids importing the heavy AWS SDK at compile time
interface BedrockRuntimeClient {
    send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<BedrockConverseResponse | BedrockConverseStreamResponse>;
}

export interface BedrockConverseProviderConfig {
    /** AWS region (e.g. us-east-1). */
    readonly region: string;
    /** Bedrock model or inference profile id (e.g. anthropic.claude-3-5-sonnet-20240620-v1:0). */
    readonly modelId: string;
    /** Optional pre-constructed client; if omitted, one is created with the default credential chain. */
    readonly client?: BedrockRuntimeClient;
}

/** Extract plain text from a message (either a string or text parts). */
function flattenText(m: Message): string {
    if (typeof m.content === 'string') return m.content;
    return m.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
}

/** Tool-call shapes accepted from both runners: flat and OpenAI-style. */
function extractAssistantToolCalls(m: Message): ToolCall[] {
    const typed = m as Message & {
        toolCalls?: Array<{ id: string; name: string; arguments: unknown }>;
        tool_calls?: Array<{ id: string; type?: string; function?: { name?: string; arguments?: string } }>;
    };
    if (Array.isArray(typed.toolCalls)) {
        return typed.toolCalls.map((tc) => ({
            id: tc.id,
            name: tc.name,
            arguments: (tc.arguments ?? {}) as Record<string, unknown>,
        }));
    }
    if (Array.isArray(typed.tool_calls)) {
        return typed.tool_calls.map((tc) => {
            let args: Record<string, unknown> = {};
            const raw = tc.function?.arguments;
            if (typeof raw === 'string' && raw) {
                try { args = JSON.parse(raw) as Record<string, unknown>; } catch { args = {}; }
            }
            return { id: tc.id, name: tc.function?.name ?? 'unknown', arguments: args };
        });
    }
    return [];
}

/**
 * Convert a personforge message list into Bedrock Converse `messages` + `system`,
 * preserving tool-use / tool-result pairing for multi-turn ReAct loops.
 */
function toBedrockMessages(messages: Message[]): { system: Array<{ text: string }>; beds: BedrockRequestMessage[] } {
    const system: Array<{ text: string }> = [];
    const beds: BedrockRequestMessage[] = [];
    const toolResults: Array<{ toolUseId: string; text: string }> = [];

    for (const m of messages) {
        if (m.role === 'system') {
            const t = flattenText(m);
            if (t) system.push({ text: t });
            continue;
        }
        if (m.role === 'user') {
            beds.push({ role: 'user', content: [{ text: flattenText(m) }] });
            continue;
        }
        if (m.role === 'assistant') {
            const calls = extractAssistantToolCalls(m);
            const text = flattenText(m);
            const content: BedrockRequestBlock[] = [];
            if (text) content.push({ text });
            for (const c of calls) {
                content.push({ toolUse: { toolUseId: c.id, name: c.name, input: c.arguments } });
            }
            beds.push({ role: 'assistant', content });
            continue;
        }
        if (m.role === 'tool') {
            const toolMsg = m as Message & { toolCallId?: string; tool_call_id?: string };
            const id = toolMsg.toolCallId ?? toolMsg.tool_call_id ?? 'unknown';
            toolResults.push({ toolUseId: id, text: flattenText(m) });
        }
    }

    // Bedrock requires each toolResult immediately following the assistant
    // message that declared the toolUse. Flush pending toolResults as user turns.
    if (toolResults.length > 0) {
        beds.push({
            role: 'user',
            content: toolResults.map((r) => ({
                toolResult: { toolUseId: r.toolUseId, content: [{ text: r.text }], status: 'success' as const },
            })),
        });
        toolResults.length = 0;
    }

    return { system, beds };
}

/** Convert personforge tools → Bedrock toolConfig. */
function toBedrockToolConfig(tools?: LLMToolDefinition[]): { tools: Array<{ toolSpec: { name: string; description: string; inputSchema: Record<string, unknown> } }> } | undefined {
    if (!tools?.length) return undefined;
    return {
        tools: tools.map((t) => ({
            toolSpec: {
                name: t.name,
                description: t.description,
                inputSchema: t.parameters as Record<string, unknown>,
            },
        })),
    };
}

/** Parse toolUse blocks from a non-streamed Converse response. */
function extractToolCallsFromContent(content: BedrockContentBlock[] | undefined): ToolCall[] | undefined {
    const calls: ToolCall[] = [];
    if (!content) return undefined;
    for (const block of content) {
        if (block.toolUse?.toolUseId && block.toolUse.name) {
            calls.push({
                id: block.toolUse.toolUseId,
                name: block.toolUse.name,
                arguments: block.toolUse.input ?? {},
            });
        }
    }
    return calls.length > 0 ? calls : undefined;
}

/**
 * LLM provider backed by Bedrock `Converse` / `ConverseStream`.
 */
export class BedrockConverseProvider implements LLMProvider {
    private readonly region: string;
    private readonly modelId: string;
    private client: BedrockRuntimeClient | null;

    constructor(config: BedrockConverseProviderConfig) {
        this.region = config.region;
        this.modelId = config.modelId;
        this.client = config.client ?? null;
    }

    private async ensureClient(): Promise<BedrockRuntimeClient> {
        if (this.client) {
            return this.client;
        }
        try {
            const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
            this.client = new BedrockRuntimeClient({ region: this.region });
            return this.client;
        } catch {
            throw new Error(
                'BedrockConverseProvider requires @aws-sdk/client-bedrock-runtime. Install: npm install @aws-sdk/client-bedrock-runtime'
            );
        }
    }

    async generateText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
        const client = await this.ensureClient();
        const { ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');

        const { system, beds } = toBedrockMessages(messages);
        const toolConfig = toBedrockToolConfig(options?.tools);

        const cmd = new ConverseCommand({
            modelId: this.modelId,
            ...(system.length ? { system } : {}),
            // The minimal BedrockRequestMessage/ToolConfiguration shapes are a
            // structural subset of the SDK's strict smithy types — bridge once
            // at the command-construction boundary instead of per field.
            messages: beds,
            inferenceConfig: {
                ...(options?.maxTokens !== undefined && { maxTokens: options.maxTokens }),
                ...(options?.temperature !== undefined && { temperature: options.temperature }),
            },
            ...(toolConfig ? { toolConfig } : {}),
        } as unknown as ConstructorParameters<typeof ConverseCommand>[0]);

        const out = await client.send(cmd, options?.signal ? { abortSignal: options.signal } : undefined) as BedrockConverseResponse;
        const contentBlocks = out.output?.message?.content ?? [];
        let text = '';
        for (const block of contentBlocks) {
            if (block && typeof block === 'object' && typeof block.text === 'string') {
                text += block.text;
            }
        }

        const usage = out.usage
            ? {
                  promptTokens: out.usage.inputTokens,
                  completionTokens: out.usage.outputTokens,
                  totalTokens: (out.usage.inputTokens ?? 0) + (out.usage.outputTokens ?? 0),
              }
            : undefined;

        return {
            text,
            toolCalls: extractToolCallsFromContent(contentBlocks),
            finishReason: normalizeFinishReason(out.stopReason),
            usage,
        };
    }

    async streamText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
        const client = await this.ensureClient();
        const { ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime');

        const { system, beds } = toBedrockMessages(messages);
        const toolConfig = toBedrockToolConfig(options?.tools);

        const cmd = new ConverseStreamCommand({
            modelId: this.modelId,
            ...(system.length ? { system } : {}),
            messages: beds,
            inferenceConfig: {
                ...(options?.maxTokens !== undefined && { maxTokens: options.maxTokens }),
                ...(options?.temperature !== undefined && { temperature: options.temperature }),
            },
            ...(toolConfig ? { toolConfig } : {}),
        } as unknown as ConstructorParameters<typeof ConverseStreamCommand>[0]);

        const response = await client.send(cmd, options?.signal ? { abortSignal: options.signal } : undefined) as BedrockConverseStreamResponse;

        let text = '';
        // ConverseStream tool input arrives as JSON-text deltas after a
        // contentBlockStart that carries the toolUseId + name. Multiple parallel
        // calls each open sequentially, so we append deltas to the most recent block.
        const toolBlocks: Array<{ id: string; name: string; argsRaw: string }> = [];
        let usage: GenerateResult['usage'];
        const stream = response.stream;
        if (stream) {
            for await (const evt of stream) {
                if (evt.contentBlockStart?.start?.toolUse) {
                    const start = evt.contentBlockStart.start.toolUse;
                    toolBlocks.push({
                        id: start.toolUseId ?? `tool_${toolBlocks.length}`,
                        name: start.name ?? 'unknown',
                        argsRaw: '',
                    });
                }
                if (evt.contentBlockDelta?.delta) {
                    const delta = evt.contentBlockDelta.delta;
                    if (delta.text) {
                        text += delta.text;
                        options?.onChunk?.(delta.text);
                    } else if (delta.toolUse?.input && toolBlocks.length > 0) {
                        toolBlocks[toolBlocks.length - 1]!.argsRaw += delta.toolUse.input;
                    }
                }
                const u = evt.usage ?? evt.metadata?.usage;
                if (u && (u.inputTokens !== undefined || u.outputTokens !== undefined)) {
                    usage = {
                        promptTokens: u.inputTokens,
                        completionTokens: u.outputTokens,
                        totalTokens: (u.inputTokens ?? 0) + (u.outputTokens ?? 0),
                    };
                }
            }
        }

        const toolCalls: ToolCall[] = toolBlocks.map((b) => ({
            id: b.id,
            name: b.name,
            arguments: (() => {
                try { return JSON.parse(b.argsRaw || '{}') as Record<string, unknown>; } catch { return {}; }
            })(),
        }));

        return {
            text,
            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
            finishReason: 'stop',
            ...(usage && { usage }),
        };
    }
}
