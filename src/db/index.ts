/**
 * @personaforge/db — Unified agent database layer.
 *
 * Re-exports everything from all backends so you can import from the
 * package root or from the specific sub-path entry point.
 *
 * @example
 * ```ts
 * import { AgentDb, SqliteAgentDb, PostgresAgentDb } from './index.js';
 *
 * // Extend to add your own backend:
 * import { AgentDb } from './index.js';
 * class MyDb extends AgentDb { ... }
 * ```
 */

export { AgentDb } from './base.js';
export type {
  SessionRow, MemoryRow, LearningRow, KnowledgeRow, TraceRow, ScheduleRow,
  SessionQuery, MemoryQuery, LearningQuery, KnowledgeQuery,
  UpsertSessionInput, UpsertMemoryInput, UpsertLearningInput, UpsertKnowledgeInput,
  AgentDbTableNames, LearningType,
} from './types.js';
export { DEFAULT_TABLE_NAMES } from './types.js';

export { InMemoryAgentDb } from './in-memory.js';

export { SqliteAgentDb } from './sqlite.js';
export type { SqliteAgentDbOptions } from './sqlite.js';

export { PostgresAgentDb } from './postgres.js';
export type { PostgresAgentDbOptions } from './postgres.js';

export { MongoAgentDb } from './mongo.js';
export type { MongoAgentDbOptions } from './mongo.js';

export { RedisAgentDb } from './redis.js';
export type { RedisAgentDbOptions } from './redis.js';

export { JsonFileAgentDb } from './json.js';
export type { JsonFileAgentDbOptions } from './json.js';

export { MysqlAgentDb } from './mysql.js';
export type { MysqlAgentDbOptions } from './mysql.js';

export { DynamoDbAgentDb } from './dynamodb.js';
export type { DynamoDbAgentDbOptions } from './dynamodb.js';

export { TursoAgentDb } from './turso.js';
export type { TursoAgentDbOptions } from './turso.js';

export { createAgentDb } from './factory.js';
export type { AgentDbConfig, AgentDbType } from './factory.js';
