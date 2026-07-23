# Contributing to personaforge

Thank you for contributing! This guide covers how to set up the project, the coding standards, and the PR process.

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.1.0
- Node.js ≥ 18 (for type checking and some runtime paths)

## Development Setup

```bash
# Clone and install
git clone https://github.com/personaforge/personaforge.git
cd agent-framework
bun install

# Run the test suite
bun test

# Type-check everything (source + tests)
bun run typecheck

# Build the package
bun run build

# Lint
bun run lint
```

## Project Structure

```
src/
  adapters/       # 20-category adapter system (LLM, storage, vector DB, etc.)
  agentic/        # Agentic runner (multi-step LLM loop)
  artifacts/      # Structured agent output (markdown, JSON, images)
  background/     # Background job queues (BullMQ)
  cli/            # personaforge CLI commands
  config/         # Configuration loading
  core/           # Core utilities (circuit breaker, retry, rate limiter)
  execution/      # Tool execution sandbox
  guardrails/     # Output validation and safety controls
  knowledge/      # RAG / vector search
  learning/       # Feedback and RLHF pipeline
  llm/            # LLM provider abstraction (OpenAI, Anthropic, Google, etc.)
  memory/         # Long-term and working memory
  observability/  # OpenTelemetry tracing, metrics, logging
  orchestration/  # Multi-agent orchestration (team, supervisor)
  planner/        # Step planner for complex tasks
  plugins/        # Plugin system
  production/     # Budget enforcement, health checks, HITL
  runtime/        # HTTP server, JWT RBAC, WebSocket, admin API
  session/        # Session management
  storage/        # Key-value + blob storage
  testing/        # Testing utilities (MockLLM, MockSessionStore, etc.)
  tools/          # Tool registry and types
  voice/          # Voice / audio streaming
tests/            # Vitest test suite
examples/         # Runnable examples
docs/             # Documentation
```

## Coding Standards

### TypeScript

- Strict mode is enabled (`"strict": true` in tsconfig.json)
- Prefer `interface` over `type` for public API shapes
- Use `readonly` for all configuration and result objects
- Export types separately from implementations (`export type { Foo }`)
- Avoid `any` — use `unknown` and narrow with type guards
- Use `satisfies` for configuration objects where inference is preferred

### File Organization

- One primary export per file (the main class or function)
- Types file per module (e.g., `types.ts`)
- Index file re-exports only — no logic in `index.ts`
- Test files in `tests/` named `<feature>.test.ts`

### Error Handling

- Use domain-specific error classes (extend `Error`, set `this.name`)
- Set `Object.setPrototypeOf(this, MyError.prototype)` in constructor for instanceof to work across bundles
- Never swallow errors silently — log or rethrow

### Testing

Use the testing utilities in `src/testing/`:

```ts
import { createTestAgent } from 'personaforge/testing';
import { MockToolRegistry } from 'personaforge/testing';

const { agent, llm } = await createTestAgent({
  instructions: 'You are a test agent',
});
llm.setResponse('Hello from mock');
const result = await agent.run('Hello');
```

- Target ≥ 80% coverage for new modules
- Test error paths, not just happy paths
- Use `beforeEach` to reset mock state between tests

## Pull Request Process

1. **Branch naming**: `feat/<name>`, `fix/<name>`, `test/<name>`, `docs/<name>`
2. **One concern per PR** — keep PRs focused and reviewable
3. **Tests required**: New features need tests. Bug fixes need a regression test.
4. **Update CHANGELOG.md** under `[Unreleased]` with a summary of your change
5. **Type-check passes**: `bun run typecheck` must exit 0
6. **All tests pass**: `bun test` must exit 0

## Adding a New LLM Provider

1. Implement `LLMProvider` from `src/llm/types.ts`
2. Add to `src/adapters/built-in.ts` adapter registry
3. Add cost pricing to `src/llm/cost-tracker.ts` `MODEL_PRICING` map
4. Export from `src/adapters/index.ts`
5. Add a test in `tests/` and an example in `examples/`
6. Document in `docs/guide/adapters.md`

## Adding a New Tool

```ts
import type { Tool } from 'personaforge/tools';

export const myTool: Tool = {
  name: 'my_tool',
  description: 'Does something useful',
  parameters: z.object({
    input: z.string().describe('The input to process'),
  }),
  execute: async (args, context) => {
    // context.permissions.allowNetwork etc.
    return { success: true, data: `processed: ${args.input}` };
  },
};
```

## Release Process

Releases are managed by maintainers:

1. Update `CHANGELOG.md` — move `[Unreleased]` items to the new version section
2. Bump `version` in `package.json` and `src/version.ts`
3. `bun run build && bun test`
4. Tag: `git tag v0.X.Y && git push --tags`
5. `npm publish` (or Bun publish)

## Code of Conduct

Be respectful. Focus on technical merit. No harassment or discrimination of any kind.

## Questions?

Open a GitHub Discussion or file an issue with the `question` label.
