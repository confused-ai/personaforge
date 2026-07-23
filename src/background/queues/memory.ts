/**
 * InMemoryBackgroundQueue — default queue, zero dependencies.
 *
 * Tasks run inside the same process using an async worker pool.
 * Good for development and single-node deployments.
 * For production at scale swap to one of the durable backends.
 */
import type {
    BackgroundQueue,
    BackgroundTask,
    BackgroundTaskHandler,
    EnqueueOptions,
    WorkerOptions,
} from '../types.js';
import { generateTaskId } from '../util.js';

interface PendingTask {
    task: BackgroundTask;
    handler: BackgroundTaskHandler;
    retries: number;
}

/**
 * In-process background queue backed by a simple async worker pool.
 * No external dependencies.
 *
 * @example
 * ```ts
 * import { InMemoryBackgroundQueue } from 'personaforge/background';
 *
 * const queue = new InMemoryBackgroundQueue({ concurrency: 4 });
 * ```
 */
export class InMemoryBackgroundQueue implements BackgroundQueue {
    readonly name = 'in-memory';

    private readonly defaultConcurrency: number;
    private readonly handlers = new Map<string, BackgroundTaskHandler>();
    private readonly pending: PendingTask[] = [];
    private active = 0;
    private closed = false;

    constructor(options: { concurrency?: number } = {}) {
        this.defaultConcurrency = options.concurrency ?? 5;
    }

    async enqueue<TPayload = unknown>(
        task: Omit<BackgroundTask<TPayload>, 'id' | 'enqueuedAt'>,
        options: EnqueueOptions = {},
    ): Promise<void> {
        if (this.closed) return;

        const full: BackgroundTask<TPayload> = {
            id: generateTaskId(),
            enqueuedAt: Date.now(),
            ...task,
        } as BackgroundTask<TPayload>;

        const handler = this.handlers.get(full.type);
        if (!handler) {
            // No handler registered yet — park the task; it will drain when one is registered
            this.pending.push({ task: full as BackgroundTask, handler: async () => { /* deferred */ }, retries: options.retries ?? 0 });
            return;
        }

        const delay = options.delay ?? 0;
        if (delay > 0) {
            setTimeout(() => void this.dispatch({ task: full as BackgroundTask, handler, retries: options.retries ?? 0 }), delay);
        } else {
            this.dispatch({ task: full as BackgroundTask, handler, retries: options.retries ?? 0 });
        }
    }

    async consume<TPayload = unknown>(
        type: string,
        handler: BackgroundTaskHandler<TPayload>,
        options: WorkerOptions = {},
    ): Promise<() => Promise<void>> {
        this.defaultConcurrency; // unused but kept for symmetry
        const concurrency = options.concurrency ?? this.defaultConcurrency;
        this.handlers.set(type, handler as BackgroundTaskHandler);

        // Drain any tasks that arrived before the handler was registered
        const parked = this.pending.filter((p) => p.task.type === type);
        parked.forEach((p) => {
            this.pending.splice(this.pending.indexOf(p), 1);
            p.handler = handler as BackgroundTaskHandler;
            if (this.active < concurrency) this.dispatch(p);
        });

        return async () => {
            this.handlers.delete(type);
        };
    }

    async close(): Promise<void> {
        this.closed = true;
        // Wait briefly for in-flight tasks
        await new Promise<void>((resolve) => setTimeout(resolve, 200));
    }

    // ─── internal ──────────────────────────────────────────────────────────

    private dispatch(item: PendingTask): void {
        if (this.active >= this.defaultConcurrency || this.closed) {
            this.pending.push(item);
            return;
        }
        this.active++;
        void Promise.resolve(item.handler(item.task))
            .catch((err: unknown) => {
                console.error(`[InMemoryBackgroundQueue] task "${item.task.type}" failed:`, err);
                if (item.retries > 0) {
                    setTimeout(() => this.dispatch({ ...item, retries: item.retries - 1 }), 1000);
                }
            })
            .finally(() => {
                this.active--;
                if (this.pending.length > 0) {
                    const next = this.pending.shift();
                    if (next) this.dispatch(next);
                }
            });
    }
}
