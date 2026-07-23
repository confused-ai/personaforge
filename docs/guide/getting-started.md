---
title: Getting Started
description: Install personaforge, run your first agent, and follow a clean upgrade path toward tools, sessions, retrieval, and production runtime features.
outline: [2, 3]
---

# Getting Started

The fastest way to learn `personaforge` is to get one working result quickly, then add capability in the order the application actually needs it. This page is that first path.

## Step 1: Install the package

```bash
npm install personaforge
```

If you use Bun or pnpm, the package name is still the same. The public install story is one package: `personaforge`.

## Step 2: Set one provider key

Start with one provider only. Do not add several until the task is already working.

```bash
OPENAI_API_KEY=sk-...
```

## Step 3: Run one agent

```ts
import { createAgent } from 'personaforge';

const assistant = createAgent({
	name: 'hello-agent',
	model: 'gpt-4o-mini',
	instructions: 'You are a concise and helpful assistant.',
});

const result = await assistant.run('What is the capital of France?');
console.log(result.text);
```

If this run is not working reliably, stop here and fix it before layering anything else on top.

## What you need before going further

The minimum starting point is small:

- the `personaforge` package installed in your project
- one working model or provider configuration
- one task simple enough to validate in a single run

Do not start with orchestration, multiple providers, or a full production runtime. Those layers are useful, but they are not the first milestone.

## Your first milestone

The first milestone is not “build the platform.” The first milestone is “prove one agent can do one job correctly.”

That usually means:

1. define clear instructions
2. choose one model
3. run one prompt
4. inspect the returned text

If that path is unreliable, every advanced feature you add later will be harder to debug and easier to misdiagnose.

## Step 4: Add only the next missing capability

Once the base path works, the next layer should be chosen by need, not by curiosity.

Use this rule of thumb:

- add a **tool** when the model needs live data or a side effect
- add a **session store** when the user returns across turns
- add **knowledge or retrieval** when answers should come from source material
- add **HTTP serving** when the agent becomes a real endpoint
- add **orchestration** when one agent is no longer the right boundary

## Recommended build order

Use this progression unless you already know a later layer is required:

1. Start with one agent and one verified run.
2. Add one tool when the model needs live data or a side effect.
3. Add a session store when the user returns across turns.
4. Add retrieval or knowledge when answers should come from documents.
5. Add HTTP serving, scheduling, or orchestration only when the base behavior is solid.

This order keeps the moving parts separated so you can tell which layer introduced a failure.

## A second example: add one tool

The next upgrade should still feel simple.

```ts
import { agent, tool } from 'personaforge';
import { z } from 'zod/v3';

const getWeather = tool({
	name: 'get_weather',
	description: 'Return the current weather for a city.',
	parameters: z.object({ city: z.string() }),
	execute: async ({ city }) => `${city}: sunny, 24°C`,
});

const weatherAgent = agent({
	name: 'weather-agent',
	model: 'gpt-4o-mini',
	instructions: 'Use the tool to answer weather questions.',
	tools: [getWeather],
});

const result = await weatherAgent.run('What is the weather in Tokyo?');
console.log(result.text);
```

That is the general pattern for growing the system: add one explicit capability, verify it, then continue.

## What to avoid early

These are common ways to make the first version harder than it needs to be:

- starting with a team when one agent would do
- mixing several model providers before you know the task shape
- adding persistence or approvals before the core prompt behavior is understood
- writing many tools before one tool has proven its value

## Where to go next

After the first run works, choose the next page based on the missing capability:

- `agents.md` if you want a clearer authoring model
- `tools.md` if the agent needs live system access
- `session.md` if the conversation should continue over time
- `rag.md` if the answers must come from your documents
- `production.md` if the agent is moving into a real runtime