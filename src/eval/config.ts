/**
 * Eval configuration types.
 *
 * These are the canonical config shapes imported from the root entry point
 * (`personaforge`) so consumers have a single, stable config surface for
 * running evaluations and defining suites.
 */

import type { BenchmarkSample, Scorer } from './benchmark.js';

/**
 * Options for running an evaluation over a dataset with one or many subjects.
 */
export interface EvalConfig {
    /** Dataset to evaluate. When omitted, the caller must supply one. */
    readonly dataset?: BenchmarkSample[];
    /** Cap the number of samples evaluated. */
    readonly maxSamples?: number;
    /** Max concurrent invocations per subject variant. Default: 1. */
    readonly concurrency?: number;
    /** A sample "passes" when avgScore >= this (0–1). Default: 0.7. */
    readonly passThreshold?: number;
    /** Scorers applied to every sample. */
    readonly scorers?: Scorer[];
    /** Session id forwarded to subject invocations. */
    readonly sessionId?: string;
    /** Restrict evaluation to these variant names. */
    readonly only?: string[];
}

/**
 * Configuration for a named evaluation suite — a reusable bundle of a dataset
 * plus eval options.
 */
export interface EvalSuiteConfig {
    /** Optional suite id. */
    readonly id?: string;
    /** Human-readable suite name. */
    readonly name: string;
    /** Dataset backing the suite. */
    readonly dataset: BenchmarkSample[];
    /** Options passed through to the eval run (dataset excluded). */
    readonly eval?: Omit<EvalConfig, 'dataset'>;
}
