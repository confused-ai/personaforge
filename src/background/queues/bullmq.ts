/**
 * BullMQBackgroundQueue — BullMQ adapter (Redis-backed, durable, retries, delays, priorities).
 *
 * Install peer dep:  bun add bullmq
 *
 * @example
 * ```ts
 * import { BullMQBackgroundQueue } from 'personaforge/background';
 *
 * const queue = new BullMQBackgroundQueue({
 *   queueName: 'agent-hooks',
 *   redis: { host: 'localhost', port: 6379 },
 *   defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 1000 } },
 * });
 *
 * // In your worker process:
 * await queue.consume('afterRun', async (task) => {
 *   await analytics.track(task.payload);
 * }, { concurrency: 10 });
 * ```
 */
import type {
    BackgroundQueue,
    BackgroundTask,
    BackgroundTaskHandler,
    EnqueueOptions,
    WorkerOptions,
} from '../types.js';
import { generateTaskId } from '../util.js';

// We use dynamic import so the peer dep is optional — only fails at runtime
// if BullMQBackgroundQueue is actually instantiated without bullmq installed.
type BullMQQueue = {
    add(name: string, data: unknown, opts?: Record<string, unknown>): Promise<unknown>;
    close(): Promise<void>;
};
type BullMQWorker = {
    close(): Promise<void>;
};

export interface BullMQBackgroundQueueOptions {
    /** BullMQ queue name (all hook types share one queue). */
    queueName?: string;
    /** Redis connection options passed directly to BullMQ Queue / Worker constructors. */
    redis: { host: string; port: number; password?: string; db?: number } | string;
    /**
     * Default BullMQ job options applied to every job.
     * Supports all BullMQ JobsOptions fields.
     */
    defaultJobOptions?: Record<string, unknown>;
}

export class BullMQBackgroundQueue implements BackgroundQueue {
    readonly name = 'bullmq';

    private readonly opts: BullMQBackgroundQueueOptions;
    private queue?: BullMQQueue;
    private readonly workers: BullMQWorker[] = [];

    constructor(options: BullMQBackgroundQueueOptions) {
        this.opts = options;
    }

    // ─── lazy init ──────────────────────────────────────────────────────────

    private async getQueue(): Promise<BullMQQueue> {
        if (this.queue) return this.queue;

        // @ts-ignore -- bullmq is an optional peer dep
        const { Queue } = (await import('bullmq')) as any;
        this.queue = new Queue(this.opts.queueName ?? 'agent-background', {
            connection: typeof this.opts.redis === 'string'
                ? { url: this.opts.redis }
                : this.opts.redis,
            defaultJobOptions: this.opts.defaultJobOptions ?? { attempts: 3 },
        }) as BullMQQueue;
        return this.queue;
    }

    async enqueue<TPayload = unknown>(
        task: Omit<BackgroundTask<TPayload>, 'id' | 'enqueuedAt'>,
        options: EnqueueOptions = {},
    ): Promise<void> {
        const full: BackgroundTask<TPayload> = {
            id: generateTaskId(),
            enqueuedAt: Date.now(),
            ...task,
        } as BackgroundTask<TPayload>;

        const q = await this.getQueue();
        await q.add(full.type, full, {
            ...(this.opts.defaultJobOptions ?? {}),
            ...(options.backendOptions ?? {}),
            ...(options.delay ? { delay: options.delay } : {}),
            ...(options.retries !== undefined ? { attempts: options.retries + 1 } : {}),
        });
    }

    async consume<TPayload = unknown>(
        type: string,
        handler: BackgroundTaskHandler<TPayload>,
        options: WorkerOptions = {},
    ): Promise<() => Promise<void>> {

        // @ts-ignore -- bullmq is an optional peer dep
        const { Worker } = (await import('bullmq')) as any;
        const worker = new Worker(
            this.opts.queueName ?? 'agent-background',
            async (job: { name: string; data: BackgroundTask<TPayload> }) => {
                if (job.name !== type) return; // each worker handles one type
                await handler(job.data);
            },
            {
                connection: typeof this.opts.redis === 'string'
                    ? { url: this.opts.redis }
                    : this.opts.redis,
                concurrency: options.concurrency ?? 5,
                ...(options.backendOptions ?? {}),
            },
        ) as BullMQWorker;
        this.workers.push(worker);
        return async () => { await worker.close(); };
    }

    async close(): Promise<void> {
        await Promise.all(this.workers.map((w) => w.close()));
        if (this.queue) await this.queue.close();
    }
}
