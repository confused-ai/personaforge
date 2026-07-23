import { describe, it, expect } from 'vitest';
import { generateStructured, detectProviderKind } from '../src/structured/index.js';
import type { LLMProvider, Message, GenerateOptions, GenerateResult } from '../src/contracts/interfaces.js';

// Fake providers with class names matching detection heuristics.
class OpenAIProvider implements LLMProvider {
  constructor(private reply: string, public lastOpts?: GenerateOptions) {}
  async generateText(_m: Message[], opts?: GenerateOptions): Promise<GenerateResult> {
    this.lastOpts = opts;
    return { text: this.reply, finishReason: 'stop' };
  }
}
class AnthropicProvider implements LLMProvider {
  constructor(private toolArgs: string) {}
  async generateText(_m: Message[], opts?: GenerateOptions): Promise<GenerateResult> {
    // simulate a forced tool call
    return {
      text: '',
      toolCalls: [{ id: '1', name: opts?.tools?.[0]?.name ?? 'x', arguments: this.toolArgs }],
      finishReason: 'tool_calls',
    };
  }
}
class OllamaProvider implements LLMProvider {
  private calls = 0;
  constructor(private replies: string[]) {}
  async generateText(): Promise<GenerateResult> {
    const text = this.replies[Math.min(this.calls, this.replies.length - 1)] ?? '';
    this.calls++;
    return { text, finishReason: 'stop' };
  }
}

const schema = {
  name: 'person',
  parse(data: unknown) {
    const d = data as { name: string; age: number };
    if (typeof d.name !== 'string' || typeof d.age !== 'number') throw new Error('bad shape');
    return d;
  },
};

const msgs: Message[] = [{ role: 'user', content: 'give me a person' }];

describe('detectProviderKind', () => {
  it('detects each provider by class name', () => {
    expect(detectProviderKind(new OpenAIProvider('{}'))).toBe('openai');
    expect(detectProviderKind(new AnthropicProvider('{}'))).toBe('anthropic');
    expect(detectProviderKind(new OllamaProvider(['{}']))).toBe('unknown');
  });
});

describe('generateStructured — OpenAI native', () => {
  it('parses response and passes response_format', async () => {
    const p = new OpenAIProvider('{"name": "Bob", "age": 42}');
    const result = await generateStructured(p, msgs, schema);
    expect(result.data).toEqual({ name: 'Bob', age: 42 });
    expect((p.lastOpts as Record<string, unknown>).response_format).toBeDefined();
  });
});

describe('generateStructured — Anthropic tool-forced', () => {
  it('extracts args from forced tool call', async () => {
    const p = new AnthropicProvider('{"name": "Ann", "age": 30}');
    const result = await generateStructured(p, msgs, schema);
    expect(result.data).toEqual({ name: 'Ann', age: 30 });
  });
});

describe('generateStructured — fallback with retry', () => {
  it('retries on bad output then succeeds', async () => {
    const p = new OllamaProvider(['garbage', '{"name": "Cy", "age": 5}']);
    const result = await generateStructured(p, msgs, schema, { maxRetries: 2 });
    expect(result.data).toEqual({ name: 'Cy', age: 5 });
    expect(result.attempts).toBe(2);
  });
  it('throws after exhausting retries', async () => {
    const p = new OllamaProvider(['nope']);
    await expect(generateStructured(p, msgs, schema, { maxRetries: 1 })).rejects.toThrow();
  });
});
