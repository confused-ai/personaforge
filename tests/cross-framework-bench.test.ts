/**
 * Hermetic test for the cross-framework benchmark runner.
 *
 * Proves `runFrameworkBench` + `formatComparison` score any `Framework`
 * (personaforge, agno, langgraph, mastra, crewai …) identically using the same
 * task verifiers. Uses fake in-memory Frameworks — no network, no LLM.
 */

import { describe, it, expect } from 'vitest';
import { runFrameworkBench, formatComparison } from '../benchmarks/tau-bench/adapters/framework.js';
import type { Framework, FrameworkRunResult } from '../benchmarks/tau-bench/adapters/framework.js';
import { RETAIL_TASKS } from '../benchmarks/tau-bench/tasks/retail.js';
import type { AgentTask } from '../benchmarks/tau-bench/harness.js';

/** A perfect framework: always makes the exact tool calls each task expects. */
function oracleFramework(name: string): Framework {
    const scripts: Record<string, FrameworkRunResult> = {
        'retail-01-order-status': {
            text: 'Order W1002 status: shipped.',
            toolCalls: [{ name: 'get_order', arguments: { orderId: 'W1002' }, result: null }],
            steps: 2, finishReason: 'stop', durationMs: 10,
        },
        'retail-02-list-then-lookup': {
            text: 'Ada most expensive is W1003 at $999.',
            toolCalls: [
                { name: 'list_user_orders', arguments: { userId: 'ada' }, result: null },
                { name: 'get_order', arguments: { orderId: 'W1003' }, result: null },
            ],
            steps: 3, finishReason: 'stop', durationMs: 12,
        },
        'retail-03-cancel-allowed': {
            text: 'Cancelled W1003.',
            toolCalls: [{ name: 'cancel_order', arguments: { orderId: 'W1003' }, result: null }],
            steps: 2, finishReason: 'stop', durationMs: 8,
        },
        'retail-04-cancel-denied': {
            text: 'W1001 is already delivered, cannot cancel.',
            toolCalls: [{ name: 'get_order', arguments: { orderId: 'W1001' }, result: null }],
            steps: 2, finishReason: 'stop', durationMs: 9,
        },
        'retail-05-multi-order-total': {
            text: 'Ada spent $1128.99.',
            toolCalls: [
                { name: 'list_user_orders', arguments: { userId: 'ada' }, result: null },
                { name: 'get_order', arguments: { orderId: 'W1001' }, result: null },
                { name: 'get_order', arguments: { orderId: 'W1003' }, result: null },
            ],
            steps: 4, finishReason: 'stop', durationMs: 15,
        },
    };
    return {
        name,
        version: '1.0.0',
        run: async (task: AgentTask) =>
            scripts[task.id] ?? { text: '', toolCalls: [], steps: 0, finishReason: 'error', durationMs: 1, error: 'no script' },
    };
}

/** A weak framework: never calls any tool. */
function lazyFramework(name: string): Framework {
    return {
        name,
        run: async () => ({ text: 'I cannot help.', toolCalls: [], steps: 1, finishReason: 'stop', durationMs: 5 }),
    };
}

/** A broken framework: always errors. */
function brokenFramework(name: string): Framework {
    return {
        name,
        run: async () => ({ text: '', toolCalls: [], steps: 0, finishReason: 'error', durationMs: 1, error: 'connection refused' }),
    };
}

describe('runFrameworkBench', () => {
    it('scores an oracle framework at 100% on the retail domain', async () => {
        const summary = await runFrameworkBench(oracleFramework('oracle'), RETAIL_TASKS);
        expect(summary.passed).toBe(RETAIL_TASKS.length);
        expect(summary.passRate).toBe(1);
    });

    it('scores a lazy (no-tool) framework at 0%', async () => {
        const summary = await runFrameworkBench(lazyFramework('lazy'), RETAIL_TASKS);
        expect(summary.passed).toBe(0);
    });

    it('marks every task failed with the error reason for a broken framework', async () => {
        const summary = await runFrameworkBench(brokenFramework('broken'), RETAIL_TASKS);
        expect(summary.passed).toBe(0);
        expect(summary.results.every((r) => r.reason.includes('framework error'))).toBe(true);
    });
});

describe('formatComparison', () => {
    it('renders a sorted matrix (best pass-rate first)', async () => {
        const rows = [
            { framework: 'lazy', summary: await runFrameworkBench(lazyFramework('lazy'), RETAIL_TASKS) },
            { framework: 'oracle', version: '1.0.0', summary: await runFrameworkBench(oracleFramework('oracle'), RETAIL_TASKS) },
            { framework: 'broken', summary: await runFrameworkBench(brokenFramework('broken'), RETAIL_TASKS) },
        ];
        const table = formatComparison(rows);
        expect(table).toContain('| Framework | Version | Pass rate |');
        // oracle (100%) must appear before lazy/broken (0%)
        const oracleIdx = table.indexOf('oracle');
        const lazyIdx = table.indexOf('lazy');
        expect(oracleIdx).toBeGreaterThan(0);
        expect(oracleIdx).toBeLessThan(lazyIdx);
    });
});
