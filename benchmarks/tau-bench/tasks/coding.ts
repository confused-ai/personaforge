/**
 * τ-bench coding domain — SWE-bench-lite style tasks that verify the agent
 * used file tools (read → edit) to make a targeted change against a small
 * in-memory codebase.
 *
 * Verifiers assert *what* was written to *which* file, not prose style, so a
 * capable model with correct tool use passes reproducibly.
 */

import { z } from 'zod/v3';
import { tool } from '../../../src/tools/core/tool-helper.js';
import type { AgentTask, RecordedCall } from '../harness.js';
import type { Tool } from '../../../src/core/index.js';

// ── In-memory codebase (per-test-invocation via factory) ─────────────────────
interface Codebase {
    files: Map<string, string>;
    tools: Tool[];
}

function makeCodebase(seed: Record<string, string>): Codebase {
    const files = new Map(Object.entries(seed));
    const listFiles = tool({
        name: 'list_files',
        description: 'List file paths in the repository.',
        parameters: z.object({}),
        execute: () => ({ files: [...files.keys()] }),
    }) as unknown as Tool;

    const readFile = tool({
        name: 'read_file',
        description: 'Read the full contents of a file at the given path.',
        parameters: z.object({ path: z.string() }),
        execute: ({ path }) => (files.has(path) ? { content: files.get(path) } : { error: 'not found' }),
    }) as unknown as Tool;

    const writeFile = tool({
        name: 'write_file',
        description: 'Overwrite the file at the given path with the given content.',
        parameters: z.object({ path: z.string(), content: z.string() }),
        execute: ({ path, content }) => {
            files.set(path, content);
            return { ok: true };
        },
    }) as unknown as Tool;

    return { files, tools: [listFiles, readFile, writeFile] };
}

function lastWrite(list: readonly RecordedCall[], path: string): RecordedCall | undefined {
    const writes = list.filter((c) => c.name === 'write_file' && c.arguments['path'] === path);
    return writes[writes.length - 1];
}

/**
 * Task factory — each task instantiates its own fresh codebase so state does
 * not leak between runs.
 */
export function makeCodingTasks(): AgentTask[] {
    // ── Task 1: rename an exported symbol ───────────────────────────────────
    const t1 = makeCodebase({
        'src/greet.ts': "export function greet(name: string) { return 'hi ' + name; }\n",
    });
    // ── Task 2: fix an off-by-one bug ───────────────────────────────────────
    const t2 = makeCodebase({
        'src/sum.ts':
            'export function sumTo(n: number): number {\n' +
            '    let s = 0;\n' +
            '    for (let i = 1; i < n; i++) s += i;  // BUG: should be i <= n\n' +
            '    return s;\n' +
            '}\n',
    });
    // ── Task 3: add a missing export ────────────────────────────────────────
    const t3 = makeCodebase({
        'src/math.ts': 'export function add(a: number, b: number) { return a + b; }\n' +
                       'function subtract(a: number, b: number) { return a - b; }\n',
    });

    return [
        {
            id: 'code-01-rename-symbol',
            domain: 'coding',
            instruction:
                'In the file src/greet.ts, rename the exported function `greet` to `sayHello`. ' +
                'Read the file first, then write the updated content back.',
            tools: t1.tools,
            maxSteps: 6,
            verify: (calls) => {
                const w = lastWrite(calls, 'src/greet.ts');
                if (!w) return { passed: false, reason: 'did not write src/greet.ts' };
                const content = String(w.arguments['content'] ?? '');
                const hasNew = /export\s+function\s+sayHello\s*\(/.test(content);
                const hasOld = /export\s+function\s+greet\s*\(/.test(content);
                if (!hasNew) return { passed: false, reason: 'sayHello export missing in new content' };
                if (hasOld) return { passed: false, reason: 'old greet export still present' };
                return { passed: true, reason: 'ok' };
            },
        },
        {
            id: 'code-02-off-by-one',
            domain: 'coding',
            instruction:
                'The function `sumTo(n)` in src/sum.ts should return the sum 1+2+…+n but has an off-by-one bug. ' +
                'Fix it. Read the file first, then write the corrected content.',
            tools: t2.tools,
            maxSteps: 6,
            verify: (calls) => {
                const w = lastWrite(calls, 'src/sum.ts');
                if (!w) return { passed: false, reason: 'did not write src/sum.ts' };
                const content = String(w.arguments['content'] ?? '');
                // Accept `i <= n` or `i < n + 1` or a `n * (n+1) / 2` closed form.
                const fixed =
                    /i\s*<=\s*n/.test(content) ||
                    /i\s*<\s*n\s*\+\s*1/.test(content) ||
                    /n\s*\*\s*\(\s*n\s*\+\s*1\s*\)\s*\/\s*2/.test(content);
                return { passed: fixed, reason: fixed ? 'ok' : 'condition not fixed to include n' };
            },
        },
        {
            id: 'code-03-add-export',
            domain: 'coding',
            instruction:
                'In src/math.ts, `subtract` is defined but not exported. Add the missing `export` keyword. ' +
                'Read the file first, then write the corrected content.',
            tools: t3.tools,
            maxSteps: 6,
            verify: (calls) => {
                const w = lastWrite(calls, 'src/math.ts');
                if (!w) return { passed: false, reason: 'did not write src/math.ts' };
                const content = String(w.arguments['content'] ?? '');
                const has = /export\s+function\s+subtract\s*\(/.test(content);
                return { passed: has, reason: has ? 'ok' : 'subtract still not exported' };
            },
        },
    ];
}

export const CODING_TASKS = makeCodingTasks();
