/**
 * ThreadPool — real OS-thread parallelism via `node:worker_threads`.
 *
 * `WorkerPool` in this folder is a logical Promise scheduler: it multiplexes
 * async tasks onto in-process "workers" that share the event loop. That is the
 * right primitive for I/O-bound orchestration (LLM calls, HTTP, DB), but it
 * cannot exploit multiple CPU cores for pure-compute work — a CPU-bound task on
 * one worker still blocks the whole process.
 *
 * `ThreadPool` is the opt-in, off-loop primitive for that CPU-bound case:
 *
 *   - Persistent pool of `node:worker_threads` (fixed or bounded).
 *   - Each job is a `(input) => output` function stringified once at
 *     registration time and cached inside every worker.
 *   - Input and output must be structured-clone serialisable
 *     (JSON-compatible types + typed arrays + `ArrayBuffer` transferables).
 *   - No shared mutable state between jobs.
 *
 * Use it for: token counting on large corpora, embedding batch normalisation,
 * cost / eval score aggregation, deterministic hash / crypto, JSON validation.
 *
 * @example
 *   import { ThreadPool } from 'personaforge/execution';
 *
 *   const pool = new ThreadPool({ size: 4 });
 *   // job body is stringified — must be self-contained (no closures).
 *   const heavy = pool.register((n: number) => {
 *       let s = 0;
 *       for (let i = 0; i < n; i++) s += Math.sqrt(i);
 *       return s;
 *   });
 *   const results = await Promise.all([heavy(1e7), heavy(1e7), heavy(1e7)]);
 *   await pool.shutdown();
 */

import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

export interface ThreadPoolOptions {
    /** Number of worker threads to keep alive. Default: `availableParallelism()`. */
    readonly size?: number;
    /** Optional per-job timeout in ms. `undefined` means no timeout. */
    readonly taskTimeoutMs?: number;
    /**
     * Called when a worker crashes with a non-zero exit code. The pool
     * automatically respawns the worker afterwards.
     */
    readonly onWorkerError?: (error: Error, workerId: number) => void;
}

interface PoolJob {
    /** Stable id that maps to a registered function body inside every worker. */
    readonly id: number;
    /** Stringified function body. */
    readonly body: string;
}

interface PendingCall<TOutput> {
    readonly resolve: (value: TOutput) => void;
    readonly reject: (err: Error) => void;
    readonly timeoutId?: ReturnType<typeof setTimeout>;
}

interface WorkerSlot {
    readonly id: number;
    worker: Worker;
    busy: boolean;
    nextCallId: number;
    pending: Map<number, PendingCall<unknown>>;
}

const WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads');
const registry = new Map();
parentPort.on('message', (msg) => {
    if (msg && msg.type === 'register') {
        try {
            // Reconstruct the function from its stringified body. The body must
            // be self-contained (no closures over the parent scope).
            // eslint-disable-next-line no-new-func
            const fn = (0, eval)('(' + msg.body + ')');
            registry.set(msg.jobId, fn);
            parentPort.postMessage({ type: 'registered', jobId: msg.jobId });
        } catch (err) {
            parentPort.postMessage({ type: 'register-error', jobId: msg.jobId, error: String(err) });
        }
        return;
    }
    if (msg && msg.type === 'call') {
        const fn = registry.get(msg.jobId);
        if (!fn) {
            parentPort.postMessage({ type: 'result', callId: msg.callId, error: 'job ' + msg.jobId + ' not registered on this worker' });
            return;
        }
        Promise.resolve()
            .then(() => fn(msg.input))
            .then((output) => { parentPort.postMessage({ type: 'result', callId: msg.callId, output }); })
            .catch((err) => { parentPort.postMessage({ type: 'result', callId: msg.callId, error: err && err.message ? err.message : String(err) }); });
        return;
    }
});
`;

/**
 * A registered job handle. Call it like a function; each call is scheduled onto
 * an available worker thread. Resolves with the value returned by the job body.
 */
export type ThreadJob<TInput, TOutput> = (input: TInput) => Promise<TOutput>;

export class ThreadPool {
    private readonly options: Required<ThreadPoolOptions>;
    private readonly slots: WorkerSlot[] = [];
    private readonly registrations = new Map<number, PoolJob>();
    private readonly queue: Array<{
        jobId: number;
        input: unknown;
        resolve: (value: unknown) => void;
        reject: (err: Error) => void;
    }> = [];
    private nextJobId = 1;
    private isShuttingDown = false;

    constructor(options: ThreadPoolOptions = {}) {
        this.options = {
            size: options.size ?? Math.max(1, availableParallelism()),
            taskTimeoutMs: options.taskTimeoutMs ?? 0,
            onWorkerError: options.onWorkerError ?? (() => undefined),
        };
        for (let i = 0; i < this.options.size; i++) {
            this.slots.push(this.spawn(i));
        }
    }

    /**
     * Register a pure function on every worker and get back a caller.
     * The function body is stringified — it MUST NOT reference any variable from
     * the surrounding lexical scope.
     */
    register<TInput = unknown, TOutput = unknown>(fn: (input: TInput) => TOutput | Promise<TOutput>): ThreadJob<TInput, TOutput> {
        if (this.isShuttingDown) throw new Error('ThreadPool is shut down');
        const id = this.nextJobId++;
        const body = fn.toString();
        const registration: PoolJob = { id, body };
        this.registrations.set(id, registration);
        for (const slot of this.slots) {
            slot.worker.postMessage({ type: 'register', jobId: id, body });
        }
        return (input: TInput) => this.call<TOutput>(id, input);
    }

    /** Number of currently alive worker threads. */
    size(): number {
        return this.slots.length;
    }

    /**
     * Drain the queue, wait for in-flight jobs, then terminate all workers.
     * After `shutdown()` resolves the pool is unusable.
     */
    async shutdown(): Promise<void> {
        this.isShuttingDown = true;
        // Drain pending queue with a shutdown error.
        while (this.queue.length > 0) {
            const q = this.queue.shift()!;
            q.reject(new Error('ThreadPool is shutting down'));
        }
        // Wait for busy slots to finish then terminate.
        await Promise.all(
            this.slots.map(async (slot) => {
                while (slot.busy) {
                    await new Promise((r) => setTimeout(r, 5));
                }
                await slot.worker.terminate();
            }),
        );
        this.slots.length = 0;
    }

    private call<TOutput>(jobId: number, input: unknown): Promise<TOutput> {
        if (this.isShuttingDown) return Promise.reject(new Error('ThreadPool is shut down'));
        return new Promise<TOutput>((resolve, reject) => {
            this.queue.push({
                jobId,
                input,
                resolve: resolve as (value: unknown) => void,
                reject,
            });
            this.pump();
        });
    }

    private pump(): void {
        for (const slot of this.slots) {
            if (this.queue.length === 0) return;
            if (slot.busy) continue;
            const q = this.queue.shift()!;
            this.dispatch(slot, q.jobId, q.input, q.resolve, q.reject);
        }
    }

    private dispatch(
        slot: WorkerSlot,
        jobId: number,
        input: unknown,
        resolve: (value: unknown) => void,
        reject: (err: Error) => void,
    ): void {
        slot.busy = true;
        const callId = slot.nextCallId++;
        const timeoutId = this.options.taskTimeoutMs > 0
            ? setTimeout(() => {
                const pending = slot.pending.get(callId);
                if (!pending) return;
                slot.pending.delete(callId);
                slot.busy = false;
                pending.reject(new Error(`ThreadPool job timed out after ${this.options.taskTimeoutMs}ms`));
                this.pump();
            }, this.options.taskTimeoutMs)
            : undefined;
        slot.pending.set(callId, {
            resolve,
            reject,
            ...(timeoutId !== undefined && { timeoutId }),
        });
        slot.worker.postMessage({ type: 'call', jobId, callId, input });
    }

    private spawn(id: number): WorkerSlot {
        const worker = new Worker(WORKER_SOURCE, { eval: true });
        const slot: WorkerSlot = {
            id,
            worker,
            busy: false,
            nextCallId: 1,
            pending: new Map(),
        };
        worker.on('message', (msg: { type: string; callId?: number; output?: unknown; error?: string }) => {
            if (msg.type !== 'result' || msg.callId === undefined) return;
            const pending = slot.pending.get(msg.callId);
            if (!pending) return;
            slot.pending.delete(msg.callId);
            if (pending.timeoutId !== undefined) clearTimeout(pending.timeoutId);
            slot.busy = false;
            if (msg.error !== undefined) {
                pending.reject(new Error(msg.error));
            } else {
                pending.resolve(msg.output);
            }
            this.pump();
        });
        worker.on('error', (rawErr: unknown) => {
            const err = rawErr instanceof Error ? rawErr : new Error(String(rawErr));
            this.options.onWorkerError(err, id);
            // Fail all in-flight calls on this worker and respawn.
            for (const pending of slot.pending.values()) pending.reject(err);
            slot.pending.clear();
            slot.busy = false;
            if (this.isShuttingDown) return;
            const idx = this.slots.indexOf(slot);
            if (idx >= 0) {
                const replacement = this.spawn(id);
                // Re-register every known job on the new worker.
                for (const reg of this.registrations.values()) {
                    replacement.worker.postMessage({ type: 'register', jobId: reg.id, body: reg.body });
                }
                this.slots[idx] = replacement;
                this.pump();
            }
        });
        // Register any already-declared jobs on the new worker.
        for (const reg of this.registrations.values()) {
            worker.postMessage({ type: 'register', jobId: reg.id, body: reg.body });
        }
        return slot;
    }
}

/** Convenience factory mirroring the style of `createWorkerPool`. */
export function createThreadPool(options: ThreadPoolOptions = {}): ThreadPool {
    return new ThreadPool(options);
}
