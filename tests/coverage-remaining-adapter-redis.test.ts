/**
 * Hermetic coverage for src/adapter-redis/* with in-memory fake redis clients.
 * tests include glob: tests/coverage-remaining-*.test.ts
 */
import { describe, it, expect } from 'vitest';
import { RedisSessionStore, type RedisClientLike } from '../src/adapter-redis/session-store.js';
import { RedisRateLimiter, RateLimitError } from '../src/adapter-redis/rate-limiter.js';
import { RedisEventStore } from '../src/adapter-redis/event-store.js';

class FakeRedis implements RedisClientLike {
    hashes = new Map<string, Record<string, string>>();
    lists = new Map<string, string[]>();
    ttls = new Map<string, number>();

    async hSet(key: string, fieldOrObj: string | Record<string, string>, value?: string): Promise<number> {
        const h = this.hashes.get(key) ?? {};
        if (typeof fieldOrObj === 'object') {
            Object.assign(h, fieldOrObj);
        } else {
            h[fieldOrObj] = value ?? '';
        }
        this.hashes.set(key, h);
        return 1;
    }
    async hGetAll(key: string): Promise<Record<string, string>> {
        return { ...(this.hashes.get(key) ?? {}) };
    }
    async rPush(key: string, ...values: string[]): Promise<number> {
        const list = this.lists.get(key) ?? [];
        list.push(...values);
        this.lists.set(key, list);
        return list.length;
    }
    async lRange(key: string, start: number, stop: number): Promise<string[]> {
        const list = this.lists.get(key) ?? [];
        const end = stop < 0 ? list.length : stop + 1;
        return list.slice(start, end);
    }
    async del(...keys: string[]): Promise<number> {
        let n = 0;
        for (const k of keys) {
            if (this.hashes.delete(k)) n++;
            if (this.lists.delete(k)) n++;
        }
        return n;
    }
    async expire(key: string, seconds: number): Promise<number> {
        this.ttls.set(key, seconds);
        return 1;
    }
    async scan(cursor: number, options?: { MATCH?: string; COUNT?: number }) {
        const match = (options?.MATCH ?? '*').replace(/\*/g, '');
        const keys = [...this.hashes.keys()].filter((k) => k.includes(match) || match === '');
        if (cursor !== 0) return { cursor: 0, keys: [] };
        return { cursor: 0, keys };
    }
    multi() {
        const ops: Array<() => void> = [];
        const api = {
            del: (...keys: string[]) => {
                ops.push(() => {
                    void this.del(...keys);
                });
                return api;
            },
            exec: async () => {
                for (const op of ops) op();
                return [];
            },
        };
        return api;
    }
    // optional lTrim for maxMessages
    async lTrim(key: string, start: number, stop: number): Promise<string> {
        const list = this.lists.get(key) ?? [];
        const sliced = list.slice(start < 0 ? list.length + start : start, stop < 0 ? undefined : stop + 1);
        this.lists.set(key, sliced);
        return 'OK';
    }
}

describe('RedisSessionStore', () => {
    it('create/get/append/listByUser/touch/delete', async () => {
        const client = new FakeRedis();
        const store = new RedisSessionStore({
            client,
            ttlSeconds: 60,
            keyPrefix: 't:',
            maxMessages: 2,
        });

        const created = await store.create({
            agentId: 'a1',
            userId: 'u1',
            messages: [{ role: 'user', content: 'hi' }],
        });
        expect(typeof created === 'object' ? created.id : created).toBeTruthy();
        const id = typeof created === 'string' ? created : created.id;

        const got = await store.get(id);
        expect(got?.messages.length).toBe(1);

        await store.append(id, [
            { role: 'assistant', content: 'yo' },
            { role: 'user', content: 'again' },
        ]);
        const got2 = await store.get(id);
        expect(got2!.messages.length).toBeGreaterThanOrEqual(2);

        const listed = await store.listByUser('u1');
        expect(listed.some((s) => s.id === id)).toBe(true);

        await store.touch(id, 30);
        expect(client.ttls.get(`t:${id}`)).toBe(30);

        const legacy = await store.create('legacy-user');
        expect(typeof legacy).toBe('string');

        expect(await store.get('missing')).toBeNull();
        await store.delete(id);
        expect(await store.get(id)).toBeNull();
    });
});

describe('RedisRateLimiter', () => {
    it('tryAcquire/execute and RateLimitError', async () => {
        let calls = 0;
        const client = {
            eval: async () => {
                calls++;
                return calls <= 2 ? 1 : 0;
            },
        };
        const limiter = new RedisRateLimiter({
            client,
            name: 'api',
            maxRequests: 2,
            windowMs: 1000,
            keyPrefix: 'rl:',
        });
        expect(await limiter.tryAcquire('u1')).toBe(true);
        expect(await limiter.tryAcquire('u1')).toBe(true);
        expect(await limiter.tryAcquire('u1')).toBe(false);

        calls = 0;
        await expect(limiter.execute(async () => 42, 'u2')).resolves.toBe(42);
        calls = 10;
        await expect(limiter.execute(async () => 1, 'u2')).rejects.toBeInstanceOf(RateLimitError);
        const err = new RateLimitError('api', 1000);
        expect(err.name).toBe('RateLimitError');
        expect(err.message).toContain('api');
    });
});

describe('RedisEventStore', () => {
    it('append/getEvents/deleteEvents', async () => {
        const client = new FakeRedis();
        const store = new RedisEventStore({ client, keyPrefix: 'ev:', ttlSeconds: 10 });
        const e1 = await store.append('wf1', { type: 'start', data: { a: 1 } } as any);
        expect(e1.id).toBeTruthy();
        expect(e1.timestamp).toBeGreaterThan(0);
        await store.append('wf1', { type: 'end', data: {} } as any);
        // corrupt one entry
        await client.rPush('ev:wf1', '{bad');
        const events = await store.getEvents('wf1');
        expect(events.length).toBe(2);
        await store.deleteEvents('wf1');
        expect(await store.getEvents('wf1')).toEqual([]);
    });
});
