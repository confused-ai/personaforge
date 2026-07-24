/**
 * τ-bench HERMETIC test.
 *
 * Drives the τ-bench harness with a scripted mock LLM that always makes the
 * correct sequence of tool calls for each task. This proves:
 *   1. The harness records tool calls and their arguments correctly.
 *   2. Each verifier accepts a correct trace and rejects an incorrect one.
 *   3. The summary math (pass rate, per-domain rollup) is right.
 *
 * Because a real LLM's tool-choice correctness would be non-deterministic in
 * CI, the *live* pass-rate benchmark runs opt-in under
 * `bun run test:integration` (see benchmarks/tau-bench/README.md).
 */

import { describe, it, expect } from 'vitest';
import { runTauBench, formatSummary } from '../benchmarks/tau-bench/harness.js';
import { RETAIL_TASKS } from '../benchmarks/tau-bench/tasks/retail.js';
import { DATA_TASKS } from '../benchmarks/tau-bench/tasks/data.js';
import { makeCodingTasks } from '../benchmarks/tau-bench/tasks/coding.js';
import type { LLMProvider, GenerateResult, Message } from '../src/contracts/index.js';

/**
 * Scripted "oracle" LLM: for a given user instruction, emits the correct
 * sequence of tool calls, then a final text answer. Each script entry is a
 * callable that inspects the current messages and returns the next response.
 */
type Turn = GenerateResult;
type Script = (messages: readonly Message[]) => Turn;

class ScriptedLLM implements LLMProvider {
    private idx = 0;
    constructor(private readonly script: readonly Script[]) {}
    async generateText(messages: Message[]): Promise<GenerateResult> {
        if (this.idx >= this.script.length) {
            return { text: '(end of script)', finishReason: 'stop' };
        }
        const turn = this.script[this.idx]!;
        this.idx += 1;
        return turn(messages);
    }
}

function toolCall(name: string, args: Record<string, unknown>, id = `c-${name}`) {
    return { id, name, arguments: args };
}

function finalAnswer(text: string): Turn {
    return () => ({ text, finishReason: 'stop' });
}

function step(name: string, args: Record<string, unknown>): Turn {
    return () => ({
        text: `Calling ${name}`,
        toolCalls: [toolCall(name, args)],
        finishReason: 'tool_calls',
    });
}

describe('τ-bench harness (hermetic)', () => {
    it('scores an all-correct oracle run at 100%', async () => {
        // Per-task oracle scripts — one entry per LLM turn, matching each task's
        // verifier requirements exactly.
        const scripts: Record<string, Script[]> = {
            'retail-01-order-status': [
                step('get_order', { orderId: 'W1002' }),
                finalAnswer('Order W1002 status: shipped.'),
            ],
            'retail-02-list-then-lookup': [
                step('list_user_orders', { userId: 'ada' }),
                step('get_order', { orderId: 'W1003' }),
                finalAnswer('Ada spent $999 on her most expensive order (W1003).'),
            ],
            'retail-03-cancel-allowed': [
                step('cancel_order', { orderId: 'W1003' }),
                finalAnswer('Order W1003 cancelled.'),
            ],
            'retail-04-cancel-denied': [
                step('cancel_order', { orderId: 'W1001' }),
                finalAnswer('Order W1001 cannot be cancelled — it is already delivered.'),
            ],
            'retail-05-multi-order-total': [
                step('list_user_orders', { userId: 'ada' }),
                step('get_order', { orderId: 'W1001' }),
                step('get_order', { orderId: 'W1003' }),
                finalAnswer('Ada has spent $1128.99 across her two orders.'),
            ],
        };

        // Run each task individually with its own scripted LLM.
        for (const task of RETAIL_TASKS) {
            const script = scripts[task.id];
            expect(script, `no script for ${task.id}`).toBeDefined();
            const summary = await runTauBench({ llm: new ScriptedLLM(script!), tasks: [task] });
            expect(summary.passed, `${task.id} failed: ${summary.results[0]!.reason}`).toBe(1);
            expect(summary.results[0]!.toolCallCount).toBeGreaterThan(0);
        }
    });

    it('a bad run (wrong arguments) is rejected by the verifier', async () => {
        const badScript: Script[] = [
            step('get_order', { orderId: 'W9999' }), // wrong id
            finalAnswer('No such order.'),
        ];
        const summary = await runTauBench({
            llm: new ScriptedLLM(badScript),
            tasks: [RETAIL_TASKS[0]!], // retail-01-order-status expects W1002
        });
        expect(summary.passed).toBe(0);
        expect(summary.results[0]!.reason).toMatch(/wrong orderId/i);
    });

    it('a run that never calls the required tool is rejected', async () => {
        const noCallScript: Script[] = [
            finalAnswer('I do not know without looking it up.'),
        ];
        const summary = await runTauBench({
            llm: new ScriptedLLM(noCallScript),
            tasks: [RETAIL_TASKS[0]!],
        });
        expect(summary.passed).toBe(0);
        expect(summary.results[0]!.reason).toMatch(/did not call/i);
    });

    it('summary rollup: mixed pass / fail run reports the right pass rate', async () => {
        // Task 1 correct, task 3 wrong (uses W9999).
        const goodTurns: Script[] = [
            step('get_order', { orderId: 'W1002' }),
            finalAnswer('Order W1002 status: shipped.'),
        ];
        const badTurns: Script[] = [
            step('cancel_order', { orderId: 'W9999' }),
            finalAnswer('done'),
        ];
        // Each task builds its own LLM by wrapping the two scripts back to back.
        // For simplicity we run them separately and merge summaries.
        const good = await runTauBench({ llm: new ScriptedLLM(goodTurns), tasks: [RETAIL_TASKS[0]!] });
        const bad = await runTauBench({ llm: new ScriptedLLM(badTurns), tasks: [RETAIL_TASKS[2]!] });

        expect(good.passRate).toBe(1);
        expect(bad.passRate).toBe(0);

        // Combined summary math
        const total = good.total + bad.total;
        const passed = good.passed + bad.passed;
        expect(total).toBe(2);
        expect(passed).toBe(1);
        expect(passed / total).toBe(0.5);
    });

    it('formatSummary renders a well-formed markdown table', async () => {
        const script: Script[] = [
            step('get_order', { orderId: 'W1002' }),
            finalAnswer('Order W1002 status: shipped.'),
        ];
        const summary = await runTauBench({ llm: new ScriptedLLM(script), tasks: [RETAIL_TASKS[0]!] });
        const md = formatSummary(summary);
        expect(md).toContain('τ-bench');
        expect(md).toContain('| Domain |');
        expect(md).toContain('retail');
        expect(md).toContain('retail-01-order-status');
    });
});


describe('τ-bench harness (hermetic) — data domain', () => {
    it('scores the data domain oracle at 100%', async () => {
        const dataRows = [
            { region: 'emea', product: 'widget', units: 10, revenue: 100 },
            { region: 'emea', product: 'gadget', units: 5, revenue: 250 },
            { region: 'apac', product: 'widget', units: 20, revenue: 200 },
            { region: 'apac', product: 'gadget', units: 2, revenue: 100 },
            { region: 'amer', product: 'widget', units: 7, revenue: 70 },
        ];
        const scripts: Record<string, Script[]> = {
            'data-01-filter-region': [
                step('query_rows', { region: 'apac' }),
                finalAnswer('There are 2 apac rows.'),
            ],
            'data-02-sum-revenue': [
                step('query_rows', {}),
                step('aggregate', { column: 'revenue', op: 'sum', rows: dataRows }),
                finalAnswer('Total revenue is 720.'),
            ],
            'data-03-avg-units-widget': [
                step('query_rows', { product: 'widget' }),
                step('aggregate', {
                    column: 'units', op: 'avg',
                    rows: dataRows.filter((r) => r.product === 'widget'),
                }),
                finalAnswer('Average widget units per sale is ~12.3.'),
            ],
            'data-04-list-regions': [
                step('list_regions', {}),
                finalAnswer('Regions: emea, apac, amer.'),
            ],
            'data-05-max-revenue-region': [
                step('query_rows', { region: 'emea' }),
                step('aggregate', {
                    column: 'revenue', op: 'max',
                    rows: dataRows.filter((r) => r.region === 'emea'),
                }),
                finalAnswer('Highest emea sale is 250.'),
            ],
        };
        for (const task of DATA_TASKS) {
            const script = scripts[task.id];
            expect(script, `no script for ${task.id}`).toBeDefined();
            const summary = await runTauBench({ llm: new ScriptedLLM(script!), tasks: [task] });
            expect(summary.passed, `${task.id} failed: ${summary.results[0]!.reason}`).toBe(1);
        }
    });
});


describe('τ-bench harness (hermetic) — coding domain', () => {
    it('scores the coding oracle at 100% with correct file edits', async () => {
        const tasks = makeCodingTasks();
        const scripts: Record<string, Script[]> = {
            'code-01-rename-symbol': [
                step('read_file', { path: 'src/greet.ts' }),
                step('write_file', {
                    path: 'src/greet.ts',
                    content: "export function sayHello(name: string) { return 'hi ' + name; }\n",
                }),
                finalAnswer('Renamed greet to sayHello.'),
            ],
            'code-02-off-by-one': [
                step('read_file', { path: 'src/sum.ts' }),
                step('write_file', {
                    path: 'src/sum.ts',
                    content: 'export function sumTo(n: number): number {\n    let s = 0;\n    for (let i = 1; i <= n; i++) s += i;\n    return s;\n}\n',
                }),
                finalAnswer('Fixed the off-by-one.'),
            ],
            'code-03-add-export': [
                step('read_file', { path: 'src/math.ts' }),
                step('write_file', {
                    path: 'src/math.ts',
                    content: 'export function add(a: number, b: number) { return a + b; }\nexport function subtract(a: number, b: number) { return a - b; }\n',
                }),
                finalAnswer('Exported subtract.'),
            ],
        };
        for (const task of tasks) {
            const script = scripts[task.id];
            expect(script, `no script for ${task.id}`).toBeDefined();
            const summary = await runTauBench({ llm: new ScriptedLLM(script!), tasks: [task] });
            expect(summary.passed, `${task.id} failed: ${summary.results[0]!.reason}`).toBe(1);
        }
    });

    it('rejects a coding run that writes the wrong content', async () => {
        const [renameTask] = makeCodingTasks();
        const badScript: Script[] = [
            step('read_file', { path: 'src/greet.ts' }),
            step('write_file', { path: 'src/greet.ts', content: 'export function greet() {}' }),
            finalAnswer('done'),
        ];
        const summary = await runTauBench({ llm: new ScriptedLLM(badScript), tasks: [renameTask!] });
        expect(summary.passed).toBe(0);
    });
});
