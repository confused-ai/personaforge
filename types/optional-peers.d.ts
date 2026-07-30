/**
 * Ambient stubs for optional peer dependencies.
 * Used when peers are not installed so `tsc` / prepack typecheck can succeed.
 * Real package types take precedence when the peer is present in node_modules.
 */

declare module '@anthropic-ai/sdk' {
  class Anthropic {
    constructor(opts?: { apiKey?: string });
    messages: {
      create(body: unknown): Promise<{
        content: Anthropic.Messages.ContentBlock[];
        stop_reason: string | null;
        usage: { input_tokens: number; output_tokens: number };
      }>;
      stream(body: unknown): AsyncIterable<unknown>;
    };
  }

  namespace Anthropic {
    namespace Messages {
      type MessageParam = {
        role: string;
        content: unknown;
      };
      type Tool = {
        name: string;
        description?: string;
        input_schema: Record<string, unknown>;
      };
      /** Flat shape so find/filter consumers can read fields without predicates. */
      type ContentBlock = {
        type: string;
        text: string;
        id: string;
        name: string;
        input: unknown;
      };
    }
  }

  export default Anthropic;
  export { Anthropic };
}

declare module '@google/generative-ai' {
  export type Content = {
    role: string;
    parts: Array<{ text?: string }>;
  };

  export class GenerativeModel {
    startChat(opts: { history: Content[] }): {
      sendMessage(text: string): Promise<{
        response: {
          text(): string;
          usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            totalTokenCount?: number;
          };
        };
      }>;
      sendMessageStream(text: string): Promise<{
        stream: AsyncIterable<{ text(): string }>;
      }>;
    };
  }

  export class GoogleGenerativeAI {
    constructor(apiKey: string);
    getGenerativeModel(opts: { model: string }): GenerativeModel;
  }
}

declare module 'ollama' {
  export type Message = {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
  };

  export class Ollama {
    constructor(opts?: { host?: string });
    chat(opts: {
      model: string;
      messages: Message[];
      stream?: false;
    }): Promise<{
      message: { content: string };
      prompt_eval_count: number;
      eval_count: number;
    }>;
    chat(opts: {
      model: string;
      messages: Message[];
      stream: true;
    }): Promise<AsyncIterable<{ message: { content: string } }>>;
  }
}

declare module 'openai' {
  class OpenAI {
    constructor(opts?: { apiKey?: string; baseURL?: string });
    chat: {
      completions: {
        create(body: unknown): Promise<{
          choices: Array<{
            message: {
              content?: string | null;
              tool_calls?: OpenAI.Chat.ChatCompletionMessageToolCall[];
            };
            finish_reason?: string | null;
          }>;
          usage?: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
          };
        }>;
      };
    };
  }

  namespace OpenAI {
    namespace Chat {
      type ChatCompletionMessageParam = {
        role: string;
        content?: string | null;
        name?: string;
        tool_call_id?: string;
        tool_calls?: unknown;
      };
      type ChatCompletionMessageToolCall = {
        id: string;
        type?: string;
        function: { name: string; arguments: string };
      };
    }
  }

  export default OpenAI;
  export { OpenAI };
}

declare module 'yahoo-finance2' {
  const yahooFinance: {
    quote(symbol: string): Promise<unknown>;
  };
  export default yahooFinance;
}

declare module 'pexels' {
  export function createClient(apiKey: string): unknown;
}

declare module '@ffmpeg-installer/ffmpeg' {
  const ffmpegInstaller: { path: string };
  export default ffmpegInstaller;
  export const path: string;
}
