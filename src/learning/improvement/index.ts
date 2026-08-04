/**
 * @personaforge/learning — continuous improvement subsystem.
 *
 * Turns every agent execution into structured, versioned feedback that an
 * adaptive pipeline uses to keep improving the agent — while staying safe,
 * auditable and deterministically rollback-able:
 *
 *   execution → signal → feedback (human / user / AI critique / self-reflection
 *     / peer / reward / metric) → performance scoring → automatic optimization
 *     (prompt / tool selection / workflow / memory / model routing / cost /
 *     latency) → versioned promotion (regression-gated) → rollout / rollback.
 *
 * Storage is any-DB by default: dedicated in-memory and SQLite stores, plus
 * `DbFeedbackRepo` / `DbPolicyStore` on the unified `AgentDb` abstraction, so
 * Postgres, MongoDB, Redis, MySQL, DynamoDB, Turso, JSON file and more work
 * with zero extra code via `createImprovementStores()`.
 *
 * @experimental This subsystem is newer and not yet semver-stable.
 */

export * from './types.js';
export * from './async-lock.js';
export * from './reward.js';
export * from './eval-metrics.js';
export * from './feedback.js';
export * from './scoring.js';
export * from './policy-store.js';
export * from './bandit.js';
export * from './optimizers.js';
export * from './pipeline.js';
export * from './sources.js';
export * from './db-stores.js';
export * from './store-factory.js';
export * from './loop.js';
