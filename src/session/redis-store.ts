/**
 * @personaforge/session — Redis session store (distributed, horizontally scalable).
 *
 * SRP  — owns only Redis session persistence.
 * DIP  — implements SessionStore interface.
 * Lazy — ioredis loaded inside factory; zero cost if unused.
 * DS   — Redis hashes for O(1) field access. TTL managed by Redis natively.
 *         Keys follow namespace:sessionId pattern for multi-tenant isolation.
 */

import { tryImport } from '../shared/index.js';
import type { SessionStore, SessionData, SessionMessage } from './types.js';

interface RedisClientLike {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  watch(key: string): Promise<unknown>;
  unwatch(): Promise<unknown>;
  multi(): RedisMultiLike;
}

interface RedisMultiLike {
  setex(key: string, ttlSeconds: number, value: string): RedisMultiLike;
  exec(): Promise<unknown[] | null>;
}

/** Minimal ioredis-compatible client interface for typing purposes. */
export interface RedisClient {
    get(key: string): Promise<string | null>;
    incr(key: string): Promise<number>;
    set(key: string, value: string): Promise<'OK' | null>;
    set(key: string, value: string, exFlag: 'EX', seconds: number, nxFlag?: 'NX'): Promise<'OK' | null>;
    del(...keys: string[]): Promise<number>;
  watch(...keys: string[]): Promise<'OK'>;
  unwatch(): Promise<'OK'>;
    exists(...keys: string[]): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
    hset(key: string, ...args: (string | number)[]): Promise<number>;
    hgetall(key: string): Promise<Record<string, string> | null>;
    rpush(key: string, ...values: string[]): Promise<number>;
    ltrim(key: string, start: number, stop: number): Promise<'OK'>;
    lrange(key: string, start: number, stop: number): Promise<string[]>;
    llen(key: string): Promise<number>;
    scan(cursor: string, matchFlag: 'MATCH', pattern: string, countFlag: 'COUNT', count: number): Promise<[string, string[]]>;
    pipeline(): { exec(): Promise<unknown> };
    quit(): Promise<'OK'>;
}

type RedisConstructor = new (options?: string | object) => RedisClientLike;

const MISSING_SDK_MSG =
  '[personaforge] Redis session store requires ioredis.\n' +
  '  Install: npm install ioredis';

export interface RedisSessionStoreOptions {
  /** ioredis connection URL or options. Defaults to redis://localhost:6379. */
  redis?: string | object;
  /** Key prefix for namespacing. Default: "personaforge:session:". */
  keyPrefix?: string;
  /** TTL in seconds. Default: 86400 (24 hours). */
  ttl?: number;
}

export function createRedisStore(opts: RedisSessionStoreOptions = {}): SessionStore {
  const keyPrefix = opts.keyPrefix ?? 'personaforge:session:';
  const ttl       = opts.ttl ?? 86_400;
  const maxWriteRetries = 5;

  // Lazy client initialization — ioredis loaded on first use via tryImport
  let _clientPromise: Promise<RedisClientLike> | null = null;

  async function getClient(): Promise<RedisClientLike> {
    if (_clientPromise) return _clientPromise;
    return (_clientPromise = (async () => {
      const mod = await tryImport<{ default?: RedisConstructor } | RedisConstructor>('ioredis');
      if (!mod) throw new Error(MISSING_SDK_MSG);
      const IORedis = typeof mod === 'function' ? mod : mod.default;
      if (!IORedis) throw new Error(MISSING_SDK_MSG);
      return new IORedis(
        typeof opts.redis === 'string'
          ? opts.redis
          : opts.redis ?? 'redis://localhost:6379',
      );
    })());
  }

  const key = (id: string) => `${keyPrefix}${id}`;

  function parseSession(raw: string | null): SessionData | undefined {
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw) as SessionData;
      const safeMessages: SessionMessage[] = Array.isArray(parsed.messages)
        ? (parsed.messages as SessionMessage[])
        : [];
      return {
        ...parsed,
        messages: safeMessages,
      };
    } catch {
      return undefined;
    }
  }

  async function mutateSession(
    id: string,
    mutator: (session: SessionData) => SessionData,
  ): Promise<SessionData | undefined> {
    const client = await getClient();

    for (let attempt = 0; attempt < maxWriteRetries; attempt++) {
      await client.watch(key(id));
      const raw = await client.get(key(id));
      const existing = parseSession(raw);

      if (!existing) {
        await client.unwatch();
        return undefined;
      }

      const updated = mutator(existing);
      const tx = client.multi();
      tx.setex(key(id), ttl, JSON.stringify(updated));
      const result = await tx.exec();
      if (result !== null) return updated;
    }

    throw new Error(`[personaforge/session] Failed to update session "${id}" after ${String(maxWriteRetries)} retries.`);
  }

  return {
    async get(id) {
      const client = await getClient();
      const data = await client.get(key(id));
      return parseSession(data);
    },

    async create(data) {
      const client = await getClient();
      const id      = typeof data === 'string' ? data : crypto.randomUUID();
      const agentId = typeof data === 'string' ? 'unknown' : data.agentId;
      const userId  = typeof data === 'string' ? undefined  : data.userId;
      const msgs    = typeof data === 'string' ? []          : (data.messages ?? []);
      const now     = Date.now();
      const session: SessionData = {
        id,
        agentId,
        messages:  msgs,
        createdAt: now,
        updatedAt: now,
        ...(userId !== undefined && { userId }),
      };
      await client.setex(key(id), ttl, JSON.stringify(session));
      return session;
    },

    async update(id, data) {
      await mutateSession(id, (existing) => ({
        ...existing,
        messages: [...data.messages],
        updatedAt: Date.now(),
      }));
    },

    async getMessages(id) {
      const session = await this.get(id);
      return [...(session?.messages ?? [])];
    },

    async appendMessage(id, message) {
      await mutateSession(id, (existing) => ({
        ...existing,
        messages: [...existing.messages, message],
        updatedAt: Date.now(),
      }));
    },

    async delete(id) {
      const client = await getClient();
      await client.del(key(id));
    },
  };
}
