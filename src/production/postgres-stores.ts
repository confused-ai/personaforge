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
