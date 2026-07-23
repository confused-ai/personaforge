/**
 * Quickstart 03 — Memory
 *
 * Shows how agents remember facts across multiple questions using the
 * InMemoryStore. The agent stores and retrieves memories using the built-in
 * memory tools.
 *
 * Run:
 *   OPENAI_API_KEY=sk-... bun examples/quickstart/03-memory.ts
 */

import { agent, InMemoryStore } from 'personaforge';
import { createAgentMemoryTools } from '@personaforge/memory';

// ── Create a shared memory store ─────────────────────────────────────────────

const memoryStore = new InMemoryStore();

// ── Wire memory tools into the agent ─────────────────────────────────────────

const memoryTools = createAgentMemoryTools({ store: memoryStore });

const bot = agent({
  name: 'MemoryBot',
  instructions: `You are a helpful assistant with persistent memory.
Use the remember tool to store important facts the user tells you.
Use the recall tool to retrieve facts before answering questions.`,
  tools: [...memoryTools],
});

// ── Interaction ───────────────────────────────────────────────────────────────

console.log('--- Turn 1: teach the agent a fact ---');
const r1 = await bot.run('My favourite colour is indigo. Remember this.');
console.log(r1.text);

console.log('\n--- Turn 2: the agent recalls the fact ---');
const r2 = await bot.run('What is my favourite colour?');
console.log(r2.text);
