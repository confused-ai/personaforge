/**
 * Improvement store factory — pick a backend, or let it choose for you.
 *
 * Mirrors the framework's `createAgentDb` philosophy: one ergonomic call that
 * selects an appropriate, production-ready implementation from a description,
 * a connection URL, an `AgentDbConfig`, or an existing backend. Custom /
 * storage-specific behaviour never leaks into the improvement subsystem — it
 * always talks to the `FeedbackRepo` / `PolicyStore` interfaces.
 *
 * ```ts
 * // Dev: ephemeral
 * const a = await createImprovementStores('memory');
 *
 * // Prod: dedicated, transactional SQLite (WAL) or any AgentDb backend
 * const b = await createImprovementStores('sqlite');
 * const c = await createImprovementStores({ type: 'sqlite', path: './data/agent.db' });
 * const d = await createImprovementStores('postgres://user:pass@host/db');
 * const e = await createImprovementStores({ type: 'mongodb', uri: 'mongodb://…' });
 *
 * // Any AgentDb instance (sqlite/postgres/mongo/redis/mysql/dynamodb/turso/json)
 * const db   = await createAgentDb('redis://…');
 * const f    = await createImprovementStores(db);
 *
 * // Mix & match individual stores
 * const feedback = await createFeedbackRepo('sqlite');
 * const policy   = await createPolicyStore(db);
 * ```
 */

import { AgentDb, createAgentDb, type AgentDbConfig } from '../../db/index.js';
import { InMemoryFeedbackRepo, SqliteFeedbackRepo, type FeedbackRepo } from './feedback.js';
import { InMemoryPolicyStore, SqlitePolicyStore, type PolicyStore } from './policy-store.js';
import { DbFeedbackRepo, DbPolicyStore } from './db-stores.js';

type Backend = 'memory' | 'sqlite' | AgentDb;

/**
 * Anything the factory accepts. Strings may be the shortcuts `memory` /
 * `sqlite` or any connection URL understood by `createAgentDb`
 * (postgres://, mongodb://, redis://, mysql://, dynamodb://, libsql://, …).
 */
export type StoreBackendSpec =
    | 'memory'
    | 'in-memory'
    | 'sqlite'
    | string
    | AgentDbConfig
    | { type: 'memory' }
    | { type: 'sqlite'; path?: string; uri?: string }
    | { type: 'db'; db: AgentDb }
    | AgentDb;

export interface ImprovementStores {
    readonly feedback: FeedbackRepo;
    readonly policy: PolicyStore;
}

const KNOWN_DB_TYPES = [
    'memory', 'in-memory', 'sqlite', 'postgres', 'postgresql', 'mongo', 'mongodb',
    'redis', 'json', 'mysql', 'mariadb', 'dynamodb', 'turso', 'libsql',
] as const;

/** Extract the SQLite path from a spec (string URL or object form). */
function sqlitePath(spec: StoreBackendSpec): string | undefined {
    if (typeof spec === 'string' && spec.startsWith('sqlite:')) {
        return spec.replace(/^sqlite:\/\/?/, '');
    }
    if (typeof spec === 'object' && spec !== null) {
        const s = spec as { type?: unknown; path?: string; uri?: string };
        return s.path ?? (s.type === 'sqlite' ? s.uri : undefined);
    }
    return undefined;
}

/**
 * Normalise any spec into a concrete backend selection. May open a connection
 * (via `createAgentDb`) for URL/object specs — callers should reuse the result
 * for both stores rather than resolve twice.
 */
export async function resolveBackend(spec: StoreBackendSpec = 'memory'): Promise<Backend> {
    if (spec instanceof AgentDb) return spec;

    if (typeof spec === 'string') {
        const lower = spec.toLowerCase();
        if (lower === 'memory' || lower === 'in-memory') return 'memory';
        if (lower === 'sqlite' || lower.startsWith('sqlite:')) return 'sqlite';
        // Any other URL string → a real AgentDb backend (postgres://, …).
        return createAgentDb(spec);
    }

    if (typeof spec === 'object' && spec !== null) {
        const type = spec.type;
        if (type === 'memory' || type === 'in-memory') return 'memory';
        if (type === 'sqlite') return 'sqlite';
        if (type === 'db') return (spec as { db: AgentDb }).db;
        // Any other AgentDbConfig type → create the backend lazily.
        const known = KNOWN_DB_TYPES as readonly string[];
        if (typeof type === 'string' && known.includes(type)) {
            return createAgentDb(spec as AgentDbConfig);
        }
    }
    throw new Error(
        '[personaforge] Unsupported improvement store spec. Expected "memory", "sqlite", ' +
        'a connection URL/postgres://…, { type: "sqlite", path }, { type: "db", db }, or an AgentDb instance.',
    );
}

/** Build a `FeedbackRepo` from any backend description. */
export async function createFeedbackRepo(spec: StoreBackendSpec = 'memory'): Promise<FeedbackRepo> {
    const backend = await resolveBackend(spec);
    if (backend === 'memory') return new InMemoryFeedbackRepo();
    if (backend === 'sqlite') return new SqliteFeedbackRepo(sqlitePath(spec));
    return new DbFeedbackRepo(backend);
}

/** Build a `PolicyStore` from any backend description. */
export async function createPolicyStore(spec: StoreBackendSpec = 'memory'): Promise<PolicyStore> {
    const backend = await resolveBackend(spec);
    if (backend === 'memory') return new InMemoryPolicyStore();
    if (backend === 'sqlite') return new SqlitePolicyStore(sqlitePath(spec));
    return new DbPolicyStore(backend);
}

/** Build both improvement stores sharing one backend instance. */
export async function createImprovementStores(spec: StoreBackendSpec = 'memory'): Promise<ImprovementStores> {
    const backend = await resolveBackend(spec);
    if (backend === 'memory') {
        return { feedback: new InMemoryFeedbackRepo(), policy: new InMemoryPolicyStore() };
    }
    if (backend === 'sqlite') {
        const path = sqlitePath(spec);
        return { feedback: new SqliteFeedbackRepo(path), policy: new SqlitePolicyStore(path) };
    }
    // One AgentDb instance backs both stores (single connection, shared tables).
    return { feedback: new DbFeedbackRepo(backend), policy: new DbPolicyStore(backend) };
}
