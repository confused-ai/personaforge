/**
 * Redis tools — get, set, delete, list keys, hash get, increment.
 * Requires: npm install ioredis
 */

import { z } from 'zod';
import { BaseTool } from '../core/base-tool.js';
import { ToolCategory, type ToolContext } from '../core/types.js';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

export interface RedisToolConfig {
    url?: string;
    keyPrefix?: string;
    defaultTtl?: number;
}

interface RedisClient {
    get(k: string): Promise<string | null>;
    set(k: string, v: string, ...a: unknown[]): Promise<unknown>;
    del(...keys: string[]): Promise<number>;
    keys(pattern: string): Promise<string[]>;
    hgetall(k: string): Promise<Record<string, string> | null>;
    hset(k: string, ...a: unknown[]): Promise<number>;
    incr(k: string): Promise<number>;
    incrby(k: string, n: number): Promise<number>;
    quit(): Promise<void>;
}

function makeClient(config: RedisToolConfig): RedisClient {
    const Redis = _require('ioredis') as new (url: string) => RedisClient;
    return new Redis(config.url ?? 'redis://localhost:6379');
}

function pk(key: string, prefix?: string): string {
    return prefix ? `${prefix}${key}` : key;
}

/**
 * Run `fn` with a client that is always quit, even when the command throws.
 * Without this, a failed command leaks the connection.
 */
async function withClient<T>(config: RedisToolConfig, fn: (client: RedisClient) => Promise<T>): Promise<T> {
    const client = makeClient(config);
    try {
        return await fn(client);
    } finally {
        await client.quit().catch(() => undefined);
    }
}

// ── Schemas ────────────────────────────────────────────────────────────────

const GetSchema = z.object({ key: z.string().describe('Redis key') });
const SetSchema = z.object({
    key: z.string().describe('Redis key'),
    value: z.string().describe('Value to store'),
    ttl: z.number().int().positive().optional().describe('TTL in seconds'),
});
const DelSchema = z.object({ keys: z.array(z.string()).describe('Keys to delete') });
const KeysSchema = z.object({ pattern: z.string().describe('Glob pattern, e.g. "session:*"') });
const HashGetSchema = z.object({ key: z.string().describe('Hash key') });
const IncrSchema = z.object({
    key: z.string().describe('Counter key'),
    by: z.number().int().optional().default(1).describe('Amount to increment'),
});

// ── Tools ──────────────────────────────────────────────────────────────────

export class RedisGetTool extends BaseTool<typeof GetSchema, { value: string | null; exists: boolean }> {
    constructor(private config: RedisToolConfig) {
        super({ id: 'redis_get', name: 'Redis Get', description: 'Get a value from Redis by key.', category: ToolCategory.DATABASE, parameters: GetSchema });
    }
    protected async performExecute(input: z.infer<typeof GetSchema>, _ctx: ToolContext) {
        return withClient(this.config, async (client) => {
            const value = await client.get(pk(input.key, this.config.keyPrefix));
            return { value, exists: value !== null };
        });
    }
}

export class RedisSetTool extends BaseTool<typeof SetSchema, { success: boolean }> {
    constructor(private config: RedisToolConfig) {
        super({ id: 'redis_set', name: 'Redis Set', description: 'Set a key-value pair in Redis with optional TTL.', category: ToolCategory.DATABASE, parameters: SetSchema });
    }
    protected async performExecute(input: z.infer<typeof SetSchema>, _ctx: ToolContext) {
        const ttl = input.ttl ?? this.config.defaultTtl;
        const k = pk(input.key, this.config.keyPrefix);
        return withClient(this.config, async (client) => {
            if (ttl) {
                await client.set(k, input.value, 'EX', ttl);
            } else {
                await client.set(k, input.value);
            }
            return { success: true };
        });
    }
}

export class RedisDeleteTool extends BaseTool<typeof DelSchema, { deleted: number }> {
    constructor(private config: RedisToolConfig) {
        super({ id: 'redis_delete', name: 'Redis Delete', description: 'Delete one or more keys from Redis.', category: ToolCategory.DATABASE, parameters: DelSchema });
    }
    protected async performExecute(input: z.infer<typeof DelSchema>, _ctx: ToolContext) {
        return withClient(this.config, async (client) => {
            const deleted = await client.del(...input.keys.map((k) => pk(k, this.config.keyPrefix)));
            return { deleted };
        });
    }
}

export class RedisKeysTool extends BaseTool<typeof KeysSchema, { keys: string[]; count: number }> {
    constructor(private config: RedisToolConfig) {
        super({ id: 'redis_keys', name: 'Redis Keys', description: 'List Redis keys matching a glob pattern.', category: ToolCategory.DATABASE, parameters: KeysSchema });
    }
    protected async performExecute(input: z.infer<typeof KeysSchema>, _ctx: ToolContext) {
        return withClient(this.config, async (client) => {
            const pat = this.config.keyPrefix ? `${this.config.keyPrefix}${input.pattern}` : input.pattern;
            // KEYS is O(N) server-side — cap what we return so a broad
            // pattern can't blow up the result payload.
            const keys = (await client.keys(pat)).slice(0, 1000);
            return { keys, count: keys.length };
        });
    }
}

export class RedisHashGetTool extends BaseTool<typeof HashGetSchema, { fields: Record<string, string> | null }> {
    constructor(private config: RedisToolConfig) {
        super({ id: 'redis_hash_get', name: 'Redis Hash Get', description: 'Get all fields of a Redis hash (HGETALL).', category: ToolCategory.DATABASE, parameters: HashGetSchema });
    }
    protected async performExecute(input: z.infer<typeof HashGetSchema>, _ctx: ToolContext) {
        return withClient(this.config, async (client) => {
            const fields = await client.hgetall(pk(input.key, this.config.keyPrefix));
            return { fields };
        });
    }
}

export class RedisIncrTool extends BaseTool<typeof IncrSchema, { value: number }> {
    constructor(private config: RedisToolConfig) {
        super({ id: 'redis_incr', name: 'Redis Increment', description: 'Increment a Redis counter key by a given amount (default 1).', category: ToolCategory.DATABASE, parameters: IncrSchema });
    }
    protected async performExecute(input: z.infer<typeof IncrSchema>, _ctx: ToolContext) {
        return withClient(this.config, async (client) => {
            const k = pk(input.key, this.config.keyPrefix);
            const value = (input.by ?? 1) === 1 ? await client.incr(k) : await client.incrby(k, input.by ?? 1);
            return { value };
        });
    }
}

// ── Toolkit ────────────────────────────────────────────────────────────────

export class RedisToolkit {
    readonly tools: BaseTool[];
    constructor(config: RedisToolConfig = {}) {
        this.tools = [
            new RedisGetTool(config),
            new RedisSetTool(config),
            new RedisDeleteTool(config),
            new RedisKeysTool(config),
            new RedisHashGetTool(config),
            new RedisIncrTool(config),
        ];
    }
}
