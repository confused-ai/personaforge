/**
 * Versioned policy store with deterministic rollback.
 *
 * Every promotion of a candidate policy creates an immutable `PolicyVersion`
 * in append-only history; every mutation (register / promote / reject /
 * rollback) is recorded in an audit trail. Rolling back is deterministic —
 * it always reverts to the numerically previous version — so operators can
 * unwind any change with full auditability.
 *
 * Two implementations: `InMemoryPolicyStore` (tests/dev) and
 * `SqlitePolicyStore` (production, better-sqlite3).
 */

import type {
    OptimizationDomain,
    PolicyAuditEvent,
    PolicyVariant,
    PolicyVariantStatus,
    PolicyVersion,
    PolicyVersionStatus,
} from './types.js';
import { AsyncLock } from './async-lock.js';

// ── Store contract ────────────────────────────────────────────────────────────

export interface PolicyListFilter {
    readonly agentId?: string;
    readonly domain?: OptimizationDomain;
    readonly status?: PolicyVariantStatus;
}

export interface PolicyStore {
    /** Register a new candidate variant (never auto-promotes). */
    registerVariant(
        v: Omit<PolicyVariant, 'createdAt' | 'status'> & { createdAt?: string },
    ): Promise<PolicyVariant>;
    getVariant(id: string): Promise<PolicyVariant | null>;
    listVariants(filter?: PolicyListFilter): Promise<PolicyVariant[]>;
    /** Mark a candidate as rejected (kept for audit). */
    reject(variantId: string): Promise<boolean>;
    /** Current active version (config snapshot) for an agent+domain. */
    getActive(agentId: string, domain: OptimizationDomain): Promise<PolicyVersion | null>;
    /**
     * Promote a candidate to active. Idempotent: if the variant is already the
     * active version it returns it unchanged. Returns the new version or null.
     */
    promote(variantId: string, opts?: { rationale?: string }): Promise<PolicyVersion | null>;
    /**
     * Deterministically revert to the previous version for an agent+domain.
     * Returns the restored version, or null when there is nothing to roll back.
     */
    rollback(
        agentId: string,
        domain: OptimizationDomain,
        opts?: { rationale?: string },
    ): Promise<PolicyVersion | null>;
    /** All versions for an agent (optionally a domain), newest first. */
    history(agentId: string, domain?: OptimizationDomain, limit?: number): Promise<PolicyVersion[]>;
    /** Append-only audit trail. */
    audit(agentId?: string, domain?: OptimizationDomain, limit?: number): Promise<PolicyAuditEvent[]>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const keyOf = (agentId: string, domain: OptimizationDomain): string =>
    `${agentId}\u0000${domain}`;

function nowIso(): string {
    return new Date().toISOString();
}

function audit(
    events: PolicyAuditEvent[],
    e: Omit<PolicyAuditEvent, 'id' | 'createdAt'>,
): void {
    events.push({ ...e, id: crypto.randomUUID(), createdAt: nowIso() });
}

// ── In-memory ─────────────────────────────────────────────────────────────────

export class InMemoryPolicyStore implements PolicyStore {
    private readonly _lock = new AsyncLock();
    private _variants: PolicyVariant[] = [];
    private _versions = new Map<string, PolicyVersion[]>();
    private _auditEvents: PolicyAuditEvent[] = [];

    private _history(agentId: string, domain: OptimizationDomain): PolicyVersion[] {
        const list = this._versions.get(keyOf(agentId, domain));
        return list ? [...list].sort((a, b) => a.version - b.version) : [];
    }

    private _updateVariant(id: string, patch: Partial<PolicyVariant>): void {
        this._variants = this._variants.map((v) => (v.id === id ? { ...v, ...patch } : v));
    }

    private _updateVersion(
        agentId: string,
        domain: OptimizationDomain,
        version: number,
        patch: Partial<PolicyVersion>,
    ): void {
        const key = keyOf(agentId, domain);
        const list = this._versions.get(key);
        if (!list) return;
        this._versions.set(key, list.map((v) => (v.version === version ? { ...v, ...patch } : v)));
    }

    async registerVariant(
        v: Omit<PolicyVariant, 'createdAt' | 'status'> & { createdAt?: string },
    ): Promise<PolicyVariant> {
        const full: PolicyVariant = {
            ...v,
            status: 'candidate',
            createdAt: v.createdAt ?? nowIso(),
        };
        this._variants.push(full);
        audit(this._auditEvents, {
            agentId: v.agentId, domain: v.domain, action: 'register', variantId: full.id,
        });
        return full;
    }

    async getVariant(id: string): Promise<PolicyVariant | null> {
        return this._variants.find((v) => v.id === id) ?? null;
    }

    async listVariants(filter: PolicyListFilter = {}): Promise<PolicyVariant[]> {
        let rows = [...this._variants];
        if (filter.agentId) rows = rows.filter((v) => v.agentId === filter.agentId);
        if (filter.domain) rows = rows.filter((v) => v.domain === filter.domain);
        if (filter.status) rows = rows.filter((v) => v.status === filter.status);
        return rows;
    }

    async reject(variantId: string): Promise<boolean> {
        return this._lock.run(async () => {
            const v = await this.getVariant(variantId);
            if (!v) return false;
            if (v.status === 'active') return false; // do not reject a live policy
            this._updateVariant(variantId, { status: 'rejected' });
            audit(this._auditEvents, {
                agentId: v.agentId, domain: v.domain, action: 'reject', variantId,
            });
            return true;
        });
    }

    async getActive(agentId: string, domain: OptimizationDomain): Promise<PolicyVersion | null> {
        return this._history(agentId, domain).find((v) => v.status === 'active') ?? null;
    }

    async promote(variantId: string, opts?: { rationale?: string }): Promise<PolicyVersion | null> {
        return this._lock.run(async () => {
            const variant = await this.getVariant(variantId);
            if (!variant) return null;
            const history = this._history(variant.agentId, variant.domain);
            const active = history.find((v) => v.status === 'active') ?? null;
            if (active && active.variantId === variantId) return active;

            const nextVersion = history.reduce((m, v) => Math.max(m, v.version), 0) + 1;
            const now = nowIso();

            // Supersede the previously active version + its variant (immutably).
            if (active) {
                this._updateVersion(active.agentId, active.domain, active.version, {
                    status: 'superseded',
                    rolledBackAt: undefined,
                });
                const priorVariant = await this.getVariant(active.variantId);
                if (priorVariant && priorVariant.status !== 'rejected') {
                    this._updateVariant(priorVariant.id, { status: 'superseded' });
                }
            }

            this._updateVariant(variantId, { status: 'active' });
            const version: PolicyVersion = {
                version: nextVersion,
                variantId,
                agentId: variant.agentId,
                domain: variant.domain,
                config: variant.config,
                status: 'active',
                promotedAt: now,
                promotedFrom: active?.version,
                rationale: opts?.rationale,
            };
            const key = keyOf(variant.agentId, variant.domain);
            const next = this._versions.get(key) ?? [];
            next.push(version);
            this._versions.set(key, next);
            audit(this._auditEvents, {
                agentId: variant.agentId, domain: variant.domain, action: 'promote',
                variantId, version: nextVersion, fromVersion: active?.version,
                detail: opts?.rationale,
            });
            return version;
        });
    }

    async rollback(
        agentId: string,
        domain: OptimizationDomain,
        opts?: { rationale?: string },
    ): Promise<PolicyVersion | null> {
        return this._lock.run(async () => {
            const history = this._history(agentId, domain);
            const active = history.find((v) => v.status === 'active') ?? null;
            if (!active || active.version <= 1) return null;
            const target = history.find((v) => v.version === active.version - 1) ?? null;
            if (!target) return null;
            const now = nowIso();

            this._updateVersion(agentId, domain, active.version, {
                status: 'rolled-back',
                rolledBackAt: now,
                rolledBackFrom: active.version,
            });
            this._updateVersion(agentId, domain, target.version, {
                status: 'active',
                rolledBackAt: undefined,
            });
            this._updateVariant(active.variantId, { status: 'rolled-back' });
            this._updateVariant(target.variantId, { status: 'active' });

            audit(this._auditEvents, {
                agentId, domain, action: 'rollback',
                variantId: active.variantId, version: target.version, fromVersion: active.version,
                detail: opts?.rationale,
            });
            return this._history(agentId, domain).find((v) => v.version === target.version) ?? null;
        });
    }

    async history(agentId: string, domain?: OptimizationDomain, limit?: number): Promise<PolicyVersion[]> {
        const all = [...this._versions.entries()]
            .filter(([key]) => key.startsWith(`${agentId}\u0000`))
            .flatMap(([, versions]) => versions)
            .filter((v) => (domain ? v.domain === domain : true))
            .sort((a, b) => b.version - a.version);
        return all.slice(0, limit ?? all.length);
    }

    async audit(agentId?: string, domain?: OptimizationDomain, limit?: number): Promise<PolicyAuditEvent[]> {
        let rows = [...this._auditEvents];
        if (agentId) rows = rows.filter((e) => e.agentId === agentId);
        if (domain) rows = rows.filter((e) => e.domain === domain);
        rows.reverse();
        return rows.slice(0, limit ?? rows.length);
    }
}

// ── SQLite ────────────────────────────────────────────────────────────────────

const MISSING_SDK =
    '[personaforge] SQLite policy store requires better-sqlite3.\n' +
    '  Install: npm install better-sqlite3';

interface Stmt<T = unknown> {
    get(...a: unknown[]): T | undefined;
    run(...a: unknown[]): { changes: number };
    all(...a: unknown[]): T[];
}
interface Db {
    exec(sql: string): void;
    prepare<T = unknown>(sql: string): Stmt<T>;
    /** Native transaction primitive (better-sqlite3 provides it). */
    transaction?: <T>(fn: () => T) => () => T;
}
type DbCtor = new (path: string) => Db;

function loadSqlite(): DbCtor {
    try {
        return require('better-sqlite3') as DbCtor;
    } catch {
        throw new Error(MISSING_SDK);
    }
}

/** Run SQL in a native transaction when available, else run inline. */
function inTx<T>(db: Db, fn: () => T): T {
    if (typeof db.transaction === 'function') {
        return db.transaction(fn)();
    }
    return fn();
}

/** Production pragmas: WAL journaling + busy timeout for concurrent writers. */
function productionPragmas(db: Db, path: string): void {
    if (path === ':memory:') return;
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        PRAGMA synchronous = NORMAL;
    `);
}

interface VariantRow {
    id: string;
    agent_id: string;
    domain: string;
    config: string;
    description: string;
    rationale: string | null;
    created_by: string | null;
    source_run_ids: string | null;
    parent_id: string | null;
    metrics: string | null;
    status: string;
    created_at: string;
}

interface VersionRow {
    version: number;
    variant_id: string;
    agent_id: string;
    domain: string;
    config: string;
    status: string;
    promoted_at: string | null;
    rolled_back_at: string | null;
    promoted_from: number | null;
    rolled_back_from: number | null;
    rationale: string | null;
}

interface AuditRow {
    id: string;
    agent_id: string;
    domain: string;
    action: string;
    variant_id: string | null;
    version: number | null;
    from_version: number | null;
    detail: string | null;
    created_at: string;
}

export class SqlitePolicyStore implements PolicyStore {
    private readonly _db: Db;
    private readonly _lock = new AsyncLock();

    constructor(path = ':memory:') {
        const Db = loadSqlite();
        this._db = new Db(path);
        productionPragmas(this._db, path);
        this._db.exec(`
            CREATE TABLE IF NOT EXISTS policy_variants (
                id             TEXT PRIMARY KEY,
                agent_id       TEXT NOT NULL,
                domain         TEXT NOT NULL,
                config         TEXT NOT NULL,
                description    TEXT NOT NULL,
                rationale      TEXT,
                created_by     TEXT,
                source_run_ids TEXT,
                parent_id      TEXT,
                metrics        TEXT,
                status         TEXT NOT NULL,
                created_at     TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS policy_versions (
                version          INTEGER NOT NULL,
                variant_id       TEXT NOT NULL,
                agent_id         TEXT NOT NULL,
                domain           TEXT NOT NULL,
                config           TEXT NOT NULL,
                status           TEXT NOT NULL,
                promoted_at      TEXT,
                rolled_back_at   TEXT,
                promoted_from    INTEGER,
                rolled_back_from INTEGER,
                rationale        TEXT,
                PRIMARY KEY (agent_id, domain, version)
            );
            CREATE TABLE IF NOT EXISTS policy_audit (
                id           TEXT PRIMARY KEY,
                agent_id     TEXT NOT NULL,
                domain       TEXT NOT NULL,
                action       TEXT NOT NULL,
                variant_id   TEXT,
                version      INTEGER,
                from_version INTEGER,
                detail       TEXT,
                created_at   TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_pv_agent ON policy_variants(agent_id);
            CREATE INDEX IF NOT EXISTS idx_pver_agent ON policy_versions(agent_id, domain);
            CREATE INDEX IF NOT EXISTS idx_paud_agent ON policy_audit(agent_id, domain);
        `);
    }

    private _rowToVariant(r: VariantRow): PolicyVariant {
        return {
            id: r.id,
            agentId: r.agent_id,
            domain: r.domain as OptimizationDomain,
            config: JSON.parse(r.config) as Record<string, unknown>,
            description: r.description,
            rationale: r.rationale ?? undefined,
            createdBy: (r.created_by as PolicyVariant['createdBy']) ?? undefined,
            sourceRunIds: r.source_run_ids ? (JSON.parse(r.source_run_ids) as string[]) : undefined,
            parentId: r.parent_id ?? undefined,
            metrics: r.metrics ? (JSON.parse(r.metrics) as Record<string, number>) : undefined,
            status: r.status as PolicyVariantStatus,
            createdAt: r.created_at,
        };
    }

    private _rowToVersion(r: VersionRow): PolicyVersion {
        return {
            version: r.version,
            variantId: r.variant_id,
            agentId: r.agent_id,
            domain: r.domain as OptimizationDomain,
            config: JSON.parse(r.config) as Record<string, unknown>,
            status: r.status as PolicyVersionStatus,
            promotedAt: r.promoted_at ?? undefined,
            rolledBackAt: r.rolled_back_at ?? undefined,
            promotedFrom: r.promoted_from ?? undefined,
            rolledBackFrom: r.rolled_back_from ?? undefined,
            rationale: r.rationale ?? undefined,
        };
    }

    private _audit(
        e: Omit<PolicyAuditEvent, 'id' | 'createdAt'>,
    ): void {
        this._db.prepare(
            `INSERT INTO policy_audit (id, agent_id, domain, action, variant_id, version, from_version, detail, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            crypto.randomUUID(), e.agentId, e.domain, e.action,
            e.variantId ?? null, e.version ?? null, e.fromVersion ?? null,
            e.detail ?? null, new Date().toISOString(),
        );
    }

    async registerVariant(
        v: Omit<PolicyVariant, 'createdAt' | 'status'> & { createdAt?: string },
    ): Promise<PolicyVariant> {
        return this._lock.run(async () => {
            const full: PolicyVariant = { ...v, status: 'candidate', createdAt: v.createdAt ?? nowIso() };
            inTx(this._db, () => {
                this._db.prepare(
                    `INSERT INTO policy_variants
                     (id, agent_id, domain, config, description, rationale, created_by, source_run_ids, parent_id, metrics, status, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).run(
                    full.id, full.agentId, full.domain, JSON.stringify(full.config), full.description,
                    full.rationale ?? null, full.createdBy ?? null,
                    full.sourceRunIds ? JSON.stringify(full.sourceRunIds) : null,
                    full.parentId ?? null,
                    full.metrics ? JSON.stringify(full.metrics) : null,
                    'candidate', full.createdAt,
                );
                this._audit({ agentId: v.agentId, domain: v.domain, action: 'register', variantId: full.id });
            });
            return full;
        });
    }

    async getVariant(id: string): Promise<PolicyVariant | null> {
        const row = this._db.prepare<VariantRow>('SELECT * FROM policy_variants WHERE id = ?').get(id);
        return row ? this._rowToVariant(row) : null;
    }

    async listVariants(filter: PolicyListFilter = {}): Promise<PolicyVariant[]> {
        const where: string[] = [];
        const params: unknown[] = [];
        if (filter.agentId) { where.push('agent_id = ?'); params.push(filter.agentId); }
        if (filter.domain) { where.push('domain = ?'); params.push(filter.domain); }
        if (filter.status) { where.push('status = ?'); params.push(filter.status); }
        const rows = this._db.prepare<VariantRow>(
            `SELECT * FROM policy_variants${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`
        ).all(...params);
        return rows.map((r) => this._rowToVariant(r));
    }

    async reject(variantId: string): Promise<boolean> {
        return this._lock.run(async () => {
            const v = await this.getVariant(variantId);
            if (!v || v.status === 'active') return false;
            return inTx(this._db, () => {
                const r = this._db.prepare("UPDATE policy_variants SET status = 'rejected' WHERE id = ?").run(variantId);
                if (r.changes === 0) return false;
                this._audit({ agentId: v.agentId, domain: v.domain, action: 'reject', variantId });
                return true;
            });
        });
    }

    async getActive(agentId: string, domain: OptimizationDomain): Promise<PolicyVersion | null> {
        const row = this._db.prepare<VersionRow>(
            `SELECT * FROM policy_versions WHERE agent_id = ? AND domain = ? AND status = 'active'`
        ).get(agentId, domain);
        return row ? this._rowToVersion(row) : null;
    }

    async promote(variantId: string, opts?: { rationale?: string }): Promise<PolicyVersion | null> {
        return this._lock.run(async () => {
            const variant = await this.getVariant(variantId);
            if (!variant) return null;
            const prior = await this.getActive(variant.agentId, variant.domain);
            if (prior && prior.variantId === variantId) return prior;

            const maxRow = this._db.prepare<{ m: number | null }>(
                'SELECT MAX(version) AS m FROM policy_versions WHERE agent_id = ? AND domain = ?'
            ).get(variant.agentId, variant.domain);
            const nextVersion = (maxRow?.m ?? 0) + 1;
            const now = nowIso();

            return inTx(this._db, () => {
                if (prior) {
                    this._db.prepare(
                        `UPDATE policy_versions SET status = 'superseded', rolled_back_at = NULL
                         WHERE agent_id = ? AND domain = ? AND status = 'active'`
                    ).run(variant.agentId, variant.domain);
                    this._db.prepare(
                        `UPDATE policy_variants SET status = 'superseded'
                         WHERE id = ? AND status != 'rejected'`
                    ).run(prior.variantId);
                }

                this._db.prepare("UPDATE policy_variants SET status = 'active' WHERE id = ?").run(variantId);
                this._db.prepare(
                    `INSERT INTO policy_versions (version, variant_id, agent_id, domain, config, status, promoted_at, promoted_from, rolled_back_at, rationale)
                     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, NULL, ?)`
                ).run(
                    nextVersion, variantId, variant.agentId, variant.domain,
                    JSON.stringify(variant.config), now, prior?.version ?? null, opts?.rationale ?? null,
                );
                this._audit({
                    agentId: variant.agentId, domain: variant.domain, action: 'promote',
                    variantId, version: nextVersion, fromVersion: prior?.version, detail: opts?.rationale,
                });
                return this._rowToVersion(this._db.prepare<VersionRow>(
                    `SELECT * FROM policy_versions WHERE agent_id = ? AND domain = ? AND version = ?`
                ).get(variant.agentId, variant.domain, nextVersion)!);
            });
        });
    }

    async rollback(
        agentId: string,
        domain: OptimizationDomain,
        opts?: { rationale?: string },
    ): Promise<PolicyVersion | null> {
        return this._lock.run(async () => {
            const active = await this.getActive(agentId, domain);
            if (!active || active.version <= 1) return null;
            const target = this._db.prepare<VersionRow>(
                `SELECT * FROM policy_versions WHERE agent_id = ? AND domain = ? AND version = ?`
            ).get(agentId, domain, active.version - 1);
            if (!target) return null;
            const now = nowIso();

            return inTx(this._db, () => {
                this._db.prepare(
                    `UPDATE policy_versions SET status = 'rolled-back', rolled_back_at = ?, rolled_back_from = ?
                     WHERE agent_id = ? AND domain = ? AND version = ?`
                ).run(now, active.version, agentId, domain, active.version);
                this._db.prepare(
                    `UPDATE policy_versions SET status = 'active', rolled_back_at = NULL
                     WHERE agent_id = ? AND domain = ? AND version = ?`
                ).run(agentId, domain, target.version);
                this._db.prepare(
                    `UPDATE policy_variants SET status = 'rolled-back' WHERE id = ?`
                ).run(active.variantId);
                this._db.prepare(
                    `UPDATE policy_variants SET status = 'active' WHERE id = ?`
                ).run(target.variant_id);

                this._audit({
                    agentId, domain, action: 'rollback',
                    variantId: active.variantId, version: target.version, fromVersion: active.version,
                    detail: opts?.rationale,
                });
                return this._rowToVersion(target);
            });
        });
    }

    async history(agentId: string, domain?: OptimizationDomain, limit?: number): Promise<PolicyVersion[]> {
        const where: string[] = ['agent_id = ?'];
        const params: unknown[] = [agentId];
        if (domain) { where.push('domain = ?'); params.push(domain); }
        const rows = this._db.prepare<VersionRow>(
            `SELECT * FROM policy_versions WHERE ${where.join(' AND ')} ORDER BY version DESC LIMIT ?`
        ).all(...params, limit ?? 1000);
        return rows.map((r) => this._rowToVersion(r));
    }

    async audit(agentId?: string, domain?: OptimizationDomain, limit?: number): Promise<PolicyAuditEvent[]> {
        const where: string[] = [];
        const params: unknown[] = [];
        if (agentId) { where.push('agent_id = ?'); params.push(agentId); }
        if (domain) { where.push('domain = ?'); params.push(domain); }
        const rows = this._db.prepare<AuditRow>(
            `SELECT * FROM policy_audit${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`
        ).all(...params, limit ?? 1000);
        return rows.map((r) => ({
            id: r.id,
            agentId: r.agent_id,
            domain: r.domain as OptimizationDomain,
            action: r.action as PolicyAuditEvent['action'],
            variantId: r.variant_id ?? undefined,
            version: r.version ?? undefined,
            fromVersion: r.from_version ?? undefined,
            detail: r.detail ?? undefined,
            createdAt: r.created_at,
        }));
    }
}
