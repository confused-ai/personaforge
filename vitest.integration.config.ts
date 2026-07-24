/**
 * Vitest config for opt-in live-model integration tests.
 *
 * Behaviour differences vs `vitest.config.ts`:
 *   - Only picks up `tests/integration/**\/*.integration.test.ts`.
 *   - Longer timeout (300s) because real provider calls are slow.
 *   - Runs single-threaded so we do not fan out unnecessary API cost when
 *     multiple providers are configured.
 *   - No coverage — this suite is for correctness against live APIs, not for
 *     coverage measurement.
 *
 * Trigger:      `bun run test:integration`
 * Required env: at least one of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
 *               `GOOGLE_API_KEY`, `OLLAMA_HOST` — individual tests self-skip if
 *               the credential they need is missing.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        typecheck: {
            tsconfig: './tsconfig.test.json',
        },
        include: ['tests/integration/**/*.integration.test.ts'],
        // Live tool-calling tasks run sequentially and can be slow on some
        // endpoints — allow up to 5 minutes per test.
        testTimeout: 900_000,
        hookTimeout: 60_000,
        // Real API calls — do not parallelise to keep cost predictable.
        // Vitest 4 flattened poolOptions into top-level fields.
        pool: 'forks',
        maxWorkers: 1,
        minWorkers: 1,
        fileParallelism: false,
        reporters: ['verbose'],
    },
    resolve: {
        alias: {
            '@personaforge/contracts': new URL('./src/contracts/index.ts', import.meta.url).pathname,
            '@personaforge/shared':    new URL('./src/shared/index.ts', import.meta.url).pathname,
            '@personaforge/core':      new URL('./src/core/index.ts', import.meta.url).pathname,
        },
    },
});
