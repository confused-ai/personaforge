/**
 * @personaforge/eval — Evaluation framework for AI agents.
 *
 * Provides:
 * - LLM-as-judge rubric scoring
 * - Text metrics: word overlap F1, ROUGE-L
 * - Eval store: persist and query eval results
 * - Dataset loader: JSON, JSON lines, CSV
 * - Regression runner: CI/CD pass/fail
 */

// Core eval framework (eval result types, text metrics)
export * from './eval.js';

// Eval store (persistence + querying)
export * from './eval-store.js';

// LLM-as-judge
export * from './llm-judge.js';

// Metrics (latency, cost, token stats)
export * from './metrics.js';

// Dataset loading
export * from './dataset.js';

// Regression runner
export * from './regression.js';

// Observability types (MetricsCollector, MetricValue, MetricType)
export * from './obs-types.js';

// Fine-tuning dataset generator
export * from './finetune.js';

// Benchmark pipeline runner
export {
    runBenchmark,
    exactMatchScorer,
    containsScorer,
    wordOverlapScorer,
    rougeLScorer,
    llmJudgeScorer,
    customScorer,
    formatBenchmarkReport,
} from './benchmark.js';
export type {
    BenchmarkSample,
    BenchmarkSampleResult,
    BenchmarkReport,
    BenchmarkSummary,
    BenchmarkOptions,
    Scorer,
    ScorerFn,
} from './benchmark.js';

// Config types (root re-export surface)
export type { EvalConfig, EvalSuiteConfig } from './config.js';

// ── Dataset <-> trace loop ────────────────────────────────────────────────────
export { spanToSample, replayDataset, diffResults, summarizeDiff } from './trace-dataset.js';
export type { TraceSpan, ReplayResult, DiffEntry, DiffSummary } from './trace-dataset.js';
