/**
 * @personaforge/parsers — output parsers for LLM text.
 *
 * Each parser extends Runnable<string, T> so it composes with pipe():
 *   const chain = llm.pipe(jsonParser);
 *
 * Parsers:
 *   StringOutputParser       — identity (trims whitespace)
 *   JsonOutputParser<T>      — extracts + validates JSON (optional Zod schema)
 *   CsvListParser            — comma-separated → string[]
 *   RegexParser              — named capture groups → Record
 *   OutputFixingParser<T>    — re-asks a cheap LLM on parse failure
 *   RetryWithErrorParser<T>  — re-runs the original chain with the error
 */

import { Runnable } from '../runnable/index.js';

/** Common parser interface. */
export interface OutputParser<T> {
  parse(text: string): T | Promise<T>;
  getFormatInstructions(): string;
}

// ── StringOutputParser ────────────────────────────────────────────────────────

export class StringOutputParser extends Runnable<string, string> implements OutputParser<string> {
  async invoke(input: string): Promise<string> { return this.parse(input); }
  parse(text: string): string { return text.trim(); }
  getFormatInstructions(): string { return 'Return plain text.'; }
}

// ── JsonOutputParser ──────────────────────────────────────────────────────────

export interface JsonOutputParserOptions<T> {
  /** Optional Zod schema (duck-typed: .parse() method). */
  schema?: { parse(data: unknown): T; description?: string };
}

export class JsonOutputParser<T = unknown> extends Runnable<string, T> implements OutputParser<T> {
  private readonly schema?: { parse(data: unknown): T; description?: string };
  constructor(opts: JsonOutputParserOptions<T> = {}) { super(); this.schema = opts.schema; }

  async invoke(input: string): Promise<T> { return this.parse(input); }

  parse(text: string): T {
    const raw = extractJson(text);
    if (raw === undefined) throw new ParseError(`No JSON found in output: ${text.slice(0, 200)}`);
    const parsed = JSON.parse(raw) as unknown;
    if (this.schema) return this.schema.parse(parsed);
    return parsed as T;
  }

  getFormatInstructions(): string {
    return 'Respond with valid JSON enclosed in ```json ... ``` or raw JSON.';
  }
}

// ── CsvListParser ─────────────────────────────────────────────────────────────

export class CsvListParser extends Runnable<string, string[]> implements OutputParser<string[]> {
  async invoke(input: string): Promise<string[]> { return this.parse(input); }
  parse(text: string): string[] {
    return text.split(',').map((s) => s.trim()).filter(Boolean);
  }
  getFormatInstructions(): string {
    return 'Return items as a comma-separated list, e.g.: item1, item2, item3';
  }
}

// ── RegexParser ───────────────────────────────────────────────────────────────

export class RegexParser extends Runnable<string, Record<string, string>> implements OutputParser<Record<string, string>> {
  private readonly pattern: RegExp;
  constructor(pattern: RegExp) { super(); this.pattern = pattern; }
  async invoke(input: string): Promise<Record<string, string>> { return this.parse(input); }
  parse(text: string): Record<string, string> {
    const m = this.pattern.exec(text);
    if (!m) throw new ParseError(`Regex did not match: ${this.pattern.toString()}`);
    return { ...m.groups } as Record<string, string>;
  }
  getFormatInstructions(): string { return `Respond matching regex: ${this.pattern.toString()}`; }
}

// ── OutputFixingParser ────────────────────────────────────────────────────────

/**
 * OutputFixingParser — wraps another parser. On failure, sends the original
 * output + the error message to a (cheap) fixer LLM and parses again.
 */
export class OutputFixingParser<T> extends Runnable<string, T> {
  private readonly inner: OutputParser<T>;
  private readonly fixer: (prompt: string) => Promise<string>;
  private readonly maxRetries: number;
  constructor(opts: { parser: OutputParser<T>; fixer: (prompt: string) => Promise<string>; maxRetries?: number }) {
    super();
    this.inner = opts.parser;
    this.fixer = opts.fixer;
    this.maxRetries = opts.maxRetries ?? 1;
  }
  async invoke(input: string): Promise<T> {
    let text = input;
    let lastErr: unknown;
    for (let i = 0; i <= this.maxRetries; i++) {
      try { return await this.inner.parse(text); } catch (err) {
        lastErr = err;
        if (i < this.maxRetries) {
          const prompt = [
            'The following output failed to parse.',
            `Error: ${String(err)}`,
            `Original output:\n${text}`,
            this.inner.getFormatInstructions(),
            'Please fix the output so it parses correctly.',
          ].join('\n');
          text = await this.fixer(prompt);
        }
      }
    }
    throw lastErr;
  }
}

// ── RetryWithErrorParser ──────────────────────────────────────────────────────

/**
 * RetryWithErrorParser — on parse failure, re-runs the *original chain* with
 * the error fed back into the prompt. This lets the model self-correct.
 */
export class RetryWithErrorParser<T> extends Runnable<string, T> {
  private readonly inner: OutputParser<T>;
  private readonly retryChain: Runnable<string, string>;
  private readonly maxRetries: number;
  constructor(opts: {
    parser: OutputParser<T>;
    /** A Runnable that receives `originalInput + error context` and returns a new LLM attempt. */
    retryChain: Runnable<string, string>;
    maxRetries?: number;
  }) {
    super();
    this.inner = opts.parser;
    this.retryChain = opts.retryChain;
    this.maxRetries = opts.maxRetries ?? 1;
  }
  async invoke(input: string): Promise<T> {
    let text = input;
    let lastErr: unknown;
    for (let i = 0; i <= this.maxRetries; i++) {
      try { return await this.inner.parse(text); } catch (err) {
        lastErr = err;
        if (i < this.maxRetries) {
          const retryPrompt = [
            'Previous output failed to parse.',
            `Error: ${String(err)}`,
            `Previous output:\n${text}`,
            this.inner.getFormatInstructions(),
            'Please correct the output.',
          ].join('\n');
          text = await this.retryChain.invoke(retryPrompt);
        }
      }
    }
    throw lastErr;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export class ParseError extends Error {
  constructor(message: string) { super(message); this.name = 'ParseError'; }
}

/** Extract JSON from text that may contain markdown fences. */
function extractJson(text: string): string | undefined {
  // Try fenced block first.
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/.exec(text);
  if (fenced?.[1]) return fenced[1].trim();
  // Try raw JSON object/array.
  const raw = /(\{[\s\S]*\}|\[[\s\S]*\])/.exec(text);
  return raw?.[1]?.trim();
}
