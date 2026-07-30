/**
 * Hermetic coverage for src/test-utils/conformance.ts via BYOTR + in-memory mocks.
 * tests include glob: tests/coverage-remaining-*.test.ts
 */
import { describe, it, expect } from 'vitest';
import {
    runSessionStoreConformance,
    runMemoryStoreConformance,
    runProviderConformance,
    runVectorStoreConformance,
    runToolConformance,
    runKVStoreConformance,
    type VectorStoreAdapter,
    type KVStoreLike,
} from '../src/test-utils/conformance.js';
import { InMemorySessionStore } from '../src/session/in-memory.js';
import type { MemoryEntry, MemoryStore, Message, Tool } from '../src/contracts/index.js';

const runner = { describe, it, expect };

runSessionStoreConformance(() => new InMemorySessionStore(), runner);

describe('MemoryStore conformance (inline mock)', () => {
    function makeMem(): MemoryStore {
        const map = new Map<string, MemoryEntry>();
        return {
            async store(entry) {
                const full: MemoryEntry = {
                    id: crypto.randomUUID(),
                    content: entry.content,
                    metadata: entry.metadata ?? {},
                    createdAt: Date.now(),
                    ...(entry.type !== undefined && { type: entry.type }),
                    ...(entry.embedding !== undefined && { embedding: entry.embedding }),
                };
                map.set(full.id, full);
                return full;
            },
            async get(id) {
                return map.get(id) ?? null;
            },
            async update(id, updates) {
                const cur = map.get(id);
                if (!cur) throw new Error('missing');
                const next = { ...cur, ...updates, id: cur.id, createdAt: cur.createdAt };
                map.set(id, next);
                return next;
            },
            async delete(id) {
                return map.delete(id);
            },
            async clear() {
                map.clear();
            },
            async getRecent(limit) {
                return [...map.values()].slice(-limit).reverse();
            },
            async retrieve() {
                return [...map.values()].map((entry) => ({ entry, score: 1 }));
            },
        };
    }
    runMemoryStoreConformance(() => makeMem(), runner);
});

runProviderConformance(
    () => ({
        async generateText(_msgs: Message[]) {
            return { text: 'PONG', finishReason: 'stop' as const };
        },
        async streamText(_msgs: Message[]) {
            return { text: 'PONG', finishReason: 'stop' as const };
        },
    }),
    runner,
);

describe('VectorStoreAdapter conformance (inline mock)', () => {
    function makeVec(): VectorStoreAdapter {
        const items = new Map<string, { id: string; vector: number[]; metadata: Record<string, unknown> }>();
        const cos = (a: number[], b: number[]) => {
            let dot = 0;
            let na = 0;
            let nb = 0;
            for (let i = 0; i < a.length; i++) {
                dot += (a[i] ?? 0) * (b[i] ?? 0);
                na += (a[i] ?? 0) ** 2;
                nb += (b[i] ?? 0) ** 2;
            }
            return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
        };
        return {
            async upsert(vectors) {
                for (const v of vectors) items.set(v.id, v);
            },
            async search(query, limit, filter) {
                let rows = [...items.values()];
                if (filter) {
                    rows = rows.filter((r) =>
                        Object.entries(filter).every(([k, v]) => r.metadata[k] === v),
                    );
                }
                return rows
                    .map((r) => ({ id: r.id, score: cos(query, r.vector), metadata: r.metadata }))
                    .sort((a, b) => b.score - a.score)
                    .slice(0, limit);
            },
            async get(id) {
                return items.get(id) ?? null;
            },
            async delete(ids) {
                for (const id of ids) items.delete(id);
            },
            async clear() {
                items.clear();
            },
        };
    }
    runVectorStoreConformance(() => makeVec(), runner);
});

runToolConformance(
    (): Tool => ({
        name: 'echo',
        description: 'echoes input',
        parameters: { type: 'object', properties: { x: { type: 'string' } } },
        async execute(input) {
            return input;
        },
    }),
    { x: 'hi' },
    runner,
);

describe('KVStore conformance (inline mock)', () => {
    function makeKv(): KVStoreLike {
        const map = new Map<string, unknown>();
        return {
            async get(key) {
                return map.has(key) ? map.get(key) : undefined;
            },
            async set(key, value) {
                map.set(key, value);
            },
            async delete(key) {
                return map.delete(key);
            },
            async has(key) {
                return map.has(key);
            },
            async keys(prefix) {
                const all = [...map.keys()];
                return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
            },
            async clear() {
                map.clear();
            },
        };
    }
    runKVStoreConformance(() => makeKv(), runner);
});
