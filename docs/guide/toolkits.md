---
title: Toolkits
description: Curated tool bundles with system-prompt fragments — sqlToolkit, httpToolkit, fileToolkit, and combineToolkits — that add a set of related tools plus usage guidance to an agent in one line.
outline: [2, 3]
---

# Toolkits

A toolkit is a named set of tools **plus** a system-prompt fragment describing how the agent should use them. Ship a starter set of related capabilities to an agent in one line.

```ts
import { sqlToolkit, httpToolkit, fileToolkit, combineToolkits } from 'confused-ai/toolkits';
```

---

## `sqlToolkit`

Read-only SQL toolkit. Blocks destructive DML/DDL at the tool boundary.

```ts
const kit = sqlToolkit({
  execute: async (q) => db.query(q),
  listTables: async () => ['users', 'orders'],
  describeTable: async (t) => db.getSchema(t),
});

const analyst = agent({
  name: 'analyst',
  instructions: [baseInstructions, kit.promptFragment].join('\n'),
  tools: kit.tools,   // sql_list_tables, sql_describe_table, sql_query
});
```

Tools:
- `sql_list_tables` — discover tables.
- `sql_describe_table` — get columns and types for a table.
- `sql_query` — run a SELECT (throws on DROP/DELETE/UPDATE/INSERT/ALTER/TRUNCATE).

---

## `httpToolkit`

HTTP GET and POST with optional URL allowlist.

```ts
const kit = httpToolkit({
  allowlist: ['https://api.example.com', 'https://api.stripe.com'],
  headers: { 'user-agent': 'my-agent/1.0' },
});
```

Requests outside the allowlist are rejected before the fetch runs.

Tools: `http_get`, `http_post`.

---

## `fileToolkit`

Read/write/list files rooted at a configurable directory. Path guards prevent escaping the workspace root.

```ts
const kit = fileToolkit({ root: '/workspace' });
// Tools: file_read, file_write, file_list
```

Any attempt like `file_read({ path: '../../etc/passwd' })` throws.

Inject a custom `fs` adapter for tests or virtual filesystems:

```ts
const kit = fileToolkit({
  root: '/vfs',
  fs: {
    readFile: async (p) => mem.get(p),
    writeFile: async (p, c) => { mem.set(p, c); },
    readdir: async (p) => Array.from(mem.keys()).filter((k) => k.startsWith(p)),
  },
});
```

---

## `combineToolkits`

Merge multiple toolkits into one bundle. Duplicate tool names throw.

```ts
const bundle = combineToolkits(
  sqlToolkit({ ...sqlOpts }),
  httpToolkit({ allowlist: ['https://api.internal'] }),
);

agent({
  tools: bundle.tools,
  instructions: bundle.promptFragment,  // both fragments joined and labelled
});
```

---

## Building your own toolkit

The shape is deliberately minimal:

```ts
interface PromptedToolkit {
  name: string;
  description: string;
  tools: Tool[];
  promptFragment: string;
}
```

Follow the pattern in `src/toolkits/index.ts`. Keep tools narrow, describe them precisely, and prefer strict `parameters` schemas so the model gets validation for free.

---

## Related pages

- [Built-in Tools](/guide/tools) — the 100+ pre-existing tool library.
- [Tool Composition](/guide/tool-composition) — piping and wrapping tools.
- [Custom Tools](/guide/custom-tools) — authoring your own.
