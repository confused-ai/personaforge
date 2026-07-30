/**
 * @personaforge/toolkits — curated tool bundles with prompt fragments.
 *
 * A toolkit is a named set of tools *plus* an optional system-prompt fragment
 * describing how the agent should use them. This matches the LangChain
 * "SqlDatabaseToolkit" pattern and Agno's toolkit ergonomics.
 *
 * ```ts
 * const kit = sqlToolkit({ execute: runQuery, listTables: () => [...] });
 * agent({ tools: kit.tools, instructions: [baseInstructions, kit.promptFragment].join('\n') });
 * ```
 *
 * Ships three reference toolkits (SQL, HTTP, File) — the rest of the
 * pattern is applied to existing tool bundles in src/tools/* on demand.
 */

import { z } from 'zod';
import type { SchemaInput } from '../validation/index.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Tool<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly parameters: SchemaInput<unknown, TInput>;
  execute(input: TInput): Promise<TOutput>;
}

export interface PromptedToolkit {
  readonly name: string;
  readonly description: string;
  readonly tools: Tool[];
  /** Prompt fragment describing when/how to use these tools. */
  readonly promptFragment: string;
}

// ── SQL toolkit ───────────────────────────────────────────────────────────────

export interface SqlToolkitConfig {
  /** Execute a SQL query and return rows. */
  execute: (query: string) => Promise<Record<string, unknown>[]>;
  /** Return the list of table names. */
  listTables: () => Promise<string[]> | string[];
  /** Return schema (column list) for a given table. */
  describeTable: (table: string) => Promise<Array<{ column: string; type: string }>> | Array<{ column: string; type: string }>;
}

export function sqlToolkit(cfg: SqlToolkitConfig): PromptedToolkit {
  const tools: Tool[] = [
    {
      name: 'sql_list_tables',
      description: 'List all tables available in the connected database.',
      parameters: z.object({}),
      async execute() { return { tables: await cfg.listTables() }; },
    },
    {
      name: 'sql_describe_table',
      description: 'Return the columns and types for a given table.',
      parameters: z.object({ table: z.string() }),
      async execute({ table }: { table: string }) {
        return { table, columns: await cfg.describeTable(table) };
      },
    } as Tool,
    {
      name: 'sql_query',
      description: 'Execute a read-only SQL query and return the rows. Never run destructive DML/DDL.',
      parameters: z.object({ query: z.string() }),
      async execute({ query }: { query: string }) {
        if (/\b(drop|delete|update|insert|alter|truncate)\b/i.test(query)) {
          throw new Error('[sql_query] destructive statements are not permitted');
        }
        return { rows: await cfg.execute(query) };
      },
    } as Tool,
  ];

  return {
    name: 'sql',
    description: 'Read-only access to a SQL database.',
    tools,
    promptFragment: [
      'You have SQL tools:',
      '  1. Call sql_list_tables to discover tables.',
      '  2. Call sql_describe_table before crafting a query.',
      '  3. Use sql_query with SELECT statements only. Aggregate and filter server-side.',
    ].join('\n'),
  };
}

// ── HTTP toolkit ──────────────────────────────────────────────────────────────

export interface HttpToolkitConfig {
  /** Allowed URL prefixes. Requests outside this list are rejected. */
  allowlist?: string[];
  /** Default headers merged into every request. */
  headers?: Record<string, string>;
  /** Custom fetch override (for tests). */
  fetchImpl?: typeof fetch;
}

export function httpToolkit(cfg: HttpToolkitConfig = {}): PromptedToolkit {
  const f = cfg.fetchImpl ?? fetch;
  const guard = (url: string): void => {
    if (cfg.allowlist && !cfg.allowlist.some((p) => url.startsWith(p))) {
      throw new Error(`[http_toolkit] URL not in allowlist: ${url}`);
    }
  };
  const tools: Tool[] = [
    {
      name: 'http_get',
      description: 'GET a URL and return response text.',
      parameters: z.object({ url: z.string().url() }),
      async execute({ url }: { url: string }) {
        guard(url);
        const res = await f(url, { headers: cfg.headers });
        return { status: res.status, body: await res.text() };
      },
    } as Tool,
    {
      name: 'http_post',
      description: 'POST JSON to a URL and return response text.',
      parameters: z.object({ url: z.string().url(), body: z.unknown() }),
      async execute({ url, body }: { url: string; body: unknown }) {
        guard(url);
        const res = await f(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...cfg.headers },
          body: JSON.stringify(body),
        });
        return { status: res.status, body: await res.text() };
      },
    } as Tool,
  ];
  return {
    name: 'http',
    description: 'Make outbound HTTP requests.',
    tools,
    promptFragment: cfg.allowlist
      ? `You may only call URLs starting with: ${cfg.allowlist.join(', ')}`
      : 'Use http tools for outbound HTTP requests. Always prefer specific data-source tools if available.',
  };
}

// ── File toolkit ──────────────────────────────────────────────────────────────

export interface FileToolkitConfig {
  /** Root directory. All file operations are constrained beneath this path. */
  root: string;
  /** File adapter — inject for tests. Defaults to node:fs/promises. */
  fs?: {
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<void>;
    readdir: (path: string) => Promise<string[]>;
  };
}

export function fileToolkit(cfg: FileToolkitConfig): PromptedToolkit {
  // Lazy-load fs; still lets tests inject a mock.
  const fsImpl = cfg.fs ?? {
    async readFile(p: string) {
      const fs = await import('node:fs/promises');
      return fs.readFile(p, 'utf-8');
    },
    async writeFile(p: string, c: string) {
      const fs = await import('node:fs/promises');
      await fs.writeFile(p, c, 'utf-8');
    },
    async readdir(p: string) {
      const fs = await import('node:fs/promises');
      return fs.readdir(p);
    },
  };
  const guard = async (path: string): Promise<string> => {
    const pathMod = await import('node:path');
    const abs = pathMod.resolve(cfg.root, path);
    if (!abs.startsWith(pathMod.resolve(cfg.root))) {
      throw new Error(`[file_toolkit] path escapes root: ${path}`);
    }
    return abs;
  };
  const tools: Tool[] = [
    {
      name: 'file_read',
      description: 'Read a text file relative to the workspace root.',
      parameters: z.object({ path: z.string() }),
      async execute({ path }: { path: string }) {
        return { content: await fsImpl.readFile(await guard(path)) };
      },
    } as Tool,
    {
      name: 'file_write',
      description: 'Write text to a file relative to the workspace root. Overwrites existing content.',
      parameters: z.object({ path: z.string(), content: z.string() }),
      async execute({ path, content }: { path: string; content: string }) {
        await fsImpl.writeFile(await guard(path), content);
        return { ok: true };
      },
    } as Tool,
    {
      name: 'file_list',
      description: 'List files in a directory relative to workspace root.',
      parameters: z.object({ path: z.string().default('.') }),
      async execute({ path }: { path: string }) {
        return { entries: await fsImpl.readdir(await guard(path)) };
      },
    } as Tool,
  ];
  return {
    name: 'file',
    description: `Read/write files under ${cfg.root}.`,
    tools,
    promptFragment: `You can read, write, and list files rooted at ${cfg.root}. Never accept absolute paths from users; always use paths relative to the workspace root.`,
  };
}

// ── Composition helpers ───────────────────────────────────────────────────────

/**
 * Merge multiple toolkits into one bundle for a single agent config.
 * Duplicate tool names throw.
 */
export function combineToolkits(...kits: PromptedToolkit[]): PromptedToolkit {
  const tools: Tool[] = [];
  const seen = new Set<string>();
  for (const k of kits) {
    for (const t of k.tools) {
      if (seen.has(t.name)) throw new Error(`[combineToolkits] duplicate tool: ${t.name}`);
      seen.add(t.name);
      tools.push(t);
    }
  }
  return {
    name: kits.map((k) => k.name).join('+'),
    description: kits.map((k) => k.description).join(' • '),
    tools,
    promptFragment: kits.map((k) => `[${k.name}]\n${k.promptFragment}`).join('\n\n'),
  };
}
