/**
 * Repo-wide coverage batch 1 — hermetic unit tests for previously zero/low
 * coverage pure modules (contracts, core, shared, serve, toolkit, swarm, etc.).
 *
 * Callers: vitest CI only. No production imports. No data I/O.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

import { ok, err, isOk, isErr, unwrap, map, tryCatch } from '../src/contracts/result.js';
import {
    PersonaForgeError as ContractError,
    ValidationError,
    BudgetExceededError,
    CircuitOpenError,
    GuardrailViolatedError,
    ToolTimeoutError,
    ToolValidationError,
    ExecutionTimeoutError,
    UnauthorizedError,
    ForbiddenError,
    ToolNotAuthorizedError,
    isPersonaForgeError,
    isRetryable,
} from '../src/contracts/errors.js';
import { newId } from '../src/contracts/ids.js';
import {
    PersonaForgeError,
    ConfigError,
    LLMError,
    BudgetExceededError as CoreBudgetExceeded,
} from '../src/core/errors.js';
import { MapToolRegistry, createToolRegistry } from '../src/core/tool-registry.js';
import { tryImport } from '../src/shared/try-import.js';
import { generateTaskId } from '../src/background/util.js';
import { ChatRequestSchema, RunRequestSchema } from '../src/serve/schemas.js';
import { validateBody, validate } from '../src/serve/validate.js';
import { createToolkit, toolkitsToRegistry } from '../src/orchestration/core/toolkit.js';
import { createSwarm } from '../src/workflow/swarm.js';
import { InMemoryCheckpointStore } from '../src/production/checkpoint.js';
import { zodToJsonSchema, toolToLLMDef } from '../src/tools/core/zod-to-schema.js';
import { SleepTool, SleepToolkit } from '../src/tools/devtools/sleep.js';
import type { Tool } from '../src/contracts/index.js';

function fakeTool(name: string): Tool {
    return {
        id: `id-${name}`,
        name,
        description: `${name} tool`,
        parameters: z.object({}),
        execute: async () => ({ ok: true }),
        validate: () => ({ success: true, data: {} }),
    } as unknown as Tool;
}

describe('contracts/result', () => {
    it('ok/err/isOk/isErr/unwrap/map/tryCatch', async () => {
        const good = ok(42);
        expect(isOk(good)).toBe(true);
        expect(isErr(good)).toBe(false);
        expect(unwrap(good)).toBe(42);
        expect(map(good, (n) => n * 2)).toEqual(ok(84));

        const bad = err(new ValidationError('nope'));
        expect(isOk(bad)).toBe(false);
        expect(isErr(bad)).toBe(true);
        expect(() => unwrap(bad)).toThrow(ValidationError);
        expect(map(bad, (n: number) => n)).toBe(bad);

        await expect(tryCatch(async () => 1, () => new ValidationError('x'))).resolves.toEqual(ok(1));
        await expect(
            tryCatch(
                async () => {
                    throw new Error('boom');
                },
                (e) => new ValidationError(String(e)),
            ),
        ).resolves.toMatchObject({ ok: false });
    });
});

describe('contracts/errors', () => {
    it('constructs all error subclasses and isPersonaForgeError', () => {
        const base = new ContractError({
            code: 'VALIDATION_FAILED',
            message: 'base',
            context: { a: 1 },
            cause: new Error('c'),
        });
        expect(base.code).toBe('VALIDATION_FAILED');
        expect(base.context).toEqual({ a: 1 });
        expect(base.toJSON().name).toBe('PersonaForgeError');
        expect(isPersonaForgeError(base)).toBe(true);
        expect(isPersonaForgeError(new Error('no'))).toBe(false);

        expect(new BudgetExceededError({ limitUsd: 1, spentUsd: 2, scope: 'run' }).name).toBe(
            'BudgetExceededError',
        );
        expect(new CircuitOpenError('svc', 100).retryable).toBe(true);
        expect(new GuardrailViolatedError('r', 'd').name).toBe('GuardrailViolatedError');
        expect(new ToolTimeoutError('t', 50).name).toBe('ToolTimeoutError');
        expect(new ToolValidationError('tv', 'bad', { x: 1 }).name).toBe('ToolValidationError');
        expect(new ExecutionTimeoutError(10, 'scope').name).toBe('ExecutionTimeoutError');
        expect(new ValidationError('v').name).toBe('ValidationError');
        expect(new UnauthorizedError().name).toBe('UnauthorizedError');
        expect(new ForbiddenError('f', 'admin').name).toBe('ForbiddenError');
        expect(new ForbiddenError('f2').context).toEqual({});
        expect(new ToolNotAuthorizedError('ta', 'tenant').name).toBe('ToolNotAuthorizedError');
        expect(new ToolNotAuthorizedError('ta2').name).toBe('ToolNotAuthorizedError');

        expect(isRetryable(new CircuitOpenError('s', 1))).toBe(true);
        expect(isRetryable(new Error('x'))).toBe(false);
    });
});

describe('core/errors + tool-registry', () => {
    it('core error classes', () => {
        expect(new PersonaForgeError('m').code).toBe('CONFUSED_AI_ERROR');
        expect(new PersonaForgeError('m', { code: 'C', context: { x: 1 } }).context).toEqual({ x: 1 });
        expect(new ConfigError('c').name).toBe('ConfigError');
        expect(new ConfigError('c', { context: { k: 1 } }).context).toEqual({ k: 1 });
        expect(new LLMError('l').name).toBe('LLMError');
        expect(new CoreBudgetExceeded('b').name).toBe('BudgetExceededError');
    });

    it('MapToolRegistry CRUD + cache invalidation', () => {
        const a = fakeTool('a');
        const b = fakeTool('b');
        const reg = createToolRegistry([a]);
        expect(reg.size).toBe(1);
        expect(reg.get('a')).toBe(a);
        expect(reg.has('a')).toBe(true);
        expect(reg.list()).toEqual([a]);
        expect(reg.list()).toBe(reg.list()); // cached

        reg.register(b);
        expect(reg.size).toBe(2);
        expect(reg.list()).toHaveLength(2);

        reg.unregister('missing');
        reg.unregister('a');
        expect(reg.has('a')).toBe(false);
        expect(reg.list()).toHaveLength(1);

        reg.clear();
        expect(reg.size).toBe(0);
        expect(reg.list()).toEqual([]);
    });
});

describe('shared/try-import + background/util + ids', () => {
    it('tryImport returns module or null', async () => {
        const path = await tryImport<{ join: (...a: string[]) => string }>('node:path');
        expect(path).toBeTruthy();
        expect(typeof (path as { join?: unknown }).join === 'function' || typeof path === 'object').toBe(true);

        const missing = await tryImport('definitely-not-installed-pkg-xyz-123');
        expect(missing).toBeNull();
    });

    it('generateTaskId / newId', () => {
        expect(generateTaskId()).toMatch(/^task/);
        expect(newId('run')).toMatch(/^run/);
        expect(newId()).toBeTruthy();
    });
});

describe('serve schemas + validate', () => {
    it('ChatRequestSchema / RunRequestSchema', () => {
        expect(ChatRequestSchema.safeParse({ message: 'hi' }).success).toBe(true);
        expect(ChatRequestSchema.safeParse({ message: '' }).success).toBe(false);
        expect(
            RunRequestSchema.safeParse({
                agent: 'a',
                input: 'x',
                guards: { maxSteps: 3, timeoutMs: 1000 },
            }).success,
        ).toBe(true);
    });

    it('validateBody + express middleware', () => {
        const schema = z.object({ n: z.number() });
        expect(validateBody(schema, { n: 1 })).toEqual({ ok: true, data: { n: 1 } });
        const bad = validateBody(schema, { n: 'x' });
        expect(bad.ok).toBe(false);

        const mw = validate(schema);
        const next = vi.fn();
        const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
        const req = { body: { n: 2 } };
        mw(req, res as never, next);
        expect(next).toHaveBeenCalled();
        expect(req.body).toEqual({ n: 2 });

        const req2 = { body: { n: 'bad' } };
        mw(req2, res as never, next);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalled();
    });
});

describe('orchestration toolkit + workflow swarm', () => {
    it('createToolkit + toolkitsToRegistry', () => {
        const t = fakeTool('search');
        const tk = createToolkit('Search', [t], { id: 's1', description: 'd', version: '1' });
        expect(tk.id).toBe('s1');
        expect(tk.tools).toEqual([t]);

        const tk2 = createToolkit('Other', [t]);
        expect(tk2.id).toContain('toolkit-other');

        const reg = toolkitsToRegistry([tk]);
        expect(reg.list().map((x) => x.name)).toContain('search');

        const bare = fakeTool('bare');
        const reg2 = toolkitsToRegistry([bare as never]);
        expect(reg2.list().map((x) => x.name)).toContain('bare');
    });

    it('createSwarm run/runAll/route/empty', async () => {
        expect(() => createSwarm({ agents: [] })).toThrow(/At least one/);

        const a1 = { name: 'a1', run: vi.fn(async () => ({ text: '1' })) };
        const a2 = { name: 'a2', run: vi.fn(async () => ({ text: '2' })) };
        const a3 = {
            name: 'a3',
            run: vi.fn(async () => {
                throw new Error('fail');
            }),
        };

        const swarm = createSwarm({ agents: [a1, a2] as never });
        await expect(swarm.run('p')).resolves.toEqual({ text: '1' });
        await expect(swarm.run('p')).resolves.toEqual({ text: '2' });

        const routed = createSwarm({
            agents: [a1, a2] as never,
            route: async (_p, agents) => agents[1]!,
        });
        await expect(routed.run('p')).resolves.toEqual({ text: '2' });

        const all = createSwarm({ agents: [a1, a2, a3] as never, concurrency: 2 });
        const results = await all.runAll('p');
        expect(results).toHaveLength(2);
    });
});

describe('production checkpoint in-memory', () => {
    it('save/load/delete/listIncomplete', async () => {
        const store = new InMemoryCheckpointStore();
        const state = {
            messages: [],
            step: 1,
            agentName: 'a',
            prompt: 'p',
            startedAt: new Date().toISOString(),
            checkpointAt: new Date().toISOString(),
        };
        await store.save('r1', 1, state);
        expect(await store.load('r1')).toEqual({ step: 1, state });
        expect(await store.load('missing')).toBeNull();
        expect(await store.listIncomplete()).toEqual(['r1']);
        await store.delete('r1');
        expect(await store.load('r1')).toBeNull();
    });
});

describe('tools zod-to-schema + sleep', () => {
    it('zodToJsonSchema + toolToLLMDef', () => {
        const schema = z.object({ q: z.string() });
        const json = zodToJsonSchema(schema);
        expect(json).toBeTruthy();

        const tool = {
            name: 't',
            description: 'd',
            parameters: schema,
        } as never;
        const def = toolToLLMDef(tool);
        expect(def.name).toBe('t');
        expect(def.parameters).toBeTruthy();

        const withToJSON = {
            name: 't2',
            description: 'd2',
            parameters: {
                toJSONSchema: () => ({ $schema: 'x', type: 'object', properties: {} }),
            },
        } as never;
        const def2 = toolToLLMDef(withToJSON);
        expect((def2.parameters as Record<string, unknown>)['$schema']).toBeUndefined();
    });

    it('SleepTool / SleepToolkit', async () => {
        vi.useFakeTimers();
        try {
            const toolkit = new SleepToolkit();
            expect(toolkit.getTools()).toHaveLength(1);
            const tool = toolkit.sleep;
            const p = tool.execute({ seconds: 0.1, reason: 'test' } as never, {
                sessionId: 's',
            } as never);
            await vi.advanceTimersByTimeAsync(100);
            const r = await p;
            expect(r.success).toBe(true);
            expect(r.data).toMatchObject({ sleptForSeconds: 0.1, reason: 'test' });

            const p2 = tool.execute({ seconds: 0.1 } as never, { sessionId: 's' } as never);
            await vi.advanceTimersByTimeAsync(100);
            const r2 = await p2;
            expect(r2.data).toMatchObject({ sleptForSeconds: 0.1 });
            expect((r2.data as { reason?: string }).reason).toBeUndefined();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('sdk orchestrator adapter', () => {
    it('asOrchestratorAgent parses JSON prompts and passes strings', async () => {
        const { asOrchestratorAgent } = await import('../src/sdk/orchestrator-adapter.js');
        const defined = {
            getConfig: () => ({ name: 'd', description: 'desc' }),
            run: vi.fn(async ({ input }: { input: unknown }) => ({ echo: input })),
        };
        const agent = asOrchestratorAgent(defined as never);
        expect(agent.name).toBe('d');
        expect(agent.description).toBe('desc');

        const out = await agent.run({ prompt: '{"a":1}', context: { k: 1 } }, {});
        expect(out.result).toEqual({ echo: { a: 1 } });
        expect(out.state).toBeDefined();

        const out2 = await agent.run({ prompt: 'plain' }, {});
        expect(out2.result).toEqual({ echo: 'plain' });

        const noDesc = asOrchestratorAgent({
            getConfig: () => ({ name: 'n' }),
            run: async () => 1,
        } as never);
        expect(noDesc.description).toBeUndefined();
    });
});
