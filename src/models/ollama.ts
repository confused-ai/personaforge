/**
 * @personaforge/models — Ollama adapter (local models). Lazy SDK import.
 */

import type { LLMProvider, Message, GenerateOptions, GenerateResult } from '../core/index.js';
import type { ModelAdapterConfig } from './types.js';

const MISSING_SDK_MSG =
  '[personaforge] Ollama adapter requires the ollama package.\n' +
  '  Install: npm install ollama\n' +
  '  Also ensure Ollama is running locally: https://ollama.ai';

const DEFAULT_MODEL  = 'llama3.2';
const DEFAULT_HOST   = 'http://localhost:11434';

export function ollama(config: ModelAdapterConfig = {}): LLMProvider {
  const model   = config.model   ?? DEFAULT_MODEL;
  const baseURL = config.baseURL ?? process.env['OLLAMA_HOST'] ?? DEFAULT_HOST;

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
    const res = await (client as import('ollama').Ollama).chat({
      model,
      messages: toOllamaMessages(messages),
    });
    return {
      text:         res.message.content,
      finishReason: 'stop',
      usage: {
        promptTokens:     res.prompt_eval_count,
        completionTokens: res.eval_count,
        totalTokens:      res.prompt_eval_count + res.eval_count,
      },
    };
  }

  async function streamText(messages: Message[], opts?: GenerateOptions): Promise<GenerateResult> {
    const client = await getClient();
    const stream = await (client as import('ollama').Ollama).chat({
      model,
      messages: toOllamaMessages(messages),
      stream:   true,
    });

    let fullText = '';
    for await (const chunk of stream) {
      const delta = chunk.message.content;
      if (delta) {
        fullText += delta;
        opts?.onChunk?.(delta);
      }
    }
    return { text: fullText, finishReason: 'stop' };
  }

  return { generateText, streamText };
}
