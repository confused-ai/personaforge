/**
 * Event Store — Durable event persistence layer
 *
 * Provides event-sourced durability for graph executions.
 * The architecture follows CQRS: events are the write-side (append-only),
 * state reconstruction via replay is the read-side.
 *
 * Implementations:
 * - InMemoryEventStore: for testing and single-process scenarios
 * - SqliteEventStore: for local persistence without external deps
 *
 * Production implementations (bring your own):
 * - PostgresEventStore, RedisEventStore, KafkaEventStore
 * - All follow the same EventStore interface
 *
 * Key invariants:
 * - Events are append-only (never modified or deleted)
 * - Events are ordered by sequence within an execution
 * - Checkpoints are idempotent snapshots for fast recovery
 * - append() is idempotent on event.id (safe to retry)
 */

import {
  type EventStore,
  type GraphEvent,
  type Checkpoint,
  type ExecutionId,
  GraphEventType,
} from './types.js';

// ── In-Memory Event Store ───────────────────────────────────────────────────

/**
 * Non-durable event store for testing and development.
 * Events are lost on process restart.
 */
export class InMemoryEventStore implements EventStore {
  private events: Map<string, GraphEvent[]> = new Map();
  private checkpoints: Map<string, Checkpoint> = new Map();
  private eventIds: Set<string> = new Set();

  async append(events: GraphEvent[]): Promise<void> {
    for (const event of events) {
      // Idempotency: skip if already stored
      if (this.eventIds.has(event.id)) continue;

      this.eventIds.add(event.id);
      const key = event.executionId;
      if (!this.events.has(key)) {
        this.events.set(key, []);
      }
      this.events.get(key)!.push(event);
    }
  }

  async load(executionId: ExecutionId): Promise<GraphEvent[]> {
    // Events are appended in sequence order — no sort needed
    return this.events.get(executionId) ?? [];
  }

  async loadAfter(executionId: ExecutionId, afterSequence: number): Promise<GraphEvent[]> {
    // Array is already ordered; filter is O(n) without an extra sort
    return (this.events.get(executionId) ?? []).filter(e => e.sequence > afterSequence);
  }

  async getCheckpoint(executionId: ExecutionId): Promise<Checkpoint | null> {
    return this.checkpoints.get(executionId) ?? null;
  }

  async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    this.checkpoints.set(checkpoint.executionId, checkpoint);
  }

  async purge(executionId: ExecutionId): Promise<void> {
    const events = this.events.get(executionId);
    if (events) {
      for (const e of events) this.eventIds.delete(e.id);
    }
    this.events.delete(executionId);
    this.checkpoints.delete(executionId);
  }

  /** Test helper: get all events across all executions */
  getAllEvents(): GraphEvent[] {
    const all: GraphEvent[] = [];
    for (const events of this.events.values()) {
      all.push(...events);
    }
    return all.sort((a, b) => a.timestamp - b.timestamp);
  }

  /** Test helper: get event count for an execution */
  getEventCount(executionId: ExecutionId): number {
    return this.events.get(executionId)?.length ?? 0;
  }

  /** Clear all stored data */
  clear(): void {
    this.events.clear();
    this.checkpoints.clear();
    this.eventIds.clear();
  }
}

// ── SQLite Event Store ──────────────────────────────────────────────────────

/**
 * Durable event store backed by SQLite.
 * Zero external dependencies — uses the native SQLite binding (Bun/better-sqlite3).
 *
 * Schema:
 *   events(id TEXT PK, execution_id TEXT, graph_id TEXT, type TEXT,
 *          sequence INTEGER, node_id TEXT, data TEXT, timestamp INTEGER)
 *   checkpoints(execution_id TEXT PK, graph_id TEXT, state TEXT,
 *               sequence INTEGER, timestamp INTEGER)
 *
 * Performance:
 * - WAL mode for concurrent reads during writes
 * - Index on (execution_id, sequence) for fast replay
 * - Batch inserts in a transaction for append
 */
export class SqliteEventStore implements EventStore {
  private db: any;
  private stmts: {
    insert: any;
    loadAll: any;
    loadAfter: any;
    getCheckpoint: any;
    upsertCheckpoint: any;
  } | null = null;

  constructor(private dbPath: string) {}

  async init(): Promise<this> {
    // Try Bun's native SQLite first, fall back to better-sqlite3
    try {
      const { Database } = await import('bun:sqlite' as string);
      this.db = new Database(this.dbPath);
    } catch {
      try {
        const mod = await import('better-sqlite3' as string);
        const Database = mod.default ?? mod;
        this.db = new Database(this.dbPath);
      } catch {
        throw new Error(
          'SqliteEventStore requires either Bun runtime or "better-sqlite3" package. ' +
          'Install: npm install better-sqlite3'
        );
      }
    }

    // Enable WAL mode for better concurrent performance
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS graph_events (
        id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        graph_id TEXT NOT NULL,
        type TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        node_id TEXT,
        data TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_exec_seq
        ON graph_events(execution_id, sequence);

      CREATE TABLE IF NOT EXISTS graph_checkpoints (
        execution_id TEXT PRIMARY KEY,
        graph_id TEXT NOT NULL,
        state TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        timestamp INTEGER NOT NULL
      );
    `);

    // Prepare statements
    this.stmts = {
      insert: this.db.prepare(`
        INSERT OR IGNORE INTO graph_events (id, execution_id, graph_id, type, sequence, node_id, data, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      loadAll: this.db.prepare(`
        SELECT * FROM graph_events WHERE execution_id = ? ORDER BY sequence ASC
      `),
      loadAfter: this.db.prepare(`
        SELECT * FROM graph_events WHERE execution_id = ? AND sequence > ? ORDER BY sequence ASC
      `),
      getCheckpoint: this.db.prepare(`
        SELECT * FROM graph_checkpoints WHERE execution_id = ?
      `),
      upsertCheckpoint: this.db.prepare(`
        INSERT OR REPLACE INTO graph_checkpoints (execution_id, graph_id, state, sequence, timestamp)
        VALUES (?, ?, ?, ?, ?)
      `),
    };

    return this;
  }

  async append(events: GraphEvent[]): Promise<void> {
    this._ensureInit();

    // Batch insert in a transaction for performance
    const insertMany = this.db.transaction((evts: GraphEvent[]) => {
      for (const event of evts) {
        this.stmts!.insert.run(
          event.id,
          event.executionId,
          event.graphId,
          event.type,
          event.sequence,
          event.nodeId ?? null,
          event.data ? JSON.stringify(event.data) : null,
          event.timestamp
        );
      }
    });

    insertMany(events);
  }

  async load(executionId: ExecutionId): Promise<GraphEvent[]> {
    this._ensureInit();
    const rows = this.stmts!.loadAll.all(executionId);
    return rows.map(this._rowToEvent);
  }

  async loadAfter(executionId: ExecutionId, afterSequence: number): Promise<GraphEvent[]> {
    this._ensureInit();
    const rows = this.stmts!.loadAfter.all(executionId, afterSequence);
    return rows.map(this._rowToEvent);
  }

  async getCheckpoint(executionId: ExecutionId): Promise<Checkpoint | null> {
    this._ensureInit();
    const row = this.stmts!.getCheckpoint.get(executionId);
    if (!row) return null;

    return {
      executionId: row.execution_id as ExecutionId,
      graphId: row.graph_id as string as any,
      state: JSON.parse(row.state as string),
      sequence: row.sequence as number,
      timestamp: row.timestamp as number,
    };
  }

  async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    this._ensureInit();
    this.stmts!.upsertCheckpoint.run(
      checkpoint.executionId,
      checkpoint.graphId,
      JSON.stringify(checkpoint.state),
      checkpoint.sequence,
      checkpoint.timestamp
    );
  }

  async purge(executionId: ExecutionId): Promise<void> {
    this._ensureInit();
    const tx = this.db.transaction((id: string) => {
      this.db.prepare('DELETE FROM graph_events WHERE execution_id = ?').run(id);
      this.db.prepare('DELETE FROM graph_checkpoints WHERE execution_id = ?').run(id);
    });
    tx(executionId);
  }

  close(): void {
    this.db?.close?.();
  }

  private _ensureInit(): void {
    if (!this.stmts) {
      throw new Error('SqliteEventStore not initialized. Call .init() first.');
    }
  }

  private _rowToEvent(row: any): GraphEvent {
    return {
      id: row.id,
      type: row.type as GraphEventType,
      executionId: row.execution_id as ExecutionId,
      graphId: row.graph_id as string as any,
      timestamp: row.timestamp as number,
      sequence: row.sequence as number,
      nodeId: row.node_id as string as any ?? undefined,
      data: row.data ? JSON.parse(row.data) : undefined,
    };
  }
}
