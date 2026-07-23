/**
 * Budget Enforcement — hard stop on LLM spend per run, per user, and per month.
 *
 * Wraps the agentic runner with cost tracking and throws `BudgetExceededError`
 * when any configured cap is crossed. Unlike `CostTracker` (which only
 * measures), this module *stops* execution.
 *
 * @example
 * ```ts
 * const agent = createAgent({
 *   name: 'Safe',
 *   budget: {
 *     maxUsdPerRun: 0.50,
 *     maxUsdPerUser: 10.00,   // requires a BudgetStore for persistence
 *     maxUsdPerMonth: 500.00, // requires a BudgetStore for persistence
 *     onExceeded: 'throw',    // 'throw' | 'warn' | 'truncate'
 *   },
 * });
 * ```
 */

import { MODEL_PRICING } from './_pricing.js';
import { AgentError, ErrorCode, type ErrorCodeType } from '../shared/index.js';

// ── Types ──────────────────────────────────────────────────────────────────

/** What to do when a budget cap is exceeded. */
export type BudgetExceededAction = 'throw' | 'warn' | 'truncate';

/** Budget configuration for `createAgent`. */
export interface BudgetConfig {
    /** Hard cap per single `agent.run()` call (USD). */
    readonly maxUsdPerRun?: number;
    /** Daily cap per `userId` (USD). Requires a `BudgetStore`. */
    readonly maxUsdPerUser?: number;
    /** Monthly cap across all users / runs (USD). Requires a `BudgetStore`. */
    readonly maxUsdPerMonth?: number;
    /** Action when a cap is exceeded. Default: `'throw'`. */
    readonly onExceeded?: BudgetExceededAction;
    /** Store for persisting per-user and monthly spend. Defaults to in-memory. */
    readonly store?: BudgetStore;
}

/** Tracks cumulative spend across runs. */
export interface BudgetStore {
    /** Get USD spent by a user today (calendar day, UTC). */
    getUserDailySpend(userId: string): Promise<number>;
    /** Add to a user's daily spend. */
    incrementUserDailySpend(userId: string, usd: number): Promise<void>;
    /** Get total USD spent this calendar month (UTC). */
    getMonthlySpend(): Promise<number>;
    /** Add to the monthly spend. */
    incrementMonthlySpend(usd: number): Promise<void>;
}

/** Thrown when a budget cap is exceeded (when onExceeded === 'throw'). */
export class BudgetExceededError extends AgentError {
    readonly cap: 'run' | 'user_daily' | 'monthly';
    readonly limitUsd: number;
    readonly spentUsd: number;
    readonly runCostUsd: number;

    constructor(opts: {
        cap: 'run' | 'user_daily' | 'monthly';
        limitUsd: number;
        spentUsd: number;
        runCostUsd: number;
    }) {
        super(
            `Budget exceeded [${opts.cap}]: spent $${opts.spentUsd.toFixed(4)} of $${opts.limitUsd.toFixed(4)} limit ` +
            `(this run: $${opts.runCostUsd.toFixed(4)})`,
            {
                code: ErrorCode.BUDGET_EXCEEDED as ErrorCodeType,
                retryable: false,
                context: { cap: opts.cap, limitUsd: opts.limitUsd, spentUsd: opts.spentUsd, runCostUsd: opts.runCostUsd },
            }
        );
        this.name = 'BudgetExceededError';
        this.cap = opts.cap;
        this.limitUsd = opts.limitUsd;
        this.spentUsd = opts.spentUsd;
        this.runCostUsd = opts.runCostUsd;
        Object.setPrototypeOf(this, BudgetExceededError.prototype);
    }
}

// ── In-memory BudgetStore ──────────────────────────────────────────────────

function todayKey(): string {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}
function monthKey(): string {
    return new Date().toISOString().slice(0, 7); // YYYY-MM
}

/** Default in-memory budget store. Resets on process restart. */
export class InMemoryBudgetStore implements BudgetStore {
    private userDaily = new Map<string, { date: string; usd: number }>();
    private monthly = new Map<string, number>();

    async getUserDailySpend(userId: string): Promise<number> {
        const today = todayKey();
        const entry = this.userDaily.get(userId);
        if (!entry || entry.date !== today) return 0;
        return entry.usd;
    }

    async incrementUserDailySpend(userId: string, usd: number): Promise<void> {
        const today = todayKey();
        const entry = this.userDaily.get(userId);
        if (!entry || entry.date !== today) {
            this.userDaily.set(userId, { date: today, usd });
        } else {
            entry.usd += usd;
        }
    }

    async getMonthlySpend(): Promise<number> {
        return this.monthly.get(monthKey()) ?? 0;
    }

    async incrementMonthlySpend(usd: number): Promise<void> {
        const key = monthKey();
        this.monthly.set(key, (this.monthly.get(key) ?? 0) + usd);
    }
}

// ── Cost calculation helper ────────────────────────────────────────────────

/** Estimate cost in USD from token usage and model name. */
export function estimateCostUsd(
    model: string,
    promptTokens: number,
    completionTokens: number,
): number {
    const key = model.toLowerCase().replace(/^[^:]+:/, ''); // strip provider prefix
    const pricing = MODEL_PRICING[key] ?? MODEL_PRICING['__default__']!;
    const inputCost = (promptTokens / 1_000_000) * pricing.input;
    const outputCost = (completionTokens / 1_000_000) * pricing.output;
    return inputCost + outputCost;
}

// ── BudgetEnforcer ─────────────────────────────────────────────────────────

/**
 * Enforces budget caps on agent runs.
 * Instantiate once per agent and call `checkAndRecord()` after each run.
 */
export class BudgetEnforcer {
    private readonly config: Required<BudgetConfig>;
    private runSpendUsd = 0;

    constructor(config: BudgetConfig) {
        this.config = {
            maxUsdPerRun: config.maxUsdPerRun ?? Infinity,
            maxUsdPerUser: config.maxUsdPerUser ?? Infinity,
            maxUsdPerMonth: config.maxUsdPerMonth ?? Infinity,
            onExceeded: config.onExceeded ?? 'throw',
            store: config.store ?? new InMemoryBudgetStore(),
        };
    }

    /** Reset per-run accumulator. Call before each agent.run(). */
    resetRun(): void {
        this.runSpendUsd = 0;
    }

    /**
     * Add step cost and check run-level cap immediately.
     * Call after each LLM step with the token usage from that step.
     *
     * Semantics: this is a POST-STEP hard stop, not a pre-flight guard. The
     * step's cost is recorded first, then the cap is checked — so a single
     * step whose cost exceeds the remaining budget will push `runSpendUsd`
     * past `maxUsdPerRun` before this throws. The cap bounds how much a run
     * continues spending, not the cost of any one step. Callers needing a
     * hard per-step ceiling must estimate cost before issuing the LLM call.
     */
    addStepCost(model: string, promptTokens: number, completionTokens: number): void {
        const cost = estimateCostUsd(model, promptTokens, completionTokens);
        this.runSpendUsd += cost;

        if (this.runSpendUsd > this.config.maxUsdPerRun) {
            this.handleExceeded({
                cap: 'run',
                limitUsd: this.config.maxUsdPerRun,
                spentUsd: this.runSpendUsd,
                runCostUsd: this.runSpendUsd,
            });
        }
    }

    /**
     * After a run completes, record spend and check user/monthly caps.
     * Returns the run cost in USD.
     */
    async recordAndCheck(userId?: string): Promise<number> {
        const runCost = this.runSpendUsd;
        if (runCost <= 0) return runCost;

        const store = this.config.store;

        if (userId && this.config.maxUsdPerUser < Infinity) {
            await store.incrementUserDailySpend(userId, runCost);
            const dailyTotal = await store.getUserDailySpend(userId);
            if (dailyTotal > this.config.maxUsdPerUser) {
                this.handleExceeded({
                    cap: 'user_daily',
                    limitUsd: this.config.maxUsdPerUser,
                    spentUsd: dailyTotal,
                    runCostUsd: runCost,
                });
            }
        }

        if (this.config.maxUsdPerMonth < Infinity) {
            await store.incrementMonthlySpend(runCost);
            const monthlyTotal = await store.getMonthlySpend();
            if (monthlyTotal > this.config.maxUsdPerMonth) {
                this.handleExceeded({
                    cap: 'monthly',
                    limitUsd: this.config.maxUsdPerMonth,
                    spentUsd: monthlyTotal,
                    runCostUsd: runCost,
                });
            }
        }

        return runCost;
    }

    private handleExceeded(opts: {
        cap: 'run' | 'user_daily' | 'monthly';
        limitUsd: number;
        spentUsd: number;
        runCostUsd: number;
    }): void {
        if (this.config.onExceeded === 'throw') {
            throw new BudgetExceededError(opts);
        }
        if (this.config.onExceeded === 'warn') {
            console.warn(
                `[personaforge] Budget warning [${opts.cap}]: $${opts.spentUsd.toFixed(4)} of $${opts.limitUsd.toFixed(4)}`
            );
        }
        // 'truncate' — caller checks the thrown error; for warn/truncate we just log
    }
}
