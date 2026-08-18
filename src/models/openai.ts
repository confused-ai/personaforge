/**
 * @personaforge/models — OpenAI adapter.
 *
 * SRP  — This file owns only the OpenAI provider.
 * DIP  — Returns LLMProvider interface; caller never sees the SDK class.
 * Lazy — SDK imported inside the factory function. Zero cost if unused.
 */

import type { LLMProvider, Message, GenerateOptions, GenerateResult } from '../core/index.js';
import type { ModelAdapterConfig } from './types.js';

const MISSING_SDK_MSG =
  '[personaforge] OpenAI adapter requires the openai package.\n' +
  '  Install: npm install openai  (or: yarn add / pnpm add / bun add openai)';

const DEFAULT_MODEL = 'gpt-4o';

/**
 * Create an OpenAI LLMProvider.
 *
 * @example
 * ```ts
 * const llm = openai({ model: 'gpt-4o-mini' });
 * const agent = createAgent({ name: 'bot', instructions: 'Help the user.', llm });
 * ```
 */
export function openai(config: ModelAdapterConfig = {}): LLMProvider {
  const apiKey  = config.apiKey  ?? process.env['OPENAI_API_KEY'];
  const model   = config.model   ?? process.env['OPENAI_MODEL'] ?? DEFAULT_MODEL;
  const baseURL = config.baseURL ?? process.env['OPENAI_BASE_URL'];

  /** Lazy-loaded SDK singleton — avoids re-import on every call. */
  let _client: unknown = null;

  async function getClient(): Promise<import('openai').default> {
    if (_client) return _client as import('openai').default;
    const mod = await import('openai').catch(() => { throw new Error(MISSING_SDK_MSG); });
    _client = new mod.default({ apiKey, baseURL });
    return _client as import('openai').default;
  }

  /** Convert framework Messages → OpenAI chat messages. O(n). */
  function toOpenAIMessages(msgs: Message[]): import('openai').OpenAI.Chat.ChatCompletionMessageParam[] {
    return msgs.map((m) => {
      const msg = {
        role:    m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
        ...(m.name && { name: m.name }),
        ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
        ...(m.tool_calls && { tool_calls: m.tool_calls }),
      };
      return msg as unknown as import('openai').OpenAI.Chat.ChatCompletionMessageParam;
    });
  }

  async function generateText(messages: Message[], opts?: GenerateOptions): Promise<GenerateResult> {
    const client = await getClient();
    const tools = opts?.tools?.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
    const request = {
      model,
      messages:    toOpenAIMessages(messages),
      tool_choice: opts?.toolChoice === 'none' ? 'none' : opts?.toolChoice === 'required' ? 'required' : 'auto',
      ...(tools?.length && { tools }),
      ...((opts?.maxTokens ?? config.maxTokens) !== undefined && { max_tokens: opts?.maxTokens ?? config.maxTokens }),
      ...((opts?.temperature ?? config.temperature) !== undefined && { temperature: opts?.temperature ?? config.temperature }),
    };
    const openaiClient = client as import('openai').default;
    const createChat = openaiClient.chat.completions.create.bind(openaiClient.chat.completions) as
      (body: unknown, options?: { headers?: Record<string, string> }) => Promise<import('openai').OpenAI.Chat.Completions.ChatCompletion>;
    const res = await createChat(request, opts?.headers ? { headers: opts.headers } : undefined);

    const choice = res.choices[0];
    const text   = choice?.message.content ?? '';
    const toolCalls = choice?.message.tool_calls
      ?.filter((tc) => 'function' in tc)
      .map((tc) => ({
        id:        tc.id,
        name:      tc.function.name,
        arguments: JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>,
      }));
    const usage = res.usage ? {
      promptTokens:     res.usage.prompt_tokens,
      completionTokens: res.usage.completion_tokens,
      totalTokens:      res.usage.total_tokens,
    } : undefined;

    const finishReason: NonNullable<GenerateResult['finishReason']> = choice?.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop';

    return {
      text,
      ...(toolCalls?.length && { toolCalls }),
      finishReason,
      ...(usage && { usage }),
    };
  }

  async function streamText(messages: Message[], opts?: GenerateOptions): Promise<GenerateResult> {
    const client = await getClient();
    const tools = opts?.tools?.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.parameters } }));
    const request = {
      model,
      messages:    toOpenAIMessages(messages),
      tool_choice: opts?.toolChoice === 'none' ? 'none' : 'auto',
      stream:      true,
      ...(tools?.length && { tools }),
    };
    const openaiClient = client as import('openai').default;
    const createChatStream = openaiClient.chat.completions.create.bind(openaiClient.chat.completions) as
      (body: unknown, options?: { headers?: Record<string, string> }) => Promise<unknown>;
    const stream = await createChatStream(request, opts?.headers ? { headers: opts.headers } : undefined) as unknown as AsyncIterable<{
      choices: Array<{
        delta?: {
          content?: string | null;
          tool_calls?: Array<{
            index: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    }>;

    let fullText = '';
    const toolCallAccum: Map<number, { id: string; name: string; args: string }> = new Map();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;

      if (delta.content) {
        fullText += delta.content;
        opts?.onChunk?.(delta.content);
      }

      // Accumulate streaming tool calls — O(1) per chunk via Map index
      for (const tc of delta.tool_calls ?? []) {
        const existing = toolCallAccum.get(tc.index);
        if (existing) {
          existing.args += tc.function?.arguments ?? '';
        } else {
          toolCallAccum.set(tc.index, {
            id:   tc.id ?? '',
            name: tc.function?.name ?? '',
            args: tc.function?.arguments ?? '',
          });
        }
      }
    }

    const toolCalls = toolCallAccum.size > 0
      ? Array.from(toolCallAccum.values()).map((tc) => ({
          id:        tc.id,
          name:      tc.name,
          arguments: JSON.parse(tc.args || '{}') as Record<string, unknown>,
        }))
      : undefined;

    return {
      text: fullText,
      ...(toolCalls && { toolCalls }),
      finishReason: toolCalls ? 'tool_calls' : 'stop',
    };
  }

  return { generateText, streamText };
}
