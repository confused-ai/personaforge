/**
 * @personaforge/models — Ollama adapter (local models). Lazy SDK import.
 */

import type { LLMProvider, Message, GenerateOptions, GenerateResult } from '../core/index.js';
import type { ModelAdapterConfig } from './types.js';
import { isReasoningStreamEnabled } from '../streaming/reasoning-accumulator.js';

const MISSING_SDK_MSG =
  '[personaforge] Ollama adapter requires the ollama package.\n' +
  '  Install: npm install ollama\n' +
  '  Also ensure Ollama is running locally: https://ollama.ai';

const DEFAULT_MODEL  = 'llama3.2';
const DEFAULT_HOST   = 'http://localhost:11434';

// Model families known to support native thinking (matched as substrings, case-insensitive).
const THINKING_FAMILIES = ['deepseek-r1', 'qwen3', 'gpt-oss', 'magistral', 'deepseek-v3.1'];

type Think = boolean | 'high' | 'medium' | 'low';

export function ollama(config: ModelAdapterConfig & { think?: Think } = {}): LLMProvider {
  const model   = config.model   ?? DEFAULT_MODEL;
  const baseURL = config.baseURL ?? process.env['OLLAMA_HOST'] ?? DEFAULT_HOST;

  function resolveThink(): Think | undefined {
    if (!isReasoningStreamEnabled()) return undefined;
    if (config.think !== undefined) return config.think === false ? undefined : config.think;
    const lower = model.toLowerCase();
    return THINKING_FAMILIES.some((f) => lower.includes(f)) ? true : undefined;
  }

  let _client: unknown = null;

  async function getClient(): Promise<import('ollama').Ollama> {
    if (_client) return _client as import('ollama').Ollama;
    const mod = await import('ollama').catch(() => { throw new Error(MISSING_SDK_MSG); });
    _client = new mod.Ollama({ host: baseURL });
    return _client as import('ollama').Ollama;
  }

  function toOllamaMessages(msgs: Message[]): import('ollama').Message[] {
    return msgs.map((m) => ({
      role:    m.role as 'system' | 'user' | 'assistant' | 'tool',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
  }

  async function generateText(messages: Message[], _opts?: GenerateOptions): Promise<GenerateResult> {
    const client = await getClient();
    const think = resolveThink();
    const res = await (client as import('ollama').Ollama).chat({
      model,
      messages: toOllamaMessages(messages),
      ...(think !== undefined && { think }),
    });
    return {
      text:         res.message.content,
      finishReason: 'stop',
      usage: {
        promptTokens:     res.prompt_eval_count,
        completionTokens: res.eval_count,
        totalTokens:      res.prompt_eval_count + res.eval_count,
      },
      ...(res.message.thinking && { reasoning: [{ text: res.message.thinking }] }),
    };
  }

  async function streamText(messages: Message[], opts?: GenerateOptions): Promise<GenerateResult> {
    const client = await getClient();
    const think = resolveThink();
    const stream = await (client as import('ollama').Ollama).chat({
      model,
      messages: toOllamaMessages(messages),
      stream:   true,
      ...(think !== undefined && { think }),
    });

    let fullText = '';
    let thinkingBuffer = '';
    for await (const chunk of stream) {
      const thinking = chunk.message.thinking;
      if (thinking) {
        thinkingBuffer += thinking;
        opts?.onReasoning?.({ text: thinking });
      }
      const delta = chunk.message.content;
      if (delta) {
        fullText += delta;
        opts?.onChunk?.(delta);
      }
    }
    return {
      text:         fullText,
      finishReason: 'stop',
      ...(thinkingBuffer && { reasoning: [{ text: thinkingBuffer }] }),
    };
  }

  return { generateText, streamText };
}
