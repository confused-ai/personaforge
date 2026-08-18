/**
 * Anthropic LLM provider (Claude 3.5 Sonnet, Opus, Haiku)
 * Requires: npm install @anthropic-ai/sdk
 *
 * Usage:
 * import { AnthropicProvider } from 'personaforge-core/llm';
 * const llm = new AnthropicProvider({ model: 'claude-3-5-sonnet-20241022' });
 * const result = await llm.generateText([{ role: 'user', content: 'Hello' }]);
 */

import type {
    LLMProvider,
    Message,
    GenerateResult,
    GenerateOptions,
    LLMToolDefinition,
    ToolCall,
    AssistantMessage,
} from './types.js';
import { normalizeFinishReason } from './types.js';
import { DebugLogger, createDebugLogger } from '../shared/index.js';
import { createRequire } from 'node:module';
// ESM-safe require: tsup's ESM bundle turns bare require() into a shim that
// throws "Dynamic require not supported". createRequire restores sync peer-dep loading.
const _require = createRequire(import.meta.url);

// Minimal types for compile-time (runtime: peer dependency @anthropic-ai/sdk)
interface AnthropicClient {
    messages: {
        create(params: AnthropicCreateParams, requestOptions?: { signal?: AbortSignal; headers?: Record<string, string> }): Promise<AnthropicResponse | AsyncIterable<AnthropicStreamEvent>>;
    };
}

/**
 * Re-throw an SDK error with its HTTP `status` and `headers` preserved on the
 * thrown object so the retry layer can read `Retry-After` / rate-limit headers.
 */
function rethrowWithStatus(err: unknown): never {
    if (err && typeof err === 'object') {
        const e = err as Record<string, unknown>;
        const status = e['status'] ?? (e['response'] as Record<string, unknown> | undefined)?.['status'];
        const headers = e['headers'] ?? (e['response'] as Record<string, unknown> | undefined)?.['headers'];
        if (status !== undefined && e['status'] === undefined) e['status'] = status;
        if (headers !== undefined && e['headers'] === undefined) e['headers'] = headers;
    }
    throw err;
}

interface AnthropicCreateParams {
    model: string;
    max_tokens: number;
    system?: string;
    messages: AnthropicMessageParam[];
    tools?: AnthropicTool[];
    temperature?: number;
    stream?: boolean;
}

type AnthropicContent = string | Array<{ type: string; text?: string; source?: { type: string; media_type?: string; data?: string } }>;

type AnthropicMessageParam =
    | { role: 'user'; content: AnthropicContent }
    | { role: 'assistant'; content: AnthropicContent };

interface AnthropicTool {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
}

interface AnthropicResponse {
    id: string;
    type: string;
    role: string;
    content: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>;
    model: string;
    stop_reason: string;
    usage: { input_tokens: number; output_tokens: number };
}

interface AnthropicStreamEvent {
    type: string;
    index?: number;
    // content_block_start: block has type 'text' or 'tool_use' (with id, name)
    content_block?: { type: string; text?: string; id?: string; name?: string };
    delta?: { type: string; text?: string; partial_json?: string };
    usage?: { input_tokens: number; output_tokens: number };
    message?: Partial<AnthropicResponse>;
    stop_reason?: string;
}

export interface AnthropicProviderConfig {
    /** Anthropic client instance */
    client?: AnthropicClient;
    /** Model name (default: claude-3-5-sonnet-20241022) */
    model?: string;
    /** API key (used only if client not provided) */
    apiKey?: string;
    /** Enable debug logging */
    debug?: boolean;
}

/**
 * Convert framework Message[] to Anthropic format.
 * Handles: system, user, assistant (with tool_calls), tool (results).
 */
function toAnthropicMessages(messages: Message[]): { system?: string; messages: AnthropicMessageParam[] } {
    let system: string | undefined;
    const anthropicMessages: AnthropicMessageParam[] = [];

    for (const m of messages) {
        if (m.role === 'system') {
            system = typeof m.content === 'string' ? m.content : '';
            continue;
        }

        // tool result → user message with tool_result block
        if (m.role === 'tool') {
            const toolMsg = m as Message & { toolCallId?: string; tool_call_id?: string };
            const text = typeof m.content === 'string' ? m.content
                : Array.isArray(m.content) ? ((m.content.find((p: { type: string; text?: string }) => p.type === 'text') as { text?: string } | undefined)?.text ?? '') : '';
            anthropicMessages.push({
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: toolMsg.toolCallId ?? toolMsg.tool_call_id ?? '', content: text } as unknown as { type: string; text?: string }],
            });
            continue;
        }

        // assistant with tool_calls → content blocks
        if (m.role === 'assistant') {
            const asst = m as AssistantMessage;
            const blocks: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> = [];
            const textContent = typeof asst.content === 'string' ? asst.content : '';
            if (textContent) blocks.push({ type: 'text', text: textContent });
            if (asst.toolCalls?.length) {
                for (const tc of asst.toolCalls) {
                    blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
                }
            }
            anthropicMessages.push({ role: 'assistant', content: blocks as AnthropicContent });
            continue;
        }

        // user message with optional multimodal content
        const content: AnthropicContent = Array.isArray(m.content)
            ? m.content.map(part => {
                if (part.type === 'text') return { type: 'text', text: part.text };
                if (part.type === 'image_url' && 'image_url' in part) {
                    return { type: 'image', source: { type: 'url', url: (part.image_url as { url: string }).url } };
                }
                return { type: 'text', text: String(part) };
            })
            : (m.content || '');

        anthropicMessages.push({ role: 'user', content });
    }

    return { system, messages: anthropicMessages };
}

/**
 * Convert framework tools to Anthropic format
 */
function toAnthropicTools(tools?: LLMToolDefinition[]): AnthropicTool[] | undefined {
    if (!tools?.length) return undefined;
    return tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters as Record<string, unknown>,
    }));
}

/**
 * Anthropic Claude implementation of LLMProvider
 * Install: npm install @anthropic-ai/sdk
 */
export class AnthropicProvider implements LLMProvider {
    private client: AnthropicClient;
    private model: string;
    private logger: DebugLogger;

    constructor(config: AnthropicProviderConfig = {}) {
        this.logger = createDebugLogger('AnthropicProvider', config.debug ?? false);

        if (config.client) {
            this.client = config.client;
        } else {
            const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY;
            if (!apiKey) {
                throw new Error('AnthropicProvider requires apiKey (or ANTHROPIC_API_KEY env var)');
            }
            const Anthropic = _require('@anthropic-ai/sdk').Anthropic;
            this.client = new Anthropic({ apiKey });
        }

        this.model = config.model ?? 'claude-3-5-sonnet-20241022';
        this.logger.debug('AnthropicProvider initialized', undefined, { model: this.model });
    }

    async generateText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
        const startTime = Date.now();
        this.logger.logStart('Anthropic generateText', {
            messageCount: messages.length,
            model: this.model,
        });

        const { system, messages: anthropicMsgs } = toAnthropicMessages(messages);
        const tools = toAnthropicTools(options?.tools);

        const reqParams = {
            model: this.model,
            max_tokens: options?.maxTokens ?? 4096,
            system,
            messages: anthropicMsgs,
            temperature: options?.temperature ?? 0.7,
            ...(tools && { tools }),
        } as AnthropicCreateParams;
        const requestOpts = options?.signal || options?.headers
            ? { ...(options.signal && { signal: options.signal }), ...(options.headers && { headers: options.headers }) }
            : undefined;
        const response = await (requestOpts
            ? this.client.messages.create(reqParams, requestOpts)
            : this.client.messages.create(reqParams)
        ).catch(rethrowWithStatus) as AnthropicResponse;

        let text = '';
        const toolCalls: ToolCall[] = [];

        for (const block of response.content) {
            if (block.type === 'text' && block.text) {
                text += block.text;
            } else if (block.type === 'tool_use' && block.id && block.name && block.input) {
                toolCalls.push({
                    id: block.id,
                    name: block.name,
                    arguments: block.input as Record<string, unknown>,
                });
            }
        }

        const duration = Date.now() - startTime;
        this.logger.logComplete('Anthropic generateText', duration, {
            textLength: text.length,
            toolCallsCount: toolCalls.length,
            tokens: response.usage?.output_tokens,
        });

        return {
            text,
            toolCalls: toolCalls.length ? toolCalls : undefined,
            finishReason: normalizeFinishReason(response.stop_reason),
            usage: {
                promptTokens: response.usage?.input_tokens,
                completionTokens: response.usage?.output_tokens,
                totalTokens: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
            },
        };
    }

    async streamText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
        const startTime = Date.now();
        const { system, messages: anthropicMsgs } = toAnthropicMessages(messages);
        const tools = toAnthropicTools(options?.tools);

        const streamParams = {
            model: this.model,
            max_tokens: options?.maxTokens ?? 4096,
            system,
            messages: anthropicMsgs,
            temperature: options?.temperature ?? 0.7,
            stream: true,
            ...(tools && { tools }),
        } as AnthropicCreateParams;
        const requestOpts = options?.signal || options?.headers
            ? { ...(options.signal && { signal: options.signal }), ...(options.headers && { headers: options.headers }) }
            : undefined;
        const stream = await (requestOpts
            ? this.client.messages.create(streamParams, requestOpts)
            : this.client.messages.create(streamParams)
        ).catch(rethrowWithStatus) as AsyncIterable<AnthropicStreamEvent>;

        let fullText = '';
        // index → {id, name, args} for in-flight tool blocks
        const toolBlocks = new Map<number, { id: string; name: string; args: string }>();
        let finishReason: GenerateResult['finishReason'] = 'max_tokens';
        let usage: GenerateResult['usage'];

        for await (const event of stream) {
            if (event.type === 'content_block_start' && event.index !== undefined && event.content_block) {
                const block = event.content_block;
                if (block.type === 'tool_use' && block.id && block.name) {
                    toolBlocks.set(event.index, { id: block.id, name: block.name, args: '' });
                }
            } else if (event.type === 'content_block_delta' && event.index !== undefined && event.delta) {
                if (event.delta.type === 'text_delta' && event.delta.text) {
                    fullText += event.delta.text;
                    options?.onChunk?.(event.delta.text);
                } else if (event.delta.type === 'input_json_delta' && event.delta.partial_json) {
                    const block = toolBlocks.get(event.index);
                    if (block) {
                        block.args += event.delta.partial_json;
                        // (tool-call streaming is returned via result.toolCalls, not via onChunk in the canonical LLMProvider contract)
                        }
                }
            } else if (event.type === 'message_delta' && event.stop_reason) {
                finishReason = normalizeFinishReason(event.stop_reason);
            }

            if (event.usage) {
                usage = {
                    promptTokens: event.usage.input_tokens,
                    completionTokens: event.usage.output_tokens,
                    totalTokens: event.usage.input_tokens + event.usage.output_tokens,
                };
            }
        }

        const toolCalls: ToolCall[] = Array.from(toolBlocks.values()).map((b) => ({
            id: b.id,
            name: b.name,
            arguments: (() => {
                try { return JSON.parse(b.args) as Record<string, unknown>; } catch { return {}; }
            })(),
        }));

        const duration = Date.now() - startTime;
        this.logger.logComplete('Anthropic streamText', duration, {
            textLength: fullText.length,
            toolCallsCount: toolCalls.length,
        });

        return {
            text: fullText,
            toolCalls: toolCalls.length ? toolCalls : undefined,
            finishReason,
            usage,
        };
    }
}
