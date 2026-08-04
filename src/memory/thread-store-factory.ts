/**
 * @personaforge/memory — ThreadStore factory.
 *
 * libSQL first. `createThreadStore()` picks the default driver:
 *
 *   1. `libsql` (default)  — `@libsql/client`, local file / shared memory / Turso
 *   2. `sqlite`            — better-sqlite3 (when explicitly requested)
 *   3. `memory`            — in-memory (zero-config dev)
 *
 * The default driver is libsql with a shared in-memory database unless
 * `LIB_SQL_URL` is set — so a bare `new Memory()` is durable-by-default once
 * `@libsql/client` is present.
 */

import { createRequire } from 'node:module';
import { InMemoryThreadStore } from './in-memory-thread-store.js';
import type { ThreadStore } from './thread-store.js';
import { LibSqlThreadStore, SHARED_MEMORY_URL, type LibSqlThreadStoreConfig } from './libsql-thread-store.js';
import { SqliteThreadStore } from './sqlite-thread-store.js';

const _require = createRequire(import.meta.url);

export type ThreadStoreDriver = 'libsql' | 'sqlite' | 'memory';

export interface CreateThreadStoreConfig {
    driver?: ThreadStoreDriver;
    /** libSQL URL (driver 'libsql') — `:memory:`, `file:…`, `libsql://…`, or a bare path. */
    url?: string;
    /** libSQL auth token (Turso cloud). */
    authToken?: string;
    /** better-sqlite3 file path (driver 'sqlite'). */
    path?: string;
    /** Fall back to in-memory when the requested driver's dep is missing. */
    fallbackToMemory?: boolean;
}

const DEFAULT_URL =
    typeof process !== 'undefined' && process.env?.['LIB_SQL_URL']
        ? process.env['LIB_SQL_URL']!
        : SHARED_MEMORY_URL;

/**
 * Create a ThreadStore. Defaults to libSQL (`@libsql/client`) shared-memory;
 * falls back to an in-memory store when the driver's dependency is not
 * installed (unless `fallbackToMemory: false`).
 *
 * @example
 * ```ts
 * // Default: libsql, shared in-memory (durable when LIB_SQL_URL points at file:/remote)
 * const store = createThreadStore();
 *
 * // Durable local file via libSQL — the production default
 * const store = createThreadStore({ url: 'file:./memory.db' });
 *
 * // Explicit in-memory
 * const store = createThreadStore({ driver: 'memory' });
 * ```
 */
export function createThreadStore(config: CreateThreadStoreConfig = {}): ThreadStore {
    const driver = config.driver ?? (config.url || config.path ? inferDriver(config) : 'libsql');

    switch (driver) {
        case 'memory':
            return new InMemoryThreadStore();
        case 'sqlite':
            return new SqliteThreadStore({
                path: config.path ?? (config.url ? libsqlUrlToPath(config.url) : ':memory:'),
            });
        case 'libsql':
        default: {
            const url = config.url ?? DEFAULT_URL;
            if (config.fallbackToMemory !== false && !libsqlAvailable()) {
                return new InMemoryThreadStore();
            }
            return new LibSqlThreadStore({
                url,
                authToken: config.authToken,
                fallbackToMemory: config.fallbackToMemory ?? true,
            } satisfies LibSqlThreadStoreConfig);
        }
    }
}

function inferDriver(config: CreateThreadStoreConfig): ThreadStoreDriver {
    if (config.path) return 'sqlite';
    return 'libsql';
}

function libsqlUrlToPath(url: string): string {
    if (url.startsWith('file:')) {
        const path = url.slice('file:'.length).split('?')[0]!;
        return path || ':memory:';
    }
    return ':memory:';
}

function libsqlAvailable(): boolean {
    try {
        _require('@libsql/client');
        return true;
    } catch {
        return false;
    }
}
