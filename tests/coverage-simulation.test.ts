/**
 * Hermetic coverage for src/simulation — simulate edges + trainsetFromReport.
 * Callers: bunx vitest run tests/coverage-*.test.ts. No production imports.
 */

import { describe, it, expect, vi } from 'vitest';
import { simulate, trainsetFromReport } from '../src/simulation/index.js';
import { MapToolRegistry } from '../src/core/tool-registry.js';
import type { Tool } from '../src/contracts/index.js';

const llm = {
    generateText: async (messages: Array<{ content?: string }>) => {
        const p = String(messages[messages.length - 1]?.content ?? '');
        return { text: p.includes('fail') ? 'bad' : 'ok', toolCalls: [], finishReason: 'stop' as const };
    },
};

describe('simulation/simulate', () => {
    it('empty scenarios yields zero passRate', async () => {
        const report = await simulate({ name: 'b', instructions: 'i', llm: llm as never }, []);
        expect(report.total).toBe(0);
        expect(report.passed).toBe(0);
        expect(report.failed).toBe(0);
        expect(report.passRate).toBe(0);
        expect(report.outcomes).toEqual([]);
    });

    it('uses custom tools registry and concurrency 1', async () => {
        const tool: Tool = {
            name: 'noop',
            description: 'n',
            parameters: { type: 'object', properties: {} },
            execute: async () => 'x',
        };
        const tools = new MapToolRegistry([tool]);
        const report = await simulate(
            { name: 'b', instructions: 'i', llm: llm as never, tools },
            [
                { name: 'a', prompt: 'hi' },
                { name: 'b', prompt: 'fail me', expect: (r) => r.text === 'ok' },
            ],
            { concurrency: 1 },
        );
        expect(report.total).toBe(2);
        expect(report.passed).toBe(1);
        expect(report.failed).toBe(1);
        expect(report.passRate).toBe(0.5);
        expect(report.outcomes[0]!.passed).toBe(true);
        expect(report.outcomes[1]!.passed).toBe(false);
        expect(report.outcomes[0]!.executionId).toBeTruthy();
        expect(report.outcomes[0]!.finishReason).toBeTruthy();
    });

    it('default expect passes when omitted', async () => {
        const report = await simulate(
            { name: 'b', instructions: 'i', llm: llm as never },
            [{ name: 'only', prompt: 'fail' }],
        );
        expect(report.passed).toBe(1);
    });
});

describe('simulation/learn', () => {
    it('trainsetFromReport keeps only passing outcomes', () => {
        const trainset = trainsetFromReport({
            total: 2,
            passed: 1,
            failed: 1,
            passRate: 0.5,
            outcomes: [
                {
                    name: 'ok',
                    prompt: 'p1',
                    text: 't1',
                    steps: 1,
                    finishReason: 'stop',
                    passed: true,
                    executionId: 'e1' as never,
                },
                {
                    name: 'bad',
                    prompt: 'p2',
                    text: 't2',
                    steps: 1,
                    finishReason: 'stop',
                    passed: false,
                    executionId: 'e2' as never,
                },
            ],
        });
        expect(trainset).toEqual([{ input: 'p1', expected: 't1' }]);
    });
});
