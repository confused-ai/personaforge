/**
 * The bridge from simulation to self-improvement: the durable log becomes
 * training data.
 *
 * A simulation run produces a `SimReport` — which scenarios the agent handled
 * well and which it failed. The passing outcomes are exactly the labelled
 * examples an optimizer needs: prompt in, good answer out. `trainsetFromReport`
 * turns them into the `OptimizeExample[]` that `bootstrapFewShot` (in
 * @personaforge/optimize) compiles into a self-tuned few-shot prompt.
 *
 * Loop: run → record → simulate → learn → better prompt → run again.
 */

import type { SimReport } from './simulate.js';
import type { OptimizeExample } from '../optimize/index.js';

/**
 * Labelled trainset built from the passing outcomes of a simulation.
 * Each passing scenario contributes `{ input: prompt, expected: text }`.
 */
export function trainsetFromReport(report: SimReport): OptimizeExample[] {
  return report.outcomes
    .filter((o) => o.passed)
    .map((o) => ({ input: o.prompt, expected: o.text }));
}
