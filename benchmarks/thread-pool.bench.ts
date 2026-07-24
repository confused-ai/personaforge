/**
 * Benchmark: ThreadPool throughput — OS threads vs main-thread baseline.
 *
 * Measures wall-time for N CPU-bound jobs across K worker threads vs the same
 * workload on the main thread. Run:
 *
 *   bun bench benchmarks/thread-pool.bench.ts
 *
 * Expected: parallel throughput scales linearly with thread count on multi-core
 * machines. On single-core (CI runners), the parallel version should be no
 * worse than ~1.2× serial.
 */

import { bench, describe } from 'vitest';
import { ThreadPool } from '../src/execution/thread-pool.js';

function spin(n: number): number {
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.sqrt(i) * Math.sin(i);
    return s;
}

const WORK = 2_000_000;
const JOBS = 8;

describe('ThreadPool throughput', () => {
    const pool = new ThreadPool({ size: 4 });
    const job = pool.register(spin);

    bench('serial (main thread)', () => {
        for (let i = 0; i < JOBS; i++) spin(WORK);
    });

    bench('parallel (4 worker threads)', async () => {
        await Promise.all(Array.from({ length: JOBS }, () => job(WORK)));
    });
});
