/**
 * Continuous improvement loop.
 *
 * Wires the pieces together into an always-on learning loop:
 *
 *   submit feedback → (interval + sample + budget gates)
 *       → run adaptive pipeline → promote/reject (regression-gated)
 *       → monitor post-promotion performance → auto rollback on regression
 *
 * Safety is built in: min intervals, min sample counts, a promotion budget per
 * rolling window, a relative regression gate before any promotion, and
 * deterministic rollback with a full audit trail.
 */

import { LearningPipeline } from './pipeline.js';
import { type FeedbackRepo, type FeedbackFilter } from './feedback.js';
import type { PolicyStore } from './policy-store.js';
import { createImprovementStores, type StoreBackendSpec } from './store-factory.js';
import { OptimizationDomain } from './types.js';
import type {
    ExecutionFeedback,
    ImprovementLoopEvent,
    PipelineRun,
    PolicyVariant,
    VariantEvaluator,
} from './types.js';

// ── Local example projection (keeps this module free of barrel cycles) ────────

function toExamples(entries: readonly ExecutionFeedback[]): Array<{
    input: string; expected?: string; actual?: string; passed?: boolean;
    taskType?: string; model?: string; steps?: number; latencyMs?: number; costUsd?: number;
}> {
    return entries.map((e) => {
        const s = e.signal;
        return {
            input: s?.prompt ?? '',
            expected: s?.expected,
            actual: s?.output,
            passed: s?.passed,
            taskType: s?.taskType,
            model: s?.model,
            steps: s?.steps,
            latencyMs: s?.latencyMs,
            costUsd: s?.costUsd,
        };
    });
}

export interface ImprovementLoopOptions {
    readonly agentId: string;
    /** Feedback reservoir. Defaults to one built from `db` (or in-memory). */
    readonly feedback?: FeedbackRepo;
    /** Versioned policy store. Defaults to one built from `db` (or in-memory). */
    readonly policy?: PolicyStore;
    /**
     * Any-DB spec: when `feedback`/`policy` are omitted, pass an `AgentDb`
     * instance, the string "sqlite", or { type: 'db', db } to auto-build
     * production-ready stores on that backend.
     */
    readonly db?: StoreBackendSpec;
    /** Domains to optimise. Defaults to all seven. */
    readonly domains?: readonly OptimizationDomain[];
    /** Baseline config for the default pipeline before the first promotion. */
    readonly currentConfig?: Readonly<Record<string, unknown>>;
    /** Custom evaluator forwarded to the default pipeline. */
    readonly evaluate?: VariantEvaluator;
    /** Min ms between pipeline runs. Default 60_000. */
    readonly minIntervalMs?: number;
    /** Min new feedback since the last run required to run again. Default 1. */
    readonly minNewFeedback?: number;
    /** Max promotions per rolling window. Default 1. */
    readonly maxPromotionsPerWindow?: number;
    /** Rolling window length in ms. Default 1 hour. */
    readonly windowMs?: number;
    /** Tick interval for start()/stop(). Default 60_000 ms. */
    readonly intervalMs?: number;
    /** Relative post-promotion regression threshold before auto rollback. Default 0.2. */
    readonly autoRollbackThreshold?: number;
    /** Deterministic clock (tests). */
    readonly now?: () => Date;
    /** Observer for loop events. */
    readonly onEvent?: (event: ImprovementLoopEvent) => void;
}

export interface ImprovementLoopState {
    readonly lastRunAt: string | null;
    readonly runsCompleted: number;
    readonly totalPromotions: number;
    readonly totalRollbacks: number;
    readonly promotionsInWindow: number;
    readonly windowStartedAt: string;
    readonly newFeedbackSinceLastRun: number;
    readonly running: boolean;
}

export interface ImprovementLoopResult {
    /** Present when the run was skipped (reason). */
    readonly skipped?: string;
    /** Present when a pipeline run happened. */
    readonly run?: PipelineRun;
    /** Present when the pipeline run failed. */
    readonly error?: string;
}

export class ImprovementLoop {
    private readonly agentId: string;
    private readonly opts: Required<Pick<ImprovementLoopOptions,
        | 'minIntervalMs' | 'minNewFeedback' | 'maxPromotionsPerWindow'
        | 'windowMs' | 'intervalMs' | 'autoRollbackThreshold'>>;
    private readonly domains: readonly OptimizationDomain[];
    private readonly currentConfig: Readonly<Record<string, unknown>>;
    private readonly evaluate?: VariantEvaluator;
    private readonly onEvent?: (event: ImprovementLoopEvent) => void;
    private readonly now: () => Date;
    private readonly defaultDomains: readonly OptimizationDomain[] = [
        OptimizationDomain.PROMPT,
        OptimizationDomain.TOOL_SELECTION,
        OptimizationDomain.WORKFLOW,
        OptimizationDomain.MEMORY,
        OptimizationDomain.MODEL_ROUTING,
        OptimizationDomain.COST,
        OptimizationDomain.LATENCY,
    ];

    private _feedback?: FeedbackRepo;
    private _policy?: PolicyStore;
    private _storesPromise?: Promise<{ feedback: FeedbackRepo; policy: PolicyStore }>;
    private _pipeline?: LearningPipeline;

    private _lastRunAt: number | null = null;
    private _runsCompleted = 0;
    private _totalPromotions = 0;
    private _totalRollbacks = 0;
    private _promotionsInWindow = 0;
    private _windowStartedAt: number;
    private _newFeedbackSinceLastRun = 0;
    private _running = false;
    private _ticking = false;
    private _timer?: ReturnType<typeof setInterval>;

    /** Score/domain/version of the most recent promotion — regression baseline. */
    private _lastPromoted?: { score: number; domain: OptimizationDomain; version: number };

    constructor(opts: ImprovementLoopOptions) {
        if (!opts.agentId) throw new Error('ImprovementLoop: agentId is required');
        this.agentId = opts.agentId;
        this.opts = {
            minIntervalMs: opts.minIntervalMs ?? 60_000,
            minNewFeedback: opts.minNewFeedback ?? 1,
            maxPromotionsPerWindow: opts.maxPromotionsPerWindow ?? 1,
            windowMs: opts.windowMs ?? 3_600_000,
            intervalMs: opts.intervalMs ?? 60_000,
            autoRollbackThreshold: opts.autoRollbackThreshold ?? 0.2,
        };
        this.domains = opts.domains ?? [...this.defaultDomains];
        this.currentConfig = opts.currentConfig ?? {};
        this.evaluate = opts.evaluate;
        this.onEvent = opts.onEvent;
        this.now = opts.now ?? (() => new Date());
        this._windowStartedAt = this.now().getTime();

        this._feedback = opts.feedback;
        this._policy = opts.policy;
        if (opts.db && !(opts.feedback && opts.policy)) {
            this._storesPromise = createImprovementStores(opts.db);
        }
    }

    // ── Storage plumbing ──────────────────────────────────────────────────────

    private async _stores(): Promise<{ feedback: FeedbackRepo; policy: PolicyStore }> {
        if (this._feedback && this._policy) {
            return { feedback: this._feedback, policy: this._policy };
        }
        if (!this._storesPromise) {
            this._storesPromise = createImprovementStores('memory');
        }
        const stores = await this._storesPromise;
        this._feedback ??= stores.feedback;
        this._policy ??= stores.policy;
        return { feedback: this._feedback, policy: this._policy };
    }

    private async _getPipeline(): Promise<LearningPipeline> {
        const { feedback, policy } = await this._stores();
        this._pipeline ??= new LearningPipeline({
            agentId: this.agentId,
            domains: this.domains,
            currentConfig: this.currentConfig,
            feedback,
            policy,
            evaluate: this.evaluate,
        });
        return this._pipeline;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /** Structured feedback from any source (human/AI/self/peer/metric/reward). */
    async submit(
        entry: Omit<ExecutionFeedback, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
    ): Promise<ExecutionFeedback> {
        const { feedback } = await this._stores();
        const recorded = await feedback.append(entry);
        this._newFeedbackSinceLastRun++;
        this._emit({ type: 'feedback-recorded', agentId: this.agentId, feedbackId: recorded.id });
        return recorded;
    }

    /** Count feedback stored for this agent. */
    async pendingFeedback(filter: FeedbackFilter = {}): Promise<number> {
        const { feedback } = await this._stores();
        return feedback.count({ agentId: this.agentId, ...filter });
    }

    /**
     * Attempt one improvement cycle subject to the safety gates. Returns the
     * reason when skipped, or the pipeline run when executed.
     */
    async maybeImprove(): Promise<ImprovementLoopResult> {
        const now = this.now().getTime();

        if (this._running) return { skipped: 'already running' };
        if (this._lastRunAt !== null && now - this._lastRunAt < this.opts.minIntervalMs) {
            return { skipped: 'below minimum interval' };
        }
        if (this._newFeedbackSinceLastRun < this.opts.minNewFeedback) {
            return { skipped: 'insufficient new feedback' };
        }
        if (this._promotionsInWindow >= this.opts.maxPromotionsPerWindow) {
            if (now - this._windowStartedAt < this.opts.windowMs) {
                return { skipped: 'promotion budget exhausted for window' };
            }
            this._promotionsInWindow = 0;
            this._windowStartedAt = now;
        }

        const pipeline = await this._getPipeline();
        this._running = true;

        let run: PipelineRun;
        try {
            run = await pipeline.run();
        } catch (err) {
            this._running = false;
            const message = err instanceof Error ? err.message : String(err);
            this._emit({ type: 'error', agentId: this.agentId, message });
            return { error: message };
        }

        this._running = false;
        this._lastRunAt = this.now().getTime();
        this._runsCompleted++;
        this._newFeedbackSinceLastRun = 0;

        const decision = run.decision;
        if (decision?.action === 'promote') {
            this._promotionsInWindow++;
            this._totalPromotions++;
            const evaluated = run.evaluations.find((e) => e.variantId === decision.variantId);
            const domain = run.candidates.find((c) => c.id === decision.variantId)?.domain;
            if (domain) {
                this._lastPromoted = {
                    score: evaluated?.score ?? run.incumbentScore ?? 0,
                    domain,
                    version: decision.version,
                };
            }
            this._emit({
                type: 'promotion',
                agentId: this.agentId,
                variantId: decision.variantId,
                version: decision.version,
            });
        }

        this._emit({ type: 'run-finished', agentId: this.agentId, runId: run.id, status: run.status });
        return { run };
    }

    /**
     * Check the promoted policy for post-promotion regression and roll back
     * deterministically when it drops below the threshold. Requires `evaluate`.
     */
    async checkRegression(): Promise<boolean> {
        const { feedback, policy } = await this._stores();
        if (!this.evaluate || !this._lastPromoted) return false;

        const active = await policy.getActive(this.agentId, this._lastPromoted.domain);
        if (!active || active.version !== this._lastPromoted.version) return false;

        const entries = await feedback.list({ agentId: this.agentId, limit: 500 });
        const examples = toExamples(entries);
        if (examples.length === 0) return false;

        const baseline = this._lastPromoted.score;
        const variant: PolicyVariant = {
            id: active.variantId,
            agentId: this.agentId,
            domain: active.domain,
            config: active.config,
            description: 'active post-promotion check',
            status: 'candidate',
            createdAt: new Date().toISOString(),
        };
        const result = await this.evaluate(variant, examples);
        const delta = result.score - baseline;
        const degraded = result.score < baseline * (1 - this.opts.autoRollbackThreshold);
        this._emit({ type: 'regression-checked', agentId: this.agentId, degraded, delta });

        if (degraded) {
            const domain = this._lastPromoted.domain;
            const rolled = await policy.rollback(this.agentId, domain, {
                rationale: `post-promotion regression (${result.score.toFixed(3)} vs ${baseline.toFixed(3)})`,
            });
            if (rolled) {
                this._totalRollbacks++;
                this._lastPromoted = undefined;
                this._emit({
                    type: 'rollback',
                    agentId: this.agentId,
                    domain,
                    version: rolled.version,
                });
            }
        }
        return degraded;
    }

    /** Convenience: run one cycle, then check for regression. */
    async tick(): Promise<ImprovementLoopResult> {
        if (this._ticking || this._running) return { skipped: 'already ticking' };
        this._ticking = true;
        try {
            const result = await this.maybeImprove();
            await this.checkRegression();
            return result;
        } finally {
            this._ticking = false;
        }
    }

    /** Start the periodic loop (overlapping ticks are dropped safely). */
    start(): void {
        if (this._timer) return;
        this._timer = setInterval(() => {
            void this.tick();
        }, this.opts.intervalMs);
    }

    /** Stop the periodic loop. */
    stop(): void {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = undefined;
        }
    }

    get isRunning(): boolean {
        return !!this._timer;
    }

    /** Current loop state (safety gates, counters). */
    state(): ImprovementLoopState {
        return {
            lastRunAt: this._lastRunAt === null ? null : new Date(this._lastRunAt).toISOString(),
            runsCompleted: this._runsCompleted,
            totalPromotions: this._totalPromotions,
            totalRollbacks: this._totalRollbacks,
            promotionsInWindow: this._promotionsInWindow,
            windowStartedAt: new Date(this._windowStartedAt).toISOString(),
            newFeedbackSinceLastRun: this._newFeedbackSinceLastRun,
            running: this._running,
        };
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    private _emit(event: ImprovementLoopEvent): void {
        this.onEvent?.(event);
    }
}
