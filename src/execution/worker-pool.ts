/**
 * Worker Pool for Parallel Task Execution
 *
 * Manages a pool of workers for executing tasks concurrently.
 *
 * `WorkerPool` is a logical (Promise-based) scheduler: it multiplexes async
 * tasks onto in-process "workers" that share the event loop. It is the right
 * primitive for I/O-bound orchestration (LLM calls, HTTP, DB) where a real
 * OS-thread pool (`ThreadPool`) would add no benefit.
 *
 * Each task is dispatched through a `TaskExecutor` (default: a no-op executor
 * that produces a failed result — wire a real executor via the constructor or
 * `registerExecutor()`). The pool enforces `minWorkers`/`maxWorkers` scaling,
 * per-task timeouts, idle cleanup, and graceful shutdown.
 */

import {
    WorkerPoolConfig,
    WorkerPoolStatus,
    ParallelExecutor,
    ExecutionContext,
    TaskExecutor,
} from './types.js';
import {
    Task,
    TaskResult,
    TaskStatus,
} from '../planner/index.js';

/**
 * Worker task wrapper
 */
interface WorkerTask {
    readonly task: Task;
    readonly context: ExecutionContext;
    readonly resolve: (result: TaskResult) => void;
    readonly reject: (error: Error) => void;
    readonly enqueuedAt: number;
}

/**
 * Worker state
 */
interface Worker {
    readonly id: number;
    busy: boolean;
    currentTask?: WorkerTask;
    lastActiveAt: number;
}

/**
 * Worker pool implementation
 */
export class WorkerPool implements ParallelExecutor {
    private config: Required<WorkerPoolConfig>;
    private workers: Worker[] = [];
    private taskQueue: WorkerTask[] = [];
    private taskQueueHead = 0; // head-pointer for O(1) dequeue
    private completedTasks = 0;
    private shutdown = false;
    private idleTimeoutId?: ReturnType<typeof setTimeout>;
    private executor: TaskExecutor;

    constructor(config: WorkerPoolConfig, executor?: TaskExecutor) {
        this.config = {
            minWorkers: config.minWorkers ?? 2,
            maxWorkers: config.maxWorkers ?? 8,
            idleTimeoutMs: config.idleTimeoutMs ?? 60000,
            taskTimeoutMs: config.taskTimeoutMs ?? 30000,
        };
        this.executor = executor ?? createNoopExecutor();

        // Initialize minimum workers
        this.ensureMinWorkers();
        this.startIdleCleanup();
    }

    /**
     * Set the executor used to run tasks. Replaces any previously registered
     * executor. Useful when wiring a real `TaskExecutor` after construction.
     */
    registerExecutor(executor: TaskExecutor): void {
        this.executor = executor;
    }

    /**
     * Execute multiple tasks in parallel
     */
    async executeParallel(tasks: Task[], context: ExecutionContext): Promise<TaskResult[]> {
        if (this.shutdown) {
            throw new Error('Worker pool is shutting down');
        }

        const promises = tasks.map(task => this.enqueueTask(task, context));
        return Promise.all(promises);
    }

    /**
     * Get current pool status
     */
    getPoolStatus(): WorkerPoolStatus {
        let activeWorkers = 0;
        for (const w of this.workers) if (w.busy) activeWorkers++;
        return {
            totalWorkers: this.workers.length,
            activeWorkers,
            idleWorkers: this.workers.length - activeWorkers,
            pendingTasks: this.taskQueue.length - this.taskQueueHead,
            completedTasks: this.completedTasks,
        };
    }

    /**
     * Shutdown the worker pool
     */
    async shutdownPool(waitForTasks = true): Promise<void> {
        this.shutdown = true;

        if (this.idleTimeoutId) {
            clearTimeout(this.idleTimeoutId);
        }

        if (waitForTasks) {
            // Wait for queued tasks to complete
            while (this.taskQueueHead < this.taskQueue.length || this.workers.some(w => w.busy)) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } else {
            // Reject all pending tasks
            for (let i = this.taskQueueHead; i < this.taskQueue.length; i++) {
                this.taskQueue[i]!.reject(new Error('Worker pool is shutting down'));
            }
            this.taskQueue = [];
            this.taskQueueHead = 0;
        }

        this.workers = [];
    }

    /**
     * Enqueue a task for execution
     */
    private enqueueTask(task: Task, context: ExecutionContext): Promise<TaskResult> {
        return new Promise((resolve, reject) => {
            const workerTask: WorkerTask = {
                task,
                context,
                resolve,
                reject,
                enqueuedAt: Date.now(),
            };

            this.taskQueue.push(workerTask);
            this.processQueue();
        });
    }

    /** Dequeue front item in O(1); compact when >50% dead slots and array is large enough */
    private dequeueTask(): WorkerTask | undefined {
        if (this.taskQueueHead >= this.taskQueue.length) return undefined;
        const task = this.taskQueue[this.taskQueueHead++]!;
        // Compact: when >128 dead slots and they account for >50% of the array
        if (this.taskQueueHead > 128 && this.taskQueueHead > this.taskQueue.length / 2) {
            this.taskQueue = this.taskQueue.slice(this.taskQueueHead);
            this.taskQueueHead = 0;
        }
        return task;
    }

    /**
     * Process the task queue
     */
    private processQueue(): void {
        if (this.shutdown) return;

        while (this.taskQueueHead < this.taskQueue.length) {
            const worker = this.getAvailableWorker();
            if (!worker) break;

            const task = this.dequeueTask()!;
            this.executeTask(worker, task);
        }

        // Scale up if needed
        if (this.taskQueueHead < this.taskQueue.length && this.workers.length < this.config.maxWorkers) {
            this.createWorker();
            this.processQueue();
        }
    }

    /**
     * Get an available worker
     */
    private getAvailableWorker(): Worker | undefined {
        // Find idle worker
        const idleWorker = this.workers.find(w => !w.busy);
        if (idleWorker) return idleWorker;

        // Create new worker if under max
        if (this.workers.length < this.config.maxWorkers) {
            return this.createWorker();
        }

        return undefined;
    }

    /**
     * Create a new worker
     */
    private createWorker(): Worker {
        const worker: Worker = {
            id: this.workers.length + 1,
            busy: false,
            lastActiveAt: Date.now(),
        };
        this.workers.push(worker);
        return worker;
    }

    /**
     * Execute a task on a worker
     */
    private async executeTask(worker: Worker, workerTask: WorkerTask): Promise<void> {
        worker.busy = true;
        worker.currentTask = workerTask;
        worker.lastActiveAt = Date.now();

        const { task, context, resolve, reject } = workerTask;

        try {
            // Create timeout promise
            const timeoutPromise = new Promise<never>((_, timeoutReject) => {
                setTimeout(() => {
                    timeoutReject(new Error(`Task ${task.id} timed out after ${this.config.taskTimeoutMs}ms`));
                }, this.config.taskTimeoutMs);
            });

            // Execute task with timeout
            const result = await Promise.race([
                this.runTask(task, context),
                timeoutPromise,
            ]);

            this.completedTasks++;
            resolve(result);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            reject(err);
        } finally {
            worker.busy = false;
            worker.currentTask = undefined;
            worker.lastActiveAt = Date.now();

            // Process more tasks
            this.processQueue();
        }
    }

    /**
     * Run a task through the registered executor. Produces a failed result
     * with a descriptive error if the executor throws or rejects.
     */
    private async runTask(task: Task, context: ExecutionContext): Promise<TaskResult> {
        const startTime = Date.now();
        const startedAt = new Date(startTime);

        try {
            const result = await this.executor.execute(task, context);
            // Ensure the result carries the task id + timestamps even if the
            // executor returns a partially-populated result.
            return {
                taskId: result.taskId,
                status: result.status,
                output: result.output,
                error: result.error,
                executionTimeMs: result.executionTimeMs ?? Date.now() - startTime,
                startedAt: result.startedAt ?? startedAt,
                completedAt: result.completedAt ?? new Date(),
            };
        } catch (error) {
            return {
                taskId: task.id,
                status: TaskStatus.FAILED,
                error: {
                    code: 'EXECUTION_ERROR',
                    message: error instanceof Error ? error.message : String(error),
                    retryable: true,
                },
                executionTimeMs: Date.now() - startTime,
                startedAt,
                completedAt: new Date(),
            };
        }
    }

    /**
     * Ensure minimum number of workers
     */
    private ensureMinWorkers(): void {
        while (this.workers.length < this.config.minWorkers) {
            this.createWorker();
        }
    }

    /**
     * Start idle worker cleanup
     */
    private startIdleCleanup(): void {
        const cleanup = () => {
            if (this.shutdown) return;

            const now = Date.now();
            const toRemove: Worker[] = [];

            // Find idle workers that have been idle too long
            for (const worker of this.workers) {
                if (!worker.busy &&
                    this.workers.length > this.config.minWorkers &&
                    now - worker.lastActiveAt > this.config.idleTimeoutMs) {
                    toRemove.push(worker);
                }
            }

            // Remove excess idle workers
            for (const worker of toRemove) {
                if (this.workers.length <= this.config.minWorkers) break;
                const index = this.workers.indexOf(worker);
                if (index > -1) {
                    this.workers.splice(index, 1);
                }
            }

            this.idleTimeoutId = setTimeout(cleanup, this.config.idleTimeoutMs);
        };

        this.idleTimeoutId = setTimeout(cleanup, this.config.idleTimeoutMs);
    }
}

/**
 * Default executor: fails any task with a clear message so callers are not
 * silently handed fabricated results. Real deployments should pass a concrete
 * `TaskExecutor` via the constructor or `registerExecutor()`.
 */
function createNoopExecutor(): TaskExecutor {
    return {
        canExecute(): boolean {
            return true;
        },
        async execute(task: Task): Promise<TaskResult> {
            const now = new Date();
            return {
                taskId: task.id,
                status: TaskStatus.FAILED,
                error: {
                    code: 'NO_EXECUTOR',
                    message: `No TaskExecutor registered for task "${task.name}" (${task.id}). Pass one to createWorkerPool(config, executor) or call registerExecutor().`,
                    retryable: false,
                },
                executionTimeMs: 0,
                startedAt: now,
                completedAt: now,
            };
        },
    };
}

/**
 * Create a new worker pool
 */
export function createWorkerPool(config: WorkerPoolConfig, executor?: TaskExecutor): WorkerPool {
    return new WorkerPool(config, executor);
}
