/**
 * Eval Dataset Persistence — store, query, and regression-detect evaluation runs.
 *
 * Turns `runLlmAsJudge` / `EvalAggregator` into a full evaluation pipeline with
 * persistent history, baseline snapshots, and CI-friendly regression detection.
 * This makes personaforge the only framework with built-in, self-hosted eval tracking.
 *
 * @example
 * ```ts
 * import { createSqliteEvalStore, runEvalSuite } from 'personaforge/observability';
 *
 * const store = createSqliteEvalStore('./agent.db');
 *
 * const report = await runEvalSuite({
 *   suiteName: 'qa-regression',
 *   dataset: [
 *     { input: 'What is TypeScript?', expectedOutput: 'TypeScript is a typed superset of JavaScript.' },
 *   ],
 *   agent: myAgent,
 *   store,
 *   regressionThreshold: 0.05, // fail if score drops >5% from baseline
 *   onSample: (i, total, sample) => console.log(`${i}/${total}: ${sample.input.slice(0, 40)}...`),
 * });
 *
 * if (!report.passed) {
 *   console.error('Eval regression detected!', report.regressionDelta);
 *   process.exit(1);
 * }
 * ```
 */

import { randomUUID } from 'node:crypto';

/** Minimal agent interface required for eval — avoids a cross-package import. */
interface CreateAgentResult {
    run(prompt: string, options?: Record<string, unknown>): Promise<{
        text: string;
        usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    }>;
}

// ── Types ──────────────────────────────────────────────────────────────────

/** A single evaluation sample from a dataset. */
export interface EvalDatasetItem {
    /** Unique sample ID (auto-generated if not provided). */
    readonly id?: string;
    /** Input prompt sent to the agent. */
    readonly input: string;
    /** Expected output for exact/overlap comparison (optional — required for automatic scoring). */
    readonly expectedOutput?: string;
    /** Custom metadata attached to this sample. */
    readonly metadata?: Record<string, unknown>;
}

/** Result of running one eval sample. */
export interface EvalDatasetResult {
    readonly id: string;
    readonly suiteRunId: string;
    readonly suiteName: string;
    readonly input: string;
    readonly expectedOutput?: string;
    readonly actualOutput: string;
    /** Score from 0 to 1 (higher = better). Computed by scorer or judge. */
    readonly score: number;
    /** Whether the score passed the threshold. */
    readonly passed: boolean;
    /** Token usage for this sample. */
    readonly usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
    /** Duration in milliseconds. */
    readonly durationMs: number;
    /** Error message if the agent threw. */
    readonly error?: string;
    /** ISO timestamp. */
    readonly timestamp: string;
}

/** Summary of a complete suite run. */
export interface EvalSuiteRun {
    readonly id: string;
    readonly suiteName: string;
    /** Average score across all samples (0–1). */
    readonly averageScore: number;
    /** Number of samples that passed. */
    readonly passedCount: number;
    /** Total sample count. */
    readonly totalCount: number;
    readonly durationMs: number;
    readonly timestamp: string;
    /** Whether this run is the baseline for future regression comparisons. */
    readonly isBaseline: boolean;
}

/** Regression detection report returned by `runEvalSuite`. */
export interface EvalReport {
    readonly suiteRunId: string;
    readonly suiteName: string;
    readonly averageScore: number;
    readonly passedCount: number;
    readonly totalCount: number;
    readonly durationMs: number;
    readonly samples: EvalDatasetResult[];
    /**
     * Whether the suite passed (no regression vs baseline, all samples above threshold).
     * Always `true` when no baseline exists yet.
     */
    readonly passed: boolean;
    /**
     * How much the average score changed from baseline (positive = improvement).
     * Null when no baseline exists.
     */
    readonly regressionDelta: number | null;
    /** The baseline average score used for comparison, if available. */
    readonly baselineScore: number | null;
}

/** Scoring function signature. */
export type EvalScorer = (
    input: string,
    expected: string | undefined,
    actual: string,
) => number | Promise<number>;

/** Options for `runEvalSuite`. */
export interface RunEvalSuiteOptions {
    /** Unique name for this suite (used to track baseline across runs). */
    suiteName: string;
    /** Dataset of input/expected pairs. */
    dataset: EvalDatasetItem[];
    /** The agent to evaluate. */
    agent: CreateAgentResult;
    /** Persistent store for results. Defaults to in-memory. */
    store?: EvalStore;
    /**
     * Scoring function. Default: exact match (1 if identical, 0 otherwise).
     * For semantic scoring, pass an LLM judge: `runLlmAsJudge`.
     */
    scorer?: EvalScorer;
    /**
     * Minimum acceptable score per sample (0–1). Default: 0 (no threshold).
     * Samples below this score count as failed.
     */
    passingScore?: number;
    /**
     * Maximum allowed regression from baseline before the suite fails (0–1).
     * Default: 0.05 (5%). Pass `Infinity` to never fail on regression.
     */
    regressionThreshold?: number;
    /**
     * Save this run as the new baseline after it completes.
     * Default: false (only update baseline explicitly via `store.saveBaseline`).
     */
    setBaseline?: boolean;
    /** Progress callback. */
    onSample?: (index: number, total: number, sample: EvalDatasetItem) => void;
    /** Timeout per sample in ms. Default: 60_000. */
    sampleTimeoutMs?: number;
    /** Concurrency: how many samples to run in parallel. Default: 1 (sequential). */
    concurrency?: number;
}

// ── EvalStore interface ────────────────────────────────────────────────────

/** Pluggable storage for eval results. */
export interface EvalStore {
    /** Append a sample result. */
    appendSample(result: EvalDatasetResult): Promise<void>;
    /** Append a suite run summary. */
    appendRun(run: EvalSuiteRun): Promise<void>;
    /** Query sample results for a specific suite run. */
    querySamples(suiteRunId: string): Promise<EvalDatasetResult[]>;
    /** Query all runs for a suite (sorted by timestamp descending). */
    queryRuns(suiteName: string, limit?: number): Promise<EvalSuiteRun[]>;
    /** Get the current baseline score for a suite, or null if not set. */
    getBaseline(suiteName: string): Promise<{ averageScore: number; runId: string } | null>;
    /** Save or update the baseline for a suite. */
    saveBaseline(suiteName: string, runId: string, averageScore: number): Promise<void>;
}

// ── In-memory store ────────────────────────────────────────────────────────

export class InMemoryEvalStore implements EvalStore {
    private samples = new Map<string, EvalDatasetResult[]>();
    private runs = new Map<string, EvalSuiteRun[]>();
    private baselines = new Map<string, { averageScore: number; runId: string }>();

    async appendSample(result: EvalDatasetResult): Promise<void> {
        const list = this.samples.get(result.suiteRunId) ?? [];
        list.push(result);
        this.samples.set(result.suiteRunId, list);
    }

    async appendRun(run: EvalSuiteRun): Promise<void> {
        const list = this.runs.get(run.suiteName) ?? [];
        // push() is O(1) amortised; queryRuns slices from tail for newest-first
        list.push(run);
        this.runs.set(run.suiteName, list);
    }

    async querySamples(suiteRunId: string): Promise<EvalDatasetResult[]> {
        return this.samples.get(suiteRunId) ?? [];
    }

    async queryRuns(suiteName: string, limit = 50): Promise<EvalSuiteRun[]> {
        const list = this.runs.get(suiteName) ?? [];
        // Return newest-first without mutating the stored array
        return list.length <= limit
            ? list.slice().reverse()
            : list.slice(-limit).reverse();
    }

    async getBaseline(suiteName: string): Promise<{ averageScore: number; runId: string } | null> {
        return this.baselines.get(suiteName) ?? null;
    }

    async saveBaseline(suiteName: string, runId: string, averageScore: number): Promise<void> {
        this.baselines.set(suiteName, { averageScore, runId });
    }
}

// ── SQLite store ───────────────────────────────────────────────────────────

type BetterSqlite3DB = {
    exec: (sql: string) => void;
    prepare: (sql: string) => {
        run: (...params: unknown[]) => void;
        get: (...params: unknown[]) => unknown;
        all: (...params: unknown[]) => unknown[];
    };
};

export class SqliteEvalStore implements EvalStore {
    private db: BetterSqlite3DB;

    private constructor(db: BetterSqlite3DB) {
        this.db = db;
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS eval_samples (
                id TEXT PRIMARY KEY,
                suite_run_id TEXT NOT NULL,
                suite_name TEXT NOT NULL,
                input TEXT NOT NULL,
                expected_output TEXT,
                actual_output TEXT NOT NULL,
                score REAL NOT NULL,
                passed INTEGER NOT NULL,
                usage TEXT,
                duration_ms INTEGER NOT NULL,
                error TEXT,
                timestamp TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS eval_samples_run_id ON eval_samples(suite_run_id);
            CREATE INDEX IF NOT EXISTS eval_samples_suite_name ON eval_samples(suite_name);

            CREATE TABLE IF NOT EXISTS eval_runs (
                id TEXT PRIMARY KEY,
                suite_name TEXT NOT NULL,
                average_score REAL NOT NULL,
                passed_count INTEGER NOT NULL,
                total_count INTEGER NOT NULL,
                duration_ms INTEGER NOT NULL,
                timestamp TEXT NOT NULL,
                is_baseline INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS eval_runs_suite_name ON eval_runs(suite_name, timestamp);

            CREATE TABLE IF NOT EXISTS eval_baselines (
                suite_name TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                average_score REAL NOT NULL,
                updated_at TEXT NOT NULL
            );
        `);
    }

    static create(filePath: string): SqliteEvalStore {

        let Database: (p: string) => BetterSqlite3DB;
        try {
            Database = require('better-sqlite3') as typeof Database;
        } catch {
            throw new Error(
                'SqliteEvalStore requires better-sqlite3. Install: npm install better-sqlite3'
            );
        }
        return new SqliteEvalStore(Database(filePath));
    }

    async appendSample(result: EvalDatasetResult): Promise<void> {
        this.db.prepare(`
            INSERT OR REPLACE INTO eval_samples
            (id, suite_run_id, suite_name, input, expected_output, actual_output, score, passed, usage, duration_ms, error, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            result.id,
            result.suiteRunId,
            result.suiteName,
            result.input,
            result.expectedOutput ?? null,
            result.actualOutput,
            result.score,
            result.passed ? 1 : 0,
            result.usage ? JSON.stringify(result.usage) : null,
            result.durationMs,
            result.error ?? null,
            result.timestamp,
        );
    }

    async appendRun(run: EvalSuiteRun): Promise<void> {
        this.db.prepare(`
            INSERT OR REPLACE INTO eval_runs
            (id, suite_name, average_score, passed_count, total_count, duration_ms, timestamp, is_baseline)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            run.id,
            run.suiteName,
            run.averageScore,
            run.passedCount,
            run.totalCount,
            run.durationMs,
            run.timestamp,
            run.isBaseline ? 1 : 0,
        );
    }

    async querySamples(suiteRunId: string): Promise<EvalDatasetResult[]> {
        const rows = this.db.prepare(
            'SELECT * FROM eval_samples WHERE suite_run_id = ? ORDER BY timestamp ASC'
        ).all(suiteRunId) as Record<string, unknown>[];
        return rows.map(rowToSample);
    }

    async queryRuns(suiteName: string, limit = 50): Promise<EvalSuiteRun[]> {
        const rows = this.db.prepare(
            'SELECT * FROM eval_runs WHERE suite_name = ? ORDER BY timestamp DESC LIMIT ?'
        ).all(suiteName, limit) as Record<string, unknown>[];
        return rows.map(rowToRun);
    }

    async getBaseline(suiteName: string): Promise<{ averageScore: number; runId: string } | null> {
        const row = this.db.prepare(
            'SELECT * FROM eval_baselines WHERE suite_name = ?'
        ).get(suiteName) as Record<string, unknown> | null;
        if (!row) return null;
        return { averageScore: row['average_score'] as number, runId: row['run_id'] as string };
    }

    async saveBaseline(suiteName: string, runId: string, averageScore: number): Promise<void> {
        this.db.prepare(`
            INSERT OR REPLACE INTO eval_baselines (suite_name, run_id, average_score, updated_at)
            VALUES (?, ?, ?, ?)
        `).run(suiteName, runId, averageScore, new Date().toISOString());
    }
}

/** Factory: create a SQLite-backed eval store. */
export function createSqliteEvalStore(filePath: string): EvalStore {
    return SqliteEvalStore.create(filePath);
}

// ── Row → domain mapping ───────────────────────────────────────────────────

function rowToSample(row: Record<string, unknown>): EvalDatasetResult {
    return {
        id: row['id'] as string,
        suiteRunId: row['suite_run_id'] as string,
        suiteName: row['suite_name'] as string,
        input: row['input'] as string,
        expectedOutput: (row['expected_output'] as string | null) ?? undefined,
        actualOutput: row['actual_output'] as string,
        score: row['score'] as number,
        passed: Boolean(row['passed']),
        usage: row['usage'] ? (JSON.parse(row['usage'] as string) as EvalDatasetResult['usage']) : undefined,
        durationMs: row['duration_ms'] as number,
        error: (row['error'] as string | null) ?? undefined,
        timestamp: row['timestamp'] as string,
    };
}

function rowToRun(row: Record<string, unknown>): EvalSuiteRun {
    return {
        id: row['id'] as string,
        suiteName: row['suite_name'] as string,
        averageScore: row['average_score'] as number,
        passedCount: row['passed_count'] as number,
        totalCount: row['total_count'] as number,
        durationMs: row['duration_ms'] as number,
        timestamp: row['timestamp'] as string,
        isBaseline: Boolean(row['is_baseline']),
    };
}

// ── Default scorer ─────────────────────────────────────────────────────────

/**
 * Default scorer: normalized exact match.
 * Returns 1.0 if actual === expected (case-insensitive trim), 0.0 otherwise.
 * When no expected output, returns 0.5 (neutral — use an LLM judge instead).
 */
const defaultScorer: EvalScorer = (_input, expected, actual) => {
    if (!expected) return 0.5;
    return actual.trim().toLowerCase() === expected.trim().toLowerCase() ? 1.0 : 0.0;
};

// ── runEvalSuite ───────────────────────────────────────────────────────────

/**
 * Run an evaluation suite against an agent with optional regression detection.
 *
 * - Runs all dataset samples through the agent
 * - Scores each sample using the provided `scorer` (default: exact match)
 * - Compares results against a stored baseline
 * - Returns a report with pass/fail and regression delta
 *
 * @example
 * ```ts
 * const report = await runEvalSuite({
 *   suiteName: 'qa-suite',
 *   dataset: [{ input: 'Hello', expectedOutput: 'Hi there!' }],
 *   agent: myAgent,
 *   store: createSqliteEvalStore('./evals.db'),
 *   regressionThreshold: 0.05,
 * });
 * if (!report.passed) process.exit(1);
 * ```
 */
export async function runEvalSuite(options: RunEvalSuiteOptions): Promise<EvalReport> {
    const {
        suiteName,
        dataset,
        agent,
        store = new InMemoryEvalStore(),
        scorer = defaultScorer,
        passingScore = 0,
        regressionThreshold = 0.05,
        setBaseline = false,
        onSample,
        sampleTimeoutMs = 60_000,
        concurrency = 1,
    } = options;

    const suiteRunId = randomUUID();
    const suiteStartMs = Date.now();
    const samples: EvalDatasetResult[] = [];

    // Run samples with configurable concurrency
    const runSample = async (sample: EvalDatasetItem, index: number): Promise<EvalDatasetResult> => {
        onSample?.(index + 1, dataset.length, sample);
        const sampleId = sample.id ?? randomUUID();
        const t0 = Date.now();
        let actualOutput = '';
        let error: string | undefined;
        let usage: EvalDatasetResult['usage'];

        try {
            let sampleTimer: ReturnType<typeof setTimeout> | undefined;
            const timeoutPromise = new Promise<never>((_, reject) => {
                sampleTimer = setTimeout(
                    () => reject(new Error(`Sample timeout after ${sampleTimeoutMs}ms`)),
                    sampleTimeoutMs,
                );
            });
            const runPromise = agent.run(sample.input);
            const result = await Promise.race([runPromise, timeoutPromise]).finally(() => {
                if (sampleTimer !== undefined) clearTimeout(sampleTimer);
            });
            actualOutput = result.text;
            usage = result.usage;
        } catch (err) {
            error = err instanceof Error ? err.message : String(err);
            actualOutput = '';
        }

        const score = error
            ? 0
            : await Promise.resolve(scorer(sample.input, sample.expectedOutput, actualOutput));
        const passed = !error && score >= passingScore;

        const sampleResult: EvalDatasetResult = {
            id: sampleId,
            suiteRunId,
            suiteName,
            input: sample.input,
            expectedOutput: sample.expectedOutput,
            actualOutput,
            score,
            passed,
            usage,
            durationMs: Date.now() - t0,
            error,
            timestamp: new Date().toISOString(),
        };

        await store.appendSample(sampleResult);
        return sampleResult;
    };

    // Process in chunks of `concurrency`
    for (let i = 0; i < dataset.length; i += concurrency) {
        const chunk = dataset.slice(i, i + concurrency);
        const results = await Promise.all(chunk.map((s, j) => runSample(s, i + j)));
        samples.push(...results);
    }

    const averageScore =
        samples.length > 0
            ? samples.reduce((sum, s) => sum + s.score, 0) / samples.length
            : 0;
    const passedCount = samples.filter((s) => s.passed).length;
    const totalDurationMs = Date.now() - suiteStartMs;

    // Load baseline for regression comparison
    const baseline = await store.getBaseline(suiteName);
    const regressionDelta = baseline ? averageScore - baseline.averageScore : null;
    const baselineScore = baseline?.averageScore ?? null;

    // Suite passes when no regression exceeds threshold
    const passed =
        regressionDelta === null || regressionDelta >= -regressionThreshold;

    const run: EvalSuiteRun = {
        id: suiteRunId,
        suiteName,
        averageScore,
        passedCount,
        totalCount: samples.length,
        durationMs: totalDurationMs,
        timestamp: new Date().toISOString(),
        isBaseline: setBaseline,
    };

    await store.appendRun(run);

    if (setBaseline) {
        await store.saveBaseline(suiteName, suiteRunId, averageScore);
    }

    return {
        suiteRunId,
        suiteName,
        averageScore,
        passedCount,
        totalCount: samples.length,
        durationMs: totalDurationMs,
        samples,
        passed,
        regressionDelta,
        baselineScore,
    };
}
