/**
 * ThreadPool — proves real OS-thread parallelism via node:worker_threads.
 *
 * Correctness is the primary contract. We also include a throughput signal:
 * on a multi-core runner, N CPU-bound jobs across N threads should finish in
 * meaningfully less wall-time than running them one after another on a single
 * thread. That timing assertion is deliberately loose (and skipped on single-
 * core machines) so it never flakes CI, while still failing if the pool
 * silently degrades to serial execution.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { availableParallelism } from 'node:os';
import { ThreadPool } from '../src/execution/thread-pool.js';

let pool: ThreadPool | undefined;

afterEach(async () => {
    if (pool) {
        await pool.shutdown();
        pool = undefined;
    }
});

// A self-contained CPU-bound function (no closures over the test scope).
function spin(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.sqrt(i) * Math.sin(i);
    return s;
}

describe('ThreadPool', () => {
    it('runs a registered job on a worker thread and returns the result', async () => {
        pool = new ThreadPool({ size: 2 });
        const job = pool.register(spin);
        const result = await job(100_000);
        // Same computation on the main thread must match.
        expect(result).toBeCloseTo(spin(100_000), 5);
    });

    it('handles many concurrent calls correctly', async () => {
        pool = new ThreadPool({ size: 4 });
        const job = pool.register((x: number) => x * x);
        const inputs = Array.from({ length: 50 }, (_, i) => i);
        const outputs = await Promise.all(inputs.map((i) => job(i)));
        expect(outputs).toEqual(inputs.map((i) => i * i));
    });

    it('propagates errors thrown inside a job', async () => {
        pool = new ThreadPool({ size: 1 });
        const job = pool.register((_x: number) => {
            throw new Error('boom in worker');
        });
        await expect(job(1)).rejects.toThrow('boom in worker');
    });

    it('enforces a per-job timeout when configured', async () => {
        pool = new ThreadPool({ size: 1, taskTimeoutMs: 50 });
        const job = pool.register((_x: number) => {
            // Busy-wait longer than the timeout — a worker thread cannot be
            // interrupted, so the pool must reject via its own timer.
            const end = Date.now() + 500;
            while (Date.now() < end) { /* spin */ }
            return 1;
        });
        await expect(job(1)).rejects.toThrow(/timed out/);
    });

    it('exposes the configured pool size', () => {
        pool = new ThreadPool({ size: 3 });
        expect(pool.size()).toBe(3);
    });

    it('parallel execution beats serial on multi-core machines', async () => {
        const cores = availableParallelism();
        if (cores < 2) {
            // Single-core CI box — parallel speedup is not observable. Skip.
            return;
        }
        const threads = Math.min(4, cores);
        pool = new ThreadPool({ size: threads });
        const job = pool.register(spin);

        const WORK = 8_000_000;
        const jobs = threads;

        // Warm up the workers so thread spawn cost is excluded from timing.
        await Promise.all(Array.from({ length: threads }, () => job(1)));

        const parStart = performance.now();
        await Promise.all(Array.from({ length: jobs }, () => job(WORK)));
        const parMs = performance.now() - parStart;

        // Serial baseline on the main thread.
        const serStart = performance.now();
        for (let i = 0; i < jobs; i++) spin(WORK);
        const serMs = performance.now() - serStart;

        // Expect at least a modest speedup. Loose factor to avoid CI flake:
        // parallel should be faster than 80% of serial when we have >=2 threads.
        expect(parMs).toBeLessThan(serMs * 0.8);
    });
});
