/**
 * @personaforge/db/factory — createAgentDb() factory.
 *
 * Instantiates the right AgentDb backend from a config object or a
 * connection URL string.
 *
 * @example
 * ```ts
 * import { createAgentDb } from './index.js';
 *
 * const db = await createAgentDb('sqlite:///data/agent.db');
 * const db2 = await createAgentDb({ type: 'postgres', uri: 'postgres://…' });
 * const db3 = await createAgentDb('memory'); // InMemory for tests
 * ```
 */

import type { AgentDb } from './base.js';
import type { AgentDbTableNames } from './types.js';

export type AgentDbType =
  | 'memory' | 'in-memory'
  | 'sqlite'
  | 'postgres' | 'postgresql'
  | 'mongo' | 'mongodb'
  | 'redis'
  | 'json'
  | 'mysql' | 'mariadb'
  | 'dynamodb'
  | 'turso' | 'libsql';

export interface AgentDbConfig {
  type: AgentDbType;
  /** Connection URI (meaning depends on backend). */
  uri?: string;
  /** Override table names. */
  tables?: AgentDbTableNames;
  /** Backend-specific extra options. */
  [key: string]: unknown;
}

/**
 * Create an AgentDb backend from a config object or a connection URL string.
 *
 * Supported URL schemes:
 *   `memory`, `sqlite://path`, `postgres://…`, `postgresql://…`,
 *   `mongodb://…`, `mongodb+srv://…`, `redis://…`, `rediss://…`,
 *   `json://path`, `mysql://…`, `mariadb://…`, `dynamodb://…`,
 *   `libsql://…`, `turso://…`, `file://…` (Turso local)
 */
export async function createAgentDb(config: AgentDbConfig | string): Promise<AgentDb> {
  const cfg = typeof config === 'string' ? parseUrl(config) : config;
  const type = cfg.type.toLowerCase() as AgentDbType;

  switch (type) {
    case 'memory':
    case 'in-memory': {
      const { InMemoryAgentDb } = await import('./in-memory.js');
      return new InMemoryAgentDb();
    }
    case 'sqlite': {
      const { SqliteAgentDb } = await import('./sqlite.js');
      const path = cfg.uri ?? (cfg['path'] as string | undefined);
      return new SqliteAgentDb({
        ...(path !== undefined && { path }),
        ...(cfg.tables !== undefined && { tables: cfg.tables }),
      });
    }
    case 'postgres':
    case 'postgresql': {
      const { PostgresAgentDb } = await import('./postgres.js');
      return new PostgresAgentDb({
        ...(cfg.uri !== undefined && { connectionString: cfg.uri }),
        ...(cfg.tables !== undefined && { tables: cfg.tables }),
      });
    }
    case 'mongo':
    case 'mongodb': {
      const { MongoAgentDb } = await import('./mongo.js');
      const database = cfg['database'] as string | undefined;
      return new MongoAgentDb({
        ...(cfg.uri !== undefined && { url: cfg.uri }),
        ...(database !== undefined && { database }),
        ...(cfg.tables !== undefined && { tables: cfg.tables }),
      });
    }
    case 'redis': {
      const { RedisAgentDb } = await import('./redis.js');
      return new RedisAgentDb({
        ...(cfg.uri !== undefined && { url: cfg.uri }),
        ...(cfg.tables !== undefined && { tables: cfg.tables }),
      });
    }
    case 'json': {
      const { JsonFileAgentDb } = await import('./json.js');
      const dir = cfg.uri ?? (cfg['dir'] as string | undefined);
      return new JsonFileAgentDb({
        ...(dir !== undefined && { dir }),
        ...(cfg.tables !== undefined && { tables: cfg.tables }),
      });
    }
    case 'mysql':
    case 'mariadb': {
      const { MysqlAgentDb } = await import('./mysql.js');
      return new MysqlAgentDb({
        ...(cfg.uri !== undefined && { uri: cfg.uri }),
        ...(cfg.tables !== undefined && { tables: cfg.tables }),
      });
    }
    case 'dynamodb': {
      const { DynamoDbAgentDb } = await import('./dynamodb.js');
      const tableName = cfg['tableName'] as string | undefined;
      const region    = cfg['region']    as string | undefined;
      return new DynamoDbAgentDb({
        ...(tableName !== undefined && { tableName }),
        ...(region    !== undefined && { region }),
        ...(cfg.uri   !== undefined && { endpoint: cfg.uri }),
        ...(cfg.tables !== undefined && { tables: cfg.tables }),
      });
    }
    case 'turso':
    case 'libsql': {
      const { TursoAgentDb } = await import('./turso.js');
      const authToken = cfg['authToken'] as string | undefined;
      return new TursoAgentDb({
        url: cfg.uri ?? 'file:agent.db',
        ...(authToken !== undefined && { authToken }),
        ...(cfg.tables !== undefined && { tables: cfg.tables }),
      });
    }
    default:
      throw new Error(`[personaforge/db] Unknown database type: "${type}". ` +
        `Supported: memory, sqlite, postgres, mongo, redis, json, mysql, dynamodb, turso`);
  }
}

/** Parse a connection URL string into an AgentDbConfig. */
function parseUrl(url: string): AgentDbConfig {
  const lower = url.toLowerCase();

  if (lower === 'memory' || lower === 'in-memory') return { type: 'memory' };

  if (lower.startsWith('sqlite:'))     return { type: 'sqlite',   uri: url.replace(/^sqlite:\/\/?/, '') };
  if (lower.startsWith('postgres://') || lower.startsWith('postgresql://')) return { type: 'postgres', uri: url };
  if (lower.startsWith('mongodb://') || lower.startsWith('mongodb+srv://')) return { type: 'mongo', uri: url };
  if (lower.startsWith('redis://') || lower.startsWith('rediss://')) return { type: 'redis', uri: url };
  if (lower.startsWith('json:'))       return { type: 'json',     uri: url.replace(/^json:\/\/?/, '') };
  if (lower.startsWith('mysql://') || lower.startsWith('mariadb://')) return { type: 'mysql', uri: url };
  if (lower.startsWith('dynamodb://')) {
    const endpoint = url.replace(/^dynamodb:\/\//, '');
    return endpoint ? { type: 'dynamodb', uri: endpoint } : { type: 'dynamodb' };
  }
  if (lower.startsWith('libsql://') || lower.startsWith('turso://')) return { type: 'turso', uri: url };
  if (lower.startsWith('file:'))       return { type: 'turso', uri: url };

  throw new Error(`[personaforge/db] Cannot parse database URL: "${url}". ` +
    `Expected scheme: sqlite:, postgres:, mongodb:, redis:, json:, mysql:, dynamodb:, libsql:, turso:, file:, or 'memory'`);
}
