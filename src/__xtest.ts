import type { LLMProvider } from './core/index.js';
export function f(): LLMProvider {
  const x = import('openai');
  const a: import('openai').OpenAI.Chat.ChatCompletionMessageParam[] = [];
  const b: Promise<import('openai').OpenAI.Chat.ChatCompletion> = Promise.resolve({} as never);
  const c: Promise<import('openai').OpenAI.Chat.Completions.ChatCompletion> = Promise.resolve({} as never);
  const y = import('@anthropic-ai/sdk');
  const d: Promise<import('@anthropic-ai/sdk').Anthropic.Messages.Message> = Promise.resolve({} as never);
  const e: import('@anthropic-ai/sdk').Anthropic.Messages.MessageParam[] = [];
  return { generateText: async () => ({} as never), streamText: async () => ({} as never) };
}
