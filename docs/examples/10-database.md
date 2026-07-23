# 10 · Database Analyst 🔴

Let users query a database in plain English. The agent generates SQL, runs it,
and explains the results in natural language. No SQL knowledge required.

## What you'll learn

- How to build a SQL-generation tool
- How to safely execute queries (read-only guard)
- How to give the agent schema context
- How to explain query results

## Code

```ts
// database-analyst.ts
import { z } from 'zod';
import { createAgent, tool } from 'personaforge';

// ── Database setup (using better-sqlite3 for simplicity) ───────────────────
// npm install better-sqlite3
import Database from 'better-sqlite3';

const db = new Database('./data/sales.db');

// Seed some demo data
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    customer TEXT,
    product TEXT,
    amount REAL,
    region TEXT,
    created_at TEXT
  );
  INSERT OR IGNORE INTO orders VALUES
    (1, 'Alice Corp', 'Pro Plan', 499.00, 'US', '2026-01-15'),
    (2, 'Bob Ltd',   'Starter',   99.00, 'EU', '2026-01-20'),
    (3, 'Carol Inc', 'Pro Plan', 499.00, 'US', '2026-02-01'),
    (4, 'Dave Co',  'Enterprise',1999.00,'APAC','2026-02-10'),
    (5, 'Eve Corp',  'Pro Plan', 499.00, 'EU', '2026-03-01');
`);

// ── Schema context (give this to the agent in its instructions) ────────────
const SCHEMA = `
Database schema:
  orders (id, customer, product, amount, region, created_at)
    - id: integer, primary key
    - customer: text, company name
    - product: text, one of 'Starter', 'Pro Plan', 'Enterprise'
    - amount: real, USD price
    - region: text, one of 'US', 'EU', 'APAC'
    - created_at: text, ISO date YYYY-MM-DD
`.trim();

// ── Tools ──────────────────────────────────────────────────────────────────
const runQuery = tool({
  name: 'runQuery',
  description: 'Execute a read-only SQL SELECT query on the database and return results as JSON.',
  parameters: z.object({
    sql: z.string().describe('A valid SQLite SELECT statement. Only SELECT is allowed.'),
    explanation: z.string().describe('One sentence explaining what this query does.'),
  }),
  execute: async ({ sql, explanation }) => {
    // SECURITY: Only allow SELECT statements
    const normalized = sql.trim().toUpperCase();
    if (!normalized.startsWith('SELECT')) {
      throw new Error('Only SELECT queries are allowed.');
    }
    // Block dangerous patterns
    const blocked = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'PRAGMA'];
    for (const word of blocked) {
      if (normalized.includes(word)) {
        throw new Error(`Disallowed keyword: ${word}`);
      }
    }

    try {
      const rows = db.prepare(sql).all();
      return {
        explanation,
        rowCount: rows.length,
        rows: rows.slice(0, 100),  // cap at 100 rows
      };
    } catch (err) {
      throw new Error(`SQL error: ${(err as Error).message}`);
    }
  },
});

const getSchema = tool({
  name: 'getSchema',
  description: 'Get the database schema to understand available tables and columns.',
  parameters: z.object({}),
  execute: async () => ({ schema: SCHEMA }),
});

// ── Agent ──────────────────────────────────────────────────────────────────
const analyst = createAgent({
  name: 'sql-analyst',
  model: 'gpt-4o',   // better at SQL generation
  instructions: `
    You are a data analyst who answers business questions using SQL.

    ${SCHEMA}

    Guidelines:
    - Always use runQuery to get real data before answering
    - Write clean, efficient SQL
    - Explain what the query does and interpret the results
    - Format numbers nicely (e.g., $1,999.00 not 1999)
    - When asked to compare, compute percentages and differences
    - Never make up data — only report what the query returns
  `,
  tools: [runQuery, getSchema],
});

// ── Ask business questions ─────────────────────────────────────────────────
const q1 = await analyst.run('What is our total revenue this year?');
console.log(q1.text);
// → "Total revenue for 2026 is $3,595.00 across 5 orders."

const q2 = await analyst.run('Which region generates the most revenue?');
console.log(q2.text);
// → "The US region leads with $998.00 (27.8%), followed by Enterprise deals in APAC..."

const q3 = await analyst.run('Show me all Pro Plan customers and when they signed up.');
console.log(q3.text);
// → "There are 3 Pro Plan customers: Alice Corp (Jan 15), Carol Inc (Feb 1), Eve Corp (Mar 1)"

const q4 = await analyst.run('How many orders do we have per product?');
console.log(q4.text);
// → "Pro Plan: 3 orders, Enterprise: 1 order, Starter: 1 order"
```

## PostgreSQL / MySQL

Swap `better-sqlite3` for your production database:

```ts
// PostgreSQL (npm install pg)
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const runQuery = tool({
  name: 'runQuery',
  parameters: z.object({ sql: z.string(), explanation: z.string() }),
  execute: async ({ sql, explanation }) => {
    if (!sql.trim().toUpperCase().startsWith('SELECT')) {
      throw new Error('Only SELECT allowed');
    }
    const { rows } = await pool.query(sql);
    return { explanation, rowCount: rows.length, rows };
  },
});
```

## Dynamic schema injection

For large databases with many tables:

```ts
// Only inject relevant tables based on the question
const getRelevantSchema = tool({
  name: 'getRelevantSchema',
  description: 'Get schema for tables relevant to the question',
  parameters: z.object({ tables: z.array(z.string()).describe('Table names you need') }),
  execute: async ({ tables }) => {
    const schemas: Record<string, unknown[]> = {};
    for (const table of tables) {
      schemas[table] = db.prepare(`PRAGMA table_info(${table})`).all();
    }
    return schemas;
  },
});
```

## What's next?

- [09 · Supervisor Workflow](./09-supervisor) — agent that delegates to sub-analysts
- [15 · Full-Stack App](./15-full-stack) — database analyst behind an HTTP API
