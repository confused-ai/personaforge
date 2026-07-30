/**
 * Hermetic coverage for src/sdk (defineAgent, DefinedAgent, workflow) and
 * src/workflow (supervisor + remaining swarm edges).
 * Callers: vitest only. Existing: coverage-repo-batch1 (swarm/adapter), workflow-primitives.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

import {
    defineAgent,
    defineAgentFromConfig,
    DefinedAgent,
    createWorkflow,
    isSuspended,
} from '../src/sdk/index.js';
import { createSupervisor } from '../src/workflow/supervisor.js';
import type { WorkflowAgent } from '../src/workflow/types.js';

function mockResult(text: string) {
    return { text, messages: [], steps: 1, finishReason: 'stop' };
}

function agent(name: string, fn: (p: string) => Promise<{ text: string }> | { text: string }): WorkflowAgent {
    return {
        name,
        instructions: `${name} agent`,
        run: async (p) => mockResult((await fn(p)).text),
    };
}

describe('defineAgent / TypedAgent', () => {
    it('builder chain: run, stream, resume, plan, getConfig', async () => {
        const typed = defineAgent('echo')
            .model('openai:gpt-4o')
            .input(z.object({ q: z.string() }))
            .output(z.object({ a: z.string() }))
            .instructions('Answer briefly.')
            .tools([])
            .skills([])
            .memory({
                get: async () => null,
                set: async () => undefined,
                delete: async () => undefined,
                clear: async () => undefined,
                list: async () => [],
            } as never)
            .maxIterations(5)
            .timeout(10_000)
            .handler(async ({ q }, ctx) => {
                expect(ctx?.['__instructions']).toContain('Answer briefly.');
                return { a: `ok:${q}` };
            })
            .build();

        const cfg = typed.getConfig();
        expect(cfg.name).toBe('echo');
        expect(cfg.modelRef).toBe('openai:gpt-4o');
        expect(cfg.maxIterations).toBe(5);

        const result = await typed.run({ q: 'hi' }, { sessionId: 'sess-1' });
        expect(result.a).toBe('ok:hi');
        expect(result.sessionId).toBe('sess-1');
        expect(result.runId).toBeTruthy();

        const events: string[] = [];
        for await (const ev of typed.stream({ q: 'stream' })) {
            events.push(ev.type);
        }
        expect(events).toContain('text');
        expect(events).toContain('done');

        const resumed = await typed.resume(result.runId, { context: { retry: 1 } });
        expect(resumed.a).toBe('ok:hi');

        await expect(typed.resume('missing')).rejects.toThrow(/No checkpoint/);

        const plan = await typed.plan('research topic');
        expect(plan.tasks.length).toBeGreaterThan(0);
    });

    it('passthrough without handler and stream error path', async () => {
        const passthrough = defineAgent('pt')
            .input(z.string())
            .output(z.string())
            .build();
        const r = await passthrough.run('hello');
        expect(r).toMatchObject({ sessionId: expect.any(String), runId: expect.any(String) });

        const failing = defineAgent('fail')
            .input(z.object({ x: z.number() }))
            .output(z.object({ y: z.number() }))
            .handler(async () => {
                throw new Error('boom');
            })
            .build();
        const types: string[] = [];
        for await (const ev of failing.stream({ x: 1 })) {
            types.push(ev.type);
            if (ev.type === 'error') expect(ev.error).toBeTruthy();
        }
        expect(types).toContain('error');
    });

    it('registers skill tools on build', async () => {
        const skillTool = {
            name: 'skill_tool',
            description: 'd',
            parameters: z.object({}),
            execute: async () => ({ ok: true }),
        };
        const a = defineAgent('skilled')
            .skills([{ name: 's', instructions: 'Be careful.', tools: [skillTool] } as never])
            .handler(async (input, ctx) => {
                const reg = ctx?.['__toolRegistry'] as { list: () => Array<{ name: string }> };
                expect(reg.list().some((t) => t.name === 'skill_tool')).toBe(true);
                return input;
            })
            .build();
        await a.run('x');
    });
});

describe('DefinedAgent / defineAgentFromConfig', () => {
    it('runs handler, withTool(s), plan, getConfig', async () => {
        const tool = {
            id: 't1',
            name: 't1',
            description: 'd',
            parameters: z.object({}),
            execute: async () => 1,
        };
        const defined = defineAgentFromConfig({
            name: 'legacy',
            description: 'd',
            inputSchema: z.object({ n: z.number() }),
            outputSchema: z.object({ n: z.number() }),
            handler: async ({ n }) => ({ n: n + 1 }),
            tools: [tool as never],
        });

        expect(defined.getConfig().name).toBe('legacy');
        expect(await defined.run({ input: { n: 2 } })).toEqual({ n: 3 });

        defined.withTool({
            id: 't2',
            name: 't2',
            description: 'd2',
            parameters: z.object({}),
            execute: async () => 2,
        } as never);
        defined.withTools([
            {
                id: 't3',
                name: 't3',
                description: 'd3',
                parameters: z.object({}),
                execute: async () => 3,
            } as never,
        ]);
        defined.withMemory({
            get: async () => null,
            set: async () => undefined,
            delete: async () => undefined,
            clear: async () => undefined,
            list: async () => [],
        } as never);
        defined.withPlanner({
            plan: async (goal: string) => ({
                id: 'p',
                goal,
                tasks: [],
                createdAt: new Date(),
                metadata: { plannerType: 'mock' },
            }),
            refine: async (p: unknown) => p,
            validate: () => ({ valid: true, errors: [] }),
        } as never);
        const engine = { execute: vi.fn() };
        defined.withExecutionEngine(engine as never);
        expect(defined.getExecutionEngine()).toBe(engine);

        const plan = await defined.plan('do stuff');
        expect(plan.goal).toBe('do stuff');
    });

    it('passthrough DefinedAgent without handler', async () => {
        const d = new DefinedAgent({
            name: 'pt',
            inputSchema: z.string(),
            outputSchema: z.string(),
        });
        await expect(d.run({ input: 'hi' })).resolves.toBe('hi');
    });
});

describe('createWorkflow', () => {
    function makeStepAgent(label: string) {
        return defineAgentFromConfig({
            name: label,
            inputSchema: z.unknown(),
            outputSchema: z.string(),
            handler: async (_input, ctx) => `${label}:${JSON.stringify(ctx?.['results'] ?? {})}`,
        });
    }

    it('runs sequential tasks and parallel batches', async () => {
        const a = makeStepAgent('a');
        const b = makeStepAgent('b');
        const c = makeStepAgent('c');

        const wf = createWorkflow()
            .task('t1', a)
            .dependsOn()
            .parallel()
            .task('t2', b)
            .task('t3', c)
            .sequential()
            .task('t4', a)
            .build();

        const result = await wf.execute({ seed: 1 });
        expect(result.status).toBe('completed');
        if (result.status === 'completed') {
            expect(result.results['t1']).toBeTruthy();
            expect(result.results['t2']).toBeTruthy();
            expect(result.results['t3']).toBeTruthy();
            expect(result.results['t4']).toBeTruthy();
        }
    });

    it('suspends and resumes human-in-the-loop', async () => {
        const a = makeStepAgent('a');
        const builder = createWorkflow().task('prep', a).suspend('approval', 'Need OK').task('after', a);

        const first = await builder.execute({ x: 1 });
        expect(isSuspended(first)).toBe(true);
        if (!isSuspended(first)) throw new Error('expected suspend');
        expect(first.awaiting).toBe('approval');
        expect(first.message).toBe('Need OK');

        const done = await builder.build().resume(first, 'approved');
        expect(done.status).toBe('completed');
        if (done.status === 'completed') {
            expect(done.results['approval']).toBe('approved');
            expect(done.results['after']).toBeTruthy();
        }
    });
});

describe('createSupervisor', () => {
    it('delegates to sub-agents then returns done answer', async () => {
        let round = 0;
        const supervisor = agent('sup', async () => {
            round += 1;
            if (round === 1) return { text: JSON.stringify({ agent: 'worker', prompt: 'do work' }) };
            return { text: JSON.stringify({ done: true, answer: 'final' }) };
        });
        const worker = agent('worker', async (p) => ({ text: `done:${p}` }));
        const agents = new Map<string, WorkflowAgent>([['worker', worker]]);

        const result = await createSupervisor({ supervisor, agents, maxRounds: 5 }).run('task');
        expect(result.text).toBe('final');
    });

    it('handles missing agent, bad JSON, incomplete payload, and max rounds', async () => {
        const badJson = agent('sup', async () => ({ text: 'not-json' }));
        await expect(
            createSupervisor({
                supervisor: badJson,
                agents: new Map(),
            }).run('t'),
        ).resolves.toMatchObject({ text: 'not-json' });

        let n = 0;
        const missing = agent('sup', async () => {
            n += 1;
            if (n === 1) return { text: '{"agent":"ghost","prompt":"x"}' };
            return { text: '{"done":true,"answer":"ok"}' };
        });
        await expect(
            createSupervisor({ supervisor: missing, agents: new Map(), maxRounds: 5 }).run('t'),
        ).resolves.toMatchObject({ text: 'ok' });

        const incomplete = agent('sup', async () => ({ text: '{"agent":"w"}' }));
        await expect(
            createSupervisor({
                supervisor: incomplete,
                agents: new Map([['w', agent('w', async () => ({ text: 'x' }))]]),
            }).run('t'),
        ).resolves.toMatchObject({ text: '{"agent":"w"}' });

        let rounds = 0;
        const loopy = agent('sup', async (prompt) => {
            rounds += 1;
            // After maxRounds the supervisor is asked to summarise; "Max rounds" is in the prompt.
            if (prompt.includes('Max rounds reached')) {
                return { text: 'summarized after max' };
            }
            return { text: JSON.stringify({ agent: 'w', prompt: `r${rounds}` }) };
        });
        const w = agent('w', async (p) => ({ text: p }));
        const out = await createSupervisor({
            supervisor: loopy,
            agents: new Map([['w', w]]),
            maxRounds: 2,
        }).run('goal');
        expect(out.text).toBe('summarized after max');
        expect(rounds).toBe(3);
    });
});
