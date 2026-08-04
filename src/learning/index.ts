/**
 * Learning module: user profiles, memories across sessions, learning modes.
 *
 * @experimental This subsystem is newer and not yet semver-stable — its store
 * interfaces and config shapes may change in a minor release.
 */

export * from './types.js';
export { InMemoryUserProfileStore } from './in-memory-store.js';
export { SqliteUserProfileStore, createSqliteUserProfileStore } from './sqlite-profile-store.js';
export { LearningMachine } from './machine.js';
export type { LearningMachineConfig, LearningRecallResult } from './machine.js';
export {
    InMemoryUserMemoryStore,
    InMemorySessionContextStore,
    InMemoryLearnedKnowledgeStore,
    InMemoryEntityMemoryStore,
} from './extended-stores.js';

// ── In-memory DecisionLogStore ────────────────────────────────────────────────
export { InMemoryDecisionLogStore } from './decision-log-store.js';

// ── SQLite-backed stores ──────────────────────────────────────────────────────
export {
    SqliteUserMemoryStore,
    SqliteSessionContextStore,
    SqliteLearnedKnowledgeStore,
    SqliteEntityMemoryStore,
    SqliteDecisionLogStore,
} from './sqlite-learning-stores.js';

// ── Postgres-backed stores ────────────────────────────────────────────────────
export {
    PostgresUserMemoryStore,
    PostgresSessionContextStore,
    PostgresLearnedKnowledgeStore,
    PostgresEntityMemoryStore,
    PostgresDecisionLogStore,
} from './postgres-learning-stores.js';
export type { PgLearningStoreConfig } from './postgres-learning-stores.js';

// ── MongoDB-backed stores ─────────────────────────────────────────────────────
export {
    MongoUserMemoryStore,
    MongoSessionContextStore,
    MongoLearnedKnowledgeStore,
    MongoEntityMemoryStore,
    MongoDecisionLogStore,
} from './mongo-learning-stores.js';
export type { MongoLearningConfig } from './mongo-learning-stores.js';

// ── Curator ───────────────────────────────────────────────────────────────────
export { Curator } from './curator.js';
export type { CuratorConfig, CurateOptions, CurateResult } from './curator.js';

// ── AgentDb-backed stores ──────────────────────────────────────────────────
export {
    DbUserMemoryStore,
    DbSessionContextStore,
    DbLearnedKnowledgeStore,
    DbEntityMemoryStore,
    DbDecisionLogStore,
} from './db-learning-stores.js';

// ── Continuous improvement subsystem ─────────────────────────────────────────
// Feedback, rewards, scoring, automatic optimization, versioned pipelines,
// rollback-safe policy store, and the always-on improvement loop.
export * from './improvement/index.js';
