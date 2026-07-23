# Adapters

Adapters are the infrastructure hand-off layer for `createAgent()`. The safest public patterns are:

- `createProductionSetup()` when you want a ready-made binding set
- `createAdapterRegistry()` when you want a central registry with lifecycle and health checks
- explicit `adapters` bindings when you want direct control over each slot

## Quick start

```ts
import { createAgent } from 'personaforge';
import { createProductionSetup } from 'personaforge/adapters';

const setup = createProductionSetup({ dev: true });
await setup.connect();

const agent = createAgent({
  name: 'assistant',
  instructions: 'You are a helpful assistant.',
  model: 'gpt-4o-mini',
  adapters: setup.bindings,
});

const result = await agent.run('Hello');
console.log(result.text);
console.log(await setup.healthCheck());
```

## Manual registry

```ts
import { createAgent } from 'personaforge';
import {
  InMemoryCacheAdapter,
  InMemorySessionStoreAdapter,
  InMemoryVectorAdapter,
  createAdapterRegistry,
} from 'personaforge/adapters';

const registry = createAdapterRegistry();
registry.register(new InMemoryCacheAdapter());
registry.register(new InMemoryVectorAdapter());
registry.register(new InMemorySessionStoreAdapter());

await registry.connectAll();

const agent = createAgent({
  name: 'assistant',
  instructions: 'Use the registered adapters.',
  model: 'gpt-4o-mini',
  adapters: registry,
});

console.log(registry.toBindings());
void agent;
```

## Explicit bindings

```ts
import { createAgent } from 'personaforge';
import {
  InMemoryAuditLogAdapter,
  InMemoryRateLimitAdapter,
  InMemorySessionStoreAdapter,
  InMemoryVectorAdapter,
} from 'personaforge/adapters';

const agent = createAgent({
  name: 'assistant',
  instructions: 'Use explicitly bound adapters.',
  model: 'gpt-4o-mini',
  adapters: {
    sessionStore: new InMemorySessionStoreAdapter(),
    memory: new InMemoryVectorAdapter(),
    rateLimit: new InMemoryRateLimitAdapter(),
    auditLog: new InMemoryAuditLogAdapter(),
  },
});

void agent;
```

## Choosing a pattern

- Use `createProductionSetup()` for the shortest path.
- Use a registry when you want health checks, connect/disconnect, and typed lookups.
- Use explicit bindings when you already know exactly which adapters each slot should use.