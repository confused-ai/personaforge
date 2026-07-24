# personaforge Starter Template

Quick start: `npx create-personaforge my-agent`

```bash
# Manual setup
npm install personaforge
```

```ts
import { agent, tool } from 'personaforge';
import { z } from 'zod';

const greet = tool({
  name: 'greet',
  description: 'Greet a person by name',
  schema: z.object({ name: z.string() }),
  execute: async ({ name }) => `Hello, ${name}!`,
});

const myAgent = agent({
  name: 'greeter',
  model: 'gpt-4o-mini',
  instructions: 'You are a friendly greeter. Use the greet tool.',
  tools: [greet],
});

const result = await myAgent.run('Say hello to Alice');
console.log(result.text);
```

## What's Next

- Add more tools: `npm install @personaforge/tools`
- Add sessions: `agent({ session: true })`
- Add memory: `import { VectorMemoryStore } from 'personaforge/memory'`
- Serve via HTTP: `import { createHttpService } from 'personaforge/runtime'`
- Multi-agent teams: `import { createSupervisor } from 'personaforge/workflow'`
