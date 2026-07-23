/**
 * @personaforge/production — FeedbackStore.
 *
 * Captures thumbs-up/down ratings and optional free-text comments tied to a
 * specific agent run. Useful for RLHF pipelines, eval regression tracking,
 * and customer satisfaction monitoring.
 *
 * Two implementations:
 *   - `InMemoryFeedbackStore` — development/testing; not durable.
 *   - `SqliteFeedbackStore`   — persistent; production-ready (SQLite via better-sqlite3).
 *
 * Usage:
 * ```ts
 * import { InMemoryFeedbackStore } from 'personaforge/production';
 *
 * const store = new InMemoryFeedbackStore();
 * await store.append({ runId: '…', rating: 1, comment: 'Great!' });
 * const entries = await store.query({ runId: '…' });
 * ```
 */

import { z } from 'zod';

// ── Schema (used for HTTP validation too) ────────────────────────────────────

export const FeedbackEntrySchema = z.object({
  /** Unique ID for this feedback record. Auto-generated if not provided. */
  id: z.string().optional(),
  /** The run/message this feedback is about. */
  runId: z.string().min(1),
  /** Optional session context. */
  sessionId: z.string().optional(),
  /** Optional tenant context. */
  tenantId: z.string().optional(),
  /** Optional user who provided the feedback. */
  userId: z.string().optional(),
  /**
   * Rating value.
   *  1 = thumbs up / positive
   * -1 = thumbs down / negative
   *  0 = neutral / explicit reset
   */
  rating: z.union([z.literal(1), z.literal(-1), z.literal(0)]),
  /** Optional free-text comment. Max 4 000 chars. */
  comment: z.string().max(4_000).optional(),
  /** Additional structured metadata. */
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** ISO-8601 timestamp. Defaults to now. */
  timestamp: z.string().optional(),
});

export type FeedbackEntry = z.infer<typeof FeedbackEntrySchema> & {
  id: string;
  timestamp: string;
};

export interface FeedbackFilter {
  readonly runId?: string;
  readonly sessionId?: string;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly rating?: 1 | -1 | 0;
  readonly since?: Date;
  readonly limit?: number;
  readonly offset?: number;
}

// ── Interface ─────────────────────────────────────────────────────────────────

export interface FeedbackStore {
  /** Record a new feedback entry. */
  append(entry: Omit<FeedbackEntry, 'id' | 'timestamp'> & { id?: string; timestamp?: string }): Promise<FeedbackEntry>;
  /** Query feedback entries. */
  query(filter?: FeedbackFilter): Promise<FeedbackEntry[]>;
  /** Count matching entries. */
  count(filter?: FeedbackFilter): Promise<number>;
}

// ── In-memory ─────────────────────────────────────────────────────────────────

export class InMemoryFeedbackStore implements FeedbackStore {
  private _entries: FeedbackEntry[] = [];

  async append(
    entry: Omit<FeedbackEntry, 'id' | 'timestamp'> & { id?: string; timestamp?: string },
  ): Promise<FeedbackEntry> {
    const full: FeedbackEntry = {
      ...entry,
      id:        entry.id        ?? crypto.randomUUID(),
      timestamp: entry.timestamp ?? new Date().toISOString(),
    };
    this._entries.push(full);
    return full;
  }

  async query(filter?: FeedbackFilter): Promise<FeedbackEntry[]> {
    let rows = [...this._entries];
    if (filter?.runId)     rows = rows.filter(e => e.runId     === filter.runId);
    if (filter?.sessionId) rows = rows.filter(e => e.sessionId === filter.sessionId);
    if (filter?.tenantId)  rows = rows.filter(e => e.tenantId  === filter.tenantId);
    if (filter?.userId)    rows = rows.filter(e => e.userId    === filter.userId);
    if (filter?.rating !== undefined) rows = rows.filter(e => e.rating === filter.rating);
    if (filter?.since)     rows = rows.filter(e => new Date(e.timestamp) >= filter.since!);
    const offset = filter?.offset ?? 0;
    const limit  = filter?.limit  ?? rows.length;
    return rows.slice(offset, offset + limit);
  }

  async count(filter?: FeedbackFilter): Promise<number> {
    return (await this.query(filter)).length;
  }
}
