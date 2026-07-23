---
title: "Packages & Imports"
---

# Packages & Imports

Install `personaforge` once. That is the public consumer package.

Use `personaforge` for the common agent APIs. Use `personaforge/<module>` when you want a more focused import path from the same installation.

```bash
npm install personaforge
```

```ts
import { agent, defineAgent, compose, tool } from 'personaforge';
import { TavilySearchTool } from 'personaforge/tools';
import { createSqliteStore } from 'personaforge/session';
import { ConsoleLogger } from 'personaforge/observability';
```

The repository is organized internally as a monorepo, so contributors will still see `@personaforge/*` workspace package names in implementation code and build scripts.

That internal layout is not the public install story. Consumer docs, app code, and examples should use:

- `personaforge`
- `personaforge/<module>`

`npm run package:prepare` still validates every exported subpath before publishing.
