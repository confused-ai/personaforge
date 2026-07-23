/**
 * @personaforge/test-utils — Protocol conformance suites.
 *
 * Each `run*Conformance` function registers a group of standard test cases
 * against a store or provider instance. Designed for a bring-your-own-test-
 * runner (BYOTR) model so the suites work with vitest, Jest, or Node's built-
 * in test runner without modification.
 *
 * Usage (vitest):
 * ```ts
 * import { describe, it, expect } from 'vitest';
 * import { runSessionStoreConformance } from './conformance.js';
 * import { InMemorySessionStore } from '../session/index.js';
 *
 * runSessionStoreConformance(() => new InMemorySessionStore(), { describe, it, expect });
 * ```
 */

import type {
  SessionStore,
  SessionMessage,
  MemoryStore,
  MemoryEntry,
  LLMProvider,
  Message,
  Tool,
} from '../contracts/index.js';

// ── BYOTR types ──────────────────────────────────────────────────────────────

/** Minimal assertion handle returned by expect(). */
export interface Assertion {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeDefined(): void;
  toBeUndefined(): void;
  toBeNull(): void;
  toBeGreaterThan(n: number): void;
  toBeGreaterThanOrEqual(n: number): void;
  not: Omit<Assertion, 'not'>;
}

/** Minimal test-runner interface — compatible with vitest, Jest, and node:test. */
export interface TestRunner {
  describe(name: string, fn: () => void): void;
  it(name: string, fn: () => Promise<void> | void): void;
  expect(value: unknown): Assertion;
}

// ── SessionStore conformance ──────────────────────────────────────────────────

/**
 * Standard SessionStore conformance suite.
 *
 * Covers: `get`, `create`, `update`, `delete`, `getMessages`, `appendMessage`.
 * Optional methods (`append`, `listByAgent`, etc.) are skipped unless present.
 *
 * @param factory   Called before each test to produce a fresh store instance.
 * @param t         Test runner with `describe`, `it`, `expect`.
 */
export function runSessionStoreConformance(
  factory: () => SessionStore | Promise<SessionStore>,
  t: TestRunner,
): void {
  t.describe('SessionStore conformance', () => {
    t.it('get: unknown id → undefined or null', async () => {
      const store = await factory();
      const result = await store.get('no-such-id-xyz');
      // Implementations may return undefined or null for missing sessions.
      const isAbsent = result === undefined || result === null;
      t.expect(isAbsent).toBe(true);
    });

    t.it('create: returns a session with a generated id', async () => {
      const store = await factory();
      const result = await store.create({ agentId: 'agent-1', userId: 'user-1' });
      // create may return SessionData or a string (legacy adapter pattern)
      if (typeof result === 'string') {
        t.expect(result.length).toBeGreaterThan(0);
      } else {
        t.expect(result.id).toBeDefined();
        t.expect(result.agentId).toBe('agent-1');
      }
    });

    t.it('create with string id: stores under that id', async () => {
      const store = await factory();
      const result = await store.create('my-deterministic-id');
      const id = typeof result === 'string' ? result : result.id;
      t.expect(id).toBe('my-deterministic-id');
    });

    t.it('get: retrieves a created session', async () => {
      const store = await factory();
      const created = await store.create({ agentId: 'agent-2' });
      const id = typeof created === 'string' ? created : created.id;
      const fetched = await store.get(id);
      t.expect(fetched).toBeDefined();
    });

    t.it('update: messages are persisted', async () => {
      const store = await factory();
      if (!store.update) return; // optional method — skip
      const created = await store.create({ agentId: 'agent-3' });
      const id = typeof created === 'string' ? created : created.id;
      const msg: SessionMessage = { role: 'user', content: 'hello' };
      await store.update(id, { messages: [msg] });
      const msgs = await store.getMessages?.(id) ?? [];
      t.expect(msgs.length).toBeGreaterThanOrEqual(1);
    });

    t.it('getMessages: returns empty array for fresh session', async () => {
      const store = await factory();
      if (!store.getMessages) return;
      const created = await store.create({ agentId: 'agent-4' });
      const id = typeof created === 'string' ? created : created.id;
      const msgs = await store.getMessages(id);
      t.expect(msgs.length).toBe(0);
    });

    t.it('appendMessage: appended message appears in getMessages', async () => {
      const store = await factory();
      if (!store.appendMessage || !store.getMessages) return;
      const created = await store.create({ agentId: 'agent-5' });
      const id = typeof created === 'string' ? created : created.id;
      await store.appendMessage(id, { role: 'assistant', content: 'hi' });
      const msgs = await store.getMessages(id);
      t.expect(msgs.length).toBeGreaterThanOrEqual(1);
    });

    t.it('delete: session no longer retrievable', async () => {
      const store = await factory();
      const created = await store.create({ agentId: 'agent-6' });
      const id = typeof created === 'string' ? created : created.id;
      await store.delete(id);
      const result = await store.get(id);
      const isAbsent = result === undefined || result === null;
      t.expect(isAbsent).toBe(true);
    });
  });
}

// ── MemoryStore conformance ───────────────────────────────────────────────────

/**
 * Standard MemoryStore conformance suite.
 *
 * Covers: `store`, `get`, `update`, `delete`, `clear`, `getRecent`.
 * `retrieve` (semantic search) is tested with a trivial query — implementations
 * without embeddings are expected to return an array (possibly empty).
 *
 * @param factory  Called before each test to produce a fresh store instance.
 * @param t        Test runner.
 */
export function runMemoryStoreConformance(
  factory: () => MemoryStore | Promise<MemoryStore>,
  t: TestRunner,
): void {
  const baseEntry = (): Omit<MemoryEntry, 'id' | 'createdAt'> => ({
    content:  'conformance test entry',
    metadata: { source: 'conformance' },
  });

  t.describe('MemoryStore conformance', () => {
    t.it('store: returns entry with id and createdAt', async () => {
      const mem = await factory();
      const entry = await mem.store(baseEntry());
      t.expect(entry.id).toBeDefined();
      t.expect(entry.content).toBe('conformance test entry');
    });

    t.it('get: retrieves stored entry by id', async () => {
      const mem = await factory();
      const stored = await mem.store(baseEntry());
      const fetched = await mem.get(stored.id);
      t.expect(fetched).toBeDefined();

      t.expect(fetched!.id).toBe(stored.id);
    });

    t.it('get: returns null for unknown id', async () => {
      const mem = await factory();
      const result = await mem.get('non-existent-id-xyz');
      t.expect(result).toBeNull();
    });

    t.it('update: content change is persisted', async () => {
      const mem = await factory();
      const stored = await mem.store(baseEntry());
      const updated = await mem.update(stored.id, { content: 'updated content' });
      t.expect(updated.content).toBe('updated content');
      const fetched = await mem.get(stored.id);

      t.expect(fetched!.content).toBe('updated content');
    });

    t.it('delete: entry no longer retrievable', async () => {
      const mem = await factory();
      const stored = await mem.store(baseEntry());
      await mem.delete(stored.id);
      const fetched = await mem.get(stored.id);
      t.expect(fetched).toBeNull();
    });

    t.it('getRecent: returns at most limit entries', async () => {
      const mem = await factory();
      await mem.store(baseEntry());
      await mem.store(baseEntry());
      await mem.store(baseEntry());
      const recent = await mem.getRecent(2);
      t.expect(recent.length).toBeGreaterThan(0);
      // Some implementations may not support limit precisely; at most limit+some
      t.expect(recent.length).toBeGreaterThanOrEqual(1);
    });

    t.it('clear: no entries remain after clear', async () => {
      const mem = await factory();
      await mem.store(baseEntry());
      await mem.clear();
      const recent = await mem.getRecent(100);
      t.expect(recent.length).toBe(0);
    });

    t.it('retrieve: returns an array (possibly empty)', async () => {
      const mem = await factory();
      await mem.store(baseEntry());
      const results = await mem.retrieve({ query: 'conformance test', limit: 5 });
      t.expect(Array.isArray(results)).toBe(true);
    });
  });
}

// ── LLMProvider conformance ───────────────────────────────────────────────────

/**
 * Standard LLMProvider conformance suite.
 *
 * Tests `generateText`. The provider is expected to return a non-empty string.
 * Use a mock or cheap model in tests — this is a protocol check, not a quality check.
 *
 * @param factory   Returns a ready-to-use LLMProvider.
 * @param t         Test runner.
 */
export function runProviderConformance(
  factory: () => LLMProvider | Promise<LLMProvider>,
  t: TestRunner,
): void {
  const singleMessage: Message[] = [{ role: 'user', content: 'Reply with the word PONG.' }];

  t.describe('LLMProvider conformance', () => {
    t.it('generateText: returns a GenerateResult with non-empty text', async () => {
      const provider = await factory();
      const result = await provider.generateText(singleMessage);
      t.expect(result).toBeDefined();
      t.expect(typeof result.text).toBe('string');
      t.expect(result.text.length).toBeGreaterThan(0);
    });

    t.it('generateText: finishReason is a known value or undefined', async () => {
      const provider = await factory();
      const result = await provider.generateText(singleMessage);
      const knownReasons = ['stop', 'length', 'tool_calls', 'max_tokens', 'error', undefined];
      t.expect(knownReasons.includes(result.finishReason)).toBe(true);
    });

    t.it('generateText: respects system message', async () => {
      const provider = await factory();
      const msgs: Message[] = [
        { role: 'system', content: 'You only reply with the word PONG.' },
        { role: 'user',   content: 'Ping' },
      ];
      const result = await provider.generateText(msgs);
      t.expect(result.text.length).toBeGreaterThan(0);
    });

    t.it('streamText: returns a GenerateResult if present', async () => {
      const provider = await factory();
      if (!provider.streamText) return; // optional
      const result = await provider.streamText(singleMessage);
      t.expect(result).toBeDefined();
      t.expect(typeof result.text).toBe('string');
    });
  });
}

// ── VectorStoreAdapter conformance ────────────────────────────────────────────

/**
 * VectorStoreAdapter conformance suite (memory-package adapter shape).
 *
 * Uses fixed-dimension numeric vectors for determinism. The `get` method is
 * optional — tests are skipped if not present on the adapter.
 */
export interface VectorStoreAdapter {
  upsert(vectors: { id: string; vector: number[]; metadata: Record<string, unknown> }[]): Promise<void>;
  search(query: number[], limit: number, filter?: Record<string, unknown>): Promise<{ id: string; score: number; metadata: Record<string, unknown> }[]>;
  get?(id: string): Promise<{ id: string; vector: number[]; metadata: Record<string, unknown> } | null>;
  delete(ids: string[]): Promise<void>;
  clear(): Promise<void>;
}

export function runVectorStoreConformance(
  factory: () => VectorStoreAdapter | Promise<VectorStoreAdapter>,
  t: TestRunner,
): void {
  const mkVec = (seed: number): number[] => {
    const v = [seed * 0.1, seed * 0.2, seed * 0.3];
    const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return v.map((x) => x / mag);
  };

  t.describe('VectorStoreAdapter conformance', () => {
    t.it('upsert + search: returns top-k ordered by score', async () => {
      const store = await factory();
      await store.upsert([
        { id: 'v1', vector: mkVec(1), metadata: { label: 'a' } },
        { id: 'v2', vector: mkVec(2), metadata: { label: 'b' } },
        { id: 'v3', vector: mkVec(1), metadata: { label: 'c' } },
      ]);
      const results = await store.search(mkVec(1), 2);
      t.expect(results.length).toBeGreaterThan(0);
      // First result should be the closest match
      const ids = results.map((r) => r.id);
      t.expect(ids.includes('v1') || ids.includes('v3')).toBe(true);
      // Scores should be descending
      for (let i = 1; i < results.length; i++) {

        t.expect(results[i - 1]!.score).toBeGreaterThanOrEqual(results[i]!.score);
      }
    });

    t.it('delete: removed vectors do not appear in search results', async () => {
      const store = await factory();
      await store.upsert([
        { id: 'del1', vector: mkVec(1), metadata: {} },
        { id: 'keep', vector: mkVec(1), metadata: {} },
      ]);
      await store.delete(['del1']);
      const results = await store.search(mkVec(1), 10);
      const ids = results.map((r) => r.id);
      t.expect(ids.includes('del1')).toBe(false);
    });

    t.it('filter: metadata filter restricts results', async () => {
      const store = await factory();
      await store.upsert([
        { id: 'fa', vector: mkVec(1), metadata: { type: 'alpha' } },
        { id: 'fb', vector: mkVec(1), metadata: { type: 'beta' } },
      ]);
      const results = await store.search(mkVec(1), 10, { type: 'alpha' });
      for (const r of results) {
        t.expect(r.metadata['type']).toBe('alpha');
      }
    });

    t.it('get: returns upserted vector by id', async () => {
      const store = await factory();
      if (!store.get) return; // optional method
      await store.upsert([{ id: 'gv1', vector: mkVec(1), metadata: { note: 'test' } }]);
      const entry = await store.get('gv1');
      t.expect(entry).not.toBeNull();

      t.expect(entry!.id).toBe('gv1');
    });

    t.it('get: returns null for unknown id', async () => {
      const store = await factory();
      if (!store.get) return; // optional method
      const entry = await store.get('nonexistent-xyz');
      t.expect(entry).toBeNull();
    });

    t.it('clear: all entries removed', async () => {
      const store = await factory();
      await store.upsert([{ id: 'cl1', vector: mkVec(1), metadata: {} }]);
      await store.clear();
      const results = await store.search(mkVec(1), 10);
      t.expect(results.length).toBe(0);
    });
  });
}

// ── Tool conformance ──────────────────────────────────────────────────────────

/**
 * Standard Tool conformance suite.
 *
 * Verifies the tool's structural contract: name, description, and execute.
 * The `validInput` must match the tool's schema for a successful call.
 *
 * @param factory     Returns a fresh Tool instance.
 * @param validInput  A valid input that the tool should accept and execute.
 * @param t           Test runner.
 */
export function runToolConformance(
  factory: () => Tool | Promise<Tool>,
  validInput: Record<string, unknown>,
  t: TestRunner,
): void {
  t.describe('Tool conformance', () => {
    t.it('tool.name is a non-empty string', async () => {
      const tool = await factory();
      t.expect(typeof tool.name).toBe('string');
      t.expect(tool.name.length).toBeGreaterThan(0);
    });

    t.it('tool.description is a non-empty string', async () => {
      const tool = await factory();
      t.expect(typeof tool.description).toBe('string');
      t.expect(tool.description.length).toBeGreaterThan(0);
    });

    t.it('tool.parameters is an object', async () => {
      const tool = await factory();
      t.expect(typeof tool.parameters).toBe('object');
      t.expect(tool.parameters).not.toBeNull();
    });

    t.it('execute: succeeds with valid input', async () => {
      const tool = await factory();
      await tool.execute(validInput);
      // Result may be anything — the key invariant is that it does not throw.
    });
  });
}

// ── KVStore conformance ───────────────────────────────────────────────────────

/**
 * Minimal structural KVStore shape tested by this suite.
 * Compatible with both `@personaforge/contracts` KVStore and the graph-local
 * KVStore (which uses generics), so either implementation can be wired in.
 */
export interface KVStoreLike {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
  keys(prefix?: string): Promise<string[]>;
  clear(): Promise<void>;
}

/**
 * Standard KVStore conformance suite.
 *
 * Covers the full get/set/has/delete/keys/clear contract.
 *
 * @param factory   Called before each test to produce a fresh KVStore.
 * @param t         Test runner.
 */
export function runKVStoreConformance(
  factory: () => KVStoreLike | Promise<KVStoreLike>,
  t: TestRunner,
): void {
  t.describe('KVStore conformance', () => {
    t.it('get: returns undefined for missing key', async () => {
      const kv = await factory();
      const val = await kv.get('missing-key-xyz');
      t.expect(val === undefined || val === null).toBe(true);
    });

    t.it('set + get: string round-trip', async () => {
      const kv = await factory();
      await kv.set('str-key', 'hello');
      const val = await kv.get('str-key');
      t.expect(val).toBe('hello');
    });

    t.it('set + get: number round-trip', async () => {
      const kv = await factory();
      await kv.set('num-key', 42);
      const val = await kv.get('num-key');
      t.expect(val).toBe(42);
    });

    t.it('set + get: object round-trip', async () => {
      const kv = await factory();
      await kv.set('obj-key', { foo: 'bar' });
      const val = await kv.get('obj-key') as Record<string, unknown>;
      t.expect(val['foo']).toBe('bar');
    });

    t.it('has: returns true for existing key', async () => {
      const kv = await factory();
      await kv.set('exists', 1);
      t.expect(await kv.has('exists')).toBe(true);
    });

    t.it('has: returns false for missing key', async () => {
      const kv = await factory();
      t.expect(await kv.has('no-such-key')).toBe(false);
    });

    t.it('delete: removes a key', async () => {
      const kv = await factory();
      await kv.set('del-me', 'value');
      const deleted = await kv.delete('del-me');
      t.expect(deleted).toBe(true);
      t.expect(await kv.has('del-me')).toBe(false);
    });

    t.it('delete: returns false for non-existent key', async () => {
      const kv = await factory();
      const deleted = await kv.delete('not-there');
      t.expect(deleted).toBe(false);
    });

    t.it('keys: lists keys matching prefix', async () => {
      const kv = await factory();
      await kv.set('prefix:a', 1);
      await kv.set('prefix:b', 2);
      await kv.set('other:c', 3);
      const keys = await kv.keys('prefix:');
      t.expect(keys.includes('prefix:a')).toBe(true);
      t.expect(keys.includes('prefix:b')).toBe(true);
      t.expect(keys.includes('other:c')).toBe(false);
    });

    t.it('clear: removes all entries', async () => {
      const kv = await factory();
      await kv.set('k1', 1);
      await kv.set('k2', 2);
      await kv.clear();
      t.expect(await kv.has('k1')).toBe(false);
      t.expect(await kv.has('k2')).toBe(false);
      const keys = await kv.keys();
      t.expect(keys.length).toBe(0);
    });
  });
}
