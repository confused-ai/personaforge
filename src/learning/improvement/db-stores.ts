/**
 * Any-DB improvement stores via the unified `AgentDb` abstraction.
 *
 * Instead of one implementation per database, these adapters persist the
 * improvement subsystem's records into AgentDb's single unified
 * `agent_learnings` table (discriminated by `learning_type`), so *every*
 * backend works out of the box: SQLite, Postgres, MongoDB, Redis, MySQL,
 * DynamoDB, Turso/libSQL, JSON file and in-memory — no per-DB code.
 *
 *   learning_type         contents
 *   ────────────────────── ─────────────────────────────────────────────
 *   improvement_feedback   one ExecutionFeedback per row
 *   improvement_variant    one PolicyVariant per row (namespace = domain)
 *   improvement_version    one immutable PolicyVersion per row
 *   improvement_audit      one PolicyAuditEvent per row (append-only)
 *
 * @example
 * ```ts
 * import { createAgentDb } from '../../db/index.js';
 * import { DbFeedbackRepo, DbPolicyStore } from './index.js';
 *
 * const db = await createAgentDb('sqlite:///data/agent.db');
 * const feedback = new DbFeedbackRepo(db);
 * const policy   = new DbPolicyStore(db);
 * ```
 */

import type { AgentDb } from '../../db/index.js';
import type { FeedbackFilter, FeedbackRepo } from './feedback.js';
import type { PolicyListFilter, PolicyStore } from './policy-store.js';
import { AsyncLock } from './async-lock.js';
import type {
    ExecutionFeedback,
    OptimizationDomain,
    PolicyAuditEvent,
    PolicyVariant,
    PolicyVersion,
} from './types.js';

const LEARNING_TYPES = {
    feedback: 'improvement_feedback',
    variant: 'improvement_variant',
    version: 'improvement_version',
    audit: 'improvement_audit',
} as const;

function genId(): string {
    return crypto.randomUUID();
}
const nowIso = (): string => new Date().toISOString();

// ── Generic learning-table helpers ────────────────────────────────────────────

interface StoredRow<T> {
    id: string;
    agentId?: string | null;
    sessionId?: string | null;
    namespace?: string | null;
    content: T;
    createdAt: number;
}

async function storeRows<T>(
    db: AgentDb,
    type: string,
    query: Parameters<AgentDb['getLearnings']>[0] = {},
): Promise<StoredRow<T>[]> {
    await db.init();
    const rows = await db.getLearnings({ learningType: type, ...query });
    return rows.map((r) => ({
        id: r.learning_id,
        agentId: r.agent_id,
        sessionId: r.session_id,
        namespace: r.namespace,
        content: JSON.parse(r.content) as T,
        createdAt: r.created_at,
    }));
}

async function upsertRow(
    db: AgentDb,
    type: string,
    id: string,
    content: Record<string, unknown>,
    opts: { agentId?: string; sessionId?: string; namespace?: string },
): Promise<void> {
    await db.init();
    await db.upsertLearning({
        id,
        learningType: type,
        content,
        agentId: opts.agentId,
        sessionId: opts.sessionId,
        namespace: opts.namespace,
    });
}

// ── DbFeedbackRepo ─────────────────────────────────────────────────────────────

export class DbFeedbackRepo implements FeedbackRepo {
    constructor(private readonly db: AgentDb) {}

    async append(
        entry: Omit<ExecutionFeedback, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
    ): Promise<ExecutionFeedback> {
        const full: ExecutionFeedback = {
            ...entry,
            id: entry.id ?? genId(),
            createdAt: entry.createdAt ?? nowIso(),
        };
        await upsertRow(this.db, LEARNING_TYPES.feedback, full.id, full as unknown as Record<string, unknown>, {
            agentId: entry.agentId,
            sessionId: entry.sessionId,
            namespace: 'feedback',
        });
        return full;
    }

    async list(filter: FeedbackFilter = {}): Promise<ExecutionFeedback[]> {
        let rows = await storeRows<ExecutionFeedback>(this.db, LEARNING_TYPES.feedback, {
            ...(filter.agentId !== undefined && { agentId: filter.agentId }),
            ...(filter.sessionId !== undefined && { sessionId: filter.sessionId }),
            limit: 10_000,
        });
        const entries = rows.map((r) => r.content);
        let out = entries;
        if (filter.runId) out = out.filter((e) => e.runId === filter.runId);
        if (filter.taskType) out = out.filter((e) => e.signal?.taskType === filter.taskType);
        if (filter.source) {
            const sources = Array.isArray(filter.source) ? filter.source : [filter.source];
            out = out.filter((e) => sources.includes(e.source));
        }
        if (filter.since) out = out.filter((e) => e.createdAt >= filter.since!);
        out = [...out].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const offset = filter.offset ?? 0;
        const limit = filter.limit ?? out.length;
        return out.slice(offset, offset + limit);
    }

    async count(filter: FeedbackFilter = {}): Promise<number> {
        return (await this.list({ ...filter, limit: 10_000 })).length;
    }

    async get(id: string): Promise<ExecutionFeedback | null> {
        const rows = await storeRows<ExecutionFeedback>(this.db, LEARNING_TYPES.feedback);
        return rows.find((r) => r.id === id)?.content ?? null;
    }

    async delete(id: string): Promise<boolean> {
        return this.db.deleteLearning(id);
    }
}

// ── DbPolicyStore ──────────────────────────────────────────────────────────────

function versionKey(agentId: string, domain: OptimizationDomain, version: number): string {
    return `${agentId}/${domain}/${version}`;
}

export class DbPolicyStore implements PolicyStore {
    private readonly db: AgentDb;
    /** Serializes read-modify-write policy mutations on any backend. */
    private readonly _lock = new AsyncLock();

    constructor(db: AgentDb) {
        this.db = db;
    }

    private async _variants(filter: PolicyListFilter = {}): Promise<PolicyVariant[]> {
        const rows = await storeRows<PolicyVariant>(this.db, LEARNING_TYPES.variant, {
            ...(filter.agentId !== undefined && { agentId: filter.agentId }),
            limit: 10_000,
        });
        return rows
            .map((r) => r.content)
            .filter((v) => (filter.domain !== undefined ? v.domain === filter.domain : true))
            .filter((v) => (filter.status !== undefined ? v.status === filter.status : true));
    }

    private async _versions(agentId: string, domain?: OptimizationDomain): Promise<PolicyVersion[]> {
        const rows = await storeRows<PolicyVersion>(this.db, LEARNING_TYPES.version, {
            ...((agentId || domain) && { agentId }),
            limit: 10_000,
        });
        return rows
            .map((r) => r.content)
            .filter((v) => (domain !== undefined ? v.domain === domain : true));
    }

    private async _auditPush(
        e: Omit<PolicyAuditEvent, 'id' | 'createdAt'>,
    ): Promise<void> {
        const full: PolicyAuditEvent = { ...e, id: genId(), createdAt: nowIso() };
        await upsertRow(this.db, LEARNING_TYPES.audit, full.id, full as unknown as Record<string, unknown>, {
            agentId: e.agentId,
            namespace: e.domain,
        });
    }

    async registerVariant(
        v: Omit<PolicyVariant, 'createdAt' | 'status'> & { createdAt?: string },
    ): Promise<PolicyVariant> {
        return this._lock.run(async () => {
            const full: PolicyVariant = { ...v, status: 'candidate', createdAt: v.createdAt ?? nowIso() };
            await upsertRow(this.db, LEARNING_TYPES.variant, full.id, full as unknown as Record<string, unknown>, {
                agentId: v.agentId,
                namespace: v.domain,
            });
            await this._auditPush({ agentId: v.agentId, domain: v.domain, action: 'register', variantId: full.id });
            return full;
        });
    }

    async getVariant(id: string): Promise<PolicyVariant | null> {
        const rows = await storeRows<PolicyVariant>(this.db, LEARNING_TYPES.variant);
        return rows.find((r) => r.id === id)?.content ?? null;
    }

    async listVariants(filter: PolicyListFilter = {}): Promise<PolicyVariant[]> {
        return this._variants(filter);
    }

    async reject(variantId: string): Promise<boolean> {
        return this._lock.run(async () => {
            const v = await this.getVariant(variantId);
            if (!v || v.status === 'active') return false;
            const updated: PolicyVariant = { ...v, status: 'rejected' };
            await upsertRow(this.db, LEARNING_TYPES.variant, variantId, updated as unknown as Record<string, unknown>, {
                agentId: v.agentId,
                namespace: v.domain,
            });
            await this._auditPush({ agentId: v.agentId, domain: v.domain, action: 'reject', variantId });
            return true;
        });
    }

    async getActive(agentId: string, domain: OptimizationDomain): Promise<PolicyVersion | null> {
        const versions = await this._versions(agentId, domain);
        return versions.find((v) => v.status === 'active') ?? null;
    }

    async promote(variantId: string, opts?: { rationale?: string }): Promise<PolicyVersion | null> {
        return this._lock.run(async () => {
            const variant = await this.getVariant(variantId);
            if (!variant) return null;
            const versions = await this._versions(variant.agentId, variant.domain);
            const prior = versions.find((v) => v.status === 'active') ?? null;
            if (prior && prior.variantId === variantId) return prior;

            const nextVersion = versions.reduce((m, v) => Math.max(m, v.version), 0) + 1;
            const now = nowIso();

            if (prior) {
                const superseded: PolicyVersion = { ...prior, status: 'superseded' };
                await upsertRow(
                    this.db, LEARNING_TYPES.version, versionKey(prior.agentId, prior.domain, prior.version),
                    superseded as unknown as Record<string, unknown>,
                    { agentId: prior.agentId, namespace: prior.domain },
                );
                const priorVariant = await this.getVariant(prior.variantId);
                if (priorVariant && priorVariant.status !== 'rejected') {
                    await upsertRow(
                        this.db, LEARNING_TYPES.variant, priorVariant.id,
                        { ...priorVariant, status: 'superseded' } as unknown as Record<string, unknown>,
                        { agentId: priorVariant.agentId, namespace: priorVariant.domain },
                    );
                }
            }

            await upsertRow(
                this.db, LEARNING_TYPES.variant, variantId,
                { ...variant, status: 'active' } as unknown as Record<string, unknown>,
                { agentId: variant.agentId, namespace: variant.domain },
            );

            const version: PolicyVersion = {
                version: nextVersion,
                variantId,
                agentId: variant.agentId,
                domain: variant.domain,
                config: variant.config,
                status: 'active',
                promotedAt: now,
                promotedFrom: prior?.version,
                rationale: opts?.rationale,
            };
            await upsertRow(
                this.db, LEARNING_TYPES.version, versionKey(variant.agentId, variant.domain, nextVersion),
                version as unknown as Record<string, unknown>,
                { agentId: variant.agentId, namespace: variant.domain },
            );
            await this._auditPush({
                agentId: variant.agentId, domain: variant.domain, action: 'promote',
                variantId, version: nextVersion, fromVersion: prior?.version, detail: opts?.rationale,
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
            const versions = await this._versions(agentId, domain);
            const active = versions.find((v) => v.status === 'active') ?? null;
            if (!active || active.version <= 1) return null;
            const target = versions.find((v) => v.version === active.version - 1) ?? null;
            if (!target) return null;
            const now = nowIso();

            const rolledBack: PolicyVersion = {
                ...active, status: 'rolled-back', rolledBackAt: now, rolledBackFrom: active.version,
            };
            await upsertRow(
                this.db, LEARNING_TYPES.version, versionKey(active.agentId, active.domain, active.version),
                rolledBack as unknown as Record<string, unknown>,
                { agentId: active.agentId, namespace: active.domain },
            );
            const restored: PolicyVersion = { ...target, status: 'active', rolledBackAt: undefined };
            await upsertRow(
                this.db, LEARNING_TYPES.version, versionKey(target.agentId, target.domain, target.version),
                restored as unknown as Record<string, unknown>,
                { agentId: target.agentId, namespace: target.domain },
            );

            const activeVariant = await this.getVariant(active.variantId);
            const targetVariant = await this.getVariant(target.variantId);
            if (activeVariant) {
                await upsertRow(
                    this.db, LEARNING_TYPES.variant, activeVariant.id,
                    { ...activeVariant, status: 'rolled-back' } as unknown as Record<string, unknown>,
                    { agentId: activeVariant.agentId, namespace: activeVariant.domain },
                );
            }
            if (targetVariant) {
                await upsertRow(
                    this.db, LEARNING_TYPES.variant, targetVariant.id,
                    { ...targetVariant, status: 'active' } as unknown as Record<string, unknown>,
                    { agentId: targetVariant.agentId, namespace: targetVariant.domain },
                );
            }

            await this._auditPush({
                agentId, domain, action: 'rollback',
                variantId: active.variantId, version: target.version, fromVersion: active.version,
                detail: opts?.rationale,
            });
            return restored;
        });
    }

    async history(agentId: string, domain?: OptimizationDomain, limit?: number): Promise<PolicyVersion[]> {
        const versions = await this._versions(agentId, domain);
        return versions.sort((a, b) => b.version - a.version).slice(0, limit ?? versions.length);
    }

    async audit(agentId?: string, domain?: OptimizationDomain, limit?: number): Promise<PolicyAuditEvent[]> {
        const rows = await storeRows<PolicyAuditEvent>(this.db, LEARNING_TYPES.audit, {
            ...(agentId !== undefined && { agentId }),
            limit: 10_000,
        });
        const events = rows
            .map((r) => r.content)
            .filter((e) => (domain !== undefined ? e.domain === domain : true))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return events.slice(0, limit ?? events.length);
    }
}
