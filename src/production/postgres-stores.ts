/**
 * PostgreSQL-backed stores for `personaforge`.
 *
 * Provides durable, production-ready implementations of:
 *   - `AuditStore`            → `PostgresAuditStore`
 *   - `AgentCheckpointStore`  → `PostgresCheckpointStore`
 *
 * Both use a minimal `pg`-compatible client interface (pool or client) so they
 * work with `pg`, `postgres`, `node-postgres`, `@neondatabase/serverless`, etc.
 *
 * ## Setup
 *
 * Run the included DDL once:
 * ```ts
 * import { createPostgresAuditStore, createPostgresCheckpointStore } from 'personaforge/production';
 * import pg from 'pg';
 *
 * const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
 *
 * const auditStore      = await createPostgresAuditStore(pool);
 * const checkpointStore = await createPostgresCheckpointStore(pool);
 * ```
 *
 * The `create*` factory runs `CREATE TABLE IF NOT EXISTS` automatically.
 *
 * ## Peer dependency
 *
 * `pg` (or compatible) must be installed by the consuming application.
 * This file imports nothing at module load time — the pool is provided by the caller.
 */

import type { AuditEntry, AuditFilter, AuditStore } from './audit-store.js';
import type { AgentCheckpointStore, AgentRunState } from './checkpoint.js';

// ── Minimal `pg`-compatible pool interface ────────────────────────────────
// We type only the subset we need so callers can use any pg-compatible driver.

export interface PgQueryable {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[] }>;
}

// ── DDL ───────────────────────────────────────────────────────────────────

const AUDIT_DDL = `
CREATE TABLE IF NOT EXISTS personaforge_audit_log (
  id               TEXT        NOT NULL PRIMARY KEY,
  timestamp        TIMESTAMPTZ NOT NULL DEFAULT now(),
  method           TEXT        NOT NULL,
  path             TEXT        NOT NULL,
  status           INTEGER     NOT NULL,
  agent_name       TEXT,
  session_id       TEXT,
  user_id          TEXT,
  tenant_id        TEXT,
  prompt_hash      TEXT,
  tools_called     JSONB,
  finish_reason    TEXT,
  duration_ms      INTEGER,
  cost_usd         NUMERIC(12,8),
  ip               TEXT,
  idempotency_key  TEXT,
  idempotency_hit  BOOLEAN
);
CREATE INDEX IF NOT EXISTS cai_audit_timestamp  ON personaforge_audit_log (timestamp DESC);
CREATE INDEX IF NOT EXISTS cai_audit_user_id    ON personaforge_audit_log (user_id);
CREATE INDEX IF NOT EXISTS cai_audit_agent_name ON personaforge_audit_log (agent_name);
CREATE INDEX IF NOT EXISTS cai_audit_tenant_id  ON personaforge_audit_log (tenant_id);
`.trim();

const CHECKPOINT_DDL = `
CREATE TABLE IF NOT EXISTS personaforge_checkpoints (
  run_id       TEXT        NOT NULL PRIMARY KEY,
  step         INTEGER     NOT NULL,
  state        JSONB       NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
`.trim();

// ── PostgresAuditStore ────────────────────────────────────────────────────

/**
 * PostgreSQL-backed `AuditStore`.
 *
 * All writes are append-only (INSERT, never UPDATE/DELETE except `purge()`).
 * The table name `personaforge_audit_log` is fixed to avoid SQL injection via
 * dynamic identifiers.
 */
export class PostgresAuditStore implements AuditStore {
  private constructor(private readonly _db: PgQueryable) {}

  /** Create and initialize the store (runs DDL). */
  static async create(db: PgQueryable): Promise<PostgresAuditStore> {
    await db.query(AUDIT_DDL);
    return new PostgresAuditStore(db);
  }

  async append(entry: AuditEntry): Promise<void> {
    await this._db.query(
      `INSERT INTO personaforge_audit_log (
         id, timestamp, method, path, status,
         agent_name, session_id, user_id, tenant_id, prompt_hash,
         tools_called, finish_reason, duration_ms, cost_usd, ip,
         idempotency_key, idempotency_hit
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO NOTHING`,
      [
        entry.id,
        entry.timestamp,
        entry.method,
        entry.path,
        entry.status,
        entry.agentName         ?? null,
        entry.sessionId         ?? null,
        entry.userId            ?? null,
        entry.tenantId          ?? null,
        entry.promptHash        ?? null,
        entry.toolsCalled       ? JSON.stringify(entry.toolsCalled) : null,
        entry.finishReason      ?? null,
        entry.durationMs        ?? null,
        entry.costUsd           ?? null,
        entry.ip                ?? null,
        entry.idempotencyKey    ?? null,
        entry.idempotencyHit    ?? null,
      ],
    );
  }

  async query(filter?: AuditFilter): Promise<AuditEntry[]> {
    const { sql, params } = buildAuditWhere(filter);
    const offset = filter?.offset ?? 0;
    const limit  = filter?.limit  ?? 1_000;

    const { rows } = await this._db.query<Record<string, unknown>>(
      `SELECT * FROM personaforge_audit_log ${sql}
       ORDER BY timestamp DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return rows.map(rowToAuditEntry);
  }

  async count(filter?: AuditFilter): Promise<number> {
    const { sql, params } = buildAuditWhere(filter);
    const { rows } = await this._db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM personaforge_audit_log ${sql}`,
      params,
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }

  async purge(beforeDate: Date): Promise<number> {
    const { rows } = await this._db.query<{ count: string }>(
      `WITH deleted AS (
         DELETE FROM personaforge_audit_log WHERE timestamp < $1 RETURNING id
       ) SELECT COUNT(*)::text AS count FROM deleted`,
      [beforeDate.toISOString()],
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }
}

function buildAuditWhere(filter?: AuditFilter): { sql: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];
  const p = () => `$${params.length}`;

  if (filter?.agentName)  { params.push(filter.agentName);           conds.push(`agent_name = ${p()}`); }
  if (filter?.userId)     { params.push(filter.userId);              conds.push(`user_id = ${p()}`);    }
  if (filter?.tenantId)   { params.push(filter.tenantId);            conds.push(`tenant_id = ${p()}`);  }
  if (filter?.sessionId)  { params.push(filter.sessionId);           conds.push(`session_id = ${p()}`); }
  if (filter?.status)     { params.push(filter.status);              conds.push(`status = ${p()}`);     }
  if (filter?.since)      { params.push(filter.since.toISOString()); conds.push(`timestamp >= ${p()}`); }
  if (filter?.until)      { params.push(filter.until.toISOString()); conds.push(`timestamp <= ${p()}`); }

  return { sql: conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '', params };
}

function rowToAuditEntry(row: Record<string, unknown>): AuditEntry {
  return {
    id:               row['id']               as string,
    timestamp:        row['timestamp'] instanceof Date
      ? (row['timestamp'] as Date).toISOString()
      : row['timestamp'] as string,
    method:           row['method']           as string,
    path:             row['path']             as string,
    status:           row['status']           as number,
    agentName:        (row['agent_name']       as string | null)  ?? undefined,
    sessionId:        (row['session_id']       as string | null)  ?? undefined,
    userId:           (row['user_id']          as string | null)  ?? undefined,
    tenantId:         (row['tenant_id']        as string | null)  ?? undefined,
    promptHash:       (row['prompt_hash']      as string | null)  ?? undefined,
    toolsCalled:      row['tools_called']
      ? (typeof row['tools_called'] === 'string'
        ? JSON.parse(row['tools_called'] as string)
        : row['tools_called']) as string[]
      : undefined,
    finishReason:     (row['finish_reason']    as string | null)  ?? undefined,
    durationMs:       (row['duration_ms']      as number | null)  ?? undefined,
    costUsd:          (row['cost_usd']         != null ? parseFloat(String(row['cost_usd'])) : undefined),
    ip:               (row['ip']               as string | null)  ?? undefined,
    idempotencyKey:   (row['idempotency_key']  as string | null)  ?? undefined,
    idempotencyHit:   (row['idempotency_hit']  as boolean | null) ?? undefined,
  };
}

// ── PostgresCheckpointStore ───────────────────────────────────────────────

/**
 * PostgreSQL-backed `AgentCheckpointStore`.
 *
 * Uses an UPSERT pattern so `save()` is idempotent. Checkpoints are stored as
 * JSONB in the `personaforge_checkpoints` table.
 */
export class PostgresCheckpointStore implements AgentCheckpointStore {
  private constructor(private readonly _db: PgQueryable) {}

  /** Create and initialize the store (runs DDL). */
  static async create(db: PgQueryable): Promise<PostgresCheckpointStore> {
    await db.query(CHECKPOINT_DDL);
    return new PostgresCheckpointStore(db);
  }

  async save(runId: string, step: number, state: AgentRunState): Promise<void> {
    await this._db.query(
      `INSERT INTO personaforge_checkpoints (run_id, step, state, updated_at)
       VALUES ($1, $2, $3::jsonb, now())
       ON CONFLICT (run_id) DO UPDATE
         SET step = EXCLUDED.step,
             state = EXCLUDED.state,
             updated_at = EXCLUDED.updated_at`,
      [runId, step, JSON.stringify(state)],
    );
  }

  async load(runId: string): Promise<{ step: number; state: AgentRunState } | null> {
    const { rows } = await this._db.query<{ step: number; state: unknown }>(
      `SELECT step, state FROM personaforge_checkpoints WHERE run_id = $1`,
      [runId],
    );
    if (!rows[0]) return null;
    const { step, state } = rows[0];
    const parsed: AgentRunState = typeof state === 'string' ? JSON.parse(state) : (state as AgentRunState);
    return { step, state: parsed };
  }

  async delete(runId: string): Promise<void> {
    await this._db.query(
      `DELETE FROM personaforge_checkpoints WHERE run_id = $1`,
      [runId],
    );
  }

  async listIncomplete(): Promise<string[]> {
    const { rows } = await this._db.query<{ run_id: string }>(
      `SELECT run_id FROM personaforge_checkpoints ORDER BY updated_at DESC`,
    );
    return rows.map(r => r.run_id);
  }
}

// ── Factory helpers ───────────────────────────────────────────────────────

/** Create and initialise a `PostgresAuditStore`. Runs DDL on first call. */
export async function createPostgresAuditStore(db: PgQueryable): Promise<PostgresAuditStore> {
  return PostgresAuditStore.create(db);
}

/** Create and initialise a `PostgresCheckpointStore`. Runs DDL on first call. */
export async function createPostgresCheckpointStore(db: PgQueryable): Promise<PostgresCheckpointStore> {
  return PostgresCheckpointStore.create(db);
}

// ── DDL ───────────────────────────────────────────────────────────────────

const RUNS_DDL = `
CREATE TABLE IF NOT EXISTS personaforge_runs (
  run_id            TEXT        NOT NULL PRIMARY KEY,
  tenant_id         TEXT,
  user_id           TEXT,
  agent_id          TEXT,
  agent_version     TEXT,
  session_id        TEXT,
  parent_run_id     TEXT,
  status            TEXT        NOT NULL DEFAULT 'running',
  input             TEXT,
  output            TEXT,
  start_time        TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_time          TIMESTAMPTZ,
  duration_ms       INTEGER,
  prompt_tokens     INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens      INTEGER DEFAULT 0,
  cost_usd          NUMERIC(12,8) DEFAULT 0,
  model             TEXT,
  provider          TEXT,
  finish_reason     TEXT,
  error             TEXT,
  error_code        TEXT,
  metadata          JSONB,
  trace_id          TEXT
);
CREATE INDEX IF NOT EXISTS cai_runs_tenant   ON personaforge_runs (tenant_id);
CREATE INDEX IF NOT EXISTS cai_runs_status   ON personaforge_runs (status);
CREATE INDEX IF NOT EXISTS cai_runs_agent    ON personaforge_runs (agent_id);
CREATE INDEX IF NOT EXISTS cai_runs_session  ON personaforge_runs (session_id);
CREATE INDEX IF NOT EXISTS cai_runs_start    ON personaforge_runs (start_time DESC);
`.trim();

// ── PostgresRunStore ──────────────────────────────────────────────────────

export class PostgresRunStore implements import('./run-store.js').RunStore {
  private constructor(private readonly _db: PgQueryable) {}

  static async create(db: PgQueryable): Promise<PostgresRunStore> {
    await db.query(RUNS_DDL);
    return new PostgresRunStore(db);
  }

  async save(record: import('./run-store.js').RunRecord): Promise<void> {
    await this._db.query(
      `INSERT INTO personaforge_runs (
         run_id, tenant_id, user_id, agent_id, agent_version, session_id, parent_run_id,
         status, input, output, start_time, end_time, duration_ms,
         prompt_tokens, completion_tokens, total_tokens, cost_usd,
         model, provider, finish_reason, error, error_code, metadata, trace_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       ON CONFLICT (run_id) DO UPDATE SET
         status=EXCLUDED.status, output=EXCLUDED.output, end_time=EXCLUDED.end_time,
         duration_ms=EXCLUDED.duration_ms, prompt_tokens=EXCLUDED.prompt_tokens,
         completion_tokens=EXCLUDED.completion_tokens, total_tokens=EXCLUDED.total_tokens,
         cost_usd=EXCLUDED.cost_usd, finish_reason=EXCLUDED.finish_reason,
         error=EXCLUDED.error, error_code=EXCLUDED.error_code,
         metadata=EXCLUDED.metadata`,
      [
        record.runId, record.tenantId ?? null, record.userId ?? null,
        record.agentId ?? null, record.agentVersion ?? null,
        record.sessionId ?? null, record.parentRunId ?? null,
        record.status, record.input ?? null, record.output ?? null,
        record.startTime, record.endTime ?? null, record.durationMs ?? null,
        record.promptTokens ?? 0, record.completionTokens ?? 0,
        record.totalTokens ?? 0, record.costUsd ?? 0,
        record.model ?? null, record.provider ?? null,
        record.finishReason ?? null, record.error ?? null,
        record.errorCode ?? null,
        record.metadata ? JSON.stringify(record.metadata) : null,
        record.traceId ?? null,
      ],
    );
  }

  async get(runId: string): Promise<import('./run-store.js').RunRecord | null> {
    const { rows } = await this._db.query<Record<string, unknown>>(
      'SELECT * FROM personaforge_runs WHERE run_id = $1',
      [runId],
    );
    if (!rows[0]) return null;
    return pgRowToRunRecord(rows[0]);
  }

  async list(filter?: import('./run-store.js').RunFilter): Promise<import('./run-store.js').RunRecord[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    let pidx = 1;
    if (filter?.tenantId) { clauses.push(`tenant_id = $${pidx++}`); params.push(filter.tenantId); }
    if (filter?.userId) { clauses.push(`user_id = $${pidx++}`); params.push(filter.userId); }
    if (filter?.agentId) { clauses.push(`agent_id = $${pidx++}`); params.push(filter.agentId); }
    if (filter?.sessionId) { clauses.push(`session_id = $${pidx++}`); params.push(filter.sessionId); }
    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      clauses.push(`status IN (${statuses.map(() => `$${pidx++}`).join(',')})`);
      params.push(...statuses);
    }
    if (filter?.startTime) { clauses.push(`start_time >= $${pidx++}`); params.push(filter.startTime); }
    if (filter?.endTime) { clauses.push(`start_time <= $${pidx++}`); params.push(filter.endTime); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const limit = filter?.limit ? ` LIMIT ${filter.limit}` : '';
    const offset = filter?.offset ? ` OFFSET ${filter.offset}` : '';
    const { rows } = await this._db.query<Record<string, unknown>>(
      `SELECT * FROM personaforge_runs${where} ORDER BY start_time DESC${limit}${offset}`,
      params,
    );
    return rows.map(pgRowToRunRecord);
  }

  async delete(runId: string): Promise<void> {
    await this._db.query('DELETE FROM personaforge_runs WHERE run_id = $1', [runId]);
  }

  async listIncomplete(): Promise<import('./run-store.js').RunRecord[]> {
    const { rows } = await this._db.query<Record<string, unknown>>(
      "SELECT * FROM personaforge_runs WHERE status IN ('running', 'paused', 'awaiting_approval') ORDER BY start_time ASC",
    );
    return rows.map(pgRowToRunRecord);
  }

  async count(filter?: import('./run-store.js').RunFilter): Promise<number> {
    const records = await this.list(filter);
    return records.length;
  }

  async close(): Promise<void> {
    // Connection lifecycle is managed by the caller (pool)
  }
}

function pgRowToRunRecord(row: Record<string, unknown>): import('./run-store.js').RunRecord {
  return {
    runId: row['run_id'] as string,
    tenantId: (row['tenant_id'] as string | null) ?? undefined,
    userId: (row['user_id'] as string | null) ?? undefined,
    agentId: (row['agent_id'] as string | null) ?? undefined,
    agentVersion: (row['agent_version'] as string | null) ?? undefined,
    sessionId: (row['session_id'] as string | null) ?? undefined,
    parentRunId: (row['parent_run_id'] as string | null) ?? undefined,
    status: row['status'] as import('./run-store.js').RunStatus,
    input: (row['input'] as string | null) ?? undefined,
    output: (row['output'] as string | null) ?? undefined,
    startTime: row['start_time'] instanceof Date
      ? (row['start_time'] as Date).toISOString()
      : row['start_time'] as string,
    endTime: row['end_time']
      ? (row['end_time'] instanceof Date
        ? (row['end_time'] as Date).toISOString()
        : row['end_time'] as string)
      : undefined,
    durationMs: (row['duration_ms'] as number | null) ?? undefined,
    promptTokens: (row['prompt_tokens'] as number | null) ?? undefined,
    completionTokens: (row['completion_tokens'] as number | null) ?? undefined,
    totalTokens: (row['total_tokens'] as number | null) ?? undefined,
    costUsd: (row['cost_usd'] != null ? parseFloat(String(row['cost_usd'])) : undefined),
    model: (row['model'] as string | null) ?? undefined,
    provider: (row['provider'] as string | null) ?? undefined,
    finishReason: (row['finish_reason'] as string | null) ?? undefined,
    error: (row['error'] as string | null) ?? undefined,
    errorCode: (row['error_code'] as string | null) ?? undefined,
    metadata: row['metadata']
      ? (typeof row['metadata'] === 'string'
        ? JSON.parse(row['metadata'] as string)
        : row['metadata']) as Record<string, unknown>
      : undefined,
    traceId: (row['trace_id'] as string | null) ?? undefined,
  };
}

/** Create and initialise a `PostgresRunStore`. Runs DDL on first call. */
export async function createPostgresRunStore(db: PgQueryable): Promise<PostgresRunStore> {
  return PostgresRunStore.create(db);
}
