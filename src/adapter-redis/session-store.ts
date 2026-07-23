/**
 * RedisSessionStore — persistent session store backed by Redis.
 *
 * Implements the `SessionStore` interface from `@personaforge/contracts`.
 * Uses `redis` (node-redis v4) as the client.
 *
 * Design:
 * - Sessions stored as Redis hashes (`ca:sess:{id}`) — fast field access.
 * - Message lists stored in Redis lists (`ca:sess:msgs:{id}`) via RPUSH.
 * - Every write refreshes the hash TTL so active sessions never expire.
 * - `listByUser` uses SCAN to avoid blocking the Redis event loop.
 * - `delete` removes hash + message list atomically via a multi/exec pipeline.
 * - `touch` explicitly refreshes TTL for idle-keepalive patterns.
 *
 * @example
 * ```ts
 * import { createClient } from 'redis';
 * import { RedisSessionStore } from './index.js';
 *
 * const redis = createClient({ url: process.env.REDIS_URL });
 * await redis.connect();
 *
 * const sessions = new RedisSessionStore({ client: redis });
 * const agent = createAgent({ model: '...', sessionStore: sessions });
 * ```
 */

import type { SessionStore, SessionData, SessionMessage } from '../contracts/index.js';
import { newId } from '../contracts/index.js';

// ── Minimal Redis client interface (avoids importing redis types at compile time) ──
export interface RedisClientLike {
    hSet(key: string, field: string, value: string): Promise<number>;
    hGetAll(key: string): Promise<Record<string, string>>;
    rPush(key: string, ...values: string[]): Promise<number>;
    lRange(key: string, start: number, stop: number): Promise<string[]>;
    del(...keys: string[]): Promise<number>;
    expire(key: string, seconds: number): Promise<boolean | number>;
    scan(cursor: number, options?: { MATCH?: string; COUNT?: number }): Promise<{ cursor: number; keys: string[] }>;
    multi(): RedisMultiLike;
}

export interface RedisMultiLike {
    del(...keys: string[]): this;
    exec(): Promise<Array<unknown> | null>;
}

export interface RedisSessionStoreConfig {
    /** Pre-connected redis v4 client. */
    readonly client: RedisClientLike;
    /** Session TTL in seconds. Default: 86400 (24 h). */
    readonly ttlSeconds?: number;
    /** Key prefix. Default: `ca:sess:`. */
    readonly keyPrefix?: string;
    /** Max messages retained per session. 0 = unlimited. Default: 0. */
    readonly maxMessages?: number;
}

const DEFAULT_TTL = 86_400; // 24 h
const DEFAULT_PREFIX = 'ca:sess:';

export class RedisSessionStore implements SessionStore {
    private readonly client: RedisClientLike;
    private readonly ttl: number;
    private readonly prefix: string;
    private readonly maxMessages: number;

    constructor(config: RedisSessionStoreConfig) {
        this.client = config.client;
        this.ttl = config.ttlSeconds ?? DEFAULT_TTL;
        this.prefix = config.keyPrefix ?? DEFAULT_PREFIX;
        this.maxMessages = config.maxMessages ?? 0;
    }

    private sessKey(id: string): string { return `${this.prefix}${id}`; }
    private msgsKey(id: string): string { return `${this.prefix}msgs:${id}`; }

    async create(data: { agentId: string; userId?: string; messages?: SessionMessage[] } | string): Promise<SessionData | string> {
        // Support both object pattern and legacy string (userId) pattern
        const userId = typeof data === 'string' ? data : (data.userId ?? '');
        const agentId = typeof data === 'string' ? undefined : data.agentId;
        const initialMessages: SessionMessage[] = typeof data === 'string' ? [] : (data.messages ?? []);
        const id = newId('sess');
        const now = Date.now();
        await (this.client.hSet as unknown as (key: string, fields: Record<string, string>) => Promise<number>)(
            this.sessKey(id),
            {
                id,
                ...(userId && { userId }),
                ...(agentId && { agentId }),
                metadata: JSON.stringify({}),
                createdAt: String(now),
                updatedAt: String(now),
            },
        );
        await this.client.expire(this.sessKey(id), this.ttl);
        if (initialMessages.length > 0) {
            await this.append(id, initialMessages);
        }
        // Legacy string callers get back a string ID; object callers get SessionData
        if (typeof data === 'string') {
            return id;
        }
        return {
            id,
            agentId,
            userId: userId || undefined,
            messages: initialMessages,
            metadata: {},
            createdAt: now,
            updatedAt: now,
        };
    }

    async get(sessionId: string): Promise<SessionData | null> {
        const hash = await this.client.hGetAll(this.sessKey(sessionId));
        if (Object.keys(hash).length === 0) return null;

        const rawMsgs = await this.client.lRange(this.msgsKey(sessionId), 0, -1);
        const messages: SessionMessage[] = rawMsgs.flatMap((m) => {
            try { return [JSON.parse(m) as SessionMessage]; } catch { return []; }
        });

        let metadata: Record<string, unknown> = {};
        try { metadata = JSON.parse(hash['metadata'] ?? '{}') as Record<string, unknown>; } catch { /* use empty */ }

        return {
            id: hash['id'] ?? sessionId,
            userId: hash['userId'] ?? '',
            messages,
            metadata,
            createdAt: Number(hash['createdAt']) || Date.now(),
            updatedAt: Number(hash['updatedAt']) || Date.now(),
        };
    }

    async append(sessionId: string, messages: readonly SessionMessage[]): Promise<void> {
        if (messages.length === 0) return;

        const serialised = messages.map((m) => JSON.stringify(m));
        await this.client.rPush(this.msgsKey(sessionId), ...serialised);

        // Store updatedAt as epoch ms (consistent with create())
        await this.client.hSet(this.sessKey(sessionId), 'updatedAt', String(Date.now()));

        // Enforce maxMessages cap via LTRIM (keeps the most-recent N entries)
        if (this.maxMessages > 0) {
            // LTRIM with start = -(maxMessages) keeps the tail; lTrim is the node-redis v4 method name
            const client = this.client as unknown as Record<string, unknown>;
            const lTrimFn = client['lTrim'];
            if (typeof lTrimFn === 'function') {
                await (lTrimFn as (k: string, s: number, e: number) => Promise<string>).call(
                    this.client,
                    this.msgsKey(sessionId),
                    -this.maxMessages,
                    -1,
                );
            }
        }

        // Refresh TTLs
        await Promise.all([
            this.client.expire(this.sessKey(sessionId), this.ttl),
            this.client.expire(this.msgsKey(sessionId), this.ttl),
        ]);
    }

    async delete(sessionId: string): Promise<void> {
        await this.client.del(this.sessKey(sessionId), this.msgsKey(sessionId));
    }

    async listByUser(userId: string): Promise<SessionData[]> {
        const sessions: SessionData[] = [];
        let cursor = 0;

        do {
            const result = await this.client.scan(cursor, {
                MATCH: `${this.prefix}*`,
                COUNT: 100,
            });
            cursor = result.cursor;

            for (const key of result.keys) {
                // Skip message-list keys
                if (key.includes(':msgs:')) continue;

                const hash = await this.client.hGetAll(key);
                if (hash['userId'] !== userId) continue;

                const rawMsgs = await this.client.lRange(
                    this.msgsKey(hash['id'] ?? key),
                    0,
                    -1,
                );
                const msgs: SessionMessage[] = rawMsgs.flatMap((m) => {
                    try { return [JSON.parse(m) as SessionMessage]; } catch { return []; }
                });
                let meta: Record<string, unknown> = {};
                try { meta = JSON.parse(hash['metadata'] ?? '{}') as Record<string, unknown>; } catch { /* use empty */ }
                sessions.push({
                    id: hash['id'] ?? key,
                    userId: hash['userId'] ?? '',
                    messages: msgs,
                    metadata: meta,
                    createdAt: Number(hash['createdAt']) || Date.now(),
                    updatedAt: Number(hash['updatedAt']) || Date.now(),
                });
            }
        } while (cursor !== 0);

        return sessions;
    }

    async touch(sessionId: string, ttlSeconds: number): Promise<void> {
        await Promise.all([
            this.client.expire(this.sessKey(sessionId), ttlSeconds),
            this.client.expire(this.msgsKey(sessionId), ttlSeconds),
        ]);
    }
}
