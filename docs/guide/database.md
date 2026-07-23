---
title: Database
description: AgentDb — a unified interface for SQLite, PostgreSQL, MongoDB, Redis, MySQL, DynamoDB, Turso, and in-memory backends. Connect agents to structured data via AgentDb or the database tool.
outline: [2, 3]
---

# Database

`AgentDb` is the unified database abstraction used internally by sessions, memory, knowledge, schedules, and eval stores. You can also use it directly to connect agents to structured data.

```ts
import {
  SqliteAgentDb,
  PostgresAgentDb,
  MongoAgentDb,
  RedisAgentDb,
  MysqlAgentDb,
  DynamoDbAgentDb,
  TursoAgentDb,
  JsonFileAgentDb,
  InMemoryAgentDb,
  createAgentDb,
} from 'personaforge/db';
```

---

## Backends

### SQLite (zero-config local)

```ts
import { SqliteAgentDb } from 'personaforge/db';

const db = new SqliteAgentDb({ path: './data/agent.db' });
```

### PostgreSQL

```ts
import { PostgresAgentDb } from 'personaforge/db';

const db = new PostgresAgentDb({
  connectionString: process.env.DATABASE_URL!,
  // ssl: { rejectUnauthorized: false },  // for managed Postgres
});
```

### MongoDB

```ts
import { MongoAgentDb } from 'personaforge/db';

const db = new MongoAgentDb({
  url: process.env.MONGODB_URI!,
  database: 'myapp',
});
```

### Redis (key-value)

```ts
import { RedisAgentDb } from 'personaforge/db';

const db = new RedisAgentDb({
  url: process.env.REDIS_URL!,
  prefix: 'myapp:',
});
```

### Turso (libSQL, edge-ready)

```ts
import { TursoAgentDb } from 'personaforge/db';

const db = new TursoAgentDb({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
```

### DynamoDB

```ts
import { DynamoDbAgentDb } from 'personaforge/db';

const db = new DynamoDbAgentDb({
  region: 'us-east-1',
  tableName: 'agent-data',
});
```

### JSON file (zero-dependency persistence)

`JsonFileAgentDb` persists each table as a JSON file under a directory — handy for demos and small local apps with no database server:

```ts
import { JsonFileAgentDb } from 'personaforge/db';

const db = new JsonFileAgentDb({ dir: './data/agent-db' });
```

### `createAgentDb` factory

Pick a backend by string at runtime:

```ts
import { createAgentDb } from 'personaforge/db';

// createAgentDb is async. `uri` is the connection string for every backend
// (its meaning depends on `type`). A plain URL string also works, e.g.
// `await createAgentDb('postgres://…')`.
const db = await createAgentDb({
  type: process.env.DB_TYPE as 'sqlite' | 'postgres' | 'mongo' | 'redis',
  uri: process.env.DATABASE_URL,   // 'sqlite://./agent.db' | 'postgres://…' | 'mongodb://…' | 'redis://…'
  database: 'myapp',               // mongo only
  // tables: { ... }               // optional table-name overrides
});
```

---

## Plug into framework stores

The main use of `AgentDb` is wiring all framework stores to a single persistent backend:

```ts
import { createAgent, DbSessionStore } from 'personaforge';
import { createDbKnowledgeEngine, OpenAIEmbeddingProvider } from 'personaforge';
import { SqliteAgentDb } from 'personaforge/db';
import { createDbMemoryStore } from 'personaforge/memory';

const db = new SqliteAgentDb({ path: './agent.db' });
const embedder = new OpenAIEmbeddingProvider({ apiKey: process.env.OPENAI_API_KEY! });

const agent = createAgent({
  name: 'persistent-agent',
  instructions: '...',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  sessionStore:  new DbSessionStore(db),
  memoryStore:   createDbMemoryStore(db),   // AgentDb passed positionally
  knowledgebase: createDbKnowledgeEngine({
    db,
    embed: (text) => embedder.embed(text),  // embed is an EmbeddingFn, not a provider
  }),
});
```

---

## Database as a tool

For agent-initiated queries, expose database access as a typed tool:

```ts
import { tool, createAgent } from 'personaforge';
import { z } from 'zod';
import { db } from './db.js';  // your existing database client (Drizzle, Prisma, Knex...)

const lookupOrder = tool({
  name: 'lookup_order',
  description: 'Look up an order by ID. Returns order status and line items.',
  schema: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => {
    const order = await db.query.orders.findFirst({
      where: (o, { eq }) => eq(o.id, orderId),
      with: { lineItems: true },
    });
    if (!order) return { error: `Order ${orderId} not found.` };
    return order;
  },
});

const agent = createAgent({
  name: 'support-agent',
  instructions: 'Help customers with order questions.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [lookupOrder],
});
```

### Built-in data tools

If you don't want to hand-write tools, the framework ships ready-made data toolkits under `personaforge/tools/data` — SQL (`DatabaseToolkit`: Postgres/MySQL/SQLite), `RedisToolkit`, `CsvToolkit`, plus BigQuery and Neo4j tools:

```ts
import { DatabaseToolkit, RedisToolkit, CsvToolkit } from 'personaforge/tools/data';
```

---

## Where to go next

- [Storage](./storage) — key-value storage for application state.
- [Session](./session) — plug `DbSessionStore` into agents.
- [Memory](./memory) — `createDbMemoryStore` for persistent memory.
- [RAG](./rag) — `createDbKnowledgeEngine` for vector search.
