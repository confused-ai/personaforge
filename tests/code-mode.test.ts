/**
 * Hermetic unit tests for code-mode (src/code-mode) — the tool schema, the
 * sandbox boundaries (vm + local subprocess), max-code/max-output enforcement,
 * and execution-context threading. Uses `tool()`-shaped fakes; no LLM.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createCodeMode } from '@personaforge/code-mode';
import { VMSandbox, LocalSandbox, createSandbox } from '@personaforge/code-mode';
import { tool } from '@personaforge/tools';

const addTool = tool({
    name: 'add',
    description: 'Add two numbers',
    parameters: z.object({ x: z.number(), y: z.number() }),
    execute: async ({ x, y }) => ({ sum: x + y }),
});

// ── createCodeMode tool surface ──────────────────────────────────────────────

describe('createCodeMode', () => {
    it('builds a tool + instructions', () => {
        const { tool: codeTool, instructions } = createCodeMode({ tools: { add: addTool } });
        expect(codeTool.name).toBe('execute_typescript');
        expect(instructions).toContain('external_add');
        expect(instructions).toContain('execute_typescript');
    });

    it('uses a custom id and description', () => {
        const { tool: codeTool, instructions } = createCodeMode({ id: 'run_js', description: 'custom desc', tools: { add: addTool } });
        expect(codeTool.name).toBe('run_js');
        expect(codeTool.description).toBe('custom desc');
        expect(instructions).toContain('run_js');
    });

    it('lists no externals when no tools are provided', () => {
        const { instructions } = createCodeMode();
        expect(instructions).toContain('none');
        expect(instructions).toContain('pure computation');
    });

    it('rejects empty or non-string code', async () => {
        const { tool: codeTool } = createCodeMode({ sandbox: new VMSandbox() });
        const res = await codeTool.execute({ code: '  ' } as never, {});
        expect(res.success).toBe(false);
        expect(String((res as { error?: { message?: string } }).error?.message)).toContain('non-empty `code`');
    });

    it('enforces maxCodeChars', async () => {
        const { tool: codeTool } = createCodeMode({ sandbox: new VMSandbox(), maxCodeChars: 10 });
        const res = await codeTool.execute({ code: 'return 1 + 2 + 3 + 4;' } as never, {});
        expect(res.success).toBe(false);
        expect(String((res as { error?: { message?: string } }).error?.message)).toContain('exceeds the 10-char limit');
    });

    it('executes a pure-computation script in the vm sandbox', async () => {
        const { tool: codeTool } = createCodeMode({ sandbox: new VMSandbox() });
        const res = await codeTool.execute({ code: 'const nums = [1,2,3]; return nums.reduce((a,b)=>a+b,0);' } as never, { agentId: 'a', sessionId: 's' });
        expect(res.success).toBe(true);
        expect((res.data as { result: unknown }).result).toBe(6);
    });

    it('threads the caller agentId/sessionId through to external tools (regression for hardcoded ctx)', async () => {
        const seen: Array<{ agentId?: string; sessionId?: string }> = [];
        const recordingTool = tool({
            name: 'record',
            description: 'record ctx',
            parameters: z.object({ v: z.number() }),
            execute: async (_args, ctx) => {
                seen.push({ agentId: ctx?.agentId, sessionId: ctx?.sessionId });
                return { ok: true };
            },
        });
        const { tool: codeTool } = createCodeMode({ tools: { record: recordingTool }, sandbox: new VMSandbox() });
        const res = await codeTool.execute(
            { code: 'await external_record({ v: 1 }); return "done";' } as never,
            { agentId: 'real-agent', sessionId: 'real-session' },
        );
        expect(res.success).toBe(true);
        expect(seen).toEqual([{ agentId: 'real-agent', sessionId: 'real-session' }]);
    });

    it('surfaces a sandbox script error with the error message', async () => {
        const { tool: codeTool } = createCodeMode({ sandbox: new VMSandbox() });
        const res = await codeTool.execute({ code: 'throw new Error("kaboom");' } as never, {});
        expect(res.success).toBe(false);
        expect(String((res as { error?: { message?: string } }).error?.message)).toContain('kaboom');
    });
});

// ── VMSandbox ────────────────────────────────────────────────────────────────

describe('VMSandbox', () => {
    it('runs code with bridged externals', async () => {
        const sb = new VMSandbox();
        const out = await sb.run(
            'const r = await external_add({ x: 2, y: 3 }); return r.sum;',
            { add: async (a: { x: number; y: number }) => ({ sum: a.x + a.y }) },
            { timeoutMs: 2000 },
        );
        expect(out.ok).toBe(true);
        if (out.ok) expect(out.result).toBe(5);
    });

    it('captures console.log output', async () => {
        const sb = new VMSandbox();
        const out = await sb.run('console.log("hello"); return 1;', {}, { timeoutMs: 2000 });
        expect(out.ok).toBe(true);
        if (out.ok) expect(out.stdout).toContain('hello');
    });

    it('caps accumulated stdout (regression for unbounded growth)', async () => {
        const sb = new VMSandbox();
        const out = await sb.run(
            'for (let i = 0; i < 1000; i++) console.log("x".repeat(100)); return 1;',
            {},
            { timeoutMs: 2000, maxOutputBytes: 500 },
        );
        expect(out.ok).toBe(true);
        if (out.ok) expect(out.stdout.length).toBeLessThanOrEqual(500);
    });

    it('reports a script error with message + stack', async () => {
        const sb = new VMSandbox();
        const out = await sb.run('throw new Error("vm-boom");', {}, { timeoutMs: 2000 });
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.error.message).toContain('vm-boom');
    });
});

// ── LocalSandbox ─────────────────────────────────────────────────────────────

describe('LocalSandbox', () => {
    it('runs code in a subprocess with bridged externals', async () => {
        const sb = new LocalSandbox();
        const out = await sb.run(
            'const r = await external_add({ x: 5, y: 7 }); return r.sum;',
            { add: async (a: { x: number; y: number }) => ({ sum: a.x + a.y }) },
            { timeoutMs: 5000 },
        );
        expect(out.ok).toBe(true);
        if (out.ok) expect(out.result).toBe(12);
    });

    it('passes the external-call timeout through to the child (regression for hardcoded 60s)', async () => {
        // A hanging external tool should be rejected by the child's call
        // timeout (set to a short window here) rather than the hardcoded 60s.
        const sb = new LocalSandbox();
        const started = Date.now();
        const out = await sb.run(
            'await external_slow({}); return "never";',
            { slow: () => new Promise(() => { /* never resolves */ }) },
            { timeoutMs: 3000, maxOutputBytes: 10_000 },
        );
        expect(out.ok).toBe(false);
        expect(Date.now() - started).toBeLessThan(60_000);
        if (!out.ok) expect(out.error.message).toMatch(/timed out|external call timed out|exited early/i);
    });

    it('caps stdout returned from the subprocess', async () => {
        const sb = new LocalSandbox();
        const out = await sb.run(
            'for (let i = 0; i < 500; i++) console.log("y".repeat(100)); return 1;',
            {},
            { timeoutMs: 5000, maxOutputBytes: 400 },
        );
        expect(out.ok).toBe(true);
        if (out.ok) expect(out.stdout.length).toBeLessThanOrEqual(400);
    });
});

// ── createSandbox factory ────────────────────────────────────────────────────

describe('createSandbox', () => {
    it('returns the requested sandbox by name', () => {
        expect(createSandbox('vm').name).toBe('vm');
        expect(createSandbox('local').name).toBe('local');
        expect(createSandbox().name).toBe('local');
    });
});
