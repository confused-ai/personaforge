/**
 * @confused-ai/runnable — LCEL-style composable primitives.
 *
 * A `Runnable<I, O>` is the universal unit of composition:
 *   .invoke(input)                 — single call
 *   .batch(inputs, concurrency?)   — parallel
 *   .stream(input)                 — async-iterable token stream
 *   .pipe(next)                    — chain two Runnables
 *   .withRetry(opts)               — retry on error
 *   .withFallbacks(alts)           — fallback list
 *   .withConfig(cfg)               — inject config
 *   .assign(steps)                 — parallel fan-out, merge
 *   .bind(kwargs)                  — partial application
 *   .map(fn)                       — transform output
 *
 * ```ts
 * const chain = prompt.pipe(llm).pipe(parser);
 * const result = await chain.invoke({ question: 'What is 2+2?' });
 * ```
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RunnableConfig {
  tags?: string[];
  metadata?: Record<string, unknown>;
  signal?: AbortSignal;
  [key: string]: unknown;
}

// ── Runnable base ─────────────────────────────────────────────────────────────

export abstract class Runnable<I = unknown, O = unknown> {
  abstract invoke(input: I, config?: RunnableConfig): Promise<O>;

  async *stream(input: I, config?: RunnableConfig): AsyncGenerator<O> {
    // Default: yield single result. Subclasses override for true streaming.
    yield await this.invoke(input, config);
  }

  async batch(inputs: I[], config?: RunnableConfig & { concurrency?: number }): Promise<O[]> {
    const concurrency = config?.concurrency ?? inputs.length;
    const results: O[] = new Array<O>(inputs.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= inputs.length) return;
        results[i] = await this.invoke(inputs[i] as I, config);
      }
    });
    await Promise.all(workers);
    return results;
  }

  pipe<O2>(next: Runnable<O, O2>): RunnableSequence<I, O2> {
    return new RunnableSequence([this as Runnable<I, unknown>, next as Runnable<unknown, O2>]);
  }

  map<O2>(fn: (output: O) => O2 | Promise<O2>): Runnable<I, O2> {
    return new RunnableLambda<I, O2>(async (input: I, cfg?: RunnableConfig) => {
      const out = await this.invoke(input, cfg);
      return fn(out);
    });
  }

  bind(kwargs: Partial<I>): Runnable<I, O> {
     
    const self = this;
    return new RunnableLambda<I, O>(async (input: I, cfg?: RunnableConfig) => {
      const merged = typeof input === 'object' && input !== null
        ? { ...kwargs, ...input }
        : input;
      return self.invoke(merged as I, cfg);
    });
  }

  withRetry(opts?: { maxRetries?: number; delayMs?: number }): Runnable<I, O> {
    const maxRetries = opts?.maxRetries ?? 3;
    const delayMs = opts?.delayMs ?? 100;
     
    const self = this;
    return new RunnableLambda<I, O>(async (input: I, cfg?: RunnableConfig) => {
      let lastErr: unknown;
      for (let i = 0; i <= maxRetries; i++) {
        try {
          return await self.invoke(input, cfg);
        } catch (err) {
          lastErr = err;
          if (i < maxRetries) await sleep(delayMs * Math.pow(2, i));
        }
      }
      throw lastErr;
    });
  }

  withFallbacks(fallbacks: Runnable<I, O>[]): Runnable<I, O> {
     
    const self = this;
    return new RunnableLambda<I, O>(async (input: I, cfg?: RunnableConfig) => {
      try {
        return await self.invoke(input, cfg);
      } catch {
        for (const fb of fallbacks) {
          try { return await fb.invoke(input, cfg); } catch { /* try next */ }
        }
        throw new Error('[Runnable.withFallbacks] All fallbacks exhausted.');
      }
    });
  }

  withConfig(defaults: RunnableConfig): Runnable<I, O> {
     
    const self = this;
    return new RunnableLambda<I, O>((input: I, cfg?: RunnableConfig) =>
      self.invoke(input, { ...defaults, ...cfg }),
    );
  }

  /** Fan-out: run named Runnables in parallel, merge results into the input. */
  assign<Steps extends Record<string, Runnable<I, unknown>>>(
    steps: Steps,
  ): Runnable<I, I & { [K in keyof Steps]: Awaited<ReturnType<Steps[K]['invoke']>> }> {
     
    const self = this;
    type Out = I & { [K in keyof Steps]: Awaited<ReturnType<Steps[K]['invoke']>> };
    return new RunnableLambda<I, Out>(async (input: I, cfg?: RunnableConfig) => {
      const base = await self.invoke(input, cfg);
      const entries = Object.entries(steps);
      const values = await Promise.all(entries.map(([, r]) => r.invoke(input, cfg)));
      const extra: Record<string, unknown> = {};
      entries.forEach(([key], i) => { extra[key] = values[i]; });
      if (typeof base === 'object' && base !== null) return { ...base, ...extra } as Out;
      return extra as Out;
    });
  }
}

// ── RunnableLambda ────────────────────────────────────────────────────────────

/** Wrap any async function as a Runnable. */
export class RunnableLambda<I = unknown, O = unknown> extends Runnable<I, O> {
  private readonly fn: (input: I, config?: RunnableConfig) => Promise<O>;
  constructor(fn: (input: I, config?: RunnableConfig) => Promise<O> | O) {
    super();
    this.fn = async (input, config) => fn(input, config);
  }
  async invoke(input: I, config?: RunnableConfig): Promise<O> {
    return this.fn(input, config);
  }
}

// ── RunnableSequence ──────────────────────────────────────────────────────────

/** A chain of Runnables executed in order. */
export class RunnableSequence<I = unknown, O = unknown> extends Runnable<I, O> {
  readonly steps: Runnable[];
  constructor(steps: Runnable[]) {
    super();
    // Flatten nested sequences for efficient traversal.
    this.steps = steps.flatMap((s) => (s instanceof RunnableSequence ? s.steps : [s]));
  }
  async invoke(input: I, config?: RunnableConfig): Promise<O> {
    let val: unknown = input;
    for (const step of this.steps) {
      val = await step.invoke(val, config);
    }
    return val as O;
  }
  async *stream(input: I, config?: RunnableConfig): AsyncGenerator<O> {
    if (this.steps.length === 0) return;
    let val: unknown = input;
    for (let i = 0; i < this.steps.length - 1; i++) {
      val = await this.steps[i]!.invoke(val, config);
    }
    const last = this.steps[this.steps.length - 1]!;
    yield* last.stream(val, config) as AsyncGenerator<O>;
  }
  pipe<O2>(next: Runnable<O, O2>): RunnableSequence<I, O2> {
    return new RunnableSequence<I, O2>([...this.steps, next as Runnable]);
  }
}

// ── RunnableParallel ──────────────────────────────────────────────────────────

/** Run named Runnables in parallel, producing an object of results. */
export class RunnableParallel<I = unknown, Steps extends Record<string, Runnable<I, unknown>> = Record<string, Runnable<I, unknown>>> extends Runnable<I, { [K in keyof Steps]: Awaited<ReturnType<Steps[K]['invoke']>> }> {
  private readonly steps: Steps;
  constructor(steps: Steps) { super(); this.steps = steps; }
  async invoke(input: I, config?: RunnableConfig): Promise<{ [K in keyof Steps]: Awaited<ReturnType<Steps[K]['invoke']>> }> {
    const entries = Object.entries(this.steps);
    const values = await Promise.all(entries.map(([, r]) => r.invoke(input, config)));
    const result: Record<string, unknown> = {};
    entries.forEach(([key], i) => { result[key] = values[i]; });
    return result as { [K in keyof Steps]: Awaited<ReturnType<Steps[K]['invoke']>> };
  }
}

// ── RunnablePassthrough ───────────────────────────────────────────────────────

/** Passes input through unchanged. Used as identity in assign chains. */
export class RunnablePassthrough<T = unknown> extends Runnable<T, T> {
  async invoke(input: T): Promise<T> { return input; }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
