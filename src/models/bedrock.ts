/**
 * @personaforge/models — AWS Bedrock adapter. Lazy SDK import.
 */

import type { LLMProvider, Message, GenerateOptions, GenerateResult } from '../core/index.js';
import type { ModelAdapterConfig } from './types.js';
import { anthropicThinkingConfig } from '../providers/anthropic-thinking.js';

const MISSING_SDK_MSG =
  '[personaforge] Bedrock adapter requires @aws-sdk/client-bedrock-runtime.\n' +
  '  Install: npm install @aws-sdk/client-bedrock-runtime';

const DEFAULT_MODEL = 'anthropic.claude-3-5-sonnet-20241022-v2:0';

export function bedrock(config: ModelAdapterConfig & { region?: string } = {}): LLMProvider {
  const model  = config.model  ?? DEFAULT_MODEL;
  const region = (config as { region?: string }).region ?? process.env['AWS_REGION'] ?? 'us-east-1';

  let _client: unknown = null;

  async function getClient(): Promise<import('@aws-sdk/client-bedrock-runtime').BedrockRuntimeClient> {
    if (_client) return _client as import('@aws-sdk/client-bedrock-runtime').BedrockRuntimeClient;
    const mod = await import('@aws-sdk/client-bedrock-runtime').catch(() => { throw new Error(MISSING_SDK_MSG); });
    _client = new mod.BedrockRuntimeClient({ region });
    return _client as import('@aws-sdk/client-bedrock-runtime').BedrockRuntimeClient;
  }

  async function generateText(messages: Message[], opts?: GenerateOptions): Promise<GenerateResult> {
    // This adapter speaks the Anthropic-on-Bedrock body shape only.
    if (!/anthropic/i.test(model)) {
      throw new Error(`Bedrock adapter supports Anthropic models only; got ${JSON.stringify(model)}.`);
    }
    const client = await getClient();
    const { InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime').catch(() => { throw new Error(MISSING_SDK_MSG); });

    const maxTokens = opts?.maxTokens ?? config.maxTokens ?? 4096;
    const thinking  = anthropicThinkingConfig(model, maxTokens);

    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens:        maxTokens,
      messages:          messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
      system:            messages.find((m) => m.role === 'system')?.content,
      ...(thinking && { thinking }),
    });

    const res = await client.send(new InvokeModelCommand({ modelId: model, body: new TextEncoder().encode(body), contentType: 'application/json', accept: 'application/json' }));
    const decoded = JSON.parse(new TextDecoder().decode(res.body)) as {
      content?: Array<{ type?: string; text?: string; thinking?: string; signature?: string; data?: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };
    const blocks = decoded.content ?? [];

    const text = blocks
      .filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('');

    type ReasoningItem = NonNullable<GenerateResult['reasoning']>[number];
    const reasoning: ReasoningItem[] = blocks.flatMap((b): ReasoningItem[] => {
      if (b.type === 'thinking') return [{ text: b.thinking ?? '', signature: b.signature }];
      if (b.type === 'redacted_thinking') return [{ text: '', redacted: b.data }];
      return [];
    });

    return {
      text,
      finishReason: 'stop',
      usage: {
        promptTokens:     decoded.usage?.input_tokens,
        completionTokens: decoded.usage?.output_tokens,
        totalTokens:      (decoded.usage?.input_tokens ?? 0) + (decoded.usage?.output_tokens ?? 0),
      },
      ...(reasoning.length && { reasoning }),
    };
  }

  return { generateText };
}
