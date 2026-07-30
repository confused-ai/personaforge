/**
 * Hermetic coverage for src/core — errors, tool-registry, context-builder, base-agent, types.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    PersonaForgeError,
    ConfigError,
    LLMError,
    BudgetExceededError,
} from '../src/core/errors.js';
import { MapToolRegistry, createToolRegistry } from '../src/core/tool-registry.js';
import { AgentContextBuilder } from '../src/core/context-builder.js';
import { BaseAgent } from '../src/core/base-agent.js';
import { AgentState, generateEntityId } from '../src/core/types.js';
import type { AgentConfig, AgentContext, AgentInput, Message, StreamChunk } from '../src/core/types.js';
import type { Tool } from '../src/contracts/index.js';

function fakeTool(name: string): Tool {
    return {
        name,
        description: `${name} desc`,
        parameters: { type: 'object', properties: {} },
        execute: async () => 'ok',
    };
}

describe('core/errors', () => {
    it('PersonaForgeError defaults and optional context', () => {
        const a = new PersonaForgeError('oops');
        expect(a.name).toBe('PersonaForgeError');
        expect(a.code).toBe('CONFUSED_AI_ERROR');
        expect(a.message).toBe('oops');
        expect(a.context).toBeUndefined();

        const b = new PersonaForgeError('x', { code: 'CUSTOM', context: { k: 1 } });
        expect(b.code).toBe('CUSTOM');
        expect(b.context).toEqual({ k: 1 });
    });

    it('ConfigError / LLMError / BudgetExceededError codes and names', () => {
        const c = new ConfigError('bad config');
        expect(c.name).toBe('ConfigError');
        expect(c.code).toBe('CONFIG_ERROR');
        expect(c.context).toBeUndefined();

        const c2 = new ConfigError('bad', { context: { field: 'x' } });
        expect(c2.context).toEqual({ field: 'x' });

        const l = new LLMError('provider down');
        expect(l.name).toBe('LLMError');
        expect(l.code).toBe('LLM_ERROR');

        const l2 = new LLMError('rate', { context: { status: 429 } });
        expect(l2.context).toEqual({ status: 429 });

        const b = new BudgetExceededError('over');
        expect(b.name).toBe('BudgetExceededError');
        expect(b.code).toBe('BUDGET_EXCEEDED');

        const b2 = new BudgetExceededError('over', { context: { spent: 10 } });
        expect(b2.context).toEqual({ spent: 10 });
    });
});

describe('core/tool-registry', () => {
    it('constructor seeds tools and createToolRegistry factory', () => {
        const t = fakeTool('seed');
        const reg = new MapToolRegistry([t]);
        expect(reg.size).toBe(1);
        expect(reg.get('seed')).toBe(t);

        const viaFactory = createToolRegistry([fakeTool('f')]);
        expect(viaFactory).toBeInstanceOf(MapToolRegistry);
        expect(viaFactory.has('f')).toBe(true);
    });

    it('register returns this and invalidates list cache', () => {
        const reg = new MapToolRegistry();
        const a = fakeTool('a');
        expect(reg.register(a)).toBe(reg);
        const list1 = reg.list();
        expect(list1).toEqual([a]);
        expect(reg.list()).toBe(list1);

        reg.register(fakeTool('b'));
        expect(reg.list()).not.toBe(list1);
        expect(reg.list()).toHaveLength(2);
    });

    it('unregister only invalidates when key existed', () => {
        const reg = createToolRegistry([fakeTool('x')]);
        const cached = reg.list();
        reg.unregister('missing');
        expect(reg.list()).toBe(cached);
        reg.unregister('x');
        expect(reg.size).toBe(0);
        expect(reg.list()).toEqual([]);
    });

    it('clear empties registry', () => {
        const reg = createToolRegistry([fakeTool('a'), fakeTool('b')]);
        reg.clear();
        expect(reg.size).toBe(0);
        expect(reg.has('a')).toBe(false);
        expect(reg.get('a')).toBeUndefined();
    });

    it('empty constructor starts at size 0', () => {
        expect(new MapToolRegistry().size).toBe(0);
    });
});

describe('core/context-builder', () => {
    it('builds with defaults for memory and tools', () => {
        const ctx = new AgentContextBuilder().build();
        expect(ctx.agentId).toMatch(/^agent-/);
        expect(ctx.memory).toBeDefined();
        expect(ctx.tools).toBeDefined();
        expect(ctx.planner).toBeUndefined();
        expect(ctx.metadata).toEqual({});
    });

    it('fluent setters and metadata merge', () => {
        const memory = { kind: 'mem' } as never;
        const tools = { kind: 'tools' } as never;
        const planner = { kind: 'planner' } as never;

        const ctx = new AgentContextBuilder()
            .withAgentId('agent-fixed')
            .withMemory(memory)
            .withTools(tools)
            .withPlanner(planner)
            .withMetadata('a', 1)
            .withMetadataEntries({ b: 2, a: 9 })
            .build();

        expect(ctx.agentId).toBe('agent-fixed');
        expect(ctx.memory).toBe(memory);
        expect(ctx.tools).toBe(tools);
        expect(ctx.planner).toBe(planner);
        expect(ctx.metadata).toEqual({ a: 9, b: 2 });
    });

    it('fromContext clones fields into a new builder', () => {
        const original = new AgentContextBuilder()
            .withAgentId('from-me')
            .withMetadata('k', 'v')
            .build();

        const rebuilt = AgentContextBuilder.fromContext(original as never)
            .withMetadata('extra', true)
            .build();

        expect(rebuilt.agentId).toBe('from-me');
        expect(rebuilt.memory).toBe(original.memory);
        expect(rebuilt.tools).toBe(original.tools);
        expect(rebuilt.metadata).toEqual({ k: 'v', extra: true });
        expect(original.metadata).toEqual({ k: 'v' });
    });

    it('omits planner when not set', () => {
        const ctx = new AgentContextBuilder().withAgentId('no-planner').build();
        expect(ctx.planner).toBeUndefined();
    });
});

describe('core/types generateEntityId + AgentState', () => {
    it('generateEntityId returns a UUID-like string', () => {
        const id = generateEntityId();
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(8);
        expect(generateEntityId()).not.toBe(id);
    });

    it('AgentState enum values', () => {
        expect(AgentState.IDLE).toBe('idle');
        expect(AgentState.PLANNING).toBe('planning');
        expect(AgentState.EXECUTING).toBe('executing');
        expect(AgentState.PAUSED).toBe('paused');
        expect(AgentState.COMPLETED).toBe('completed');
        expect(AgentState.FAILED).toBe('failed');
        expect(AgentState.CANCELLED).toBe('cancelled');
    });
});

describe('core/base-agent', () => {
    class TestAgent extends BaseAgent {
        lastExecute?: AgentInput;
        executeResult: unknown = 'done';
        executeError?: Error;

        constructor(config: AgentConfig = { name: 'test-agent' }) {
            super(config);
        }

        protected async execute(input: AgentInput, _ctx: AgentContext): Promise<unknown> {
            this.lastExecute = input;
            if (this.executeError) throw this.executeError;
            return this.executeResult;
        }

        async run(): Promise<never> {
            throw new Error('not used');
        }
        async *stream(): AsyncIterable<string> {}
        async *streamEvents(): AsyncIterable<StreamChunk> {}
        async createSession(): Promise<string> {
            return 's';
        }
        async getSessionMessages(): Promise<Message[]> {
            return [];
        }
        withSession() {
            return {
                run: this.run.bind(this),
                stream: this.stream.bind(this),
                streamEvents: this.streamEvents.bind(this),
            };
        }

        bump() {
            this.incrementIteration();
        }
        maxReached() {
            return this.isMaxIterationsReached();
        }
        out(result: unknown, state: AgentState) {
            return this.createOutput(result, state);
        }
    }

    const emptyCtx = (): AgentContext => ({
        agentId: 'a1',
        metadata: {},
    });

    it('constructor assigns id, name, idle state, optional debug', () => {
        const a = new TestAgent({ name: 'N', id: 'fixed-id', debug: true });
        expect(a.id).toBe('fixed-id');
        expect(a.name).toBe('N');
        expect(a.state).toBe(AgentState.IDLE);
        expect(a.isExecuting()).toBe(false);
        expect(a.isCompleted()).toBe(false);
        expect(a.hasFailed()).toBe(false);

        const b = new TestAgent({ name: 'auto' });
        expect(b.id).toBeTruthy();
    });

    it('setState updates state and fires onStateChange', async () => {
        const onStateChange = vi.fn();
        const a = new TestAgent({ name: 's' });
        a.hooks.onStateChange = onStateChange;
        await a.setState(AgentState.EXECUTING, emptyCtx());
        expect(a.state).toBe(AgentState.EXECUTING);
        expect(a.isExecuting()).toBe(true);
        expect(onStateChange).toHaveBeenCalledWith(
            AgentState.IDLE,
            AgentState.EXECUTING,
            expect.any(Object),
        );
    });

    it('runWithContext success path with hooks', async () => {
        const before = vi.fn();
        const after = vi.fn();
        const a = new TestAgent({ name: 'ok' });
        a.hooks.beforeExecution = before;
        a.hooks.afterExecution = after;
        a.executeResult = { answer: 1 };

        const out = await a.runWithContext({ prompt: 'hello world' }, emptyCtx());
        expect(before).toHaveBeenCalled();
        expect(after).toHaveBeenCalled();
        expect(out.result).toEqual({ answer: 1 });
        expect(out.state).toBe(AgentState.COMPLETED);
        expect(out.metadata.iterations).toBe(0);
        expect(out.metadata.durationMs).toBeGreaterThanOrEqual(0);
        expect(a.isCompleted()).toBe(true);
        expect(a.lastExecute?.prompt).toBe('hello world');
    });

    it('runWithContext failure path with onError and non-Error throw', async () => {
        const onError = vi.fn();
        const a = new TestAgent({ name: 'fail' });
        a.hooks.onError = onError;
        a.executeError = new Error('boom');

        const out = await a.runWithContext({ prompt: 'x' }, emptyCtx());
        expect(out.state).toBe(AgentState.FAILED);
        expect(out.result).toBe('boom');
        expect(a.hasFailed()).toBe(true);
        expect(onError).toHaveBeenCalled();

        const a2 = new TestAgent({ name: 'fail2' });
        (a2 as { execute: TestAgent['execute'] }).execute = async () => {
            throw 'string-fail';
        };
        const out2 = await a2.runWithContext({ prompt: 'y' }, emptyCtx());
        expect(out2.result).toBe('string-fail');
        expect(out2.state).toBe(AgentState.FAILED);
    });

    it('iteration helpers and createOutput', () => {
        const a = new TestAgent({ name: 'iter', maxIterations: 2 });
        expect(a.maxReached()).toBe(false);
        a.bump();
        a.bump();
        expect(a.maxReached()).toBe(true);

        const noMax = new TestAgent({ name: 'nm' });
        noMax.bump();
        expect(noMax.maxReached()).toBe(false);

        const out = a.out('r', AgentState.COMPLETED);
        expect(out.result).toBe('r');
        expect(out.metadata.iterations).toBe(2);
    });
});
