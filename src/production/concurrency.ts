/**
 * Concurrency primitives — bounded parallel execution.
 *
 * A counting semaphore caps concurrent work, preventing resource
 * exhaustion (unbounded concurrency) in the runtime server and
 * tool execution paths.
 *
 * @example
 * ```ts
 * import { Semaphore } from 'personaforge/production';
 * const sem = new Semaphore(10);
 * await sem.withLock(() => heavyWork());
 * ```
 */

export class Semaphore {
    private active = 0;
    private waiting: Array<() => void> = [];

    constructor(private readonly capacity: number) {
        if (!Number.isInteger(capacity) || capacity <= 0) {
            throw new TypeError(`Semaphore: capacity must be a positive integer, got ${capacity}`);
        }
    }

    /** Number of currently acquired permits. */
    get available(): number {
        return Math.max(0, this.capacity - this.active);
    }

    /** Total capacity. */
    get limit(): number {
        return this.capacity;
    }

    /** Attempt to acquire a permit without waiting. */
    tryAcquire(): boolean {
        if (this.active >= this.capacity) return false;
        this.active += 1;
        return true;
    }

    /** Acquire a permit, waiting if none available. */
    async acquire(): Promise<void> {
        if (this.active < this.capacity) {
            this.active += 1;
            return;
        }
        await new Promise<void>((resolve) => {
            this.waiting.push(resolve);
        });
        this.active += 1;
    }

    /** Release a permit, waking the next waiter. */
    release(): void {
        this.active -= 1;
        if (this.active < 0) this.active = 0;
        const next = this.waiting.shift();
        if (next) next();
    }

    /** Run a task under the semaphore; always releases in `finally`. */
    async withLock<T>(task: () => Promise<T> | T): Promise<T> {
        await this.acquire();
        try {
            return await task();
        } finally {
            this.release();
        }
    }
}

/**
 * Bounded pool for agent/tool execution — runs at most `limit` tasks
 * concurrently, queuing the rest in FIFO order. Rejects tasks that
 * exceed the queue depth with an error (backpressure).
 */
export class ConcurrencyLimiter {
    private readonly sem: Semaphore;
    private queued = 0;

    constructor(
        limit: number,
        private readonly queueLimit = 10_000,
    ) {
        this.sem = new Semaphore(limit);
    }

    /** Current queued task count (backpressure signal). */
    get queueDepth(): number {
        return this.queued;
    }

    /** Whether the queue is full (callers should shed load). */
    get isOverloaded(): boolean {
        return this.queued >= this.queueLimit;
    }

    async run<T>(task: () => Promise<T>): Promise<T> {
        if (this.queued >= this.queueLimit) {
            throw new Error('ConcurrencyLimiter: queue full — shed load');
        }
        this.queued += 1;
        try {
            return await this.sem.withLock(task);
        } finally {
            this.queued -= 1;
        }
    }
}
