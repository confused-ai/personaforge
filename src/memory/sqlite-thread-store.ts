/**
 * @personaforge/memory — SqliteThreadStore (better-sqlite3).
 *
 * Durable single-file storage using `better-sqlite3` (optional peer dep).
 * Useful when the framework already ships better-sqlite3 and you don't want the
 * libSQL client. For the recommended default, prefer {@link LibSqlThreadStore}.
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

const MISSING =
    '[personaforge/memory] SqliteThreadStore requires better-sqlite3.\n' +
    '  Install: npm install better-sqlite3';

export interface SqliteThreadStoreConfig {
    /** File path or ':memory:'. */
    path?: string;
}

type Database = any;

export class SqliteThreadStore implements ThreadStore {
    private readonly path: string;
    private _db: Database | null = null;
    private _createdAtCursor = 0;

    constructor(config: SqliteThreadStoreConfig = {}) {
        const envPath = typeof process !== 'undefined' ? (process.env?.['AGENT_DB_PATH'] as string | undefined) : undefined;
        this.path = config.path ?? envPath ?? ':memory:';
    }

    private db(): Database {
        if (this._db) return this._db;
        let DatabaseCtor: any;
        try {
            DatabaseCtor = _require('better-sqlite3');
        } catch {
            throw new Error(MISSING);
        }
        const db = new DatabaseCtor(this.path);
        db.pragma('journal_mode = WAL');
        db.exec(`
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
        `);
        this._db = db;
        return db;
    }

    async createThread(input: CreateThreadInput): Promise<Thread> {
        const db = this.db();
        const id = input.id ?? newId('thr');
        const now = Date.now();
        const row = db
            .prepare(
                'INSERT INTO pf_memory_threads (id, resource_id, title, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            )
            .run(id, input.resourceId, input.title ?? null, JSON.stringify(input.metadata ?? {}), now, now);
        if (row.changes === 0) throw new Error(`SqliteThreadStore: thread "${id}" already exists`);
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
        const row = this.db().prepare('SELECT * FROM pf_memory_threads WHERE id = ?').get(id);
        return row ? rowToThread(row) : null;
    }

    async getThreadByResourceId(resourceId: string): Promise<Thread[]> {
        const rows = this.db()
            .prepare('SELECT * FROM pf_memory_threads WHERE resource_id = ? ORDER BY updated_at DESC')
            .all(resourceId);
        return rows.map(rowToThread);
    }

    async updateThread(id: string, input: UpdateThreadInput): Promise<Thread> {
        const db = this.db();
        const existing = db.prepare('SELECT * FROM pf_memory_threads WHERE id = ?').get(id);
        if (!existing) throw new Error(`SqliteThreadStore: thread "${id}" not found`);
        const title = input.title !== undefined ? input.title : (existing.title as string | undefined);
        const metadata = input.metadata !== undefined ? (input.metadata as Thread['metadata']) : safeParse(existing.metadata, {});
        const state = input.state !== undefined ? (input.state as ThreadState) : safeParse(existing.state, undefined);
        const updatedAt = Date.now();
        db.prepare(
            'UPDATE pf_memory_threads SET title = ?, metadata = ?, state = ?, updated_at = ? WHERE id = ?',
        ).run(title ?? null, JSON.stringify(metadata ?? {}), state != null ? JSON.stringify(state) : null, updatedAt, id);
        return {
            id,
            resourceId: existing.resource_id as string,
            title,
            metadata,
            ...(state ? { state } : {}),
            createdAt: new Date(existing.created_at as number).toISOString(),
            updatedAt: new Date(updatedAt).toISOString(),
        };
    }

    async deleteThread(id: string): Promise<void> {
        const db = this.db();
        db.prepare('DELETE FROM pf_memory_messages WHERE thread_id = ?').run(id);
        db.prepare('DELETE FROM pf_memory_threads WHERE id = ?').run(id);
    }

    async listThreads(options: ListThreadsOptions = {}): Promise<Thread[]> {
        const db = this.db();
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
        const rows = db
            .prepare(`SELECT * FROM pf_memory_threads ${clause} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
            .all(...args, limit, offset);
        return rows.map(rowToThread);
    }

    async saveMessages(threadId: string, messages: StorageMessage[]): Promise<StorageMessage[]> {
        const db = this.db();
        const stamped: StorageMessage[] = [];
        const insert = db.prepare(
            `INSERT OR IGNORE INTO pf_memory_messages
             (id, thread_id, role, content, tool_call_id, tool_calls, name, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        const touch = db.prepare('UPDATE pf_memory_threads SET updated_at = ? WHERE id = ?');
        const run = db.transaction((items: StorageMessage[]) => {
            for (const message of items) {
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
                insert.run(
                    id,
                    threadId,
                    row.role,
                    JSON.stringify(row.content),
                    row.toolCallId ?? null,
                    row.toolCalls != null ? JSON.stringify(row.toolCalls) : null,
                    row.name ?? null,
                    row.metadata != null ? JSON.stringify(row.metadata) : null,
                    createdAtMs,
                );
                stamped.push(row);
            }
        });
        run(messages);
        touch.run(Date.now(), threadId);
        return stamped;
    }

    async getMessages(threadId: string, options: GetMessagesOptions = {}): Promise<StorageMessage[]> {
        const db = this.db();
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
        const sql = options.limit && options.limit > 0
            ? `SELECT * FROM pf_memory_messages WHERE ${clause} ORDER BY rowid ASC LIMIT ? OFFSET ?`
            : `SELECT * FROM pf_memory_messages WHERE ${clause} ORDER BY rowid ASC`;
        const rows = options.limit && options.limit > 0
            ? db.prepare(sql).all(...args, options.limit, options.offset ?? 0)
            : db.prepare(sql).all(...args);
        return rows.map(rowToMessage);
    }

    async deleteMessages(threadId: string, ids: string[]): Promise<void> {
        const db = this.db();
        const stmt = db.prepare('DELETE FROM pf_memory_messages WHERE thread_id = ? AND id = ?');
        for (const id of ids) stmt.run(threadId, id);
    }

    async getMessageCount(threadId: string): Promise<number> {
        const row = this.db()
            .prepare('SELECT COUNT(*) AS n FROM pf_memory_messages WHERE thread_id = ?')
            .get(threadId);
        return Number(row?.n ?? 0);
    }

    async close(): Promise<void> {
        this._db?.close();
        this._db = null;
    }

    /** Monotonically increasing timestamp keeps within-thread ordering deterministic. */
    private nextTimestamp(hint?: number): number {
        const base = hint && Number.isFinite(hint) ? Math.max(hint, this._createdAtCursor) : Date.now();
        const ts = base > this._createdAtCursor ? base : this._createdAtCursor + 1;
        this._createdAtCursor = ts;
        return ts;
    }
}

function rowToThread(row: Record<string, unknown>): Thread {
    const metadata = safeParse<Thread['metadata']>(row.metadata, {});
    const state = row.state != null ? safeParse<ThreadState | undefined>(row.state, undefined) : undefined;
    return {
        id: String(row.id),
        resourceId: String(row.resource_id),
        ...(row.title != null ? { title: String(row.title) } : {}),
        metadata,
        ...(state ? { state } : {}),
        createdAt: new Date(Number(row.created_at)).toISOString(),
        updatedAt: new Date(Number(row.updated_at)).toISOString(),
    };
}

function rowToMessage(row: Record<string, unknown>): StorageMessage {
    const content = safeParse<StorageMessage['content']>(row.content, String(row.content ?? ''));
    const toolCalls = row.tool_calls != null ? safeParse<readonly unknown[] | undefined>(row.tool_calls, undefined) : undefined;
    const metadata = row.metadata != null ? safeParse<Record<string, unknown>>(row.metadata, {}) : undefined;
    return {
        id: String(row.id),
        threadId: String(row.thread_id),
        role: String(row.role) as StorageMessage['role'],
        content,
        ...(row.tool_call_id != null ? { toolCallId: String(row.tool_call_id) } : {}),
        ...(toolCalls ? { toolCalls } : {}),
        ...(row.name != null ? { name: String(row.name) } : {}),
        ...(metadata ? { metadata } : {}),
        createdAt: new Date(Number(row.created_at)).toISOString(),
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
