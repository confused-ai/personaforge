---
title: "01 · Hello World 🟢"
---

# 01 · Hello World 🟢

The absolute simplest agent. No tools. No memory. Just a conversation.

## What you'll learn

- How to install personaforge
- How to create an agent
- How to send a message and get a reply

## Setup

```bash
npm install personaforge
```

Create a `.env` file:

```bash
OPENAI_API_KEY=sk-...
```

## Code

```ts
// hello-world.ts
import { createAgent } from 'personaforge';

// 1. Create the agent
const agent = createAgent({
  name: 'hello-agent',
  model: 'gpt-4o-mini',         // cheap + fast, great for dev
  instructions: `
    You are a friendly assistant.
    Answer clearly and concisely.
  `,
});

// 2. Send a message
const result = await agent.run('What is the capital of France?');

// 3. Read the reply
console.log(result.text);
// → "The capital of France is Paris."
```

## Run it

```bash
npx tsx hello-world.ts
```

## What happened?

1. `createAgent()` sets up the agent with a model and instructions
2. `.run()` sends your message to the model and waits for the reply
3. `result.text` is the plain-text response

## Try changing it

- Swap `'gpt-4o-mini'` for `'claude-3-haiku-20240307'` if you have an Anthropic key
- Change the `instructions` to make the agent answer only in French
- Ask a follow-up question by calling `.run()` again with a different message

## What's next?

- [02 · First Custom Tool](./02-custom-tool) — give your agent real-world abilities
