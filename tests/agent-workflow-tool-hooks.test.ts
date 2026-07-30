/**
 * Tests for agent-as-tool, workflow-as-tool, output schema validation, and tool hooks.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { tool } from '../src/tools/core/tool-helper.js';
import { agentAsTool } from '../src/tools/core/agent-as-tool.js';
import { workflowAsTool } from '../src/tools/core/workflow-as-tool.js';
import type { LightweightTool } from '../src/tools/core/tool-helper.js';
import type { RunnableAgent } from '../src/tools/core/agent-as-tool.js';
import type { RunnableWorkflow } from '../src/tools/core/workflow-as-tool.js';

// ── Output Schema Validation ─────────────────────────────────────────────────

describe('tool() output schema validation', () => {
    it('validates output against outputSchema and returns data on success', async () => {
        const t = tool({
            name: 'greet',
            description: 'Greet someone',
            parameters: z.object({ name: z.string() }),
            outputSchema: z.object({ greeting: z.string() }),
            execute: ({ name }) => ({ greeting: `Hello, ${name}!` }),
        });

        const result = await t.execute({ name: 'World' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ greeting: 'Hello, World!' });
    });

    it('returns validation error when output does not match schema', async () => {
        const t = tool({
            name: 'greet',
            description: 'Greet someone',
            parameters: z.object({ name: z.string() }),
            outputSchema: z.object({ greeting: z.string() }),
            execute: () => ({ wrong: 'field' }),
        });

        const result = await t.execute({ name: 'World' });
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('OUTPUT_VALIDATION_ERROR');
    });

    it('skips output validation when no outputSchema is provided', async () => {
        const t = tool({
            name: 'greet',
            description: 'Greet someone',
            parameters: z.object({ name: z.string() }),
            execute: () => ({ anything: 'goes' }),
        });

        const result = await t.execute({ name: 'World' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ anything: 'goes' });
    });
});

// ── Tool Hooks ──────────────────────────────────────────────────────────────

describe('tool() lifecycle hooks', () => {
    it('runs beforeExecute and can cancel execution', async () => {
        const t = tool({
            name: ' guarded',
            description: 'A guarded tool',
            parameters: z.object({ value: z.number() }),
            execute: ({ value }) => ({ doubled: value * 2 }),
            beforeExecute: () => false,
        });

        const result = await t.execute({ value: 5 });
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('CANCELLED');
    });

    it('runs afterExecute after successful execution', async () => {
        const afterSpy = vi.fn();
        const t = tool({
            name: 'tracked',
            description: 'A tracked tool',
            parameters: z.object({ value: z.number() }),
            execute: ({ value }) => ({ doubled: value * 2 }),
            afterExecute: afterSpy,
        });

        const result = await t.execute({ value: 5 });
        expect(result.success).toBe(true);
        expect(afterSpy).toHaveBeenCalledWith({ doubled: 10 }, { value: 5 }, expect.any(Object));
    });

    it('runs onError when execution throws', async () => {
        const errorSpy = vi.fn();
        const t = tool({
            name: 'fragile',
            description: 'A tool that throws',
            parameters: z.object({ value: z.number() }),
            execute: () => { throw new Error('boom'); },
            onError: errorSpy,
        });

        const result = await t.execute({ value: 5 });
        expect(result.success).toBe(true);
        expect(errorSpy).toHaveBeenCalled();
    });

    it('re-throws when onError is not provided and execution fails', async () => {
        const t = tool({
            name: 'fragile',
            description: 'A tool that throws',
            parameters: z.object({ value: z.number() }),
            execute: () => { throw new Error('boom'); },
        });

        const result = await t.execute({ value: 5 });
        expect(result.success).toBe(false);
        expect(result.error?.message).toBe('boom');
    });
});

// ── Agent as Tool ───────────────────────────────────────────────────────────

describe('agentAsTool()', () => {
    it('wraps a simple agent and returns its result', async () => {
        const mockAgent: RunnableAgent = {
            run: vi.fn().mockResolvedValue({ text: 'done', steps: 1 }),
        };

        const t = agentAsTool({
            name: 'inner',
            description: 'Inner agent tool',
            agent: mockAgent,
            parameters: z.object({ prompt: z.string() }),
        });

        const result = await t.execute({ prompt: 'do it' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ text: 'done', steps: 1 });
        expect(mockAgent.run).toHaveBeenCalledWith({ prompt: 'do it' }, { sessionId: 'unknown' });
    });

    it('passes sessionId from context to agent.run', async () => {
        const mockAgent: RunnableAgent = {
            run: vi.fn().mockResolvedValue({ text: 'done' }),
        };

        const t = agentAsTool({
            name: 'inner',
            description: 'Inner agent tool',
            agent: mockAgent,
            parameters: z.object({ prompt: z.string() }),
        });

        await t.execute({ prompt: 'do it' }, { sessionId: 'sess-123' });
        expect(mockAgent.run).toHaveBeenCalledWith({ prompt: 'do it' }, { sessionId: 'sess-123' });
    });

    it('validates output against outputSchema when provided', async () => {
        const mockAgent: RunnableAgent = {
            run: vi.fn().mockResolvedValue({ result: 42 }),
        };

        const t = agentAsTool({
            name: 'inner',
            description: 'Inner agent tool',
            agent: mockAgent,
            parameters: z.object({ prompt: z.string() }),
            outputSchema: z.object({ result: z.number() }),
        });

        const result = await t.execute({ prompt: 'do it' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ result: 42 });
    });

    it('returns error when agent output fails outputSchema', async () => {
        const mockAgent: RunnableAgent = {
            run: vi.fn().mockResolvedValue({ result: 'not a number' }),
        };

        const t = agentAsTool({
            name: 'inner',
            description: 'Inner agent tool',
            agent: mockAgent,
            parameters: z.object({ prompt: z.string() }),
            outputSchema: z.object({ result: z.number() }),
        });

        const result = await t.execute({ prompt: 'do it' });
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('output validation');
    });

    it('runs beforeExecute hook', async () => {
        const mockAgent: RunnableAgent = {
            run: vi.fn().mockResolvedValue({ text: 'done' }),
        };

        const beforeSpy = vi.fn();

        const t = agentAsTool({
            name: 'inner',
            description: 'Inner agent tool',
            agent: mockAgent,
            parameters: z.object({ prompt: z.string() }),
            beforeExecute: beforeSpy,
        });

        await t.execute({ prompt: 'do it' });
        expect(beforeSpy).toHaveBeenCalledWith({ prompt: 'do it' }, expect.any(Object));
    });

    it('runs afterExecute hook', async () => {
        const mockAgent: RunnableAgent = {
            run: vi.fn().mockResolvedValue({ text: 'done' }),
        };

        const afterSpy = vi.fn();

        const t = agentAsTool({
            name: 'inner',
            description: 'Inner agent tool',
            agent: mockAgent,
            parameters: z.object({ prompt: z.string() }),
            afterExecute: afterSpy,
        });

        await t.execute({ prompt: 'do it' });
        expect(afterSpy).toHaveBeenCalledWith({ text: 'done' }, { prompt: 'do it' }, expect.any(Object));
    });

    it('runs onError hook when agent throws', async () => {
        const mockAgent: RunnableAgent = {
            run: vi.fn().mockRejectedValue(new Error('agent failed')),
        };

        const errorSpy = vi.fn();

        const t = agentAsTool({
            name: 'inner',
            description: 'Inner agent tool',
            agent: mockAgent,
            parameters: z.object({ prompt: z.string() }),
            onError: errorSpy,
        });

        const result = await t.execute({ prompt: 'do it' });
        expect(result.success).toBe(true);
        expect(errorSpy).toHaveBeenCalled();
    });

    it('applies transformOutput hook', async () => {
        const mockAgent: RunnableAgent = {
            run: vi.fn().mockResolvedValue({ raw: 'data' }),
        };

        const t = agentAsTool({
            name: 'inner',
            description: 'Inner agent tool',
            agent: mockAgent,
            parameters: z.object({ prompt: z.string() }),
            transformOutput: (output) => ({ ...output, transformed: true }),
        });

        const result = await t.execute({ prompt: 'do it' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ raw: 'data', transformed: true });
    });

    it('re-throws when no onError hook and agent throws', async () => {
        const mockAgent: RunnableAgent = {
            run: vi.fn().mockRejectedValue(new Error('agent failed')),
        };

        const t = agentAsTool({
            name: 'inner',
            description: 'Inner agent tool',
            agent: mockAgent,
            parameters: z.object({ prompt: z.string() }),
        });

        const result = await t.execute({ prompt: 'do it' });
        expect(result.success).toBe(false);
        expect(result.error?.message).toBe('agent failed');
    });

    it('times out after configured timeoutMs', async () => {
        const mockAgent: RunnableAgent = {
            run: vi.fn().mockImplementation(() => new Promise(() => {})),
        };

        const t = agentAsTool({
            name: 'slow',
            description: 'Slow agent',
            agent: mockAgent,
            parameters: z.object({ prompt: z.string() }),
            timeoutMs: 100,
        });

        const result = await t.execute({ prompt: 'do it' });
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('timed out');
    });
});

// ── Workflow as Tool ────────────────────────────────────────────────────────

describe('workflowAsTool()', () => {
    it('wraps a simple workflow and returns results', async () => {
        const mockWorkflow: RunnableWorkflow = {
            execute: vi.fn().mockResolvedValue({ status: 'completed', results: { step1: 'done' } }),
        };

        const t = workflowAsTool({
            name: 'wf',
            description: 'Workflow tool',
            workflow: mockWorkflow,
            parameters: z.object({ topic: z.string() }),
        });

        const result = await t.execute({ topic: 'AI' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ step1: 'done' });
        expect(mockWorkflow.execute).toHaveBeenCalledWith({ topic: 'AI' });
    });

    it('returns suspension details for suspended workflows', async () => {
        const mockWorkflow: RunnableWorkflow = {
            execute: vi.fn().mockResolvedValue({
                status: 'suspended',
                token: 'tok-123',
                awaiting: 'approval',
                message: 'Please approve',
                context: { x: 1 },
            }),
        };

        const t = workflowAsTool({
            name: 'wf',
            description: 'Workflow tool',
            workflow: mockWorkflow,
            parameters: z.object({ topic: z.string() }),
        });

        const result = await t.execute({ topic: 'AI' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({
            status: 'suspended',
            token: 'tok-123',
            awaiting: 'approval',
            message: 'Please approve',
            context: { x: 1 },
        });
    });

    it('validates output against outputSchema when provided', async () => {
        const mockWorkflow: RunnableWorkflow = {
            execute: vi.fn().mockResolvedValue({ status: 'completed', results: { count: 5 } }),
        };

        const t = workflowAsTool({
            name: 'wf',
            description: 'Workflow tool',
            workflow: mockWorkflow,
            parameters: z.object({ topic: z.string() }),
            outputSchema: z.object({ count: z.number() }),
        });

        const result = await t.execute({ topic: 'AI' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ count: 5 });
    });

    it('returns error when workflow output fails outputSchema', async () => {
        const mockWorkflow: RunnableWorkflow = {
            execute: vi.fn().mockResolvedValue({ status: 'completed', results: { count: 'five' } }),
        };

        const t = workflowAsTool({
            name: 'wf',
            description: 'Workflow tool',
            workflow: mockWorkflow,
            parameters: z.object({ topic: z.string() }),
            outputSchema: z.object({ count: z.number() }),
        });

        const result = await t.execute({ topic: 'AI' });
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('output validation');
    });

    it('runs beforeExecute hook', async () => {
        const mockWorkflow: RunnableWorkflow = {
            execute: vi.fn().mockResolvedValue({ status: 'completed', results: {} }),
        };

        const beforeSpy = vi.fn();

        const t = workflowAsTool({
            name: 'wf',
            description: 'Workflow tool',
            workflow: mockWorkflow,
            parameters: z.object({ topic: z.string() }),
            beforeExecute: beforeSpy,
        });

        await t.execute({ topic: 'AI' });
        expect(beforeSpy).toHaveBeenCalledWith({ topic: 'AI' }, expect.any(Object));
    });

    it('runs afterExecute hook', async () => {
        const mockWorkflow: RunnableWorkflow = {
            execute: vi.fn().mockResolvedValue({ status: 'completed', results: { done: true } }),
        };

        const afterSpy = vi.fn();

        const t = workflowAsTool({
            name: 'wf',
            description: 'Workflow tool',
            workflow: mockWorkflow,
            parameters: z.object({ topic: z.string() }),
            afterExecute: afterSpy,
        });

        await t.execute({ topic: 'AI' });
        expect(afterSpy).toHaveBeenCalledWith({ done: true }, { topic: 'AI' }, expect.any(Object));
    });

    it('runs onError hook when workflow throws', async () => {
        const mockWorkflow: RunnableWorkflow = {
            execute: vi.fn().mockRejectedValue(new Error('wf failed')),
        };

        const errorSpy = vi.fn();

        const t = workflowAsTool({
            name: 'wf',
            description: 'Workflow tool',
            workflow: mockWorkflow,
            parameters: z.object({ topic: z.string() }),
            onError: errorSpy,
        });

        const result = await t.execute({ topic: 'AI' });
        expect(result.success).toBe(true);
        expect(errorSpy).toHaveBeenCalled();
    });

    it('times out after configured timeoutMs', async () => {
        const mockWorkflow: RunnableWorkflow = {
            execute: vi.fn().mockImplementation(() => new Promise(() => {})),
        };

        const t = workflowAsTool({
            name: 'slow',
            description: 'Slow workflow',
            workflow: mockWorkflow,
            parameters: z.object({ topic: z.string() }),
            timeoutMs: 100,
        });

        const result = await t.execute({ topic: 'AI' });
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('timed out');
    });
});

// ── ToolBuilder extended hooks ──────────────────────────────────────────────

describe('defineTool() extended hooks', () => {
    it('supports .before(), .after(), and .onError() fluent methods', async () => {
        const beforeSpy = vi.fn();
        const afterSpy = vi.fn();
        const errorSpy = vi.fn();

        const t = tool({
            name: 'fluent',
            description: 'Fluent tool',
            parameters: z.object({ value: z.number() }),
            execute: ({ value }) => ({ doubled: value * 2 }),
            beforeExecute: beforeSpy,
            afterExecute: afterSpy,
            onError: errorSpy,
        });

        const result = await t.execute({ value: 5 });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ doubled: 10 });
        expect(beforeSpy).toHaveBeenCalledTimes(1);
        expect(afterSpy).toHaveBeenCalledTimes(1);
    });
});

// ── LightweightTool interface extensions ────────────────────────────────────

describe('LightweightTool output schema interface', () => {
    it('exposes outputSchema on the tool instance', () => {
        const t = tool({
            name: 'schema-check',
            description: 'Check schema',
            parameters: z.object({ x: z.number() }),
            outputSchema: z.object({ y: z.number() }),
            execute: ({ x }) => ({ y: x * 2 }),
        });

        expect(t.outputSchema).toBeDefined();
    });

    it('exposes lifecycle hooks on the tool instance', () => {
        const beforeSpy = vi.fn();
        const t = tool({
            name: 'hooks-check',
            description: 'Check hooks',
            parameters: z.object({ x: z.number() }),
            execute: ({ x }) => ({ y: x }),
            beforeExecute: beforeSpy,
        });

        expect(t.hooks.beforeExecute).toBe(beforeSpy);
    });
});
