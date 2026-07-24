/**
 * Cross-framework τ-bench comparison CLI.
 *
 * Runs the full task set (retail + data + coding) against every framework you
 * point it at, then prints a single comparison matrix.
 *
 * personaforge runs in-process (no server needed). Other frameworks run behind
 * a protocol-compliant HTTP server — see benchmarks/tau-bench/PROTOCOL.md and
 * the reference servers in benchmarks/tau-bench/servers/.
 *
 * Usage:
 *   OPENAI_API_KEY=... \
 *   PF_FRAMEWORKS="langgraph=http://localhost:8812,agno=http://localhost:8815" \
 *   bun benchmarks/tau-bench/compare.ts
 *
 * Env:
 *   OPENAI_API_KEY            required for the in-process personaforge run
 *   PF_IT_OPENAI_BASE_URL     optional OpenAI-compatible base URL
 *   PF_IT_OPENAI_MODEL        optional model id (default gpt-4o-mini)
 *   PF_FRAMEWORKS             comma list of name=baseUrl for HTTP frameworks
 *   PF_BENCH_DOMAINS          comma list of domains to include (default: all)
 */

import { OpenAIProvider } from '../../src/providers/index.js';
import { runFrameworkBench, httpFramework, formatComparison } from './adapters/framework.js';
import { personaforgeFramework } from './adapters/personaforge.js';
import { RETAIL_TASKS } from './tasks/retail.js';
import { DATA_TASKS } from './tasks/data.js';
import { CODING_TASKS } from './tasks/coding.js';
import type { AgentTask } from './harness.js';
import type { BenchmarkSummary } from './harness.js';

function selectTasks(): AgentTask[] {
    const wanted = (process.env['PF_BENCH_DOMAINS'] ?? 'retail,data,coding')
        .split(',').map((s) => s.trim()).filter(Boolean);
    const all: Record<string, AgentTask[]> = {
        retail: RETAIL_TASKS,
        data: DATA_TASKS,
        coding: CODING_TASKS,
    };
    return wanted.flatMap((d) => all[d] ?? []);
}

function parseFrameworks(): Array<{ name: string; baseUrl: string }> {
    const raw = process.env['PF_FRAMEWORKS'] ?? '';
    return raw.split(',').map((s) => s.trim()).filter(Boolean).map((pair) => {
        const [name, baseUrl] = pair.split('=');
        return { name: name!.trim(), baseUrl: (baseUrl ?? '').trim() };
    }).filter((f) => f.baseUrl);
}

async function main() {
    const tasks = selectTasks();
    const rows: Array<{ framework: string; version?: string; summary: BenchmarkSummary }> = [];

    // personaforge — in-process.
    if (process.env['OPENAI_API_KEY']) {
        const llm = new OpenAIProvider({
            apiKey: process.env['OPENAI_API_KEY'],
            model: process.env['PF_IT_OPENAI_MODEL'] ?? 'gpt-4o-mini',
            ...(process.env['PF_IT_OPENAI_BASE_URL'] ? { baseURL: process.env['PF_IT_OPENAI_BASE_URL'] } : {}),
        });
        const pf = personaforgeFramework(llm);
        // eslint-disable-next-line no-console
        console.log('Running personaforge (in-process)…');
        rows.push({ framework: pf.name, version: pf.version, summary: await runFrameworkBench(pf, tasks) });
    }

    // Other frameworks — HTTP.
    for (const f of parseFrameworks()) {
        const fw = httpFramework({ name: f.name, baseUrl: f.baseUrl });
        // eslint-disable-next-line no-console
        console.log(`Running ${f.name} (${f.baseUrl})…`);
        rows.push({ framework: f.name, summary: await runFrameworkBench(fw, tasks) });
    }

    if (rows.length === 0) {
        // eslint-disable-next-line no-console
        console.error('No frameworks to run. Set OPENAI_API_KEY and/or PF_FRAMEWORKS.');
        process.exit(1);
    }

    // eslint-disable-next-line no-console
    console.log(`\n## τ-bench cross-framework comparison (${tasks.length} tasks)\n`);
    // eslint-disable-next-line no-console
    console.log(formatComparison(rows));
}

main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});
