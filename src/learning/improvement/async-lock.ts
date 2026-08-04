/**
 * Minimal async mutex.
 *
 * The improvement stores perform read-modify-write (compute next version,
 * supersede the active policy, write the audit trail). An `AgentDb` exposes no
 * cross-backend transaction primitive, so we serialize those critical sections
 * with an in-process lock — correct for the standard single-process deployment
 * and safe on every backend (SQLite, Postgres, Mongo, Redis, MySQL, DynamoDB,
 * Turso, ...). For multi-process deployments, keep one store instance per
 * process and rely on the dedicated SQLite store's native transactions, or add
 * a DB-level advisory lock.
 */

export class AsyncLock {
    private _queue: Promise<unknown> = Promise.resolve();

    /** Run `fn` exclusively; waiters are serialized FIFO. */
    run<T>(fn: () => Promise<T>): Promise<T> {
        const result = this._queue.then(async () => fn());
        this._queue = result.catch(() => undefined);
        return result;
    }
}
