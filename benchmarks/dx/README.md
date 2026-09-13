# DX benchmark

Hermetic developer-experience benchmark — no API keys, runs in milliseconds.

```sh
bun benchmarks/dx/run.ts              # compare against baseline
bun benchmarks/dx/run.ts --save-baseline  # record a new baseline
```

Metrics: `lite` import time, 200× model-string resolution (`provider:model`
and `provider/model`), one `tool()` definition, one 3-step
`defineWorkflow` run, and static hello-world brevity (user lines of code).

Results: `latest.json` on every run; `baseline.json` is the checked-in
comparison point. Deltas print as `%` per metric.
