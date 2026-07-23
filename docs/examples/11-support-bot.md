# 11 · Customer Support Bot

This version keeps the example on the current public API: one agent, two tools, and a real session store for multi-turn support chats.

## What it shows

- `createAgent()` for the support bot itself
- `tool()` for order lookup and ticket creation
- `InMemorySessionStore` for conversation continuity

## Example

```ts
import { z } from 'zod/v3';
import { createAgent, tool } from 'personaforge';
import { InMemorySessionStore } from 'personaforge/session';

const lookupOrder = tool({
  name: 'lookup_order',
  description: 'Look up an order by ID.',
  parameters: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => ({
    orderId,
    status: 'shipped',
    eta: '2026-05-12',
  }),
});

const createTicket = tool({
  name: 'create_ticket',
  description: 'Create a support ticket for issues that need follow-up.',
  parameters: z.object({
    subject: z.string(),
    priority: z.enum(['low', 'medium', 'high']),
  }),
  execute: async ({ subject, priority }) => ({
    ticketId: 'TKT-1001',
    subject,
    priority,
    status: 'open',
  }),
});

const supportBot = createAgent({
  name: 'support-bot',
  instructions: [
    'You are a concise customer support assistant.',
    'Check order status before answering delivery questions.',
    'Open a ticket when the issue needs follow-up.',
  ].join(' '),
  model: 'gpt-4o-mini',
  tools: [lookupOrder, createTicket],
  sessionStore: new InMemorySessionStore(),
});

const firstReply = await supportBot.run('Where is order ORD-42?', {
  sessionId: 'cust-42',
  userId: 'cust-42',
});

const secondReply = await supportBot.run('If it is still late, open a ticket for me.', {
  sessionId: 'cust-42',
  userId: 'cust-42',
});

console.log(firstReply.text);
console.log(secondReply.text);
```

## Production notes

- Swap `InMemorySessionStore` for a persistent session store before deploying.
- Add guardrails and approval flows only when you need them; keep the support loop simple first.
- Expose the agent over HTTP with `createHttpService()` when you are ready for browser or API clients.