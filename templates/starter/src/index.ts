/**
 * personaforge starter — one-agent setup, then grow.
 *
 * Step 1: one agent, one run
 * Step 2: add a tool
 * Step 3: add sessions
 * Step 4: add serving
 */

import { agent, tool } from 'personaforge';
import { z } from 'zod';

// ── Step 1: Define a tool ──────────────────────────────────────────────
const greet = tool({
  name: 'greet',
  description: 'Greet a person by name',
  schema: z.object({ name: z.string().describe('Person to greet') }),
  execute: async ({ name }) => `Hello, ${name}! Welcome to personaforge.`,
});

// ── Step 2: Create an agent ────────────────────────────────────────────
const myAgent = agent({
  name: 'greeter',
  model: 'gpt-4o-mini',
  instructions: `You are a friendly greeter assistant.
Use the greet tool when someone introduces themselves.
Be warm and concise.`,
  tools: [greet],
});

// ── Step 3: Run ────────────────────────────────────────────────────────
const result = await myAgent.run('Hi, my name is Alice!');
console.log(result.text);
// "Hello, Alice! Welcome to personaforge."
MDEOF

echo "Starter template created"