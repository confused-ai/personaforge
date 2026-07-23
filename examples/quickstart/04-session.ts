/**
 * Quickstart 04 — Sessions
 *
 * Demonstrates multi-turn conversation using a session. Each call to
 * `agent.run()` with the same `sessionId` shares full conversation history,
 * so the agent naturally refers back to earlier messages.
 *
 * Run:
 *   OPENAI_API_KEY=sk-... bun examples/quickstart/04-session.ts
 */

import { agent, InMemorySessionStore } from 'personaforge';

// ── Shared session store ──────────────────────────────────────────────────────

const sessionStore = new InMemorySessionStore();

const bot = agent({
  name: 'ChatBot',
  instructions: 'You are a conversational assistant. Remember the full conversation.',
  sessionStore,
});

// ── Start a session ───────────────────────────────────────────────────────────

const sessionId = await bot.createSession('user-123');
console.log(`Session started: ${sessionId}`);

// ── Multi-turn conversation using the same session ────────────────────────────

console.log('\n--- Turn 1 ---');
const r1 = await bot.run('My name is Alex.', { sessionId });
console.log(r1.text);

console.log('\n--- Turn 2 ---');
const r2 = await bot.run('What is my name?', { sessionId });
console.log(r2.text);

console.log('\n--- Turn 3 ---');
const r3 = await bot.run('How many messages have we exchanged so far?', { sessionId });
console.log(r3.text);

// ── Session history ───────────────────────────────────────────────────────────

const history = await bot.getSessionMessages(sessionId);
console.log(`\nTotal stored messages: ${history.length}`);
