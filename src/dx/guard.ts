/**
 * `guard()` — declarative, schema-driven safety for any runnable.
 *
 * A guard validates inputs and outputs against Standard Schemas (Zod/Valibot/
 * ArkType) and/or a custom `validate` predicate. Wrap any runnable with
 * `.wrap()` to enforce the guard on every call; hooks reject with typed
 * `GuardError`s on failure.
 *
 * ```ts
 * import { guard } from 'personaforge';
 * import { z } from 'zod';
 *
 * const safety = guard({
 *   name: 'pii',
 *   input: z.object({ prompt: z.string().max(2000) }),
 *   validate: ({ input }) =>
 *     !/^BEGIN/.test(String(input?.prompt ?? '')) || { ok: false, reason: 'prompt-injection' },
 * });
 *
 * // Enforce on an existing runnable:
 * const safeAgent = safety.wrap(myAgent);
 * await safeAgent.run('hello');       // ok
 * await safeAgent.run('BEGIN PAYLOAD'); // throws GuardError
 * ```
 */

import type { SchemaInput } from '../validation/index.js';
import { safeValidate } from '../validation/index.js';

// ── Types ──────────────────────────────────────────────────────────────────

/** Result of a guard check. */
export interface GuardResult {
    readonly ok: boolean;
    /** Present when `ok` is false. */
    readonly reason?: string;
    /** Which stage failed: input validation, output validation, or custom. */
    readonly phase: 'input' | 'output' | 'custom';
}

/** A custom predicate; return true to pass, or a result object to fail. */
export type GuardPredicate<TInput = unknown, TOutput = unknown> = (
    input: TInput | undefined,
    output: TOutput | undefined,
) => boolean | Omit<GuardResult, 'phase'> | Promise<boolean | Omit<GuardResult, 'phase'>>;

/** Configuration for {@link guard}. */
export interface GuardOptions<TInput = unknown, TOutput = unknown> {
    /** Guard name (used in errors). */
    readonly name?: string;
    /** Human-readable description. */
    readonly description?: string;
    /** Standard Schema the input must satisfy. */
    readonly input?: SchemaInput<unknown, TInput>;
    /** Standard Schema the output must satisfy. */
    readonly output?: SchemaInput<unknown, TOutput>;
    /** Custom predicate evaluated after schema checks. */
    readonly validate?: GuardPredicate<TInput, TOutput>;
}

/** A guard failure — thrown by {@link Guard.wrap} when a check fails. */
export class GuardError extends Error {
    readonly result: GuardResult;
    constructor(result: GuardResult, guardName: string) {
        super(`Guard "${guardName}" rejected: ${result.reason ?? result.phase}`);
        this.name = 'GuardError';
        this.result = result;
    }
}

/** The object returned by {@link guard}. */
export interface Guard<TInput = unknown, TOutput = unknown> {
    readonly name: string;
    readonly description: string;
    /** Run every check against an input/output pair. */
    check(input?: TInput, output?: TOutput): Promise<GuardResult>;
    /**
     * Wrap any runnable (an object with `run(input, options?)`) so the guard
     * is enforced on every call: input checked before, output after.
     */
    wrap<TRunnable extends { run: (input: any, options?: any) => Promise<any> }>(
        runnable: TRunnable,
    ): GuardedRunnable<TRunnable>;
}

/** A runnable wrapped by a {@link Guard}. */
export type GuardedRunnable<T> = Omit<T, 'asTool' | 'run'> & {
    run: T extends { run: (input: infer I, options: infer O) => Promise<infer R> }
        ? (input: I, options?: O) => Promise<R>
        : (input: unknown, options?: unknown) => Promise<unknown>;
};

// ── Implementation ─────────────────────────────────────────────────────────

function toResult(result: boolean | Omit<GuardResult, 'phase'>, phase: GuardResult['phase']): GuardResult {
    if (result === true) return { ok: true, phase };
    if (result === false) return { ok: false, reason: 'guard predicate rejected the value', phase };
    return { ok: result.ok, ...(result.reason !== undefined ? { reason: result.reason } : {}), phase };
}

/**
 * Create a declarative guard that validates inputs and outputs.
 */
export function guard<TInput = unknown, TOutput = unknown>(
    options: GuardOptions<TInput, TOutput> = {},
): Guard<TInput, TOutput> {
    const name = options.name ?? 'guard';
    const description = options.description ?? `${name} input/output guard`;

    async function check(input?: TInput, output?: TOutput): Promise<GuardResult> {
        if (options.input && input !== undefined) {
            const result = safeValidate(options.input, input);
            if (!result.success) {
                return {
                    ok: false,
                    reason: `input validation failed: ${result.error.message}`,
                    phase: 'input',
                };
            }
        }

        if (options.output && output !== undefined) {
            const result = safeValidate(options.output, output);
            if (!result.success) {
                return {
                    ok: false,
                    reason: `output validation failed: ${result.error.message}`,
                    phase: 'output',
                };
            }
        }

        if (options.validate) {
            return toResult(await options.validate(input, output), 'custom');
        }

        return { ok: true, phase: 'custom' } as GuardResult;
    }

    return {
        name,
        description,
        async check(input, output) {
            return check(input, output);
        },
        wrap(runnable) {
            const wrapped = {
                ...runnable,
                run: async (input: unknown, runOptions?: unknown) => {
                    const phase = 'input';
                    const inputResult = await check(input as TInput, undefined);
                    if (!inputResult.ok) throw new GuardError({ ...inputResult, phase }, name);
                    const output = await (runnable as { run: (i: unknown, o?: unknown) => Promise<unknown> }).run(
                        input,
                        runOptions,
                    );
                    const outputResult = await check(undefined, output as TOutput);
                    if (!outputResult.ok) throw new GuardError({ ...outputResult, phase: 'output' }, name);
                    return output;
                },
            };
            return wrapped as unknown as GuardedRunnable<typeof runnable>;
        },
    };
}
