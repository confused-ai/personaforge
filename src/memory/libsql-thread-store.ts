/**
 * @personaforge/memory — LibSqlThreadStore (default ThreadStore).
 *
 * Persists threads and messages in libSQL (`@libsql/client`): local `file:`
 * databases, shared `:memory:` databases, or Turso cloud (`libsql://`).
 *
 * libSQL ships with local file support out of the box (no server required),
 * which makes it the recommended production default for the memory layer — the
 * same choice Mastra makes for its storage adapter.
 *
 * ```ts
 * import { createThreadStore } from 'personaforge/memory';
 *
 * // Durable local file (production default)
 * const store = createThreadStore({ url: 'file:./memory.db' });
 *
 * // Turso cloud
 * const store = createThreadStore({ url: 'libsql://my-db-org.turso.io', authToken });
 * ```
 *
 * When `@libsql/client` is not installed, `createThreadStore()` falls back to
 * an in-memory store (or throws, with `fallbackToMemory: false`).
 */

import { createRequire } from 'node:module';
import { newId } from '../contracts/index.js';
import type {
    CreateThreadInput,
    GetMessagesOptions,
    ListThreadsOptions,
    ThreadStore,
    UpdateThreadInput,
} from './thread-store.js';
import type { StorageMessage, Thread, ThreadState } from './threads.js';

const _require = createRequire(import.meta.url);

const MISSING_LIBSQL =
    '[personaforge/memory] LibSqlThreadStore requires @libsql/client.\n' +
    '  Install: npm install @libsql/client';

interface LibSqlRow {
    [k: string]: unknown;
}
interface LibSqlResult {
    rows: LibSqlRow[];
    rowsAffected: number;
}
export interface LibSqlClient {
    execute(stmt: string | { sql: string; args: unknown[] }): Promise<LibSqlResult>;
    close(): void;
}
type LibSqlCreator = { createClient(config: Record<string, unknown>): LibSqlClient };

export interface LibSqlThreadStoreConfig {
    /**
     * libSQL URL: `:memory:`, `file:./path.db`, or a remote `libsql://` URL.
     * Defaults to `process.env.LIB_SQL_URL ?? ':memory:'`.
     */
    url?: string;
    /** Auth token for Turso cloud / shared databases. */
    authToken?: string;
    /**
     * When `@libsql/client` is not installed, fall back to an in-memory store
     * instead of throwing. Default true.
     */
    fallbackToMemory?: boolean;
}

/** Shared memory database URL usable across stores in the same process. */
export const SHARED_MEMORY_URL = 'file::memory:?cache=shared';

export class LibSqlThreadStore implements ThreadStore {
    private readonly cfg: Required<Pick<LibSqlThreadStoreConfig, 'url'>> & LibSqlThreadStoreConfig;
    private _client: LibSqlClient | null = null;
    private _ready = false;
    private _init: Promise<void> | null = null;
    private _createdAtCursor = 0;

    constructor(config: LibSqlThreadStoreConfig = {}) {
        const envUrl = typeof process !== 'undefined' ? (process.env?.['LIB_SQL_URL'] as string | undefined) : undefined;
        this.cfg = {
            url: normalizeLibSqlUrl(config.url ?? envUrl ?? ':memory:'),
            authToken: config.authToken,
            fallbackToMemory: config.fallbackToMemory ?? true,
        };
    }

    private client(): LibSqlClient {
        if (this._client) return this._client;
        let creator: LibSqlCreator;
        try {
            creator = _require('@libsql/client') as LibSqlCreator;
        } catch {
            if (this.cfg.fallbackToMemory !== false) {
                throw new Error(
                    `${MISSING_LIBSQL}\n  Falling back to in-memory storage: pass an explicit store or install @libsql/client for durable memory.`,
                );
            }
            throw new Error(MISSING_LIBSQL);
        }
        const config: Record<string, unknown> = { url: this.cfg.url };
        if (this.cfg.authToken) config['authToken'] = this.cfg.authToken;
        this._client = creator.createClient(config);
        return this._client;
    }

    private async q(sql: string, args: unknown[] = []): Promise<LibSqlResult> {
        return this.client().execute({ sql, args: args.map(normalize) });
    }

    async init(): Promise<void> {
        if (this._ready) return;
        if (!this._init) this._init = this._doInit();
        return this._init;
    }

    private async _doInit(): Promise<void> {
        const schema = `
            CREATE TABLE IF NOT EXISTS pf_memory_threads (
                id TEXT PRIMARY KEY,
                resource_id TEXT NOT NULL,
                title TEXT,
                metadata TEXT NOT NULL,
                state TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS pf_memory_messages (
                id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                tool_call_id TEXT,
                tool_calls TEXT,
                name TEXT,
                metadata TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_pf_memory_messages_thread
                ON pf_memory_messages (thread_id, created_at, id);
            CREATE INDEX IF NOT EXISTS idx_pf_memory_threads_resource
                ON pf_memory_threads (resource_id);
        `;
        // libSQL's execute() handles a single statement — run each statement separately.
        for (const statement of schema.split(';')) {
            const trimmed = statement.trim();
            if (!trimmed) continue;
            await this.q(trimmed);
        }
        this._ready = true;
    }

    async createThread(input: CreateThreadInput): Promise<Thread> {
        await this.init();
        const id = input.id ?? newId('thr');
        const now = Date.now();
        const metadata = JSON.stringify(input.metadata ?? {});
        try {
            await this.q(
                'INSERT INTO pf_memory_threads (id, resource_id, title, metadata, state, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)',
                [id, input.resourceId, input.title ?? null, metadata, now, now],
            );
        } catch (error) {
            if (isUniqueViolation(error)) {
                throw new Error(`LibSqlThreadStore: thread "${id}" already exists`);
            }
            throw error;
        }
        return {
            id,
            resourceId: input.resourceId,
            title: input.title,
            metadata: input.metadata as Thread['metadata'],
            createdAt: new Date(now).toISOString(),
            updatedAt: new Date(now).toISOString(),
        };
    }

    async getThread(id: string): Promise<Thread | null> {
        await this.init();
        const result = await this.q('SELECT * FROM pf_memory_threads WHERE id = ?', [id]);
        if (result.rows.length === 0) return null;
        return rowToThread(result.rows[0]!);
    }

    async getThreadByResourceId(resourceId: string): Promise<Thread[]> {
        await this.init();
        const result = await this.q(
            'SELECT * FROM pf_memory_threads WHERE resource_id = ? ORDER BY updated_at DESC',
            [resourceId],
        );
        return result.rows.map(rowToThread);
    }

    async updateThread(id: string, input: UpdateThreadInput): Promise<Thread> {
        await this.init();
        const existing = await this.getThread(id);
        if (!existing) throw new Error(`LibSqlThreadStore: thread "${id}" not found`);
        const title = input.title !== undefined ? input.title : existing.title;
        const metadata = input.metadata !== undefined ? (input.metadata as Thread['metadata']) : existing.metadata;
        const state = input.state !== undefined ? (input.state as ThreadState) : existing.state;
        const updatedAt = Date.now();
        await this.q(
            'UPDATE pf_memory_threads SET title = ?, metadata = ?, state = ?, updated_at = ? WHERE id = ?',
            [
                title ?? null,
                JSON.stringify(metadata ?? {}),
                state != null ? JSON.stringify(state) : null,
                updatedAt,
                id,
            ],
        );
        return {
            ...existing,
            title,
            metadata,
            state,
            updatedAt: new Date(updatedAt).toISOString(),
        };
    }

    async deleteThread(id: string): Promise<void> {
        await this.init();
        await this.q('DELETE FROM pf_memory_messages WHERE thread_id = ?', [id]);
        await this.q('DELETE FROM pf_memory_threads WHERE id = ?', [id]);
    }

    async listThreads(options: ListThreadsOptions = {}): Promise<Thread[]> {
        await this.init();
        const where: string[] = [];
        const args: unknown[] = [];
        if (options.resourceId) {
            where.push('resource_id = ?');
            args.push(options.resourceId);
        }
        if (options.title) {
            where.push('title LIKE ?');
            args.push(`%${options.title}%`);
        }
        const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const limit = options.limit ?? 1000;
        const offset = options.offset ?? 0;
        const result = await this.q(
            `SELECT * FROM pf_memory_threads ${clause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
            [...args, limit, offset],
        );
        return result.rows.map(rowToThread);
    }

    async saveMessages(threadId: string, messages: StorageMessage[]): Promise<StorageMessage[]> {
        await this.init();
        const stamped: StorageMessage[] = [];
        for (const message of messages) {
            const id = message.id ?? newId('msg');
            const createdAtMs = this.nextTimestamp(message.createdAt ? Date.parse(message.createdAt) : undefined);
            const row: StorageMessage = {
                ...message,
                id,
                threadId,
                createdAt: message.createdAt && createdAtMs === Date.parse(message.createdAt)
                    ? message.createdAt
                    : new Date(createdAtMs).toISOString(),
            };
            await this.q(
                `INSERT OR IGNORE INTO pf_memory_messages
                 (id, thread_id, role, content, tool_call_id, tool_calls, name, metadata, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id,
                    threadId,
                    row.role,
                    JSON.stringify(row.content),
                    row.toolCallId ?? null,
                    row.toolCalls != null ? JSON.stringify(row.toolCalls) : null,
                    row.name ?? null,
                    row.metadata != null ? JSON.stringify(row.metadata) : null,
                    createdAtMs,
                ],
            );
            stamped.push(row);
        }
        await this.q('UPDATE pf_memory_threads SET updated_at = ? WHERE id = ?', [Date.now(), threadId]);
        return stamped;
    }

    async getMessages(threadId: string, options: GetMessagesOptions = {}): Promise<StorageMessage[]> {
        await this.init();
        const where: string[] = ['thread_id = ?'];
        const args: unknown[] = [threadId];
        if (options.afterId) {
            // OM cursor semantics — messages inserted AFTER the anchor row.
            where.push('rowid > (SELECT rowid FROM pf_memory_messages WHERE id = ?)');
            args.push(options.afterId);
        }
        if (options.beforeId) {
            where.push('rowid < (SELECT rowid FROM pf_memory_messages WHERE id = ?)');
            args.push(options.beforeId);
        }
        if (options.includeToolMessages === false) where.push("role != 'tool'");
        const clause = where.join(' AND ');
        if (options.limit && options.limit > 0) {
            const rows = await this.q(
                `SELECT * FROM pf_memory_messages WHERE ${clause}
                 ORDER BY rowid ASC
                 LIMIT ? ${options.offset ? 'OFFSET ?' : ''}`,
                options.offset
                    ? [...args, options.limit, options.offset]
                    : [...args, options.limit],
            );
            return rows.rows.map(rowToMessage);
        }
        const rows = await this.q(
            `SELECT * FROM pf_memory_messages WHERE ${clause} ORDER BY rowid ASC`,
            args,
        );
        return rows.rows.map(rowToMessage);
    }

    async deleteMessages(threadId: string, ids: string[]): Promise<void> {
        await this.init();
        for (const id of ids) {
            await this.q('DELETE FROM pf_memory_messages WHERE thread_id = ? AND id = ?', [threadId, id]);
        }
    }

    async getMessageCount(threadId: string): Promise<number> {
        await this.init();
        const result = await this.q(
            'SELECT COUNT(*) AS n FROM pf_memory_messages WHERE thread_id = ?',
            [threadId],
        );
        return Number(result.rows[0]?.['n'] ?? 0);
    }

    async close(): Promise<void> {
        this._client?.close();
        this._client = null;
        this._ready = false;
    }

    /** Monotonically increasing timestamp keeps within-thread ordering deterministic. */
    private nextTimestamp(hint?: number): number {
        const base = hint && Number.isFinite(hint) ? Math.max(hint, this._createdAtCursor) : Date.now();
        const ts = base > this._createdAtCursor ? base : this._createdAtCursor + 1;
        this._createdAtCursor = ts;
        return ts;
    }
}

function rowToThread(row: LibSqlRow): Thread {
    const metadata = safeParse<Thread['metadata']>(row['metadata'], {});
    const state = row['state'] != null ? safeParse<ThreadState | undefined>(row['state'], undefined) : undefined;
    return {
        id: String(row['id']),
        resourceId: String(row['resource_id']),
        ...(row['title'] != null ? { title: String(row['title']) } : {}),
        ...(metadata ? { metadata } : {}),
        ...(state ? { state } : {}),
        createdAt: new Date(Number(row['created_at'])).toISOString(),
        updatedAt: new Date(Number(row['updated_at'])).toISOString(),
    };
}

function rowToMessage(row: LibSqlRow): StorageMessage {
    const content = safeParse<StorageMessage['content']>(row['content'], String(row['content'] ?? ''));
    const toolCalls = row['tool_calls'] != null ? safeParse<readonly unknown[] | undefined>(row['tool_calls'], undefined) : undefined;
    const metadata = row['metadata'] != null ? safeParse<Record<string, unknown> | undefined>(row['metadata'], undefined) : undefined;
    return {
        id: String(row['id']),
        threadId: String(row['thread_id']),
        role: String(row['role']) as StorageMessage['role'],
        content,
        ...(row['tool_call_id'] != null ? { toolCallId: String(row['tool_call_id']) } : {}),
        ...(toolCalls ? { toolCalls } : {}),
        ...(row['name'] != null ? { name: String(row['name']) } : {}),
        ...(metadata ? { metadata } : {}),
        createdAt: new Date(Number(row['created_at'])).toISOString(),
    };
}

function safeParse<T>(value: unknown, fallback: T): T {
    if (typeof value !== 'string') return fallback;
    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}

function normalizeLibSqlUrl(url: string): string {
    if (
        url === ':memory:' ||
        url.startsWith('file:') ||
        url.startsWith('libsql:') ||
        url.startsWith('http:') ||
        url.startsWith('https:')
    ) {
        return url;
    }
    // Bare paths are treated as local libSQL files.
    return `file:${url}`;
}

function isUniqueViolation(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /UNIQUE constraint failed|PRIMARY KEY/i.test(message);
}

function normalize(arg: unknown): unknown {
    return arg === undefined ? null : arg;
}
