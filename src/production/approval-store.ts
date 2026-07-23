/**
 * Durable Human-in-the-Loop (HITL) Approval Store
 *
 * When an agent reaches a high-risk tool call (e.g. send_email, charge_card),
 * it pauses execution, persists its state, and waits for a human decision.
 * The decision is submitted via POST /approvals/:runId and execution resumes.
 *
 * This module provides:
 *   - `ApprovalStore` interface (pluggable: SQLite, Postgres, Redis)
 *   - `SqliteApprovalStore` — durable default
 *   - `InMemoryApprovalStore` — for tests
 *   - `requireApproval()` — tool factory that integrates with the agentic loop
 *
 * @example
 * ```ts
 * import { createAgent } from 'personaforge';
 * import { createSqliteApprovalStore, requireApprovalTool } from 'personaforge/production';
 *
 * const approvalStore = createSqliteApprovalStore('./agent.db');
 *
 * const agent = createAgent({
 *   name: 'Safe',
 *   instructions: '...',
 *   tools: [
 *     requireApprovalTool(approvalStore),
 *     sendEmailTool,
 *   ],
 * });
 * ```
 *
 * The HTTP runtime exposes `POST /v1/approvals/:runId` when an `approvalStore`
 * is passed to `createHttpService()`.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AgentError, ErrorCode, type ErrorCodeType } from '../shared/index.js';
import { tool } from '../tools/core/tool-helper.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

/** An approval request created when an agent hits a HITL gate. */
export interface HitlRequest {
    readonly id: string;
    readonly runId: string;
    readonly agentName: string;
    /** The tool or action requiring approval. */
    readonly toolName: string;
    /** Serialized tool arguments (for display). */
    readonly toolArguments: Record<string, unknown>;
    /** Human-readable risk level. */
    readonly riskLevel: 'low' | 'medium' | 'high' | 'critical';
    /** Free-text explanation shown to the approver. */
    readonly description?: string;
    readonly status: ApprovalStatus;
    /** The human's decision comment (if any). */
    readonly comment?: string;
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly decidedAt?: string;
    /** userId of the requester. */
    readonly requestedBy?: string;
    /** userId of the approver. */
    readonly decidedBy?: string;
}

/** Outcome of an approval decision. */
export interface ApprovalDecision {
    readonly approved: boolean;
    readonly comment?: string;
    readonly decidedBy?: string;
}

/** Pluggable approval persistence interface. */
export interface ApprovalStore {
    /** Create a new pending approval request. */
    create(request: Omit<HitlRequest, 'id' | 'status' | 'createdAt' | 'expiresAt'> & { ttlMs?: number }): Promise<HitlRequest>;
    /** Fetch an approval request by ID. */
    get(id: string): Promise<HitlRequest | null>;
    /** Fetch by runId (latest pending). */
    getByRunId(runId: string): Promise<HitlRequest | null>;
    /** Submit a decision. */
    decide(id: string, decision: ApprovalDecision): Promise<HitlRequest>;
    /** List pending approvals (for monitoring UI). */
    listPending(agentName?: string): Promise<HitlRequest[]>;
    /** Expire overdue requests. */
    expireStale?(): Promise<number>;
}

/** Thrown inside the agentic loop when an approval is rejected or times out. */
export class ApprovalRejectedError extends AgentError {
    readonly approvalId: string;
    readonly toolName: string;
    readonly comment?: string;

    constructor(opts: { approvalId: string; toolName: string; comment?: string }) {
        super(`Approval rejected for tool '${opts.toolName}'${opts.comment ? `: ${opts.comment}` : ''}`, {
            code: ErrorCode.APPROVAL_REJECTED as ErrorCodeType,
            retryable: false,
            context: { approvalId: opts.approvalId, toolName: opts.toolName },
        });
        this.name = 'ApprovalRejectedError';
        this.approvalId = opts.approvalId;
        this.toolName = opts.toolName;
        this.comment = opts.comment;
        Object.setPrototypeOf(this, ApprovalRejectedError.prototype);
    }
}

// ── In-memory store ────────────────────────────────────────────────────────

/**
 * @warning Approvals are lost on process restart.
 * Use {@link SqliteApprovalStore} or a custom durable store in production.
 */
export class InMemoryApprovalStore implements ApprovalStore {
    private store = new Map<string, HitlRequest>();
    private byRunId = new Map<string, string>(); // runId → approval id

    async create(
        input: Omit<HitlRequest, 'id' | 'status' | 'createdAt' | 'expiresAt'> & { ttlMs?: number }
    ): Promise<HitlRequest> {
        const id = randomUUID();
        const now = new Date();
        const ttlMs = input.ttlMs ?? 30 * 60 * 1000; // 30 min default
        const req: HitlRequest = {
            ...input,
            id,
            status: 'pending',
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        };
        this.store.set(id, req);
        this.byRunId.set(input.runId, id);
        return req;
    }

    async get(id: string): Promise<HitlRequest | null> {
        return this.store.get(id) ?? null;
    }

    async getByRunId(runId: string): Promise<HitlRequest | null> {
        const id = this.byRunId.get(runId);
        return id ? (this.store.get(id) ?? null) : null;
    }

    async decide(id: string, decision: ApprovalDecision): Promise<HitlRequest> {
        const req = this.store.get(id);
        if (!req) throw new Error(`Approval ${id} not found`);
        if (req.status !== 'pending') throw new Error(`Approval ${id} is already ${req.status}`);
        const updated: HitlRequest = {
            ...req,
            status: decision.approved ? 'approved' : 'rejected',
            comment: decision.comment,
            decidedBy: decision.decidedBy,
            decidedAt: new Date().toISOString(),
        };
        this.store.set(id, updated);
        return updated;
    }

    async listPending(agentName?: string): Promise<HitlRequest[]> {
        return Array.from(this.store.values()).filter(
            (r) => r.status === 'pending' && (!agentName || r.agentName === agentName)
        );
    }

    async expireStale(): Promise<number> {
        const now = new Date();
        let count = 0;
        for (const [id, req] of this.store) {
            if (req.status === 'pending' && new Date(req.expiresAt) < now) {
                this.store.set(id, { ...req, status: 'expired' });
                count++;
            }
        }
        return count;
    }
}

// ── SQLite store ───────────────────────────────────────────────────────────

export class SqliteApprovalStore implements ApprovalStore {
    private db: {
        exec: (sql: string) => void;
        prepare: (sql: string) => {
            run: (...params: unknown[]) => void;
            get: (...params: unknown[]) => unknown;
            all: (...params: unknown[]) => unknown[];
        };
    };

    private constructor(db: SqliteApprovalStore['db']) {
        this.db = db;
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS hitl_approvals (
                id TEXT PRIMARY KEY,
                run_id TEXT NOT NULL,
                agent_name TEXT NOT NULL,
                tool_name TEXT NOT NULL,
                tool_arguments TEXT NOT NULL,
                risk_level TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                comment TEXT,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                decided_at TEXT,
                requested_by TEXT,
                decided_by TEXT
            );
            CREATE INDEX IF NOT EXISTS hitl_run_id ON hitl_approvals(run_id);
            CREATE INDEX IF NOT EXISTS hitl_status ON hitl_approvals(status);
        `);
    }

    static create(filePath: string): SqliteApprovalStore {

        let Database: (p: string) => SqliteApprovalStore['db'];
        try {
            Database = require('better-sqlite3') as typeof Database;
        } catch {
            throw new Error('SqliteApprovalStore requires better-sqlite3. Install: npm install better-sqlite3');
        }
        return new SqliteApprovalStore(Database(filePath));
    }

    async create(
        input: Omit<HitlRequest, 'id' | 'status' | 'createdAt' | 'expiresAt'> & { ttlMs?: number }
    ): Promise<HitlRequest> {
        const id = randomUUID();
        const now = new Date();
        const ttlMs = input.ttlMs ?? 30 * 60 * 1000;
        const req: HitlRequest = {
            id,
            runId: input.runId,
            agentName: input.agentName,
            toolName: input.toolName,
            toolArguments: input.toolArguments,
            riskLevel: input.riskLevel,
            description: input.description,
            status: 'pending',
            createdAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
            requestedBy: input.requestedBy,
        };
        this.db.prepare(`
            INSERT INTO hitl_approvals
            (id, run_id, agent_name, tool_name, tool_arguments, risk_level, description,
             status, created_at, expires_at, requested_by)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
        `).run(
            req.id, req.runId, req.agentName, req.toolName,
            JSON.stringify(req.toolArguments), req.riskLevel,
            req.description ?? null, req.status,
            req.createdAt, req.expiresAt, req.requestedBy ?? null
        );
        return req;
    }

    private rowToRequest(r: Record<string, unknown>): HitlRequest {
        return {
            id: r['id'] as string,
            runId: r['run_id'] as string,
            agentName: r['agent_name'] as string,
            toolName: r['tool_name'] as string,
            toolArguments: JSON.parse(r['tool_arguments'] as string) as Record<string, unknown>,
            riskLevel: r['risk_level'] as HitlRequest['riskLevel'],
            description: r['description'] as string | undefined,
            status: r['status'] as ApprovalStatus,
            comment: r['comment'] as string | undefined,
            createdAt: r['created_at'] as string,
            expiresAt: r['expires_at'] as string,
            decidedAt: r['decided_at'] as string | undefined,
            requestedBy: r['requested_by'] as string | undefined,
            decidedBy: r['decided_by'] as string | undefined,
        };
    }

    async get(id: string): Promise<HitlRequest | null> {
        const row = this.db.prepare(`SELECT * FROM hitl_approvals WHERE id = ?`).get(id);
        return row ? this.rowToRequest(row as Record<string, unknown>) : null;
    }

    async getByRunId(runId: string): Promise<HitlRequest | null> {
        const row = this.db.prepare(
            `SELECT * FROM hitl_approvals WHERE run_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`
        ).get(runId);
        return row ? this.rowToRequest(row as Record<string, unknown>) : null;
    }

    async decide(id: string, decision: ApprovalDecision): Promise<HitlRequest> {
        const existing = await this.get(id);
        if (!existing) throw new Error(`Approval ${id} not found`);
        if (existing.status !== 'pending') throw new Error(`Approval ${id} is already ${existing.status}`);
        const now = new Date().toISOString();
        const status = decision.approved ? 'approved' : 'rejected';
        this.db.prepare(`
            UPDATE hitl_approvals SET status=?, comment=?, decided_at=?, decided_by=? WHERE id=?
        `).run(status, decision.comment ?? null, now, decision.decidedBy ?? null, id);
        return { ...existing, status, comment: decision.comment, decidedAt: now, decidedBy: decision.decidedBy };
    }

    async listPending(agentName?: string): Promise<HitlRequest[]> {
        const now = new Date().toISOString();
        const rows = agentName
            ? this.db.prepare(`SELECT * FROM hitl_approvals WHERE status='pending' AND expires_at > ? AND agent_name=? ORDER BY created_at ASC`).all(now, agentName)
            : this.db.prepare(`SELECT * FROM hitl_approvals WHERE status='pending' AND expires_at > ? ORDER BY created_at ASC`).all(now);
        return (rows as Record<string, unknown>[]).map(this.rowToRequest.bind(this));
    }

    async expireStale(): Promise<number> {
        const now = new Date().toISOString();
        const pending = await this.listPending();
        const toExpire = pending.filter((r) => r.expiresAt < now);
        for (const r of toExpire) {
            this.db.prepare(`UPDATE hitl_approvals SET status='expired' WHERE id=?`).run(r.id);
        }
        return toExpire.length;
    }
}

/**
 * Factory: create a SQLite-backed approval store.
 */
export function createSqliteApprovalStore(filePath: string): ApprovalStore {
    return SqliteApprovalStore.create(filePath);
}

// ── Poll helper for agentic loop ───────────────────────────────────────────

/**
 * Wait for an approval decision by polling the store.
 * Used inside tool `execute()` to block until a human decides.
 *
 * @param store - The approval store to poll
 * @param approvalId - ID returned by `store.create()`
 * @param opts.pollIntervalMs - How often to check. Default: 2000ms
 * @param opts.timeoutMs - Max wait time. Default: matches approval TTL (30 min)
 */
export async function waitForApproval(
    store: ApprovalStore,
    approvalId: string,
    opts: { pollIntervalMs?: number; timeoutMs?: number } = {}
): Promise<HitlRequest> {
    const pollMs = opts.pollIntervalMs ?? 2_000;
    const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1_000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const req = await store.get(approvalId);
        if (!req) throw new Error(`Approval ${approvalId} not found`);
        if (req.status === 'approved') return req;
        if (req.status === 'rejected') {
            throw new ApprovalRejectedError({ approvalId, toolName: req.toolName, comment: req.comment });
        }
        if (req.status === 'expired') {
            throw new ApprovalRejectedError({ approvalId, toolName: req.toolName, comment: 'Approval expired' });
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new ApprovalRejectedError({ approvalId, toolName: 'unknown', comment: 'Approval wait timeout' });
}

// ── Human-in-the-loop tool factory ─────────────────────────────────────────

/** Options for {@link requireApprovalTool}. */
export interface RequireApprovalToolOptions {
    /** Tool name exposed to the model. Default: `request_human_approval`. */
    readonly name?: string;
    /** Tool description shown to the model. */
    readonly description?: string;
    /** Agent name recorded on the approval request. Default: `'unknown'`. */
    readonly agentName?: string;
    /** Risk level recorded on the approval request. Default: `'high'`. */
    readonly riskLevel?: HitlRequest['riskLevel'];
    /** Approval TTL in ms (how long the request stays pending). Default: 30 min. */
    readonly ttlMs?: number;
    /** Poll interval while waiting for a decision (ms). Default: 2000. */
    readonly pollIntervalMs?: number;
    /** Max time to wait for a decision (ms). Default: matches `ttlMs`. */
    readonly timeoutMs?: number;
}

/**
 * Create a HITL tool that pauses the agent loop until a human approves or rejects.
 *
 * The returned tool (a) creates a pending approval in the {@link ApprovalStore},
 * (b) waits for a decision via {@link waitForApproval}, and (c) returns the outcome
 * to the agent. A rejection or timeout surfaces as {@link ApprovalRejectedError}
 * so the agentic loop can halt the gated action.
 *
 * @remarks
 * This implementation performs an **in-process** wait (polling the store). Durable
 * resume — persisting the agent's pending state across restarts and resuming from the
 * stored decision — is a follow-up; the approval record itself is already durable when
 * a SQLite/Postgres store is used.
 *
 * @example
 * ```ts
 * import { createSqliteApprovalStore, requireApprovalTool } from 'personaforge/production';
 * const store = createSqliteApprovalStore('./agent.db');
 * const agent = createAgent({ name: 'Safe', tools: [requireApprovalTool(store)] });
 * ```
 */
export function requireApprovalTool(
    store: ApprovalStore,
    options: RequireApprovalToolOptions = {}
) {
    const ttlMs = options.ttlMs ?? 30 * 60 * 1000;
    return tool({
        name: options.name ?? 'request_human_approval',
        description:
            options.description ??
            'Pause and request human approval before performing a high-risk action. ' +
            'Returns once a human approves or rejects the request.',
        parameters: z.object({
            action: z.string().describe('Short description of the action requiring approval.'),
            details: z
                .record(z.string(), z.unknown())
                .optional()
                .describe('Structured arguments shown to the approver.'),
            runId: z
                .string()
                .optional()
                .describe('Run identifier to correlate the approval with the agent run.'),
        }),
        async execute(params, ctx) {
            const runId = params.runId ?? ctx?.sessionId ?? randomUUID();
            const request = await store.create({
                runId,
                agentName: options.agentName ?? ctx?.agentId ?? 'unknown',
                toolName: params.action,
                toolArguments: params.details ?? {},
                riskLevel: options.riskLevel ?? 'high',
                ttlMs,
            });

            const decided = await waitForApproval(store, request.id, {
                ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
                timeoutMs: options.timeoutMs ?? ttlMs,
            });

            // waitForApproval throws on rejection/timeout; reaching here means approved.
            return {
                approved: true as const,
                approvalId: decided.id,
                decidedBy: decided.decidedBy,
                comment: decided.comment,
            };
        },
    });
}
