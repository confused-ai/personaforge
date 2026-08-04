/**
 * Continuous improvement subsystem — core types.
 *
 * This module turns every agent execution into structured, versioned feedback
 * that a learning pipeline can consume to improve future decisions, while
 * keeping every change auditable and deterministically rollback-able:
 *
 *   execution → signal → feedback → scoring → optimization candidates
 *        → versioned promotion (regression-gated) → rollout/rollback
 *
 * @experimental This subsystem is newer and not yet semver-stable.
 */

// ── Feedback sources ──────────────────────────────────────────────────────────

/** Where a piece of feedback originated. */
export type FeedbackSource =
    | 'human'        // a person reviewing the run
    | 'user'         // the end-user (rating / thumbs)
    | 'ai-critique'  // LLM-as-judge critique
    | 'self-reflection' // the agent reviewing its own output
    | 'peer-agent'   // another agent evaluating this run
    | 'reward'       // computed reward function
    | 'metric';      // automated metric (exact match, f1, latency…)

// ── Execution signals ─────────────────────────────────────────────────────────

/** A structured observation extracted from one agent execution. */
export interface ExecutionSignal {
    readonly id: string;
    readonly runId?: string;
    readonly agentId?: string;
    readonly sessionId?: string;
    readonly taskType?: string;
    readonly model?: string;
    readonly variantId?: string;
    readonly prompt?: string;
    readonly output?: string;
    readonly expected?: string;
    /** Whether the execution was judged successful (any signal). */
    readonly passed?: boolean;
    readonly error?: string;
    readonly finishReason?: string;
    readonly steps?: number;
    /** Detailed tool-call telemetry, used by tool-selection optimization. */
    readonly toolCalls?: ReadonlyArray<{
        readonly name: string;
        readonly args?: unknown;
        readonly ok?: boolean;
        readonly durationMs?: number;
        readonly costUsd?: number;
    }>;
    readonly latencyMs?: number;
    readonly costUsd?: number;
    readonly tokensIn?: number;
    readonly tokensOut?: number;
    readonly memoryUsed?: number;
    readonly createdAt: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}

// ── Execution feedback ────────────────────────────────────────────────────────

/** One structured feedback record about a run, from any source. */
export interface ExecutionFeedback {
    readonly id: string;
    readonly agentId?: string;
    readonly runId: string;
    readonly sessionId?: string;
    readonly source: FeedbackSource;
    /** Normalised 0…1 score when applicable (rating/10, judge score/10, …). */
    readonly score?: number;
    /** Discrete thumbs: 1 = up, 0 = neutral, -1 = down. */
    readonly rating?: -1 | 0 | 1;
    /** Reward contributed by a reward function. */
    readonly reward?: number;
    readonly comment?: string;
    readonly signalId?: string;
    /** The execution signal this feedback refers to (denormalised for convenience). */
    readonly signal?: ExecutionSignal;
    /** Arbitrary numeric metrics attached to the feedback. */
    readonly metrics?: Readonly<Record<string, number>>;
    readonly tags?: readonly string[];
    readonly createdAt: string;
    readonly metadata?: Readonly<Record<string, unknown>>;
}

// ── Reward functions ──────────────────────────────────────────────────────────

export interface RewardContext {
    readonly expected?: string;
    readonly actual?: string;
    readonly passed?: boolean;
    readonly signal?: ExecutionSignal;
    readonly metrics?: Readonly<Record<string, number>>;
}

/** Computes a normalised reward in [0, 1] for an execution. */
export type RewardFunction = (ctx: RewardContext) => number;

// ── Evaluation metrics ────────────────────────────────────────────────────────

export interface EvaluationMetricInput {
    readonly runId?: string;
    readonly agentId?: string;
    readonly expected?: string;
    readonly actual?: string;
    readonly passed?: boolean;
    readonly signal?: ExecutionSignal;
    readonly metrics?: Readonly<Record<string, number>>;
}

/** A single named, reusable evaluation metric scoring in [0, 1]. */
export interface EvaluationMetric {
    readonly name: string;
    readonly score: (input: EvaluationMetricInput) => number;
}

// ── Performance scoring ───────────────────────────────────────────────────────

/** Weighting controlling how a composite performance score is computed. */
export interface PerformanceWeights {
    /** Weight of correctness/quality. Default 1. */
    readonly quality: number;
    /** Weight of cost efficiency (lower cost = better). Default 0.2. */
    readonly cost: number;
    /** Weight of latency (lower latency = better). Default 0.2. */
    readonly latency: number;
}

/** Aggregate performance of an agent (or task type) over a window. */
export interface PerformanceScore {
    readonly agentId?: string;
    readonly taskType?: string;
    readonly windowStart: string;
    readonly windowEnd: string;
    readonly samples: number;
    readonly successRate: number;
    readonly meanScore: number;
    readonly meanReward: number;
    readonly meanRating: number;
    readonly errorRate: number;
    readonly meanLatencyMs: number;
    readonly meanCostUsd: number;
    /** 0…100 blended score using the supplied/configured weights. */
    readonly composite: number;
    /** Score breakdown per feedback source (mean score per source). */
    readonly bySource: Readonly<Partial<Record<FeedbackSource, number>>>;
}

// ── Optimization domains ──────────────────────────────────────────────────────

/** The seven axes an agent can automatically optimise. */
export enum OptimizationDomain {
    PROMPT = 'prompt',
    TOOL_SELECTION = 'tool-selection',
    WORKFLOW = 'workflow',
    MEMORY = 'memory',
    MODEL_ROUTING = 'model-routing',
    COST = 'cost',
    LATENCY = 'latency',
}

/** A concrete proposed configuration change, produced by an optimizer. */
export interface OptimizationSuggestion {
    readonly domain: OptimizationDomain;
    readonly title: string;
    readonly description: string;
    /** The proposed config snapshot (the `config` of the resulting variant). */
    readonly patch: Readonly<Record<string, unknown>>;
    readonly rationale: string;
    readonly expectedImpact?: 'quality' | 'cost' | 'latency' | 'reliability';
    /** Run ids that motivated this suggestion (auditability). */
    readonly sourceRunIds: readonly string[];
    /** Heuristic confidence in [0, 1]. */
    readonly confidence: number;
}

// ── Versioned policies ────────────────────────────────────────────────────────

export type PolicyVariantStatus =
    | 'candidate'   // registered but never promoted
    | 'active'      // currently deployed
    | 'superseded'  // was active, replaced by a newer promotion
    | 'rejected'    // failed evaluation / filtered out
    | 'rolled-back';// was active, reverted by a rollback

/** A versioned, immutable policy snapshot. */
export interface PolicyVariant {
    readonly id: string;
    readonly agentId: string;
    readonly domain: OptimizationDomain;
    readonly config: Readonly<Record<string, unknown>>;
    readonly description: string;
    readonly rationale?: string;
    readonly createdBy?: 'baseline' | 'feedback' | 'simulation' | 'benchmark' | 'mutation';
    /** Run ids that shaped this variant (auditability). */
    readonly sourceRunIds?: readonly string[];
    /** Parent variant id this was derived from. */
    readonly parentId?: string;
    /** Offline/attached metrics from evaluation (e.g. `score`). */
    readonly metrics?: Readonly<Record<string, number>>;
    readonly status: PolicyVariantStatus;
    readonly createdAt: string;
}

/** Status of a single archived policy version. */
export type PolicyVersionStatus = 'active' | 'superseded' | 'rolled-back';

/** An immutable, assignable version in an agent's policy history. */
export interface PolicyVersion {
    readonly version: number;
    readonly variantId: string;
    readonly agentId: string;
    readonly domain: OptimizationDomain;
    readonly config: Readonly<Record<string, unknown>>;
    readonly status: PolicyVersionStatus;
    readonly promotedAt?: string;
    readonly rolledBackAt?: string;
    readonly promotedFrom?: number;
    readonly rolledBackFrom?: number;
    readonly rationale?: string;
}

/** Append-only audit trail of every policy mutation (safety / auditability). */
export interface PolicyAuditEvent {
    readonly id: string;
    readonly agentId: string;
    readonly domain: OptimizationDomain;
    readonly action: 'register' | 'promote' | 'reject' | 'rollback';
    readonly variantId?: string;
    readonly version?: number;
    readonly fromVersion?: number;
    readonly detail?: string;
    readonly createdAt: string;
}

// ── Learning pipelines ────────────────────────────────────────────────────────

/** A labelled example the pipeline can generate/optimise from. */
export interface LearningExample {
    readonly id?: string;
    /** The agent input/prompt. */
    readonly input: string;
    readonly expected?: string;
    readonly actual?: string;
    readonly passed?: boolean;
    readonly taskType?: string;
    readonly model?: string;
    readonly latencyMs?: number;
    readonly costUsd?: number;
    readonly steps?: number;
    readonly source?: 'production' | 'simulation' | 'benchmark' | 'synthetic';
    readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Result of evaluating one candidate policy variant on a dataset. */
export interface PipelineEvaluationResult {
    readonly variantId: string;
    /** Normalised 0…1 blend of the evaluation objective(s). */
    readonly score: number;
    readonly successRate: number;
    readonly meanLatencyMs: number;
    readonly meanCostUsd: number;
    readonly samples: number;
    readonly errors?: readonly string[];
}

/** Evaluates a candidate variant against a set of examples. */
export type VariantEvaluator = (
    variant: PolicyVariant,
    examples: readonly LearningExample[],
) => Promise<PipelineEvaluationResult>;

export type PipelineRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export type PipelineDecision =
    | { readonly action: 'promote'; readonly variantId: string; readonly version: number; readonly reason: string }
    | { readonly action: 'reject'; readonly variantId?: string; readonly reason: string }
    | { readonly action: 'noop'; readonly reason: string };

/** Full, reproducible record of one pipeline run. */
export interface PipelineRun {
    readonly id: string;
    readonly agentId: string;
    readonly status: PipelineRunStatus;
    readonly startedAt: string;
    readonly finishedAt?: string;
    /** Seeded RNG split — same seed reproduces the same train/holdout split. */
    readonly seed: number;
    /** Deterministic content hash of dataset + config (reproducibility). */
    readonly datasetHash: string;
    readonly domains: readonly OptimizationDomain[];
    readonly feedbackCount: number;
    readonly exampleCount: number;
    readonly trainCount: number;
    readonly holdoutCount: number;
    readonly candidates: readonly PolicyVariant[];
    readonly evaluations: readonly PipelineEvaluationResult[];
    readonly incumbentScore?: number;
    readonly decision?: PipelineDecision;
    readonly error?: string;
    /** Frozen copy of the pipeline config at run time (reproducibility). */
    readonly configSnapshot: Readonly<Record<string, unknown>>;
}

// ── Improvement loop ──────────────────────────────────────────────────────────

export type ImprovementLoopEvent =
    | { readonly type: 'feedback-recorded'; readonly agentId: string; readonly feedbackId: string }
    | { readonly type: 'run-skipped'; readonly agentId: string; readonly reason: string }
    | { readonly type: 'run-finished'; readonly agentId: string; readonly runId: string; readonly status: PipelineRunStatus }
    | { readonly type: 'promotion'; readonly agentId: string; readonly variantId: string; readonly version: number }
    | { readonly type: 'rollback'; readonly agentId: string; readonly domain: OptimizationDomain; readonly version: number }
    | { readonly type: 'regression-checked'; readonly agentId: string; readonly degraded: boolean; readonly delta: number }
    | { readonly type: 'error'; readonly agentId: string; readonly message: string };
