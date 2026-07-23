/**
 * OpenAI LLM provider.
 * Requires: npm install openai
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
import { DebugLogger, createDebugLogger } from '../shared/index.js';
import { createRequire } from 'node:module';
// ESM-safe require: tsup's ESM bundle turns bare require() into a shim that
// throws "Dynamic require not supported". createRequire restores sync peer-dep loading.
const _require = createRequire(import.meta.url);

// Minimal types so we don't require openai at compile time (peer dependency at runtime)
interface OpenAIClient {
    chat: {
        completions: {
            create(params: OpenAICreateParams, requestOptions?: { signal?: AbortSignal }): Promise<OpenAIResponse | AsyncIterable<OpenAIStreamChunk>>;
        };
    };
}
interface OpenAICreateParams {
    model: string;
    messages: OpenAIMessageParam[];
    temperature?: number;
    max_tokens?: number;
    stop?: string[];
    tools?: OpenAITool[];
    tool_choice?: 'auto' | 'none';
    stream?: boolean;
    stream_options?: { include_usage?: boolean };
}

/**
 * Re-throw an SDK error with its HTTP `status` and `headers` preserved on the
 * thrown object, so the retry layer can read `Retry-After` / rate-limit headers.
 * The OpenAI/Anthropic SDKs already expose `.status` and `.headers`; this is a
 * defensive normalisation that also surfaces them in `context` for PersonaForgeError.
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
// Content: string or multimodal parts (text, image_url, etc.) per OpenAI API
type OpenAIContent = string | Array<{ type: string; text?: string; image_url?: { url: string; detail?: string }; file?: { url: string }; audio?: { url: string }; video?: { url: string } }> | null;
type OpenAIMessageParam =
    | { role: 'system' | 'user'; content: OpenAIContent }
    | { role: 'assistant'; content: OpenAIContent; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
    | { role: 'tool'; content: string; tool_call_id: string };
interface OpenAITool {
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
}
interface OpenAIResponse {
    choices?: { message?: { content?: string | null; tool_calls?: { id: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}
interface OpenAIStreamChunk {
    choices?: {
        delta?: {
            content?: string | null;
            tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[]
        };
        finish_reason?: string | null;
    }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export interface OpenAIProviderConfig {
    /** OpenAI client instance, or options to create one */
    client?: OpenAIClient;
    /** Model name (default: gpt-4o). Use e.g. llama3.2, bern2-8b for open models. */
    model?: string;
    /** API key (used only if client is not provided). Optional when baseURL points to a local server (e.g. Ollama). */
    apiKey?: string;
    /** Base URL for the API (e.g. https://api.openai.com/v1, or http://localhost:11434/v1 for Ollama). */
    baseURL?: string;
    /** Enable debug logging */
    debug?: boolean;
}

/**
 * Map framework Message[] to OpenAI format
 */
function toOpenAIMessages(messages: Message[]): OpenAIMessageParam[] {
    return messages.map((m) => {
        if (m.role === 'assistant' && 'toolCalls' in m && (m as { toolCalls?: ToolCall[] }).toolCalls?.length) {
            const content = m.content;
            const normalized = Array.isArray(content) ? content : (content ?? null);
            return {
                role: 'assistant',
                content: normalized as OpenAIContent,
                tool_calls: (m as { toolCalls: ToolCall[] }).toolCalls.map((tc) => ({
                    id: tc.id,
                    type: 'function' as const,
                    function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
                })),
            };
        }
        if (m.role === 'tool') {
            const toolMsg = m as Message & { toolCallId?: string };
            const content = typeof m.content === 'string' ? m.content : (Array.isArray(m.content) ? (m.content.find((p: { type: string; text?: string }) => p.type === 'text') as { text?: string } | undefined)?.text ?? '' : '');
            return {
                role: 'tool',
                content,
                tool_call_id: toolMsg.toolCallId ?? '',
            };
        }
        const content = m.content;
        const normalized = Array.isArray(content) ? content : (content ?? null);
        return { role: m.role as 'system' | 'user' | 'assistant', content: normalized as OpenAIContent };
    });
}

/**
 * Map framework LLMToolDefinition to OpenAI format
 */
function toOpenAITools(tools?: LLMToolDefinition[]): OpenAITool[] | undefined {
    if (!tools?.length) return undefined;
    return tools.map((t) => ({
        type: 'function' as const,
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters as Record<string, unknown>,
        },
    }));
}

/**
 * OpenAI implementation of LLMProvider.
 * Install the openai package: npm install openai
 */
export class OpenAIProvider implements LLMProvider {
    private client: OpenAIClient;
    private model: string;
    private logger: DebugLogger;

    constructor(config: OpenAIProviderConfig = {}) {
        this.logger = createDebugLogger('OpenAIProvider', config.debug ?? false);

        if (config.client) {
            this.client = config.client;
        } else {
            const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY;
            const baseURL = config.baseURL ?? process.env.OPENAI_BASE_URL;
            if (!baseURL && !apiKey) {
                throw new Error('OpenAIProvider requires apiKey (or OPENAI_API_KEY) or baseURL (or OPENAI_BASE_URL)');
            }
            const { OpenAI } = _require('openai') as {
                OpenAI: new (opts: { apiKey?: string; baseURL?: string }) => OpenAIClient;
            };
            this.client = new OpenAI({
                apiKey: apiKey ?? 'not-needed',
                ...(baseURL && { baseURL }),
            });
        }
        this.model = config.model ?? 'gpt-4o';
        this.logger.debug('OpenAIProvider initialized', undefined, { model: this.model });
    }

    async generateText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
        const startTime = Date.now();
        this.logger.logStart('LLM generateText', {
            messageCount: messages.length,
            model: this.model,
        });

        const body: Record<string, unknown> = {
            model: this.model,
            messages: toOpenAIMessages(messages),
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens,
            stop: options?.stop,
        };

        const tools = toOpenAITools(options?.tools);
        if (tools?.length) {
            body.tools = tools;
            body.tool_choice = options?.toolChoice === 'none' ? 'none' : 'auto';
            this.logger.debug('Including tools in request', undefined, { toolCount: tools.length });
        }

        // Forward the abort signal as a per-request option (OpenAI SDK 2nd arg).
        const requestOpts = options?.signal ? { signal: options.signal } : undefined;
        const response = await (requestOpts
            ? this.client.chat.completions.create(body as unknown as OpenAICreateParams, requestOpts as never)
            : this.client.chat.completions.create(body as unknown as OpenAICreateParams)
        ).catch(rethrowWithStatus) as OpenAIResponse;

        const choice = response.choices?.[0];
        if (!choice?.message) {
            this.logger.warn('Empty response from LLM');
            return { text: '', finishReason: normalizeFinishReason(choice?.finish_reason) };
        }

        const msg = choice.message;
        let text = typeof msg.content === 'string' ? msg.content : '';

        const toolCalls: ToolCall[] | undefined = msg.tool_calls?.map((tc: { id: string; function?: { name?: string; arguments?: string } }) => ({
            id: tc.id,
            name: tc.function?.name ?? '',
            arguments: (() => {
                try {
                    return JSON.parse(tc.function?.arguments ?? '{}') as Record<string, unknown>;
                } catch {
                    return {};
                }
            })(),
        }));

        const duration = Date.now() - startTime;
        this.logger.logComplete('LLM generateText', duration, {
            textLength: text.length,
            toolCallsCount: toolCalls?.length ?? 0,
            tokens: response.usage?.total_tokens,
        });

        return {
            text,
            toolCalls: toolCalls?.length ? toolCalls : undefined,
            finishReason: normalizeFinishReason(choice.finish_reason),
            usage: response.usage
                ? {
                    promptTokens: response.usage.prompt_tokens,
                    completionTokens: response.usage.completion_tokens,
                    totalTokens: response.usage.total_tokens,
                }
                : undefined,
        };
    }

    async streamText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
        const body: Record<string, unknown> = {
            model: this.model,
            messages: toOpenAIMessages(messages),
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens,
            stop: options?.stop,
            stream: true,
            // Request the final usage chunk; without this streamed usage is never sent.
            stream_options: { include_usage: true },
        };

        const tools = toOpenAITools(options?.tools);
        if (tools?.length) {
            body.tools = tools;
            body.tool_choice = options?.toolChoice === 'none' ? 'none' : 'auto';
        }

        const requestOpts = options?.signal ? { signal: options.signal } : undefined;
        const stream = await (requestOpts
            ? this.client.chat.completions.create(body as unknown as OpenAICreateParams, requestOpts as never)
            : this.client.chat.completions.create(body as unknown as OpenAICreateParams)
        ).catch(rethrowWithStatus) as AsyncIterable<OpenAIStreamChunk>;

        let fullText = '';
        const toolCallsMap = new Map<number, { id: string; name: string; args: string }>();
        let finishReason: GenerateResult['finishReason'];
        let usage: GenerateResult['usage'];

        for await (const chunk of stream) {
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) continue;

            // Handle text content
            if (delta.content) {
                const textDelta = delta.content;
                fullText += textDelta;
                options?.onChunk?.(textDelta);
            }

            // Handle tool calls
            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    if (tc.id) {
                        toolCallsMap.set(tc.index, {
                            id: tc.id,
                            name: tc.function?.name ?? '',
                            args: tc.function?.arguments ?? ''
                        });
                    } else if (tc.function?.arguments) {
                        const existing = toolCallsMap.get(tc.index);
                        if (existing) {
                            existing.args += tc.function.arguments;
                        }
                    }

                    // tool-call streaming intentionally omitted from onChunk (see LLMProvider contract; deltas are aggregated into result.toolCalls)
                    }
            }

            if (chunk.choices?.[0]?.finish_reason) {
                finishReason = normalizeFinishReason(chunk.choices[0].finish_reason);
            }

            if (chunk.usage) {
                usage = {
                    promptTokens: chunk.usage.prompt_tokens,
                    completionTokens: chunk.usage.completion_tokens,
                    totalTokens: chunk.usage.total_tokens,
                };
            }
        }

        // Parse tool calls
        const toolCalls: ToolCall[] = Array.from(toolCallsMap.values()).map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: (() => {
                try {
                    return JSON.parse(tc.args) as Record<string, unknown>;
                } catch {
                    return {};
                }
            })(),
        }));

        return {
            text: fullText,
            toolCalls: toolCalls.length ? toolCalls : undefined,
            finishReason,
            usage,
        };
    }
}
