/**
 * @personaforge/models — AWS Bedrock adapter. Lazy SDK import.
 */

import type { LLMProvider, Message, GenerateOptions, GenerateResult } from '../core/index.js';
import type { ModelAdapterConfig } from './types.js';

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
    const client = await getClient();
    const { InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime').catch(() => { throw new Error(MISSING_SDK_MSG); });

    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens:        opts?.maxTokens ?? config.maxTokens ?? 4096,
      messages:          messages.filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: m.content })),
      system:            messages.find((m) => m.role === 'system')?.content,
    });

    const res = await client.send(new InvokeModelCommand({ modelId: model, body: new TextEncoder().encode(body), contentType: 'application/json', accept: 'application/json' }));
    const decoded = JSON.parse(new TextDecoder().decode(res.body)) as { content: Array<{ text: string }>; usage: { input_tokens: number; output_tokens: number } };

    return {
      text:         decoded.content[0]?.text ?? '',
      finishReason: 'stop',
      usage: {
        promptTokens:     decoded.usage?.input_tokens,
        completionTokens: decoded.usage?.output_tokens,
        totalTokens:      (decoded.usage?.input_tokens ?? 0) + (decoded.usage?.output_tokens ?? 0),
      },
    };
  }

  return { generateText };
}
