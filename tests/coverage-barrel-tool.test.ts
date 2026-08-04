/**
 * Coverage for src/tool.ts (barrel) — tool definition / composition helpers.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
    tool,
    createTool,
    createTools,
    defineTool,
    extendTool,
    pipeTools,
    isLightweightTool,
    ToolCategory,
} from '../src/tool.js';

const ctx = { agentId: 'a', sessionId: 's' } as never;

function mkTool(name: string, out: unknown) {
    return tool({
        name,
        description: `${name} desc`,
        parameters: z.object({ q: z.string() }),
        execute: async ({ q }) => `${out}:${q}`,
    });
}

describe('tool barrel', () => {
    it('tool() builds a LightweightTool whose execute runs', async () => {
        const t = mkTool('t1', 'R');
        expect(isLightweightTool(t)).toBe(true);
        const r = await t.execute({ q: 'x' }, ctx);
        expect(r.data).toBe('R:x');
    });

    it('tool() validates parameters and returns a failure result on bad input', async () => {
        const t = mkTool('t2', 'R');
        const r = await t.execute({ q: 123 } as never, ctx);
        expect(r.success).toBe(false);
    });

    it('createTool is an alias for tool()', async () => {
        const t = createTool({
            name: 'ct',
            description: 'ct',
            parameters: z.object({ q: z.string() }),
            execute: async () => 'ok',
        });
        expect((await t.execute({ q: 'a' }, ctx)).data).toBe('ok');
    });

    it('createTools builds a record of named tools', async () => {
        const tools = createTools({
            upper: { description: 'u', parameters: z.object({ q: z.string() }), execute: async ({ q }) => q.toUpperCase() },
            lower: { description: 'l', parameters: z.object({ q: z.string() }), execute: async ({ q }) => q.toLowerCase() },
        });
        expect(Object.keys(tools).sort()).toEqual(['lower', 'upper']);
        expect((await tools.upper.execute({ q: 'a' }, ctx)).data).toBe('A');
    });

    it('defineTool() returns a Tool with metadata', () => {
        const t = defineTool({
            name: 'dt',
            description: 'dt',
            parameters: z.object({ q: z.string() }),
            execute: async () => 'ok',
        });
        expect(t.name).toBe('dt');
        expect(isLightweightTool(t)).toBe(false);
        expect(typeof t.execute).toBe('function');
    });

    it('extendTool wraps execute with before/after hooks', async () => {
        const base = mkTool('base', 'B');
        const calls: string[] = [];
        const wrapped = extendTool(base, {
            name: 'wrapped',
            beforeExecute: async () => { calls.push('before'); },
            afterExecute: async () => { calls.push('after'); },
        });
        const r = await wrapped.execute({ q: 'y' }, ctx);
        expect(r.data).toBe('B:y');
        expect(calls).toEqual(['before', 'after']);
    });

    it('extendTool beforeExecute can cancel execution', async () => {
        const base = mkTool('base2', 'B');
        const wrapped = extendTool(base, {
            name: 'w2',
            beforeExecute: async () => false,
        });
        const r = await wrapped.execute({ q: 'y' }, ctx);
        expect(r.success).toBe(false);
        expect(r.error?.message).toMatch(/cancelled/);
    });

    it('pipeTools chains two tools via an adapter', async () => {
        const first = mkTool('f', 'F');
        const second = mkTool('s', 'S');
        const piped = pipeTools(first, second, {
            name: 'piped',
            description: 'p',
            adapter: (firstOut) => ({ q: String(firstOut) }),
        });
        const r = await piped.execute({ q: 'in' }, ctx);
        expect(r.data).toBe('S:F:in');
    });

    it('isLightweightTool rejects plain objects', () => {
        expect(isLightweightTool({ name: 'x', description: 'y' })).toBe(false);
        expect(isLightweightTool(null)).toBe(false);
    });

    it('ToolCategory enum is exported', () => {
        expect(ToolCategory.CUSTOM).toBe('custom');
    });
});
