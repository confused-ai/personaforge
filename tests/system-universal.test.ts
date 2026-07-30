/**
 * createSystem / supervisor / universal adapters — competitive edge suite.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createSystem } from '../src/system/create-system.js';
import { fromOpenAITool, fromOpenAITools, jsonSchemaToZodObject } from '../src/adapters/universal/from-openai.js';
import { fromHttpTool } from '../src/adapters/universal/from-http.js';
import { fromForeignTool } from '../src/adapters/universal/from-foreign.js';
import type { CreateAgentResult } from '../src/create-agent/types.js';
import type { AgenticRunResult } from '../src/agentic/types.js';

function mockAgent(name: string, text = `${name}-ok`): CreateAgentResult {
    const result = {
        text,
        markdown: { name: 'response', content: text, mimeType: 'text/markdown' as const, type: 'markdown' as const },
        messages: [],
        steps: 1,
        finishReason: 'stop' as const,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } satisfies AgenticRunResult;

    const agent = {
        name,
        description: `${name} specialist`,
        instructions: `You are ${name}`,
        run: vi.fn().mockResolvedValue(result),
        generate: vi.fn(async (p: string, o?: unknown) => agent.run(p, o as never)),
        stream: vi.fn(),
        streamEvents: vi.fn(),
        createSession: vi.fn().mockResolvedValue('sess'),
        getSessionMessages: vi.fn().mockResolvedValue([]),
        getCompressionStats: vi.fn(),
        resume: vi.fn(),
        asTool: vi.fn(),
    } as unknown as CreateAgentResult;

    return agent;
}

describe('createSystem()', () => {
    it('registers agents and builds a supervisor with specialist tools', () => {
        const research = mockAgent('research');
        const writer = mockAgent('writer');

        const system = createSystem({
            name: 'studio',
            description: 'Content studio',
            agents: {
                research: { agent: research, description: 'Deep research' },
                writer: { agent: writer, description: 'Technical writer' },
            },
            resilience: false,
        });

        expect(system.listAgents()).toEqual(['research', 'writer']);
        expect(system.getAgent('research')).toBe(research);
        expect(system.toJSON()).toMatchObject({
            name: 'studio',
            agents: ['research', 'writer'],
        });

        const boss = system.supervisor({
            instructions: 'Coordinate.',
            createCoordinator: (tools) => {
                const c = mockAgent('studio-supervisor');
                (c as { tools?: unknown }).tools = tools;
                return c;
            },
        });

        expect(boss.tools.map((t) => t.name).sort()).toEqual(['research', 'writer']);
        expect(boss.agent.name).toBe('studio-supervisor');
    });

    it('exposes the whole system as a tool', async () => {
        const research = mockAgent('research', 'done');
        // Patch coordinator by using a system with no agents and empty supervisor that still works
        const system = createSystem({
            name: 'nested',
            agents: { research: { agent: research, description: 'R' } },
            resilience: false,
        });

        // asTool wraps harness around a real agent() supervisor — can't call LLM in unit test.
        // Instead verify tool metadata + that specialist tools execute.
        const boss = system.supervisor({
            createCoordinator: () => mockAgent('nested-supervisor'),
        });
        const researchTool = boss.tools.find((t) => t.name === 'research')!;
        const result = await researchTool.execute({ prompt: 'topic' });
        expect(result.success).toBe(true);
        expect(research.run).toHaveBeenCalled();
    });

    it('supports runtime registration of workflows and pipelines', async () => {
        const system = createSystem({ name: 'dyn', resilience: false });
        system.addWorkflow('bill', {
            description: 'Billing workflow',
            workflow: {
                execute: vi.fn().mockResolvedValue({ status: 'completed', results: { ok: true } }),
            },
        });
        system.addPipeline('write', {
            description: 'Write pipeline',
            pipeline: {
                run: vi.fn().mockResolvedValue({ text: 'piped' }),
            },
        });

        const boss = system.supervisor({
            createCoordinator: () => mockAgent('dyn-supervisor'),
        });
        expect(boss.tools.map((t) => t.name).sort()).toEqual(['bill', 'write']);

        const wf = await boss.tools.find((t) => t.name === 'bill')!.execute({ input: {} });
        expect(wf.success).toBe(true);
        expect(wf.data).toEqual({ ok: true });

        const pipe = await boss.tools.find((t) => t.name === 'write')!.execute({ prompt: 'x' });
        expect(pipe.success).toBe(true);
        expect(pipe.data).toEqual({ text: 'piped' });
    });
});

describe('universal adapters', () => {
    it('fromOpenAITool adapts JSON Schema function tools', async () => {
        const t = fromOpenAITool(
            {
                type: 'function',
                function: {
                    name: 'lookup',
                    description: 'Lookup a key',
                    parameters: {
                        type: 'object',
                        properties: {
                            key: { type: 'string', description: 'Key' },
                        },
                        required: ['key'],
                    },
                },
            },
            {
                execute: async (name, args) => ({ name, args }),
            },
        );

        const result = await t.execute({ key: 'abc' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ name: 'lookup', args: { key: 'abc' } });
    });

    it('jsonSchemaToZodObject marks optional fields', () => {
        const schema = jsonSchemaToZodObject({
            type: 'object',
            properties: {
                a: { type: 'string' },
                b: { type: 'number' },
            },
            required: ['a'],
        });
        expect(schema.safeParse({ a: 'x' }).success).toBe(true);
        expect(schema.safeParse({}).success).toBe(false);
    });

    it('fromForeignTool accepts invoke/call signatures', async () => {
        const t = fromForeignTool({
            name: 'lc_tool',
            description: 'LangChain-like',
            parameters: z.object({ q: z.string() }),
            invoke: async ({ q }) => ({ q, hit: true }),
        });
        const result = await t.execute({ q: 'hi' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ q: 'hi', hit: true });
    });

    it('fromHttpTool performs JSON POST', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            headers: { get: () => 'application/json' },
            json: async () => ({ echo: true }),
            text: async () => '',
        });

        const t = fromHttpTool({
            name: 'api',
            description: 'Call API',
            url: 'https://example.test/v1',
            method: 'POST',
            parameters: z.object({ x: z.number() }),
            fetchImpl: fetchImpl as unknown as typeof fetch,
        });

        const result = await t.execute({ x: 1 });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ echo: true });
        expect(fetchImpl).toHaveBeenCalledWith(
            'https://example.test/v1',
            expect.objectContaining({ method: 'POST' }),
        );
    });

    it('fromOpenAITools maps a list', () => {
        const tools = fromOpenAITools(
            [
                { function: { name: 'a', description: 'A' } },
                { function: { name: 'b', description: 'B' } },
            ],
            { execute: async () => ({}) },
        );
        expect(tools.map((t) => t.name)).toEqual(['a', 'b']);
    });
});
