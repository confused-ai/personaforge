/**
 * @personaforge/memory — DbMemoryStore.
 *
 * Implements MemoryStore backed by any AgentDb backend (agent_memories table).
 * Persists memories across process restarts. Text search (not vector search)
 * is used for retrieve() — pair with VectorMemoryStore for full semantic search.
 *
 * Usage:
 * ```ts
 * import { SqliteAgentDb } from '../db/index.js';
 * import { DbMemoryStore } from './index.js';
 *
 * const db    = new SqliteAgentDb({ path: './data/agent.db' });
 * const store = new DbMemoryStore(db, { agentId: 'my-agent' });
 * ```
 */

import type { AgentDb } from '../db/index.js';
import type {
  MemoryStore, MemoryEntry, MemoryQuery, MemorySearchResult, MemoryStoreConfig,
} from './types.js';
import { MemoryType } from './types.js';
import type { EntityId } from '../core/index.js';
import { newId } from '../contracts/index.js';

function genId(): string {
  return newId('mem');
}

/** Extra fields that MemoryEntry has beyond basic MemoryRow. Stored as JSON in `input`. */
interface MemoryExtras {
  type:       string;
  embedding?: number[];
  metadata:   Record<string, unknown>;
  expiresAt?: string;
}

function entryToExtras(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): MemoryExtras {
  return {
    type:      entry.type,
    embedding: entry.embedding,
    metadata:  entry.metadata as Record<string, unknown>,
    ...(entry.expiresAt != null && { expiresAt: entry.expiresAt.toISOString() }),
  };
}

export interface DbMemoryStoreOptions extends MemoryStoreConfig {
  /** Scope memories to a specific agent. */
  agentId?: string;
  /** Scope memories to a specific user. */
  userId?: string;
  /** Scope memories to a team. */
  teamId?: string;
}

export class DbMemoryStore implements MemoryStore {
  private readonly db: AgentDb;
  private readonly agentId?: string;
  private readonly userId?: string;
  private readonly teamId?: string;
  private readonly defaultLimit: number;

  constructor(db: AgentDb, opts: DbMemoryStoreOptions = {}) {
    this.db = db;
    this.agentId = opts.agentId;
    this.userId  = opts.userId;
    this.teamId  = opts.teamId;
    this.defaultLimit = opts.defaultQueryLimit ?? 10;
  }

  async store(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry> {
    await this.db.init();
    const id = genId();
    const extras = entryToExtras(entry);

    await this.db.upsertMemory({
      memoryId: id,
      userId:   this.userId ?? (entry.metadata.custom?.['userId'] as string | undefined),
      agentId:  this.agentId ?? (entry.metadata.agentId as string | undefined),
      teamId:   this.teamId,
      memory:   entry.content,
      topics:   entry.metadata.tags as string[] | undefined,
      input:    JSON.stringify(extras),
    });

    return {
      ...entry,
      id,
      createdAt: new Date(),
    };
  }

  async retrieve(query: MemoryQuery): Promise<MemorySearchResult[]> {
    await this.db.init();
    const rows = await this.db.getMemories({
      agentId: this.agentId,
      userId:  this.userId ?? query.filter?.sessionId as string | undefined,
      teamId:  this.teamId,
      search:  query.query,
      limit:   query.limit ?? this.defaultLimit,
    });

    const results: MemorySearchResult[] = [];
    for (const row of rows) {
      const entry = this._rowToEntry(row);
      if (!entry) continue;
      if (query.type !== undefined && entry.type !== query.type) continue;
      if (query.filter?.tags) {
        const entryTags = entry.metadata.tags ?? [];
        const hasAll = query.filter.tags.every(t => (entryTags as string[]).includes(t));
        if (!hasAll) continue;
      }
      if (query.filter?.before && entry.createdAt >= query.filter.before) continue;
      if (query.filter?.after  && entry.createdAt <= query.filter.after)  continue;
      // Trivial relevance score — keyword match ratio
      const queryWords = query.query.toLowerCase().split(/\s+/).filter(Boolean);
      const contentLower = entry.content.toLowerCase();
      const matched = queryWords.filter(w => contentLower.includes(w)).length;
      const score = queryWords.length > 0 ? matched / queryWords.length : 0.5;
      if (query.threshold !== undefined && score < query.threshold) continue;
      results.push({ entry, score });
    }

    return results.sort((a, b) => b.score - a.score);
  }

  async get(id: EntityId): Promise<MemoryEntry | null> {
    await this.db.init();
    const row = await this.db.getMemory(id, this.userId);
    return row ? (this._rowToEntry(row) ?? null) : null;
  }

  async update(
    id: EntityId,
    updates: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>,
  ): Promise<MemoryEntry> {
    await this.db.init();
    const existing = await this.get(id);
    if (!existing) throw new Error(`[personaforge/memory] Memory not found: ${id}`);
    const merged = {
      ...existing,
      ...updates,
      metadata: { ...existing.metadata, ...(updates.metadata ?? {}) },
    };
    const extras = entryToExtras(merged);
    await this.db.upsertMemory({
      memoryId: id,
      userId:   this.userId,
      agentId:  this.agentId,
      teamId:   this.teamId,
      memory:   merged.content,
      topics:   merged.metadata.tags as string[] | undefined,
      input:    JSON.stringify(extras),
    });
    return merged;
  }

  async delete(id: EntityId): Promise<boolean> {
    await this.db.init();
    return this.db.deleteMemory(id, this.userId);
  }

  async clear(type?: MemoryType): Promise<void> {
    if (type === undefined) {
      await this.db.clearMemories(this.userId);
      return;
    }
    // type-filtered clear: fetch ids then delete
    await this.db.init();
    const rows = await this.db.getMemories({ agentId: this.agentId, userId: this.userId, limit: 10_000 });
    for (const row of rows) {
      const entry = this._rowToEntry(row);
      if (entry?.type === type) {
        await this.db.deleteMemory(row.memory_id, this.userId);
      }
    }
  }

  async getRecent(limit: number, type?: MemoryType): Promise<MemoryEntry[]> {
    await this.db.init();
    const rows = await this.db.getMemories({
      agentId: this.agentId, userId: this.userId, teamId: this.teamId, limit: type ? limit * 4 : limit,
    });
    const entries = rows.map(r => this._rowToEntry(r)).filter((e): e is MemoryEntry => e !== null);
    const filtered = type ? entries.filter(e => e.type === type) : entries;
    return filtered.slice(0, limit);
  }

  async snapshot(): Promise<MemoryEntry[]> {
    await this.db.init();
    const rows = await this.db.getMemories({ agentId: this.agentId, userId: this.userId, limit: 10_000 });
    return rows.map(r => this._rowToEntry(r)).filter((e): e is MemoryEntry => e !== null);
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private _rowToEntry(row: { memory_id: string; memory: string; topics?: string | null; input?: string | null; created_at: number }): MemoryEntry | null {
    try {
      const extras = row.input ? JSON.parse(row.input) as MemoryExtras : null;
      return {
        id:        row.memory_id,
        type:      (extras?.type as MemoryType | undefined) ?? MemoryType.LONG_TERM,
        content:   row.memory,
        embedding: extras?.embedding,
        metadata:  (extras?.metadata as MemoryEntry['metadata']) ?? {},
        createdAt: new Date(row.created_at * 1000),
        ...(extras?.expiresAt != null && { expiresAt: new Date(extras.expiresAt) }),
      };
    } catch { return null; }
  }
}

/** Convenience factory. */
export function createDbMemoryStore(db: AgentDb, opts?: DbMemoryStoreOptions): DbMemoryStore {
  return new DbMemoryStore(db, opts);
}
