/**
 * SQLite-backed User Profile Store — persistent learning across sessions.
 *
 * User profiles persist automatically across restarts when backed by SQLite (or Postgres).
 *
 * @example
 * ```ts
 * import { createAgent } from 'personaforge';
 * import { createSqliteUserProfileStore } from 'personaforge/learning';
 *
 * const agent = createAgent({
 *   name: 'PersonalAssistant',
 *   instructions: '...',
 *   userProfileStore: createSqliteUserProfileStore('./agent.db'),
 *   learningMode: 'always',
 * });
 * ```
 */

import { randomUUID } from 'node:crypto';
import type { UserProfileStore, UserProfile, UserProfileQuery } from './types.js';

// ── SQLite implementation ──────────────────────────────────────────────────

export class SqliteUserProfileStore implements UserProfileStore {
    private db: {
        exec: (sql: string) => void;
        prepare: (sql: string) => {
            run: (...params: unknown[]) => void;
            get: (...params: unknown[]) => unknown;
            all: (...params: unknown[]) => unknown[];
        };
    };

    private constructor(db: SqliteUserProfileStore['db']) {
        this.db = db;
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS user_profiles (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                agent_id TEXT,
                display_name TEXT,
                preferences TEXT,
                metadata TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_uid_aid
                ON user_profiles(user_id, COALESCE(agent_id, ''));
            CREATE INDEX IF NOT EXISTS user_profiles_user_id ON user_profiles(user_id);
        `);
    }

    static create(filePath: string): SqliteUserProfileStore {

        let Database: (p: string) => SqliteUserProfileStore['db'];
        try {
            Database = require('better-sqlite3') as typeof Database;
        } catch {
            throw new Error(
                'SqliteUserProfileStore requires better-sqlite3. Install: npm install better-sqlite3'
            );
        }
        return new SqliteUserProfileStore(Database(filePath));
    }

    private rowToProfile(r: Record<string, unknown>): UserProfile {
        return {
            id: r['id'] as string,
            userId: r['user_id'] as string,
            agentId: r['agent_id'] as string | undefined,
            displayName: r['display_name'] as string | undefined,
            preferences: r['preferences'] ? JSON.parse(r['preferences'] as string) as Record<string, unknown> : undefined,
            metadata: JSON.parse(r['metadata'] as string) as Record<string, unknown>,
            createdAt: new Date(r['created_at'] as string),
            updatedAt: new Date(r['updated_at'] as string),
        };
    }

    async get(userId: string, agentId?: string): Promise<UserProfile | null> {
        const row = agentId
            ? this.db.prepare(`SELECT * FROM user_profiles WHERE user_id=? AND agent_id=?`).get(userId, agentId)
            : this.db.prepare(`SELECT * FROM user_profiles WHERE user_id=? AND agent_id IS NULL`).get(userId);
        return row ? this.rowToProfile(row as Record<string, unknown>) : null;
    }

    async set(profile: Omit<UserProfile, 'id' | 'createdAt' | 'updatedAt'>): Promise<UserProfile> {
        const now = new Date().toISOString();
        const existing = await this.get(profile.userId, profile.agentId as string | undefined);
        if (existing) {
            return this.update(profile.userId, profile as Partial<Omit<UserProfile, 'id' | 'userId' | 'createdAt'>>, profile.agentId as string | undefined);
        }
        const id = randomUUID();
        this.db.prepare(`
            INSERT INTO user_profiles (id, user_id, agent_id, display_name, preferences, metadata, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?)
        `).run(
            id, profile.userId, profile.agentId ?? null, profile.displayName ?? null,
            profile.preferences ? JSON.stringify(profile.preferences) : null,
            JSON.stringify(profile.metadata ?? {}), now, now
        );
        return { ...profile, id, agentId: profile.agentId as string | undefined, createdAt: new Date(now), updatedAt: new Date(now) };
    }

    async update(userId: string, updates: Partial<Omit<UserProfile, 'id' | 'userId' | 'createdAt'>>, agentId?: string): Promise<UserProfile> {
        const existing = await this.get(userId, agentId);
        if (!existing) throw new Error(`UserProfile not found for userId=${userId}`);
        const now = new Date().toISOString();
        const merged: UserProfile = {
            ...existing,
            ...updates,
            updatedAt: new Date(now),
        };
        this.db.prepare(`
            UPDATE user_profiles SET display_name=?, preferences=?, metadata=?, updated_at=?
            WHERE id=?
        `).run(
            merged.displayName ?? null,
            merged.preferences ? JSON.stringify(merged.preferences) : null,
            JSON.stringify(merged.metadata),
            now, existing.id
        );
        return merged;
    }

    async list(query?: UserProfileQuery): Promise<UserProfile[]> {
        let rows: unknown[];
        if (query?.userId && query?.agentId) {
            rows = this.db.prepare(`SELECT * FROM user_profiles WHERE user_id=? AND agent_id=?`).all(query.userId, query.agentId);
        } else if (query?.userId) {
            rows = this.db.prepare(`SELECT * FROM user_profiles WHERE user_id=?`).all(query.userId);
        } else if (query?.agentId) {
            rows = this.db.prepare(`SELECT * FROM user_profiles WHERE agent_id=?`).all(query.agentId);
        } else {
            const limit = query?.limit ?? 100;
            rows = this.db.prepare(`SELECT * FROM user_profiles LIMIT ?`).all(limit);
        }
        return (rows as Record<string, unknown>[]).map(this.rowToProfile.bind(this));
    }

    async delete(userId: string, agentId?: string): Promise<boolean> {
        const existing = await this.get(userId, agentId);
        if (!existing) return false;
        if (agentId) {
            this.db.prepare(`DELETE FROM user_profiles WHERE user_id=? AND agent_id=?`).run(userId, agentId);
        } else {
            this.db.prepare(`DELETE FROM user_profiles WHERE user_id=? AND agent_id IS NULL`).run(userId);
        }
        return true;
    }
}

/**
 * Factory: create a SQLite-backed user profile store.
 */
export function createSqliteUserProfileStore(filePath: string): UserProfileStore {
    return SqliteUserProfileStore.create(filePath);
}
