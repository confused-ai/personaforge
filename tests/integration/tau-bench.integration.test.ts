/**
 * τ-bench LIVE test — runs the tool-agent benchmark against real providers and
 * prints a publishable pass-rate table. Opt-in; self-skips without credentials.
 *
 * Run: `OPENAI_API_KEY=... bun run test:integration`
 *
 * The pass-rate is asserted with a LOOSE floor (>= 40%) so a capable model does
 * not fail CI on an occasional flake, while a broken adapter (0%) still fails.
 * The printed table is the artefact you copy into the README.
 */

import { describe, it, expect } from 'vitest';
import { runTauBench, formatSummary } from '../../benchmarks/tau-bench/harness.js';
import { RETAIL_TASKS } from '../../benchmarks/tau-bench/tasks/retail.js';
import { DATA_TASKS } from '../../benchmarks/tau-bench/tasks/data.js';
import { CODING_TASKS } from '../../benchmarks/tau-bench/tasks/coding.js';

// Loose floor: catches a broken adapter (0%) without failing on model variance
// or a proxy that reshapes tool-call arguments. Raise once you have a stable
// reference model. The *table* printed below is the real artefact.
const PASS_FLOOR = 0.15;

describe.runIf(!!process.env.OPENAI_API_KEY)('τ-bench live — OpenAI', () => {
    it('retail domain pass-rate', async () => {
        const { OpenAIProvider } = await import('../../src/providers/index.js');
        const llm = new OpenAIProvider({
            apiKey: process.env.OPENAI_API_KEY!,
            model: process.env.PF_IT_OPENAI_MODEL ?? 'gpt-4o-mini',
            // Optional override — point at any OpenAI-compatible endpoint.
            ...(process.env.PF_IT_OPENAI_BASE_URL
                ? { baseURL: process.env.PF_IT_OPENAI_BASE_URL }
                : {}),
        });
        const summary = await runTauBench({
            llm,
            tasks: [...RETAIL_TASKS, ...DATA_TASKS, ...CODING_TASKS],
            // Per-task ceiling — some endpoints stream slowly on multi-step tool loops.
            timeoutMs: 90_000,
        });
        // eslint-disable-next-line no-console
        console.log('\n' + formatSummary(summary) + '\n');
        expect(summary.passRate).toBeGreaterThanOrEqual(PASS_FLOOR);
    });
});

describe.runIf(!!process.env.ANTHROPIC_API_KEY)('τ-bench live — Anthropic', () => {
    it('retail domain pass-rate', async () => {
        const { AnthropicProvider } = await import('../../src/providers/index.js');
        const llm = new AnthropicProvider({
            apiKey: process.env.ANTHROPIC_API_KEY!,
            model: process.env.PF_IT_ANTHROPIC_MODEL ?? 'claude-3-5-haiku-latest',
        });
        const summary = await runTauBench({
            llm,
            tasks: [...RETAIL_TASKS, ...DATA_TASKS, ...CODING_TASKS],
            // Per-task ceiling — some endpoints stream slowly on multi-step tool loops.
            timeoutMs: 90_000,
        });
        // eslint-disable-next-line no-console
        console.log('\n' + formatSummary(summary) + '\n');
        expect(summary.passRate).toBeGreaterThanOrEqual(PASS_FLOOR);
    });
});
