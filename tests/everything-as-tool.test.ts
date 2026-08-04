/**
 * Tests for the unified "everything is a tool" layer:
 * memoryAsTool, knowledgeAsTool, promptAsTool, and the asTool()/toTool() dispatcher.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { memoryAsTool } from '../src/tools/core/memory-as-tool.js';
import { knowledgeAsTool } from '../src/tools/core/knowledge-as-tool.js';
import { promptAsTool } from '../src/tools/core/prompt-as-tool.js';
import { asTool, toTool } from '../src/tools/core/as-tool.js';
import { InMemoryStore } from '../src/memory/in-memory-store.js';
import { PromptRegistry } from '../src/prompts/index.js';
import { defineAgent } from '../src/sdk/defined-agent.js';
import { createWorkflow } from '../src/sdk/workflow.js';

// ── memoryAsTool ────────────────────────────────────────────────────────────

describe('memoryAsTool()', () => {
    it('stores and recalls a fact through the tool interface', async () => {
        const memory = new InMemoryStore();
        const t = memoryAsTool({
            name: 'user_memory',
            description: 'User memory',
            memory,
        });

        const storeResult = await t.execute({
            action: 'store',
            content: 'User prefers dark mode',
        });
        expect(storeResult.success).toBe(true);
        expect(storeResult.data).toMatchObject({ action: 'stored', content: 'User prefers dark mode' });

        const recallResult = await t.execute({
            action: 'recall',
            query: 'dark mode',
        });
        expect(recallResult.success).toBe(true);
        expect(recallResult.data).toMatchObject({ action: 'recalled', count: 1 });
        expect((recallResult.data as { results: Array<{ content: string }> }).results[0].content).toBe('User prefers dark mode');
    });

    it('supports get_recent, delete, and clear actions', async () => {
        const memory = new InMemoryStore();
        const t = memoryAsTool({ name: 'mem', description: 'mem', memory });

        await t.execute({ action: 'store', content: 'a' });
        await t.execute({ action: 'store', content: 'b' });

        const recent = await t.execute({ action: 'get_recent', limit: 10 });
        expect(recent.success).toBe(true);
        expect((recent.data as { count: number }).count).toBe(2);

        const storedId = (await t.execute({ action: 'store', content: 'c' })).data as { id: string };
        const del = await t.execute({ action: 'delete', id: storedId.id });
        expect(del.success).toBe(true);
        expect(del.data).toMatchObject({ deleted: true });

        const cleared = await t.execute({ action: 'clear' });
        expect(cleared.success).toBe(true);
        expect(cleared.data).toMatchObject({ action: 'cleared' });
    });

    it('validates required input and cancels store when content is missing', async () => {
        const memory = new InMemoryStore();
        const t = memoryAsTool({ name: 'mem', description: 'mem', memory });

        const bad = await t.execute({ action: 'store', content: '   ' });
        expect(bad.success).toBe(false);
        expect(bad.error?.message).toContain('non-empty "content"');
    });

    it('blocks writes when writeable is false', async () => {
        const memory = new InMemoryStore();
        const t = memoryAsTool({
            name: 'ro_mem',
            description: 'read-only memory',
            memory,
            writeable: false,
        });

        const store = await t.execute({ action: 'store', content: 'x' });
        expect(store.success).toBe(false);
        expect(store.error?.message).toContain('read-only');
    });

    it('returns a validation error for an unknown action', async () => {
        const memory = new InMemoryStore();
        const t = memoryAsTool({ name: 'mem', description: 'mem', memory });

        const result = await t.execute({ action: 'nope' });
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('VALIDATION_ERROR');
    });
});

// ── knowledgeAsTool ─────────────────────────────────────────────────────────

describe('knowledgeAsTool()', () => {
    it('queries a retrieve()-based knowledge base', async () => {
        const retrieve = vi.fn().mockResolvedValue({
            query: 'durable workflows',
            chunks: [
                { id: 'c1', content: 'personaforge supports durable workflows.', score: 0.9, metadata: { doc: 'guide' } },
            ],
        });
        const kb = { retrieve };
        const t = knowledgeAsTool({
            name: 'docs_search',
            description: 'Search docs',
            knowledge: kb,
        });

        const result = await t.execute({ query: 'durable workflows' });
        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ action: 'search', query: 'durable workflows', count: 1 });
        expect((result.data as { results: Array<{ content: string }> }).results[0].content).toBe(
            'personaforge supports durable workflows.',
        );
        expect(retrieve).toHaveBeenCalledWith('durable workflows', { limit: undefined });
    });

    it('falls back to buildContext() when retrieve() is unavailable', async () => {
        const buildContext = vi.fn().mockResolvedValue('Context: durable workflows are DB-backed.');
        const kb = { buildContext };
        const t = knowledgeAsTool({
            name: 'docs_context',
            description: 'Build docs context',
            knowledge: kb,
        });

        const result = await t.execute({ query: 'durable workflows' });
        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ action: 'search', query: 'durable workflows' });
        expect((result.data as { context: string }).context).toContain('durable workflows');
    });

    it('ingests documents via action=add', async () => {
        const ingest = vi.fn().mockResolvedValue(undefined);
        const kb = { ingest };
        const t = knowledgeAsTool({
            name: 'kb_add',
            description: 'Add to KB',
            knowledge: kb,
        });

        const result = await t.execute({
            action: 'add',
            documents: [{ content: 'New fact about agents.', metadata: { source: 'test' } }],
        });
        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ action: 'added', count: 1 });
        expect(ingest).toHaveBeenCalledWith([{ content: 'New fact about agents.', metadata: { source: 'test' } }]);
    });

    it('blocks writes when writeable is false', async () => {
        const kb = { buildContext: vi.fn().mockResolvedValue('') };
        const t = knowledgeAsTool({
            name: 'ro_kb',
            description: 'read-only kb',
            knowledge: kb,
            writeable: false,
        });

        const result = await t.execute({ action: 'add', documents: [{ content: 'x' }] });
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('read-only');
    });

    it('rejects a search with no query', async () => {
        const kb = { buildContext: vi.fn() };
        const t = knowledgeAsTool({
            name: 'kb',
            description: 'kb',
            knowledge: kb,
        });

        const result = await t.execute({ action: 'search', query: '' });
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('non-empty "query"');
    });
});

// ── promptAsTool ────────────────────────────────────────────────────────────

describe('promptAsTool()', () => {
    it('renders a registered prompt with variables', async () => {
        const registry = new PromptRegistry();
        registry.register('greet', 'Hello {{name}}, welcome to {{product}}.');

        const t = promptAsTool({
            name: 'render_greeting',
            description: 'Render greeting prompt',
            registry,
        });

        const result = await t.execute({
            name: 'greet',
            variables: { name: 'Sam', product: 'personaforge' },
        });
        expect(result.success).toBe(true);
        expect(result.data).toBe('Hello Sam, welcome to personaforge.');
    });

    it('uses defaultName when name is omitted', async () => {
        const registry = new PromptRegistry();
        registry.register('triage', 'Triage task: {{task}}');

        const t = promptAsTool({
            name: 'render_prompt',
            description: 'Render triage prompt',
            registry,
            defaultName: 'triage',
        });

        const result = await t.execute({ variables: { task: 'fix bug' } });
        expect(result.success).toBe(true);
        expect(result.data).toBe('Triage task: fix bug');
    });

    it('resolves version/label selectors through the registry', async () => {
        const registry = new PromptRegistry();
        registry.register('v', 'v1 template', { labels: ['candidate'] });
        registry.register('v', 'v2 template');

        const t = promptAsTool({
            name: 'render_v',
            description: 'render v',
            registry,
        });

        const byLabel = await t.execute({ name: 'v', label: 'candidate' });
        expect(byLabel.data).toBe('v1 template');
        const byVersion = await t.execute({ name: 'v', version: 'v2' });
        expect(byVersion.data).toBe('v2 template');
    });

    it('throws a helpful error when no prompt name resolves', async () => {
        const registry = new PromptRegistry();
        const t = promptAsTool({
            name: 'render',
            description: 'render',
            registry,
        });

        const result = await t.execute({ variables: {} });
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('no prompt name');
    });
});

// ── asTool() / toTool() dispatcher ─────────────────────────────────────────

describe('asTool() / toTool() dispatcher', () => {
    it('auto-detects a runnable agent', async () => {
        const agentLike = {
            run: vi.fn().mockResolvedValue({ text: 'hi', steps: 1 }),
        };
        const t = asTool(agentLike, {
            name: 'inner',
            description: 'Inner agent',
        });

        const result = await t.execute({ prompt: 'go' });
        expect(result.success).toBe(true);
        expect(agentLike.run).toHaveBeenCalledWith({ prompt: 'go' }, { sessionId: 'unknown' });
    });

    it('auto-detects a workflow-like target via kind hint when ambiguous', async () => {
        const wfLike = { execute: vi.fn().mockResolvedValue({ status: 'completed', results: { x: 1 } }) };
        const t = asTool(wfLike, {
            kind: 'workflow',
            name: 'wf',
            description: 'A workflow',
        });

        const result = await t.execute({ input: {} });
        expect(result.success).toBe(true);
        expect(wfLike.execute).toHaveBeenCalled();
    });

    it('auto-detects a memory store', async () => {
        const memory = new InMemoryStore();
        const t = asTool(memory, {
            name: 'memory',
            description: 'Memory tool',
        });

        const storeResult = await t.execute({ action: 'store', content: 'fact' });
        expect(storeResult.success).toBe(true);
        expect(storeResult.data).toMatchObject({ action: 'stored' });
    });

    it('auto-detects a knowledge base', async () => {
        const kb = { buildContext: vi.fn().mockResolvedValue('context text') };
        const t = asTool(kb, {
            name: 'kb',
            description: 'KB tool',
        });

        const result = await t.execute({ query: 'x' });
        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ action: 'search' });
    });

    it('auto-detects a prompt registry', async () => {
        const registry = new PromptRegistry();
        registry.register('p', 'value: {{v}}');
        const t = asTool(registry, {
            name: 'prompt',
            description: 'Prompt tool',
        });

        const result = await t.execute({ name: 'p', variables: { v: 42 } });
        expect(result.success).toBe(true);
        expect(result.data).toBe('value: 42');
    });

    it('routes pipeline targets when kind=pipeline', async () => {
        const pipeline = {
            run: vi.fn().mockResolvedValue({ text: 'pipeline output', steps: 2 }),
        };
        const t = asTool(pipeline, {
            kind: 'pipeline',
            name: 'pipe',
            description: 'A pipeline',
        });

        const result = await t.execute({ prompt: 'start' });
        expect(result.success).toBe(true);
        expect(pipeline.run).toHaveBeenCalledWith('start', { sessionId: undefined });
    });

    it('throws a helpful error for undetectable targets', () => {
        expect(() =>
            asTool({} as never, {
                name: 'x',
                description: 'x',
            }),
        ).toThrow(/cannot detect target kind/);
    });

    it('is aliased by toTool with identical behaviour', async () => {
        const agentLike = { run: vi.fn().mockResolvedValue({ text: 'ok' }) };
        const t = toTool(agentLike, { name: 'a', description: 'a' });
        const result = await t.execute({ prompt: 'go' });
        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({ text: 'ok' });
    });
});

// ── SDK surface parity ──────────────────────────────────────────────────────

describe('SDK .asTool() parity', () => {
    it('exposes a typed agent as a tool using its input schema', async () => {
        const qa = defineAgent('qa')
            .input(z.object({ q: z.string() }))
            .output(z.object({ a: z.string() }))
            .handler(async ({ q }) => ({ a: `answer:${q}` }))
            .build();

        const qaTool = qa.asTool({
            name: 'qa',
            description: 'Answer questions',
        });

        expect(qaTool.name).toBe('qa');
        const result = await qaTool.execute({ input: { q: 'hi' } });
        expect(result.success).toBe(true);
        expect((result.data as { a: string }).a).toBe('answer:hi');
    });

    it('exposes a workflow builder as a tool', async () => {
        const wf = createWorkflow();
        const wfTool = wf.asTool({
            name: 'empty_wf',
            description: 'An empty workflow',
        });

        expect(wfTool.name).toBe('empty_wf');
        const result = await wfTool.execute({ input: {} });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({});
    });

    it('exposes a built workflow as a tool', async () => {
        const built = createWorkflow().build();
        const wfTool = built.asTool({
            name: 'built_wf',
            description: 'A built workflow',
        });

        const result = await wfTool.execute({ input: {} });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({});
    });
});
