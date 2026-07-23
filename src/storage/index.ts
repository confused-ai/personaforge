/**
 * Storage module — generic key-value + blob storage with pluggable adapters.
 *
 * Works anywhere: in-memory (dev/test), file system (local/single-node),
 * or swap in S3 / R2 / Azure Blob / GCS by implementing StorageAdapter.
 *
 * @example
 * ```ts
 * // In-memory (dev / testing)
 * const store = createStorage();
 * await store.set('config:user-1', { name: 'Alice', plan: 'pro' });
 * const config = await store.get<{ name: string }>('config:user-1');
 *
 * // File-based (persists to disk)
 * const store = createStorage({ driver: 'file', basePath: './data' });
 * await store.set('session:abc', { messages: [] });
 *
 * // Bring your own (S3, Redis, PlanetScale, etc.)
 * const store = createStorage({ adapter: myCustomAdapter });
 * ```
 */

import { readFile, writeFile, mkdir, unlink, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// ── Types ──────────────────────────────────────────────────────────────────

/** Low-level storage operations. Implement this to add any backend. */
export interface StorageAdapter {
    /** Retrieve a value by key. Returns undefined if not found. */
    get(key: string): Promise<string | undefined>;
    /** Store a value. Set ttl (seconds) for automatic expiry if supported. */
    set(key: string, value: string, ttl?: number): Promise<void>;
    /** Delete a key. Resolves regardless of whether it existed. */
    delete(key: string): Promise<void>;
    /** List keys matching an optional prefix. */
    list(prefix?: string): Promise<string[]>;
    /** Check if a key exists. */
    has(key: string): Promise<boolean>;
    /** Remove all keys (optional). */
    clear?(): Promise<void>;
}

/** High-level typed storage, wraps a StorageAdapter with JSON serialization. */
export interface Storage {
    /** Get a typed value. Returns undefined if not found. */
    get<T = unknown>(key: string): Promise<T | undefined>;
    /** Store a typed value (JSON-serialized). */
    set<T = unknown>(key: string, value: T, ttl?: number): Promise<void>;
    /** Delete a key. */
    delete(key: string): Promise<void>;
    /** List keys matching an optional prefix. */
    list(prefix?: string): Promise<string[]>;
    /** Check if a key exists. */
    has(key: string): Promise<boolean>;
    /** Remove all keys (if the adapter supports it). */
    clear(): Promise<void>;
    /** Access the raw adapter for advanced usage. */
    readonly adapter: StorageAdapter;
}

// ── Built-in Adapters ──────────────────────────────────────────────────────

/**
 * In-memory storage adapter. Perfect for development, testing, and short-lived runs.
 * Data is lost when the process restarts.
 */
export class MemoryStorageAdapter implements StorageAdapter {
    private store = new Map<string, { value: string; expiresAt?: number }>();

    async get(key: string): Promise<string | undefined> {
        const entry = this.store.get(key);
        if (!entry) return undefined;
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            this.store.delete(key);
            return undefined;
        }
        return entry.value;
    }

    async set(key: string, value: string, ttl?: number): Promise<void> {
        this.store.set(key, {
            value,
            expiresAt: ttl ? Date.now() + ttl * 1000 : undefined,
        });
    }

    async delete(key: string): Promise<void> {
        this.store.delete(key);
    }

    async list(prefix?: string): Promise<string[]> {
        const now = Date.now();
        const keys: string[] = [];
        for (const [key, entry] of this.store) {
            if (entry.expiresAt && now > entry.expiresAt) continue;
            if (!prefix || key.startsWith(prefix)) keys.push(key);
        }
        return keys;
    }

    async has(key: string): Promise<boolean> {
        return (await this.get(key)) !== undefined;
    }

    async clear(): Promise<void> {
        this.store.clear();
    }
}

/**
 * File-system storage adapter. Persists each key as a JSON file under `basePath`.
 * Keys can use `:` or `/` as separators — they are normalized to directory paths.
 * Good for local development, edge functions with ephemeral FS, and single-node apps.
 */
export class FileStorageAdapter implements StorageAdapter {
    constructor(private basePath: string) {}

    private keyToPath(key: string): string {
        // 'user:123:prefs' → '{basePath}/user/123/prefs.json'
        const segments = key.replace(/:/g, '/');
        return join(this.basePath, `${segments}.json`);
    }

    async get(key: string): Promise<string | undefined> {
        try {
            const content = await readFile(this.keyToPath(key), 'utf8');
            const { value, expiresAt } = JSON.parse(content) as { value: string; expiresAt?: number };
            if (expiresAt && Date.now() > expiresAt) {
                await this.delete(key);
                return undefined;
            }
            return value;
        } catch {
            return undefined;
        }
    }

    async set(key: string, value: string, ttl?: number): Promise<void> {
        const path = this.keyToPath(key);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, JSON.stringify({ value, expiresAt: ttl ? Date.now() + ttl * 1000 : undefined }), 'utf8');
    }

    async delete(key: string): Promise<void> {
        try { await unlink(this.keyToPath(key)); } catch { /* noop */ }
    }

    async list(prefix?: string): Promise<string[]> {
        try {
            const allFiles = await this.globFiles(this.basePath);
            return allFiles
                .map((f) => f.replace(this.basePath + '/', '').replace(/\//g, ':').replace(/\.json$/, ''))
                .filter((k) => !prefix || k.startsWith(prefix));
        } catch {
            return [];
        }
    }

    async has(key: string): Promise<boolean> {
        return (await this.get(key)) !== undefined;
    }

    async clear(): Promise<void> {
        const keys = await this.list();
        await Promise.all(keys.map((k) => this.delete(k)));
    }

    private async globFiles(dir: string): Promise<string[]> {
        try {
            const entries = await readdir(dir, { withFileTypes: true });
            const files: string[] = [];
            for (const e of entries) {
                const full = join(dir, e.name);
                if (e.isDirectory()) files.push(...(await this.globFiles(full)));
                else if (e.name.endsWith('.json')) files.push(full);
            }
            return files;
        } catch {
            return [];
        }
    }
}

// ── Factory ────────────────────────────────────────────────────────────────

export interface StorageOptions {
    /** 'memory' (default) or 'file'. Pass `adapter` for custom backends. */
    driver?: 'memory' | 'file';
    /** Required when driver = 'file'. Directory to store files in. */
    basePath?: string;
    /** Custom adapter — overrides `driver`. Use for S3, Redis, PlanetScale, etc. */
    adapter?: StorageAdapter;
}

/**
 * Create a typed storage instance.
 *
 * @example
 * ```ts
 * import { createStorage } from 'personaforge';
 *
 * // Dev: in-memory
 * const store = createStorage();
 *
 * // Production: file-based
 * const store = createStorage({ driver: 'file', basePath: './storage' });
 *
 * // Custom: bring your own adapter (S3, Redis, Turso, etc.)
 * const store = createStorage({ adapter: myRedisAdapter });
 *
 * // Use it:
 * await store.set('user:1', { name: 'Alice', plan: 'pro' });
 * const user = await store.get<{ name: string; plan: string }>('user:1');
 * console.log(user?.name); // Alice
 *
 * await store.set('token:session-abc', 'jwt-value-here', 3600); // expires in 1h
 * const keys = await store.list('user:');  // ['user:1']
 * ```
 */
export function createStorage(options: StorageOptions = {}): Storage {
    let adapter: StorageAdapter;

    if (options.adapter) {
        adapter = options.adapter;
    } else if (options.driver === 'file') {
        if (!options.basePath) throw new Error("createStorage({ driver: 'file' }) requires basePath");
        adapter = new FileStorageAdapter(options.basePath);
    } else {
        adapter = new MemoryStorageAdapter();
    }

    return {
        adapter,

        async get<T = unknown>(key: string): Promise<T | undefined> {
            const raw = await adapter.get(key);
            if (raw === undefined) return undefined;
            try { return JSON.parse(raw) as T; } catch { return raw as unknown as T; }
        },

        async set<T = unknown>(key: string, value: T, ttl?: number): Promise<void> {
            const raw = typeof value === 'string' ? value : JSON.stringify(value);
            return adapter.set(key, raw, ttl);
        },

        delete: (key) => adapter.delete(key),
        list: (prefix) => adapter.list(prefix),
        has: (key) => adapter.has(key),

        async clear() {
            if (adapter.clear) return adapter.clear();
            const keys = await adapter.list();
            await Promise.all(keys.map((k) => adapter.delete(k)));
        },
    };
}
