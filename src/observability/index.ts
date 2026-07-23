/**
 * Observability module exports.
 *
 * This module is the "batteries-included" observability layer: evaluation runners
 * (`runEvalBatch`, `runLlmAsJudge`, multi-criteria judges), trace stores, OTLP export,
 * and Langfuse / Langsmith ingest. It is a distinct layer from `personaforge/observe`,
 * which provides the lightweight in-process tracing / logging / metrics primitives.
 *
 * The two modules share a handful of logging type names (`Logger`, `LogLevel`,
 * `LogEntry`) but with different shapes — this module's `LogLevel` is an enum that
 * includes `FATAL`, while `personaforge/observe` uses a 4-value string union. Import
 * logging types from whichever module you are already using; do not mix the two.
 */

export * from './types.js';
export { ConsoleLogger } from './console-logger.js';
export { InMemoryTracer } from './tracer.js';
export { MetricsCollectorImpl } from './metrics.js';

// Evaluation framework - export just implementations to avoid conflicts
export {
    EvalAggregator,
    ExactMatchAccuracy,
    PartialMatchAccuracy,
    LevenshteinAccuracy,
    wordOverlapF1,
    rougeLWords,
} from './eval.js';

export { runLlmAsJudge, createMultiCriteriaJudge, runEvalBatch, RAG_CRITERIA, AGENT_CRITERIA } from './llm-judge.js';

// W3C Trace Context — distributed tracing propagation
export {
    parseTraceparent,
    generateTraceparent,
    childSpan,
    extractTraceContext,
    injectTraceHeaders,
    buildTraceparent,
} from './trace-context.js';
export type { TraceContext } from './trace-context.js';
export type {
    LlmJudgeOptions, LlmJudgeResult,
    JudgeCriterion, MultiCriteriaJudgeOptions, CriterionScore,
    MultiCriteriaJudgeResult, MultiCriteriaJudgeInput, MultiCriteriaJudge,
    EvalCase, EvalRunResult, EvalSummary, EvalRunnerOptions,
} from './llm-judge.js';

// OTLP Export
export { OTLPTraceExporter, OTLPMetricsExporter } from './otlp-exporter.js';
export type { OTLPExporterConfig } from './otlp-exporter.js';

// External eval / trace ingestion (optional HTTP clients, no SDK peers)
export { sendLangfuseBatch } from './langfuse-ingest.js';
export type { LangfuseIngestClientConfig } from './langfuse-ingest.js';

export { sendLangSmithRunBatch } from './langsmith-ingest.js';
export type { LangSmithRunPayload } from './langsmith-ingest.js';

// Eval dataset persistence — persistent results, baseline regression detection
export {
    InMemoryEvalStore,
    SqliteEvalStore,
    createSqliteEvalStore,
    runEvalSuite,
} from './eval-store.js';
export type {
    EvalStore,
    EvalDatasetItem,
    EvalDatasetResult,
    EvalSuiteRun,
    EvalReport,
    EvalScorer,
    RunEvalSuiteOptions,
} from './eval-store.js';