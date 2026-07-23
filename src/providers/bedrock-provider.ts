/**
 * Amazon Bedrock Converse API — optional peer: `@aws-sdk/client-bedrock-runtime`.
 *
 * Supports text-only messages (system, user, assistant). Tool / multimodal messages
 * are not mapped yet; extend as needed for your models.
 */

import type {
    LLMProvider,
    Message,
    GenerateResult,
    GenerateOptions,
} from './types.js';
import { normalizeFinishReason } from './types.js';

// Minimal Bedrock response shapes — avoids importing the heavy AWS SDK at compile time
interface BedrockConverseResponse {
    output?: { message?: { content?: Array<{ text?: string }> } };
    usage?: { inputTokens?: number; outputTokens?: number };
    stopReason?: string;
}

interface BedrockStreamEvent {
    contentBlockDelta?: { delta?: { text?: string } };
}

interface BedrockConverseStreamResponse {
    stream?: AsyncIterable<BedrockStreamEvent>;
}

// Minimal Bedrock client interface — avoids importing the heavy AWS SDK at compile time
interface BedrockRuntimeClient {
    send(command: unknown): Promise<BedrockConverseResponse | BedrockConverseStreamResponse>;
}

export interface BedrockConverseProviderConfig {
    /** AWS region (e.g. us-east-1). */
    readonly region: string;
    /** Bedrock model or inference profile id (e.g. anthropic.claude-3-5-sonnet-20240620-v1:0). */
    readonly modelId: string;
    /** Optional pre-constructed client; if omitted, one is created with the default credential chain. */
    readonly client?: BedrockRuntimeClient;
}

function flattenText(m: Message): string {
    if (typeof m.content === 'string') {
        return m.content;
    }
    return m.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
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

        const system: { text: string }[] = [];
        const beds: { role: 'user' | 'assistant'; content: { text: string }[] }[] = [];

        for (const m of messages) {
            if (m.role === 'system') {
                const t = flattenText(m);
                if (t) {
                    system.push({ text: t });
                }
                continue;
            }
            if (m.role === 'user') {
                beds.push({ role: 'user', content: [{ text: flattenText(m) }] });
                continue;
            }
            if (m.role === 'assistant') {
                beds.push({ role: 'assistant', content: [{ text: flattenText(m) }] });
                continue;
            }
            if (m.role === 'tool') {
                beds.push({
                    role: 'user',
                    content: [{ text: `[tool result] ${flattenText(m as Message)}` }],
                });
            }
        }

        const cmd = new ConverseCommand({
            modelId: this.modelId,
            ...(system.length ? { system } : {}),
            messages: beds,
            inferenceConfig: {
                maxTokens: options?.maxTokens,
                temperature: options?.temperature,
            },
        });

        const out = await client.send(cmd) as BedrockConverseResponse;
        const contentBlocks = out.output?.message?.content ?? [];
        let text = '';
        for (const block of contentBlocks) {
            if (block && typeof block === 'object' && 'text' in block && typeof (block as { text: string }).text === 'string') {
                text += (block as { text: string }).text;
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
            finishReason: normalizeFinishReason(out.stopReason),
            usage,
        };
    }

    async streamText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
        const client = await this.ensureClient();
        const { ConverseStreamCommand } = await import('@aws-sdk/client-bedrock-runtime');

        const system: { text: string }[] = [];
        const beds: { role: 'user' | 'assistant'; content: { text: string }[] }[] = [];
        for (const m of messages) {
            if (m.role === 'system') {
                const t = flattenText(m);
                if (t) {
                    system.push({ text: t });
                }
                continue;
            }
            if (m.role === 'user') {
                beds.push({ role: 'user', content: [{ text: flattenText(m) }] });
                continue;
            }
            if (m.role === 'assistant') {
                beds.push({ role: 'assistant', content: [{ text: flattenText(m) }] });
                continue;
            }
            if (m.role === 'tool') {
                beds.push({
                    role: 'user',
                    content: [{ text: `[tool result] ${flattenText(m as Message)}` }],
                });
            }
        }

        const cmd = new ConverseStreamCommand({
            modelId: this.modelId,
            ...(system.length ? { system } : {}),
            messages: beds,
            inferenceConfig: {
                maxTokens: options?.maxTokens,
                temperature: options?.temperature,
            },
        });

        const response = await client.send(cmd) as BedrockConverseStreamResponse;
        let text = '';
        const stream = response.stream;
        if (stream) {
            for await (const evt of stream) {
                if (evt.contentBlockDelta?.delta && 'text' in evt.contentBlockDelta.delta) {
                    const delta = evt.contentBlockDelta.delta as { text?: string };
                    const piece = delta.text ?? '';
                    text += piece;
                    options?.onChunk?.(piece);
                }
            }
        }

        return { text, finishReason: 'stop' };
    }
}
