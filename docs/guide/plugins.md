---
title: Plugins
description: Register cross-cutting concerns — logging, rate limiting, telemetry — as plugins applied to all agents and tools via createPluginRegistry(). Author custom plugins with the Plugin interface.
outline: [2, 3]
---

# Plugins

Plugins are cross-cutting extensions that apply to all agents and tools registered in the same `PluginRegistry`. Unlike hooks (which are per-agent), plugins are global: register once, run everywhere.

```ts
import {
  createPluginRegistry,
  createLoggingPlugin,
  createRateLimitPlugin,
  createTelemetryPlugin,
} from 'personaforge/plugins';
```

---

## Quick start

```ts
import { createAgent } from 'personaforge';
import {
  createPluginRegistry,
  createLoggingPlugin,
  createRateLimitPlugin,
} from 'personaforge/plugins';

const plugins = createPluginRegistry();

plugins.register(createLoggingPlugin());
plugins.register(createRateLimitPlugin({ maxRpm: 60 }));

const agent = createAgent({
  name: 'my-agent',
  instructions: '...',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});

// There is no `plugins` option on createAgent — a registry is applied
// manually around each run. `runBeforeHooks` folds every plugin's beforeRun
// over the input (in registration order) and may transform it:
const context = { agentId: 'my-agent', logger: console, metadata: {} };
const input = await plugins.runBeforeHooks({ prompt: 'Summarize the latest report.' }, context);

const result = await agent.run(input.prompt);

// Collect the combined tool middleware from every plugin. Run the after /
// error hooks with `plugins.runAfterHooks(output, context)` and
// `plugins.runErrorHooks(error, context)`.
const toolMiddleware = plugins.getToolMiddleware();
```

---

## Built-in plugins

### `createLoggingPlugin`

Logs every agent invocation, tool call, and error:

```ts
import { createLoggingPlugin } from 'personaforge/plugins';

plugins.register(createLoggingPlugin(myLogger));  // optional custom logger
```

### `createRateLimitPlugin`

Rejects or queues requests that exceed a per-minute request rate:

```ts
import { createRateLimitPlugin } from 'personaforge/plugins';

plugins.register(createRateLimitPlugin({
  maxRpm:    60,    // max requests per minute (default: 60)
  maxTokens: 100_000,  // optional token budget per minute
}));
```

### `createTelemetryPlugin`

Emits metrics counters and histograms to any `MetricsCollector`:

```ts
import { createTelemetryPlugin } from 'personaforge/plugins';

plugins.register(createTelemetryPlugin(metricsCollector));
```

---

## `PluginRegistry` interface

```ts
interface PluginRegistry {
  register(plugin: Plugin): void;
  unregister(pluginId: string): boolean;
  get(pluginId: string): Plugin | undefined;
  list(): Plugin[];

  /** Run every plugin's beforeRun in order — may transform the input. */
  runBeforeHooks(input: AgentInput, context: PluginContext): Promise<AgentInput>;
  /** Run every plugin's afterRun in order — may transform the output. */
  runAfterHooks(output: AgentOutput, context: PluginContext): Promise<AgentOutput>;
  /** Combined tool middleware contributed by all plugins. */
  getToolMiddleware(): (ToolMiddleware | ToolMiddlewareObject)[];
  /** Fan an error out to every plugin's onError. */
  runErrorHooks(error: Error, context: PluginContext): Promise<void>;
}
```

---

## Author a custom plugin

```ts
import type { Plugin } from 'personaforge/plugins';

const auditPlugin: Plugin = {
  id: 'audit-logger',
  name: 'Audit Logger',

  async beforeRun(input, ctx) {
    await auditLog.write({ event: 'run.start', runId: ctx.runId, userId: ctx.userId });
    return input;  // must return (possibly modified) input
  },

  async afterRun(output, ctx) {
    await auditLog.write({ event: 'run.end', runId: ctx.runId, tokens: output.usage?.totalTokens });
    return output;  // must return (possibly modified) output
  },

  async toolMiddleware(name, args, next) {
    const start = Date.now();
    try {
      const result = await next(name, args);
      metrics.counter('tool.success', 1, { tool: name });
      return result;
    } catch (err) {
      metrics.counter('tool.error', 1, { tool: name });
      throw err;
    }
  },

  async onError(error, ctx) {
    await alerting.notify(`Agent error in run ${ctx.runId}: ${error.message}`);
  },
};

plugins.register(auditPlugin);
```

### `Plugin` interface

```ts
interface Plugin {
  /** Unique identifier */
  readonly id: string;
  /** Human-readable name */
  readonly name: string;

  /** Runs before every agent.run() — can modify input */
  beforeRun?(input: AgentInput, ctx: PluginContext): Promise<AgentInput>;

  /** Runs after every agent.run() — can modify output */
  afterRun?(output: AgentOutput, ctx: PluginContext): Promise<AgentOutput>;

  /** Tool middleware — wraps every tool call */
  toolMiddleware?(name: string, args: unknown, next: (name: string, args: unknown) => Promise<unknown>): Promise<unknown>;

  /** Called when an unhandled error occurs */
  onError?(error: Error, ctx: PluginContext): Promise<void>;
}
```

---

## Convert hooks to a plugin

If you already have `AgentLifecycleHooks`, use `hooksToPlugin` to register them as a plugin:

```ts
import { hooksToPlugin } from 'personaforge/plugins';

const myPlugin = hooksToPlugin('my-hooks', {
  beforeRun: async (input) => { console.log('run started'); return input; },
  afterRun:  async (output) => { console.log('run finished'); return output; },
});

plugins.register(myPlugin);
```

---

## Where to go next

- [Hooks](./hooks) — per-agent lifecycle hooks.
- [Observability](./observability) — OpenTelemetry spans and metrics.
- [Production](./production) — circuit breakers and rate limiters at the agent level.
