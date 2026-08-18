/**
 * @personaforge/models — Anthropic adapter.
 * Lazy SDK import. Returns LLMProvider (DIP).
 */

import type { LLMProvider, Message, GenerateOptions, GenerateResult } from '../core/index.js';
import type { ModelAdapterConfig } from './types.js';

const MISSING_SDK_MSG =
  '[personaforge] Anthropic adapter requires the @anthropic-ai/sdk package.\n' +
  '  Install: npm install @anthropic-ai/sdk';

const DEFAULT_MODEL = 'claude-3-5-sonnet-20241022';

export function anthropic(config: ModelAdapterConfig = {}): LLMProvider {
  const apiKey = config.apiKey ?? process.env['ANTHROPIC_API_KEY'];
  const model  = config.model  ?? DEFAULT_MODEL;

  let _client: unknown = null;

  async function getClient(): Promise<import('@anthropic-ai/sdk').default> {
    if (_client) return _client as import('@anthropic-ai/sdk').default;
    const mod = await import('@anthropic-ai/sdk').catch(() => { throw new Error(MISSING_SDK_MSG); });
    _client = new mod.default({ apiKey });
    return _client as import('@anthropic-ai/sdk').default;
  }

  function toAnthropicMessages(msgs: Message[]): import('@anthropic-ai/sdk').Anthropic.Messages.MessageParam[] {
    const out: unknown[] = [];
    for (const m of msgs) {
      if (m.role === 'system') continue;

      // tool result → user message with a tool_result content block keyed by tool_call id.
      if (m.role === 'tool') {
        const toolMsg = m as Message & { toolCallId?: string };
        const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
        out.push({
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: toolMsg.toolCallId ?? '', content: text }],
        });
        continue;
      }

      // assistant with toolCalls → text + tool_use content blocks.
      if (m.role === 'assistant') {
        const asst = m as Message & { toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> };
        const blocks: unknown[] = [];
        const text = typeof asst.content === 'string' ? asst.content : '';
        if (text) blocks.push({ type: 'text', text });
        for (const tc of asst.toolCalls ?? []) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
        }
        out.push({ role: 'assistant', content: blocks.length ? blocks : text });
        continue;
      }

      out.push({
        role: 'user',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      });
    }
    return out as import('@anthropic-ai/sdk').Anthropic.Messages.MessageParam[];
  }

  function getSystem(msgs: Message[]): string | undefined {
    return msgs.find((m) => m.role === 'system')?.content as string | undefined;
  }

  async function generateText(messages: Message[], opts?: GenerateOptions): Promise<GenerateResult> {
    const client = await getClient();
    const tools = opts?.tools?.map((t) => ({
      name:         t.name,
      description:  t.description,
      input_schema: t.parameters as import('@anthropic-ai/sdk').Anthropic.Messages.Tool['input_schema'],
    }));

    const system = getSystem(messages);
    const anthropicClient = client as import('@anthropic-ai/sdk').default;
    const createMessage = anthropicClient.messages.create.bind(anthropicClient.messages) as
      (body: unknown, options?: { headers?: Record<string, string> }) => Promise<import('@anthropic-ai/sdk').Anthropic.Messages.Message>;
    const res = await createMessage({
      model,
      max_tokens: opts?.maxTokens ?? config.maxTokens ?? 4096,
      messages:   toAnthropicMessages(messages),
      ...(system !== undefined && { system }),
      ...(tools?.length && { tools }),
    }, opts?.headers ? { headers: opts.headers } : undefined);

    const textBlock  = res.content.find((b) => b.type === 'text');
    const toolBlocks = res.content.filter((b) => b.type === 'tool_use');
    const text       = textBlock ? textBlock.text : '';

    const toolCalls = toolBlocks.length
      ? toolBlocks.map((b) => ({ id: b.id, name: b.name, arguments: b.input as Record<string, unknown> }))
      : undefined;

    return {
      text,
      ...(toolCalls && { toolCalls }),
      finishReason: res.stop_reason === 'tool_use' ? 'tool_calls' : 'stop',
      usage: { promptTokens: res.usage.input_tokens, completionTokens: res.usage.output_tokens, totalTokens: res.usage.input_tokens + res.usage.output_tokens },
    };
  }

  async function streamText(messages: Message[], opts?: GenerateOptions): Promise<GenerateResult> {
    const client = await getClient();
    let fullText = '';
    let promptTokens = 0;
    let completionTokens = 0;
    let finishReason: GenerateResult['finishReason'] = 'stop';

    const tools = opts?.tools?.map((t) => ({
      name:         t.name,
      description:  t.description,
      input_schema: t.parameters as import('@anthropic-ai/sdk').Anthropic.Messages.Tool['input_schema'],
    }));

    const system = getSystem(messages);
    const anthropicClient = client as import('@anthropic-ai/sdk').default;
    const streamMessage = anthropicClient.messages.stream.bind(anthropicClient.messages) as
      (body: unknown, options?: { headers?: Record<string, string> }) => AsyncIterable<unknown>;
    const stream = streamMessage({
      model,
      max_tokens: opts?.maxTokens ?? config.maxTokens ?? 4096,
      messages:   toAnthropicMessages(messages),
      ...(system !== undefined && { system }),
      ...(tools?.length && { tools }),
      ...(opts?.signal && { signal: opts.signal }),
    }, opts?.headers ? { headers: opts.headers } : undefined);

    for await (const event of stream as AsyncIterable<{
      type: string;
      delta?: { type?: string; text?: string; stop_reason?: string };
      message?: { usage?: { input_tokens?: number; output_tokens?: number } };
      usage?: { output_tokens?: number };
    }>) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
        fullText += event.delta.text;
        opts?.onChunk?.(event.delta.text);
      } else if (event.type === 'message_start' && event.message?.usage) {
        promptTokens = event.message.usage.input_tokens ?? 0;
        completionTokens = event.message.usage.output_tokens ?? 0;
      } else if (event.type === 'message_delta') {
        if (event.usage?.output_tokens !== undefined) completionTokens = event.usage.output_tokens;
        if (event.delta?.stop_reason) finishReason = event.delta.stop_reason === 'tool_use' ? 'tool_calls' : 'stop';
      }
    }

    return {
      text: fullText,
      finishReason,
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    };
  }

  return { generateText, streamText };
}
