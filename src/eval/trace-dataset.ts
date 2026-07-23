/**
 * @personaforge/eval — dataset <-> trace loop.
 *
 * Closes the LangSmith-style workflow:
 *   1. Capture a span from a production trace (TraceSpan)
 *   2. Add it to a dataset as an EvalSample (spanToSample)
 *   3. Replay the dataset against a new prompt/agent version (replayDataset)
 *   4. Diff old vs new results side by side (diffResults)
 *
 * ```ts
 * const sample = spanToSample(span);
 * dataset.push(sample);
 * const results = await replayDataset(dataset, agent.run);
 * const diffs = diffResults(baseline, results);
 * ```
 */

import type { EvalSample } from './dataset.js';

// ── Trace span ────────────────────────────────────────────────────────────────

/** Minimal trace span — matches what src/observe exports. */
export interface TraceSpan {
  id: string;
  name: string;
  input: string;
  output: string;
  startTime: number;
  endTime: number;
  metadata?: Record<string, unknown>;
}

// ── span -> sample ────────────────────────────────────────────────────────────

/** Convert a production trace span into an eval dataset sample. */
export function spanToSample(span: TraceSpan, opts?: { expectedField?: 'output' }): EvalSample {
  return {
    id: span.id,
    input: span.input,
    expected: span.output,
    metadata: { source: 'trace', spanName: span.name, ...span.metadata },
  };
}

// ── Replay ────────────────────────────────────────────────────────────────────

export interface ReplayResult {
  sample: EvalSample;
  output: string;
  durationMs: number;
}

/**
 * Replay every sample in a dataset through a run function.
 * Returns results matched to samples for easy diffing.
 */
export async function replayDataset(
  samples: EvalSample[],
  run: (input: string) => Promise<string | { text: string }>,
  opts?: { concurrency?: number },
): Promise<ReplayResult[]> {
  const concurrency = opts?.concurrency ?? 4;
  const results: ReplayResult[] = new Array(samples.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, samples.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= samples.length) return;
      const sample = samples[i]!;
      const t0 = Date.now();
      const raw = await run(sample.input);
      const output = typeof raw === 'string' ? raw : raw.text;
      results[i] = { sample, output, durationMs: Date.now() - t0 };
    }
  });
  await Promise.all(workers);
  return results;
}

// ── Diff ──────────────────────────────────────────────────────────────────────

export interface DiffEntry {
  sampleId?: string;
  input: string;
  expected?: string;
  baselineOutput: string;
  newOutput: string;
  /** True when newOutput === baselineOutput. */
  unchanged: boolean;
  /** When expected exists: did the new output match? */
  newMatchesExpected?: boolean;
  baselineMatchesExpected?: boolean;
}

/** Side-by-side diff of two replay runs. Arrays must be same length & order. */
export function diffResults(baseline: ReplayResult[], candidate: ReplayResult[]): DiffEntry[] {
  if (baseline.length !== candidate.length) {
    throw new Error('[diffResults] baseline and candidate must have the same length.');
  }
  return baseline.map((b, i) => {
    const c = candidate[i]!;
    const expected = b.sample.expected;
    return {
      sampleId: b.sample.id,
      input: b.sample.input,
      expected,
      baselineOutput: b.output,
      newOutput: c.output,
      unchanged: b.output === c.output,
      newMatchesExpected: expected !== undefined ? c.output === expected : undefined,
      baselineMatchesExpected: expected !== undefined ? b.output === expected : undefined,
    };
  });
}

// ── Summary ───────────────────────────────────────────────────────────────────

export interface DiffSummary {
  total: number;
  unchanged: number;
  changed: number;
  regressions: number;
  improvements: number;
}

/** Summarise a diff for CI/CD reporting. */
export function summarizeDiff(diffs: DiffEntry[]): DiffSummary {
  let unchanged = 0;
  let changed = 0;
  let regressions = 0;
  let improvements = 0;
  for (const d of diffs) {
    if (d.unchanged) { unchanged++; continue; }
    changed++;
    if (d.baselineMatchesExpected === true && d.newMatchesExpected === false) regressions++;
    if (d.baselineMatchesExpected === false && d.newMatchesExpected === true) improvements++;
  }
  return { total: diffs.length, unchanged, changed, regressions, improvements };
}
