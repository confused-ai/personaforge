---
title: Skills
description: Bundle reusable agent capabilities (instructions + tools) into named skills. Built-in webResearchSkill, codeReviewerSkill, pdfSummarizerSkill. Author custom skills with the Skill interface.
outline: [2, 3]
---

# Skills

Skills are capability bundles — a named set of instructions and tools that can be applied to any agent. They let you package reusable behaviours once and share them across agents without copying prompt logic or tool wiring.

```ts
import {
  webResearchSkill,
  codeReviewerSkill,
  pdfSummarizerSkill,
} from 'personaforge/skills';
```

---

## Attach built-in skills

```ts
import { defineAgent } from 'personaforge';
import { webResearchSkill, codeReviewerSkill } from 'personaforge/skills';

const agent = defineAgent('research-reviewer')
  .instructions('Help users research topics and review code.')
  .model('openai:gpt-4o-mini')
  .skills([webResearchSkill, codeReviewerSkill])
  .build();
```

---

## Built-in skills

### `webResearchSkill`

Gives the agent a `fetch_page` tool that retrieves the visible text from any HTTPS URL:

```ts
import { webResearchSkill } from 'personaforge/skills';

const agent = defineAgent('researcher')
  .instructions('Research questions using the web.')
  .model('openai:gpt-4o-mini')
  .skills([webResearchSkill])
  .build();

const result = await agent.run('What is the latest version of Node.js?');
// Agent will call fetch_page('https://nodejs.org/en/download/releases') internally
```

### `codeReviewerSkill`

Gives the agent a `read_source_file` tool that loads source files from disk:

```ts
import { codeReviewerSkill } from 'personaforge/skills';

const agent = defineAgent('code-reviewer')
  .instructions('Review source code files for bugs and security issues.')
  .model('openai:gpt-4o-mini')
  .skills([codeReviewerSkill])
  .build();

const result = await agent.run('Review src/runtime/jwt-rbac.ts for security vulnerabilities.');
// Supported extensions: .ts, .js, .py, .go, .rs, .java, .sql, .yaml, .md and more
```

### `pdfSummarizerSkill`

Gives the agent the ability to load and summarise PDF documents:

```ts
import { pdfSummarizerSkill } from 'personaforge/skills';

const agent = defineAgent('doc-summarizer')
  .instructions('Summarise documents and answer questions about their content.')
  .model('openai:gpt-4o')
  .skills([pdfSummarizerSkill])
  .build();

const result = await agent.run('Summarise the document at ./reports/Q4-2024.pdf');
```

---

## Author a custom skill

A `Skill` is a plain object with `id`, `name`, optional `instructions`, and an array of `tools`:

```ts
import type { Skill } from 'personaforge/contracts';
import { defineAgent, tool } from 'personaforge';
import { z } from 'zod';

const getWeather = tool({
  name: 'get_weather',
  description: 'Get the current weather for a city.',
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => fetchWeather(city),
});

export const weatherSkill: Skill = {
  id: 'weather',
  name: 'weather',
  instructions: 'You can look up current weather for any city using get_weather.',
  tools: [getWeather],
};

// Use it
const agent = defineAgent('travel-agent')
  .instructions('Help users plan trips.')
  .model('openai:gpt-4o-mini')
  .skills([weatherSkill])
  .build();
```

---

## `Skill` interface

```ts
interface Skill {
  /** Unique identifier — kebab-case recommended (e.g. "web-research") */
  id: string;
  /** Human-readable display name */
  name: string;
  /** Short description of what this skill does */
  description?: string;
  /** Additional instructions appended to the agent system prompt */
  instructions?: string;
  /** Tools this skill provides */
  tools?: Tool[];
  /** Optional category tags for discovery and filtering */
  tags?: string[];
  /** Arbitrary metadata: version, author, homepage, etc. */
  metadata?: Record<string, unknown>;
}
```

---

## Where to go next

- [Custom tools](./custom-tools) — build the individual tools that skills expose.
- [Tool composition](./tool-composition) — wrap and extend skill tools.
- [Plugins](./plugins) — framework-level extension points.
