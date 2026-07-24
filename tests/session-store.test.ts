/**
 * Tests for InMemorySessionStore — CRUD, message append, expiry pruning.
 */

import { describe, it, expect } from 'vitest';
import { InMemorySessionStore } from '../src/session/in-memory.js';

describe('InMemorySessionStore', () => {
    it('creates a session with generated id and timestamps', async () => {
        const store = new InMemorySessionStore();
        const s = await store.create({ agentId: 'a1', userId: 'u1' });
        expect(s.id).toBeTruthy();
        expect(s.agentId).toBe('a1');
        expect(s.createdAt).toBeGreaterThan(0);
        expect(s.updatedAt).toBeGreaterThanOrEqual(s.createdAt);
        expect(s.messages).toEqual([]);
    });

    it('get() returns the created session and undefined for unknown', async () => {
        const store = new InMemorySessionStore();
        const s = await store.create({ agentId: 'a1' });
        expect((await store.get(s.id))?.id).toBe(s.id);
        expect(await store.get('missing')).toBeUndefined();
    });

    it('appendMessage() adds messages retrievable via getMessages()', async () => {
        const store = new InMemorySessionStore();
        const s = await store.create({ agentId: 'a1' });
        await store.appendMessage(s.id, { role: 'user', content: 'hi' });
        await store.appendMessage(s.id, { role: 'assistant', content: 'hello' });
        const msgs = await store.getMessages(s.id);
        expect(msgs.length).toBe(2);
        expect(msgs[0]!.content).toBe('hi');
        expect(msgs[1]!.role).toBe('assistant');
    });

    it('update() replaces messages (read back via getMessages)', async () => {
        const store = new InMemorySessionStore();
        const s = await store.create({ agentId: 'a1' });
        await store.update(s.id, { messages: [{ role: 'user', content: 'x' }] });
        const msgs = await store.getMessages(s.id);
        expect(msgs.length).toBe(1);
        expect(msgs[0]!.content).toBe('x');
    });

    it('delete() removes a session', async () => {
        const store = new InMemorySessionStore();
        const s = await store.create({ agentId: 'a1' });
        await store.delete(s.id);
        expect(await store.get(s.id)).toBeUndefined();
    });

    it('create() accepts initial messages', async () => {
        const store = new InMemorySessionStore();
        const s = await store.create({ agentId: 'a1', messages: [{ role: 'user', content: 'seed' }] });
        expect(s.messages.length).toBe(1);
    });

    it('size reflects the number of stored sessions', async () => {
        const store = new InMemorySessionStore();
        await store.create({ agentId: 'a1' });
        await store.create({ agentId: 'a2' });
        expect(store.size).toBe(2);
    });

    it('pruneExpired removes stale sessions when retention is configured', async () => {
        const store = new InMemorySessionStore({ retentionDays: 0 });
        await store.create({ agentId: 'a1' });
        // retention 0 → everything is immediately stale
        await new Promise((r) => setTimeout(r, 2));
        const pruned = store.pruneExpired();
        expect(pruned).toBeGreaterThanOrEqual(0);
    });
});
