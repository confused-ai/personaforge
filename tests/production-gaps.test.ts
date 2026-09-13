/**
 * Production-gap regressions — injection, scoping, and robustness fixes.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertSelectOnly, assertIdentifier } from '../src/tools/data/sql-guard.js';
import { assertScheduleColumn, sanitizeMongoUpdate } from '../src/db/utils.js';
import { Mem0Memory } from '../src/memory/mem0.js';
import { FileStorageAdapter } from '../src/storage/index.js';
import { ThreadPool } from '../src/execution/thread-pool.js';
import { streamMerge } from '../src/models/stream-utils.js';
import type { StreamDelta } from '../src/models/stream-utils.js';
import { Neo4jCreateNodeTool } from '../src/tools/data/neo4j.js';
import { DockerCreateContainerTool } from '../src/tools/devtools/docker.js';
import { PostgreSQLQueryTool } from '../src/tools/data/database.js';
import { Mem0DeleteAllMemoriesTool } from '../src/tools/memory/mem0.js';
import { LLMCache } from '../src/providers/cache.js';
import type { ToolContext } from '../src/tools/core/types.js';

function ctx(): ToolContext {
    return {
        toolId: 'test',
        agentId: 'test',
        sessionId: 'test',
        permissions: { allowNetwork: true, allowFileSystem: true, maxExecutionTimeMs: 5000 },
    };
}

describe('sql-guard', () => {
    it('accepts plain SELECT', () => {
        expect(assertSelectOnly('SELECT * FROM t WHERE a = $1')).toContain('SELECT');
    });
    it('rejects destructive statements', () => {
        expect(() => assertSelectOnly('DELETE FROM t')).toThrow(/read-only/);
        expect(() => assertSelectOnly('DROP TABLE t')).toThrow(/read-only/);
    });
    it('rejects stacked statements and comment smuggling', () => {
        expect(() => assertSelectOnly('SELECT 1; DELETE FROM t')).toThrow(/read-only/);
        expect(() => assertSelectOnly('/* x */ DELETE FROM t')).toThrow(/read-only/);
        expect(() => assertSelectOnly('-- comment\nUPDATE t SET a=1')).toThrow(/read-only/);
    });
    it('validates identifiers', () => {
        expect(assertIdentifier('users')).toBe('users');
        expect(() => assertIdentifier('t; DROP TABLE t', 'table')).toThrow(/Invalid table/);
        expect(() => assertIdentifier('a-b', 'column')).toThrow(/Invalid column/);
    });
});

describe('db utils', () => {
    it('assertScheduleColumn allows real columns, rejects injection', () => {
        expect(assertScheduleColumn('enabled')).toBe('enabled');
        expect(() => assertScheduleColumn('enabled = 1 --')).toThrow(/Invalid schedule column/);
        expect(() => assertScheduleColumn('id')).toThrow(/Invalid schedule column/);
    });
    it('sanitizeMongoUpdate strips operators and dotted keys', () => {
        expect(sanitizeMongoUpdate({ a: 1, $set: { b: 2 }, 'c.d': 3 })).toEqual({ a: 1 });
    });
});

describe('mem0 user scoping', () => {
    it('same content for two users creates separate facts', async () => {
        const memory = new Mem0Memory({});
        const idA = await memory.add('likes dark mode', { userID: 'alice' });
        const idB = await memory.add('likes dark mode', { userID: 'bob' });
        expect(idA).not.toBe(idB);
    });
    it('search does not leak cross-user facts', async () => {
        const memory = new Mem0Memory({});
        await memory.add('alice secret phrase xyzzy', { userID: 'alice' });
        const results = await memory.search('xyzzy', { userID: 'bob' });
        expect(results).toEqual([]);
    });
});

describe('storage path containment', () => {
    it('round-trips normal keys', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'pf-storage-'));
        const store = new FileStorageAdapter(dir);
        await store.set('user:123:prefs', 'v');
        expect(await store.get('user:123:prefs')).toBe('v');
    });
    it('rejects traversal keys', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'pf-storage-'));
        const store = new FileStorageAdapter(dir);
        await expect(store.set('../escape', 'v')).rejects.toThrow(/escapes basePath/);
    });
});

describe('thread-pool registration guard', () => {
    let pool: ThreadPool | undefined;
    afterEach(async () => {
        if (pool) {
            await pool.shutdown();
            pool = undefined;
        }
    });
    it('rejects non-function registration', () => {
        pool = new ThreadPool({ size: 1 });
        expect(() => (pool as ThreadPool).register('evil()' as never)).toThrow(/requires a function/);
    });
});

describe('streamMerge failure propagation', () => {
    async function* ok(): AsyncGenerator<StreamDelta> {
        yield { text: 'a' } as StreamDelta;
    }
    async function* failing(): AsyncGenerator<StreamDelta> {
        yield { text: 'b' } as StreamDelta;
        throw new Error('source blew up');
    }
    it('drains queued deltas then surfaces the source error', async () => {
        const seen: string[] = [];
        await expect((async () => {
            for await (const d of streamMerge([ok(), failing()])) seen.push(String((d as { text: string }).text));
        })()).rejects.toThrow('source blew up');
        expect(seen.sort()).toEqual(['a', 'b']);
    });
});

describe('tool input guards (no network reached)', () => {
    it('neo4j rejects evil labels before any request', async () => {
        const tool = new Neo4jCreateNodeTool({});
        const res = await tool.execute({ labels: ['Person) MATCH (n) DETACH DELETE n //'], properties: {} }, ctx());
        expect(res.success).toBe(false);
        expect(JSON.stringify((res as { error?: unknown }).error)).toMatch(/Invalid label/);
    });
    it('docker refuses /etc/shadow subpath binds', async () => {
        const tool = new DockerCreateContainerTool({ allowHostMounts: false });
        const res = await tool.execute(
            { image: 'x', volumes: ['/etc/shadow:/shadow:ro'] } as never,
            ctx(),
        );
        expect(res.success).toBe(false);
        expect(JSON.stringify((res as { error?: unknown }).error)).toMatch(/sensitive host path/);
    });
    it('postgres query tool enforces read-only', async () => {
        const tool = new PostgreSQLQueryTool({ connectionString: 'postgres://localhost/x' });
        const res = await tool.execute({ query: 'DELETE FROM users' }, ctx());
        expect(res.success).toBe(false);
        expect(JSON.stringify((res as { error?: unknown }).error)).toMatch(/read-only/);
    });
    it('mem0 delete-all requires scope', async () => {
        const tool = new Mem0DeleteAllMemoriesTool({});
        const res = await tool.execute({}, ctx());
        expect(res.success).toBe(false);
        expect(JSON.stringify((res as { error?: unknown }).error)).toMatch(/at least one of/);
    });
});

describe('llm cache key includes tools', () => {
    it('same prompt with different tools misses', () => {
        const cache = new LLMCache({ maxEntries: 10, ttlMs: 5000 });
        const messages = [{ role: 'user', content: 'hi' }] as never;
        cache.set({ messages, tools: [{ name: 'a' }] }, { text: 'A', finishReason: 'stop' } as never);
        expect(cache.get({ messages, tools: [{ name: 'b' }] })).toBeNull();
        expect(cache.get({ messages, tools: [{ name: 'a' }] })?.text).toBe('A');
    });
});

describe('workflow chain robustness', () => {
    it('aborted runs fail with a reason instead of hanging', async () => {
        const { defineStep, defineWorkflow } = await import('../src/workflow/chain.js');
        const controller = new AbortController();
        controller.abort();
        const wf = defineWorkflow({ id: 'w' }).then(
            defineStep({ id: 'a', execute: async () => 1 }),
        );
        const res = await wf.createRun().start({ inputData: 0, abortSignal: controller.signal });
        expect(res.status).toBe('failed');
        expect(res.error).toMatch(/abort/i);
    });
    it('step throws surface the message on the result', async () => {
        const { defineStep, defineWorkflow } = await import('../src/workflow/chain.js');
        const wf = defineWorkflow({ id: 'w' }).then(
            defineStep({ id: 'boom', execute: async () => { throw new Error('kaput'); } }),
        );
        const res = await wf.createRun().start({ inputData: 0 });
        expect(res.status).toBe('failed');
        expect(res.error).toBe('kaput');
    });
});

describe('batching store backpressure', () => {
    it('caps the buffer and reports drops via onError', async () => {
        const { BatchingEventStore } = await import('../src/graph/batching-store.js');
        const errors: unknown[] = [];
        const inner = {
            append: async () => { throw new Error('store down'); },
            load: async () => [],
        };
        const batch = new BatchingEventStore(inner as never, { maxBatch: 2, onError: (e) => errors.push(e) });
        for (let i = 0; i < 40; i++) {
            await batch.append([{ type: 'x', i } as never]);
        }
        expect(errors.some((e) => String((e as Error).message).includes('dropped'))).toBe(true);
    });
});

describe('team and checkpoint edges', () => {
    it('createModeTeam rejects empty agent lists', async () => {
        const { createModeTeam } = await import('../src/orchestration/team-modes.js');
        expect(() => createModeTeam({ mode: 'debate', agents: [] })).toThrow(/at least one agent/);
    });
    it('checkpoint resume(undefined) still resumes', async () => {
        const { DurableExecutor } = await import('../src/checkpoint/index.js');
        const exec = new DurableExecutor({
            nodes: [
                ['ask', ((input: unknown, ctx: { interrupt: (p: unknown) => unknown }) => ({ input, v: ctx.interrupt('q') })) as never],
                ['fin', ((d: unknown) => ({ ...(d as object), done: true })) as never],
            ],
        });
        const r1 = await exec.run('req');
        expect(r1.interrupted).toBe(true);
        const r2 = await exec.resume(r1.threadId, undefined);
        expect(r2.interrupted).toBe(false);
        expect(r2.output).toEqual({ input: 'req', v: undefined, done: true });
    });
});

describe('engine persistence hook', () => {
    it('surfaces event-store failures via onPersistenceError', async () => {
        const { createGraph, DAGEngine } = await import('../src/graph/index.js');
        const seen: unknown[] = [];
        const graph = createGraph('t')
            .addNode('a', { kind: 'task', execute: async () => 'done' })
            .build();
        const engine = new DAGEngine(graph);
        await engine.execute({
            eventStore: {
                append: async () => { throw new Error('store down'); },
                load: async () => [],
                loadAfter: async () => [],
                getCheckpoint: async () => null,
                saveCheckpoint: async () => undefined,
            } as never,
            onPersistenceError: (e) => seen.push(e),
        });
        // Flush the non-blocking append.
        await new Promise((r) => setTimeout(r, 20));
        expect(seen.length).toBeGreaterThan(0);
    });
});
