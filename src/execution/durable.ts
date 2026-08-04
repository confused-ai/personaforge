import { createRequire } from 'node:module';
import { generateEntityId } from '../core/index.js';

const _require = createRequire(import.meta.url);

// ── Event Sourcing ──────────────────────────────────────────────────────────

export type WorkflowEventType =
    | 'WorkflowStarted'
    | 'StepStarted'
    | 'StepCompleted'
    | 'StepFailed'
    | 'WorkflowPaused'
    | 'WorkflowResumed'
    | 'WorkflowCompleted'
    | 'WorkflowFailed'
    | 'CheckpointCreated';

export interface WorkflowEvent {
    id: string;
    type: WorkflowEventType;
    workflowId: string;
    timestamp: number;
    payload?: any;
}

export interface EventStore {
    append(workflowId: string, event: Omit<WorkflowEvent, 'id' | 'timestamp'>): Promise<WorkflowEvent>;
    getEvents(workflowId: string): Promise<WorkflowEvent[]>;
    /** Optional: delete all events for a workflow (e.g. on completion to free storage). */
    deleteEvents?(workflowId: string): Promise<void>;
    /** Optional: close underlying connections. */
    close?(): Promise<void>;
}

// ── In-Memory (zero-config) ────────────────────────────────────────────────

export class InMemoryEventStore implements EventStore {
    private streams: Map<string, WorkflowEvent[]> = new Map();

    async append(workflowId: string, event: Omit<WorkflowEvent, 'id' | 'timestamp'>): Promise<WorkflowEvent> {
        const fullEvent: WorkflowEvent = {
            ...event,
            id: generateEntityId(),
            timestamp: Date.now()
        };
        const stream = this.streams.get(workflowId) ?? [];
        stream.push(fullEvent);
        this.streams.set(workflowId, stream);
        return fullEvent;
    }

    async getEvents(workflowId: string): Promise<WorkflowEvent[]> {
        return this.streams.get(workflowId) ?? [];
    }

    async deleteEvents(workflowId: string): Promise<void> {
        this.streams.delete(workflowId);
    }

    async close(): Promise<void> {
        this.streams.clear();
    }
}

// ── SQLite (better-sqlite3) ────────────────────────────────────────────────

const MISSING_BETTER_SQLITE3 =
    '[personaforge/execution] SqliteEventStore requires better-sqlite3.\n' +
    '  Install: npm install better-sqlite3';

interface Sqlite3Db {
    exec(sql: string): void;
    prepare(sql: string): { run(...params: unknown[]): unknown; get(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
    close(): void;
}

type Sqlite3Ctor = new (path: string) => Sqlite3Db;

export class SqliteEventStore implements EventStore {
    private db: Sqlite3Db;

    constructor(dbOrPath: Sqlite3Db | string) {
        if (typeof dbOrPath === 'string') {
            let Database: Sqlite3Ctor;
            try {
                Database = _require('better-sqlite3') as Sqlite3Ctor;
            } catch {
                throw new Error(MISSING_BETTER_SQLITE3);
            }
            this.db = new Database(dbOrPath);
        } else {
            this.db = dbOrPath;
        }
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS workflow_events (
                id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                type TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                payload TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_workflow_events_wf ON workflow_events (workflow_id, timestamp);
        `);
    }

    static create(filePath: string): SqliteEventStore {
        return new SqliteEventStore(filePath);
    }

    async append(workflowId: string, event: Omit<WorkflowEvent, 'id' | 'timestamp'>): Promise<WorkflowEvent> {
        const fullEvent: WorkflowEvent = {
            ...event,
            id: generateEntityId(),
            workflowId,
            timestamp: Date.now(),
        };
        this.db.prepare(
            `INSERT INTO workflow_events (id, workflow_id, type, timestamp, payload) VALUES (?, ?, ?, ?, ?)`
        ).run(fullEvent.id, fullEvent.workflowId, fullEvent.type, fullEvent.timestamp, fullEvent.payload ? JSON.stringify(fullEvent.payload) : null);
        return fullEvent;
    }

    async getEvents(workflowId: string): Promise<WorkflowEvent[]> {
        const rows = this.db.prepare(
            `SELECT * FROM workflow_events WHERE workflow_id = ? ORDER BY timestamp ASC`
        ).all(workflowId) as Array<{ id: string; workflow_id: string; type: string; timestamp: number; payload: string | null }>;
        return rows.map(rowToWorkflowEvent);
    }

    async deleteEvents(workflowId: string): Promise<void> {
        this.db.prepare(`DELETE FROM workflow_events WHERE workflow_id = ?`).run(workflowId);
    }

    async close(): Promise<void> {
        this.db.close();
    }
}

// ── libSQL (@libsql/client) ────────────────────────────────────────────────

const MISSING_LIBSQL =
    '[personaforge/execution] LibSqlEventStore requires @libsql/client.\n' +
    '  Install: npm install @libsql/client';

interface LibSqlRow { [k: string]: unknown; }
interface LibSqlResult { rows: LibSqlRow[]; rowsAffected: number; }
interface LibSqlClient {
    execute(stmt: string | { sql: string; args: unknown[] }): Promise<LibSqlResult>;
    close(): void;
}
type LibSqlCreator = { createClient(config: Record<string, unknown>): LibSqlClient };

export class LibSqlEventStore implements EventStore {
    private client: LibSqlClient;
    private _initialized = false;
    private _init: Promise<void>;

    constructor(urlOrClient: string | LibSqlClient, authToken?: string) {
        if (typeof urlOrClient === 'object') {
            this.client = urlOrClient;
        } else {
            let createClient: LibSqlCreator['createClient'];
            try {
                createClient = (_require('@libsql/client') as LibSqlCreator).createClient;
            } catch {
                throw new Error(MISSING_LIBSQL);
            }
            this.client = createClient({ url: urlOrClient, authToken });
        }
        this._init = this._ensureTable();
    }

    static create(url: string, authToken?: string): LibSqlEventStore {
        return new LibSqlEventStore(url, authToken);
    }

    private async _ensureTable(): Promise<void> {
        if (this._initialized) return;
        await this.client.execute(`
            CREATE TABLE IF NOT EXISTS workflow_events (
                id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                type TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                payload TEXT
            )
        `);
        await this.client.execute(`CREATE INDEX IF NOT EXISTS idx_workflow_events_wf ON workflow_events (workflow_id, timestamp)`);
        this._initialized = true;
    }

    async append(workflowId: string, event: Omit<WorkflowEvent, 'id' | 'timestamp'>): Promise<WorkflowEvent> {
        await this._init;
        const fullEvent: WorkflowEvent = {
            ...event,
            id: generateEntityId(),
            workflowId,
            timestamp: Date.now(),
        };
        await this.client.execute({
            sql: `INSERT INTO workflow_events (id, workflow_id, type, timestamp, payload) VALUES (?, ?, ?, ?, ?)`,
            args: [fullEvent.id, fullEvent.workflowId, fullEvent.type, fullEvent.timestamp, fullEvent.payload ? JSON.stringify(fullEvent.payload) : null],
        });
        return fullEvent;
    }

    async getEvents(workflowId: string): Promise<WorkflowEvent[]> {
        await this._init;
        const result = await this.client.execute({
            sql: `SELECT * FROM workflow_events WHERE workflow_id = ? ORDER BY timestamp ASC`,
            args: [workflowId],
        });
        return result.rows.map((r) => rowToWorkflowEvent(r as { id: string; workflow_id: string; type: string; timestamp: number; payload: string | null }));
    }

    async deleteEvents(workflowId: string): Promise<void> {
        await this._init;
        await this.client.execute({ sql: `DELETE FROM workflow_events WHERE workflow_id = ?`, args: [workflowId] });
    }

    async close(): Promise<void> {
        this.client.close();
    }
}

// ── Redis (ioredis) ─────────────────────────────────────────────────────────

const MISSING_REDIS =
    '[personaforge/execution] RedisEventStore requires ioredis.\n' +
    '  Install: npm install ioredis';

interface RedisClientLike {
    rpush(key: string, ...values: string[]): Promise<number>;
    lrange(key: string, start: number, stop: number): Promise<string[]>;
    del(key: string): Promise<number>;
    keys(pattern: string): Promise<string[]>;
    expire(key: string, seconds: number): Promise<number>;
    quit(): Promise<string>;
}

type RedisCtor = new (url?: string, opts?: Record<string, unknown>) => RedisClientLike;

const REDIS_KEY_PREFIX = 'durable:wf:';
const REDIS_TTL_SECONDS = 7 * 86_400;

export class RedisEventStore implements EventStore {
    private client: RedisClientLike;

    constructor(clientOrUrl: RedisClientLike | string) {
        if (typeof clientOrUrl === 'object') {
            this.client = clientOrUrl;
        } else {
            let Redis: RedisCtor;
            try {
                const loaded: unknown = _require('ioredis');
                const ctor = typeof loaded === 'function'
                    ? loaded
                    : (loaded as { default?: unknown; Redis?: unknown }).default ?? (loaded as { Redis?: unknown }).Redis;
                if (typeof ctor !== 'function') throw new Error('ioredis default export is not a constructor');
                Redis = ctor as RedisCtor;
            } catch {
                throw new Error(MISSING_REDIS);
            }
            this.client = new Redis(clientOrUrl);
        }
    }

    static create(url?: string): RedisEventStore {
        return new RedisEventStore(url ?? 'redis://localhost:6379');
    }

    private _key(workflowId: string): string {
        return `${REDIS_KEY_PREFIX}${workflowId}`;
    }

    async append(workflowId: string, event: Omit<WorkflowEvent, 'id' | 'timestamp'>): Promise<WorkflowEvent> {
        const fullEvent: WorkflowEvent = {
            ...event,
            id: generateEntityId(),
            timestamp: Date.now(),
        };
        const key = this._key(workflowId);
        await this.client.rpush(key, JSON.stringify(fullEvent));
        // Rolling TTL — keeps dormant workflow histories from accumulating forever.
        await this.client.expire(key, REDIS_TTL_SECONDS).catch(() => undefined);
        return fullEvent;
    }

    async getEvents(workflowId: string): Promise<WorkflowEvent[]> {
        const key = this._key(workflowId);
        const raw = await this.client.lrange(key, 0, -1);
        return raw.map((s) => JSON.parse(s) as WorkflowEvent);
    }

    async deleteEvents(workflowId: string): Promise<void> {
        await this.client.del(this._key(workflowId));
    }

    async close(): Promise<void> {
        await this.client.quit();
    }
}

// ── Postgres (node-postgres / pg) ────────────────────────────────────────────

const MISSING_PG =
    '[personaforge/execution] PgEventStore requires pg.\n' +
    '  Install: npm install pg\n' +
    '           npm install -D @types/pg';

interface PgPoolLike {
    query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
    end(): Promise<void>;
}

type PgPoolCtor = new (config: Record<string, unknown>) => PgPoolLike;

export class PgEventStore implements EventStore {
    private pool: PgPoolLike;
    private _initialized = false;
    private _init: Promise<void>;

    constructor(poolOrConfig: PgPoolLike | string | Record<string, unknown>) {
        if (typeof poolOrConfig === 'object' && 'query' in poolOrConfig) {
            this.pool = poolOrConfig as PgPoolLike;
        } else {
            let Pool: PgPoolCtor;
            try {
                const pg = _require('pg') as { Pool: PgPoolCtor; default?: { Pool: PgPoolCtor } };
                Pool = pg.Pool ?? pg.default?.Pool;
            } catch {
                throw new Error(MISSING_PG);
            }
            if (!Pool) throw new Error(MISSING_PG);
            const config = typeof poolOrConfig === 'string'
                ? { connectionString: poolOrConfig }
                : poolOrConfig;
            this.pool = new Pool(config as Record<string, unknown>);
        }
        this._init = this._ensureTable();
    }

    static create(connectionString?: string): PgEventStore {
        return new PgEventStore(connectionString ?? 'postgres://localhost:5432/personaforge');
    }

    private async _ensureTable(): Promise<void> {
        if (this._initialized) return;
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS workflow_events (
                id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                type TEXT NOT NULL,
                timestamp BIGINT NOT NULL,
                payload JSONB
            )
        `);
        await this.pool.query(`CREATE INDEX IF NOT EXISTS idx_workflow_events_wf ON workflow_events (workflow_id, timestamp)`);
        this._initialized = true;
    }

    async append(workflowId: string, event: Omit<WorkflowEvent, 'id' | 'timestamp'>): Promise<WorkflowEvent> {
        await this._init;
        const fullEvent: WorkflowEvent = {
            ...event,
            id: generateEntityId(),
            workflowId,
            timestamp: Date.now(),
        };
        await this.pool.query(
            `INSERT INTO workflow_events (id, workflow_id, type, timestamp, payload) VALUES ($1, $2, $3, $4, $5)`,
            [fullEvent.id, fullEvent.workflowId, fullEvent.type, fullEvent.timestamp, fullEvent.payload ? JSON.stringify(fullEvent.payload) : null],
        );
        return fullEvent;
    }

    async getEvents(workflowId: string): Promise<WorkflowEvent[]> {
        await this._init;
        const result = await this.pool.query(
            `SELECT * FROM workflow_events WHERE workflow_id = $1 ORDER BY timestamp ASC`,
            [workflowId],
        );
        return result.rows.map((r) => ({
            id: r['id'] as string,
            workflowId: r['workflow_id'] as string,
            type: r['type'] as WorkflowEventType,
            timestamp: Number(r['timestamp']),
            payload: r['payload'] ? (typeof r['payload'] === 'string' ? JSON.parse(r['payload'] as string) : r['payload']) : undefined,
        }));
    }

    async deleteEvents(workflowId: string): Promise<void> {
        await this._init;
        await this.pool.query(`DELETE FROM workflow_events WHERE workflow_id = $1`, [workflowId]);
    }

    async close(): Promise<void> {
        await this.pool.end();
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function rowToWorkflowEvent(row: { id: string; workflow_id: string; type: string; timestamp: number; payload: string | null }): WorkflowEvent {
    return {
        id: row.id,
        workflowId: row.workflow_id,
        type: row.type as WorkflowEventType,
        timestamp: row.timestamp,
        payload: row.payload ? JSON.parse(row.payload) : undefined,
    };
}

// ── Event Store Factory ─────────────────────────────────────────────────────

export type EventStoreDriver = 'memory' | 'sqlite' | 'libsql' | 'redis' | 'postgres' | 'custom';

export interface CreateEventStoreConfig {
    /** Storage driver. Default: 'memory' (zero config). */
    driver?: EventStoreDriver;
    /** better-sqlite3 file path (driver 'sqlite'). Default: ':memory:'. */
    path?: string;
    /** libSQL / Redis / Postgres URL string. */
    url?: string;
    /** libSQL auth token (Turso cloud). */
    authToken?: string;
    /**
     * Fall back to in-memory when the requested driver's dependency is not
     * installed. Default true.
     */
    fallbackToMemory?: boolean;
    /**
     * Pre-built client/pool/instance — pass your own connection pool, shared
     * Redis client, or an existing libSQL handle so the store integrates with
     * your infrastructure instead of owning the connection lifecycle.
     *
     * | driver    | type                                          |
     * |-----------|-----------------------------------------------|
     * | `sqlite`  | better-sqlite3 `Database` instance           |
     * | `libsql`  | `@libsql/client` `Client` instance           |
     * | `redis`   | ioredis `Redis` instance                     |
     * | `postgres`| node-postgres `Pool` instance                |
     */
    client?: unknown;
    /**
     * Bring your own EventStore implementation (driver `'custom'`).
     * Pass a ready-to-use store, or a factory `() => EventStore`.
     *
     * ```ts
     * import { createEventStore } from 'personaforge/execution';
     * import { MongoEventStore } from './my-adapters.js';
     * const store = createEventStore({ driver: 'custom', custom: () => new MongoEventStore(url) });
     * ```
     */
    custom?: EventStore | (() => EventStore);
}

const SHARED_LIBSQL_MEMORY = 'file::memory:?cache=shared';

/**
 * Create an EventStore. Pick the driver that fits your deployment:
 *
 * - `memory`   (default) — zero-config dev, no persistence
 * - `sqlite`   — better-sqlite3, local file, survives restarts
 * - `libsql`   — @libsql/client, local file / shared-memory / Turso cloud
 * - `redis`    — ioredis, distributed, single-list per workflow
 * - `postgres` — node-postgres, distributed SQL, JSONB payloads
 *
 * @example
 * ```ts
 * import { createEventStore } from 'personaforge/execution';
 *
 * // Zero config (memory)
 * const store = createEventStore();
 *
 * // Durable local file via libSQL
 * const store = createEventStore({ driver: 'libsql', url: 'file:./workflows.db' });
 *
 * // Distributed — Redis
 * const store = createEventStore({ driver: 'redis', url: 'redis://localhost:6379' });
 *
 * // Distributed — Postgres
 * const store = createEventStore({ driver: 'postgres', url: 'postgres://localhost:5432/personaforge' });
 * ```
 */
export function createEventStore(config: CreateEventStoreConfig = {}): EventStore {
    const driver = config.driver ?? 'memory';
    const fallback = config.fallbackToMemory ?? true;

    switch (driver) {
        case 'memory':
            return new InMemoryEventStore();
        case 'sqlite': {
            try {
                if (config.client) return new SqliteEventStore(config.client as any);
                return new SqliteEventStore(config.path ?? ':memory:');
            } catch (e) {
                if (!fallback) throw e;
                return new InMemoryEventStore();
            }
        }
        case 'libsql': {
            try {
                if (config.client) return new LibSqlEventStore(config.client as any);
                return new LibSqlEventStore(config.url ?? SHARED_LIBSQL_MEMORY, config.authToken);
            } catch (e) {
                if (!fallback) throw e;
                return new InMemoryEventStore();
            }
        }
        case 'redis': {
            try {
                if (config.client) return new RedisEventStore(config.client as any);
                return new RedisEventStore(config.url ?? 'redis://localhost:6379');
            } catch (e) {
                if (!fallback) throw e;
                return new InMemoryEventStore();
            }
        }
        case 'postgres': {
            try {
                if (config.client) return new PgEventStore(config.client as any);
                return new PgEventStore(config.url ?? 'postgres://localhost:5432/personaforge');
            } catch (e) {
                if (!fallback) throw e;
                return new InMemoryEventStore();
            }
        }
        case 'custom': {
            if (!config.custom) throw new Error('[personaforge/execution] Driver "custom" requires a `custom` store or factory.');
            return typeof config.custom === 'function'
                ? (config.custom as () => EventStore)()
                : config.custom as EventStore;
        }
        default:
            return new InMemoryEventStore();
    }
}

// ── Retry Policies ─────────────────────────────────────────────────────────

export interface DurableRetryPolicy {
    attempts: number;
    strategy: 'exponential' | 'linear' | 'fixed';
    backoffMs?: number;
    deadLetterQueue?: boolean;
}

// ── Durable Context ────────────────────────────────────────────────────────

export class DurableWorkflowContext {
    private stepResults: Map<string, any> = new Map();
    private currentEvents: WorkflowEvent[] = [];

    constructor(
        public readonly workflowId: string,
        private readonly eventStore: EventStore,
    ) {}

    /** Internal: hydrate context from event history for replay. */
    async loadHistory(): Promise<void> {
        this.currentEvents = await this.eventStore.getEvents(this.workflowId);
        for (const event of this.currentEvents) {
            if (event.type === 'StepCompleted') {
                this.stepResults.set(event.payload.stepId, event.payload.result);
            }
        }
    }

    /** Returns the number of events recorded for this workflow (useful for testing and observability). */
    async getEventCount(): Promise<number> {
        return (await this.eventStore.getEvents(this.workflowId)).length;
    }

    /** 
     * Durable Step Execution.
     * If the step was already completed in history, returns the cached result without re-executing.
     */
    async step<T>(stepId: string, fn: () => Promise<T>, retryPolicy?: DurableRetryPolicy): Promise<T> {
        // Check if we already have the result from a previous run
        if (this.stepResults.has(stepId)) {
            return this.stepResults.get(stepId) as T;
        }

        await this.eventStore.append(this.workflowId, {
            type: 'StepStarted',
            workflowId: this.workflowId,
            payload: { stepId }
        });

        let attempts = 0;
        const maxAttempts = retryPolicy?.attempts ?? 1;

        while (attempts < maxAttempts) {
            try {
                const result = await fn();
                await this.eventStore.append(this.workflowId, {
                    type: 'StepCompleted',
                    workflowId: this.workflowId,
                    payload: { stepId, result }
                });
                this.stepResults.set(stepId, result);
                return result;
            } catch (error) {
                attempts++;
                const errMessage = error instanceof Error ? error.message : String(error);
                await this.eventStore.append(this.workflowId, {
                    type: 'StepFailed',
                    workflowId: this.workflowId,
                    payload: { stepId, error: errMessage, attempt: attempts }
                });
                if (attempts >= maxAttempts) {
                    if (retryPolicy?.deadLetterQueue) {
                        // In a real system, we would publish to a DLQ here
                        console.warn(`[DLQ] Step ${stepId} failed permanently: ${errMessage}`);
                    }
                    throw error;
                }
                // Apply backoff strategy
                const delay = this.calculateBackoff(attempts, retryPolicy);
                if (delay > 0) {
                    await new Promise(r => setTimeout(r, delay));
                }
            }
        }
        // Unreachable: loop always returns or throws
        throw new Error('DurableWorkflowContext.step: unreachable');
    }

    private calculateBackoff(attempt: number, policy?: DurableRetryPolicy): number {
        if (!policy || !policy.backoffMs) return 0;
        if (policy.strategy === 'fixed') return policy.backoffMs;
        if (policy.strategy === 'linear') return policy.backoffMs * attempt;
        if (policy.strategy === 'exponential') return policy.backoffMs * Math.pow(2, attempt - 1);
        return 0;
    }

    /** Pause the workflow and wait for external input (e.g. human intervention). */
    async waitForHuman(reason: string = 'Waiting for human input'): Promise<never> {
        await this.eventStore.append(this.workflowId, {
            type: 'WorkflowPaused',
            workflowId: this.workflowId,
            payload: { reason }
        });
        throw new WorkflowPausedError(reason);
    }

    /** Explicitly create a savepoint. */
    async checkpoint(): Promise<void> {
        await this.eventStore.append(this.workflowId, {
            type: 'CheckpointCreated',
            workflowId: this.workflowId
        });
    }
}

// ── Errors ─────────────────────────────────────────────────────────────────

export class WorkflowPausedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WorkflowPausedError';
    }
}

export class WorkflowStateError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'WorkflowStateError';
    }
}

function getTerminalEvent(events: WorkflowEvent[]):
    | { status: 'completed'; event: WorkflowEvent }
    | { status: 'failed'; event: WorkflowEvent }
    | undefined {
    for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        if (!event) continue;
        if (event.type === 'WorkflowCompleted') return { status: 'completed', event };
        if (event.type === 'WorkflowFailed') return { status: 'failed', event };
    }
    return undefined;
}

function getLastLifecycleEvent(events: WorkflowEvent[]): WorkflowEvent | undefined {
    for (let index = events.length - 1; index >= 0; index--) {
        const event = events[index];
        if (!event) continue;
        if (
            event.type === 'WorkflowStarted'
            || event.type === 'WorkflowPaused'
            || event.type === 'WorkflowResumed'
            || event.type === 'WorkflowCompleted'
            || event.type === 'WorkflowFailed'
        ) {
            return event;
        }
    }
    return undefined;
}

// ── Durable Runtime ────────────────────────────────────────────────────────

export type WorkflowFunction<TInput, TOutput> = (ctx: DurableWorkflowContext, input: TInput) => Promise<TOutput>;

export class DurableRuntime {
    constructor(private readonly eventStore: EventStore = new InMemoryEventStore()) {}

    /**
     * Start or resume a workflow execution.
     */
    async execute<TInput, TOutput>(
        workflowId: string,
        workflowFn: WorkflowFunction<TInput, TOutput>,
        input: TInput
    ): Promise<TOutput | { status: 'paused'; reason: string }> {
        const events = await this.eventStore.getEvents(workflowId);
        const terminal = getTerminalEvent(events);
        if (terminal?.status === 'completed') {
            return terminal.event.payload?.result as TOutput;
        }
        if (terminal?.status === 'failed') {
            throw new WorkflowStateError(
                terminal.event.payload?.error
                    ? `Workflow '${workflowId}' has already failed: ${terminal.event.payload.error}`
                    : `Workflow '${workflowId}' has already failed.`,
            );
        }

        const ctx = new DurableWorkflowContext(workflowId, this.eventStore);
        
        // 1. Rehydrate state from Event Store
        await ctx.loadHistory();

        // 2. Start or Resume
        if (events.length === 0) {
            await this.eventStore.append(workflowId, {
                type: 'WorkflowStarted',
                workflowId,
                payload: { input }
            });
        } else {
            await this.eventStore.append(workflowId, {
                type: 'WorkflowResumed',
                workflowId
            });
        }

        try {
            // 3. Execute workflow function
            // Steps that are already in the event store will be skipped by the context
            const result = await workflowFn(ctx, input);

            await this.eventStore.append(workflowId, {
                type: 'WorkflowCompleted',
                workflowId,
                payload: { result }
            });

            return result;

        } catch (error) {
            if (error instanceof WorkflowPausedError) {
                return { status: 'paused', reason: error.message };
            }

            const errMessage = error instanceof Error ? error.message : String(error);
            await this.eventStore.append(workflowId, {
                type: 'WorkflowFailed',
                workflowId,
                payload: { error: errMessage }
            });
            throw error;
        }
    }

    /**
     * Resume a paused workflow by re-running it.
     */
    async resume<TInput, TOutput>(
        workflowId: string,
        workflowFn: WorkflowFunction<TInput, TOutput>,
        input: TInput
    ): Promise<TOutput | { status: 'paused'; reason: string }> {
        const events = await this.eventStore.getEvents(workflowId);
        if (events.length === 0) {
            throw new WorkflowStateError(`Workflow '${workflowId}' has not been started.`);
        }

        const terminal = getTerminalEvent(events);
        if (terminal?.status === 'completed') {
            throw new WorkflowStateError(`Workflow '${workflowId}' has already completed.`);
        }
        if (terminal?.status === 'failed') {
            throw new WorkflowStateError(`Workflow '${workflowId}' has already failed.`);
        }

        const lastLifecycleEvent = getLastLifecycleEvent(events);
        if (lastLifecycleEvent?.type !== 'WorkflowPaused') {
            throw new WorkflowStateError(
                `Workflow '${workflowId}' is not paused and cannot be resumed.`,
            );
        }

        return this.execute(workflowId, workflowFn, input);
    }

    /**
     * Full replay of a workflow (useful for auditing/debugging).
     * This simply returns the chronological events.
     */
    async replay(workflowId: string): Promise<WorkflowEvent[]> {
        return this.eventStore.getEvents(workflowId);
    }
}
