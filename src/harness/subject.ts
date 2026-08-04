/**
 * `HarnessSubject` — a uniform, evaluable unit for the harness engine.
 *
 * The harness evaluates agents, tasks, workflows, and plain functions through
 * one normalised adapter: `toHarnessRunner(subject)` returns a
 * `(input: string) => Promise<RunOutcome>` that captures output text,
 * latency, and (when reported) token/cost usage.
 *
 * ```ts
 * import { toHarnessRunner, fromAgent, fromTask, fromWorkflow } from 'personaforge/harness';
 *
 * const runAgent = toHarnessRunner(myAgent);            // CreateAgentResult → .run()
 * const runTask  = toHarnessRunner(myTask);             // TaskHandle → .run()
 * const runWf    = toHarnessRunner(myWorkflow);         // Workflow → .execute()
 * const runFn    = toHarnessRunner(async (q) => q.length);
 * ```
 */

// ── Types ──────────────────────────────────────────────────────────────────

/** Normalised result of evaluating one input through a subject. */
export interface RunOutcome {
    /** Text fed to scorers. */
    readonly output: string;
    /** Full raw result for inspection (agent result, workflow envelope, …). */
    readonly raw?: unknown;
    /** Measured wall time in ms. */
    readonly latencyMs: number;
    /** Total tokens used, when reported by the subject. */
    readonly tokensUsed?: number;
    /** USD cost, when reported by the subject. */
    readonly costUsd?: number;
}

/** Options for {@link toHarnessRunner}. */
export interface HarnessRunnerOptions {
    /** Session id forwarded to agent/task subjects. */
    readonly sessionId?: string;
    /** Extract a USD cost from the raw result (defaults to `raw.costUsd`). */
    readonly costOf?: (raw: unknown) => number | undefined;
}

/** A runnable subject variant acceptable to the harness. */
export type HarnessSubject =
    /** Function subjects. */
    | ((input: string) => unknown | Promise<unknown>)
    /** Agent-like: `run(input, options?)` (CreateAgentResult, TaskHandle, …). */
    | { readonly run: (input: unknown, options?: { sessionId?: string }) => unknown | Promise<unknown> }
    /** Workflow-like: `execute(input?)`. */
    | { readonly execute: (input?: unknown) => unknown | Promise<unknown> };

type AnyObject = Record<string, unknown>;

// ── Normalisation ──────────────────────────────────────────────────────────

function toStringValue(value: unknown): string {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

function toNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

async function runAgentLike(
    subject: { run: (input: unknown, options?: { sessionId?: string }) => unknown | Promise<unknown> },
    input: string,
    options: HarnessRunnerOptions,
): Promise<RunOutcome> {
    const t0 = performance.now();
    const raw = await subject.run(input, options.sessionId !== undefined ? { sessionId: options.sessionId } : undefined);
    const latencyMs = performance.now() - t0;

    const obj = (raw !== null && typeof raw === 'object' ? raw : { text: raw }) as AnyObject;
    const text = typeof (obj as { text?: unknown }).text === 'string' ? (obj as { text: string }).text : undefined;
    const output = text ?? toStringValue(raw);

    const usage = obj.usage as { totalTokens?: unknown; promptTokens?: unknown } | undefined;
    const tokensUsed =
        toNumber(usage?.totalTokens) ??
        toNumber(obj.tokensUsed) ??
        (toNumber(usage?.promptTokens) !== undefined ? toNumber(usage?.promptTokens) : undefined);

    const costUsd = options.costOf?.(raw) ?? toNumber(obj.costUsd);

    return {
        output,
        raw,
        latencyMs,
        ...(tokensUsed !== undefined ? { tokensUsed } : {}),
        ...(costUsd !== undefined ? { costUsd } : {}),
    };
}

async function runWorkflowLike(
    subject: { execute: (input?: unknown) => unknown | Promise<unknown> },
    input: string,
    options: HarnessRunnerOptions,
): Promise<RunOutcome> {
    const t0 = performance.now();
    const raw = await subject.execute({ input });
    const latencyMs = performance.now() - t0;

    const costUsd = options.costOf?.(raw);
    return {
        output: toStringValue(raw),
        raw,
        latencyMs,
        ...(costUsd !== undefined ? { costUsd } : {}),
    };
}

/**
 * Normalise any {@link HarnessSubject} into
 * `(input: string) => Promise<RunOutcome>`.
 */
export function toHarnessRunner(
    subject: HarnessSubject,
    options: HarnessRunnerOptions = {},
): (input: string) => Promise<RunOutcome> {
    if (typeof subject === 'function') {
        return async (input: string): Promise<RunOutcome> => {
            const t0 = performance.now();
            const raw = await subject(input);
            const latencyMs = performance.now() - t0;
            const costUsd = options.costOf?.(raw);
            return {
                output: toStringValue(raw),
                raw,
                latencyMs,
                ...(costUsd !== undefined ? { costUsd } : {}),
            };
        };
    }

    if (subject && typeof (subject as AnyObject).run === 'function') {
        return (input: string) =>
            runAgentLike(subject as { run: (i: unknown, o?: { sessionId?: string }) => unknown | Promise<unknown> }, input, options);
    }

    if (subject && typeof (subject as AnyObject).execute === 'function') {
        return (input: string) =>
            runWorkflowLike(subject as { execute: (i?: unknown) => unknown | Promise<unknown> }, input, options);
    }

    throw new Error(
        'toHarnessRunner(): unsupported subject. Expected a function, ' +
            'an object with .run(output has .text), or an object with .execute().',
    );
}

// ── Factories ──────────────────────────────────────────────────────────────

/** Harness runner for an agent-like subject (`.run()`). */
export function fromAgent<T extends { run: (input: unknown, options?: { sessionId?: string }) => unknown | Promise<unknown> }>(
    agent: T,
    options?: HarnessRunnerOptions,
): (input: string) => Promise<RunOutcome> {
    return toHarnessRunner(agent, options);
}

/** Harness runner for a task-like subject (`.run()`). */
export function fromTask(
    task: { run: (input: unknown, options?: { sessionId?: string }) => unknown | Promise<unknown> },
    options?: HarnessRunnerOptions,
): (input: string) => Promise<RunOutcome> {
    return toHarnessRunner(task, options);
}

/** Harness runner for a workflow-like subject (`.execute()`). */
export function fromWorkflow(
    workflow: { execute: (input?: unknown) => unknown | Promise<unknown> },
    options?: HarnessRunnerOptions,
): (input: string) => Promise<RunOutcome> {
    return toHarnessRunner(workflow, options);
}

/** Harness runner for a plain function subject. */
export function fromFn(fn: (input: string) => unknown | Promise<unknown>, options?: HarnessRunnerOptions): (input: string) => Promise<RunOutcome> {
    return toHarnessRunner(fn, options);
}
