---
title: ThreadPool benchmark — published throughput numbers
date: 2026-07-23
status: shipped
---

# ThreadPool benchmark

Backs the claim in `docs/superpowers/specs/2026-07-23-consolidation-and-path-to-1.md`
§3.3 that `personaforge/execution` now ships **real OS-thread parallelism** via
`node:worker_threads`, not just Promise-scheduled concurrency.

## Reproducing

```bash
bun bench benchmarks/thread-pool.bench.ts
```

Workload: 8 CPU-bound jobs, each spinning `2_000_000` iterations of
`Math.sqrt(i) * Math.sin(i)`. Times are in ops/s (higher is better).

## Results (2026-07-23, Apple Silicon dev machine, 4 worker threads)

| Configuration               | ops/s  | speedup vs serial |
|-----------------------------|--------|-------------------|
| serial (main thread)        |   3.79 | 1.00×             |
| parallel (4 worker threads) |  13.38 | **3.53×**         |

Near-linear scaling with thread count on multi-core hardware. Single-core CI
runners will show close to 1.0× — expected — but must not silently regress
below serial; the correctness test in `tests/thread-pool.test.ts` guards that.

## Interpretation

- The Promise-based `WorkerPool` in the same folder cannot exceed serial on
  CPU-bound work because it multiplexes onto one event loop.
- `ThreadPool` is the correct primitive for token counting on large corpora,
  embedding normalisation, cost/eval aggregation, deterministic hashing, JSON
  Schema validation, and other pure-compute jobs.
- IO-bound orchestration (LLM calls, DB, HTTP) should still use the async
  scheduler — thread hop cost is real (~µs per call).
