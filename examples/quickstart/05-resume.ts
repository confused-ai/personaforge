/**
 * Quickstart 05 — Resume a Session
 *
 * Demonstrates agent.resume(sessionId): pick up an existing conversation
 * from any sessionId. The agent sees the full prior history and continues
 * naturally — as if the conversation was never interrupted.
 *
 * Run:
 *   OPENAI_API_KEY=sk-... bun examples/quickstart/05-resume.ts
 */

import { agent, InMemorySessionStore } from 'personaforge';

// ── Shared session store ──────────────────────────────────────────────────────

const sessionStore = new InMemorySessionStore();

const bot = agent({
  name: 'ResumeBot',
  instructions: 'You are a helpful assistant with a good memory.',
  sessionStore,
});

// ── Phase 1: initial conversation ────────────────────────────────────────────

const sessionId = await bot.createSession('user-resume-demo');

console.log('=== Phase 1: initial conversation ===');
await bot.run('I am planning a trip to Japan in July.', { sessionId });
const r1 = await bot.run('I want to visit Kyoto and Tokyo.', { sessionId });
console.log('Agent:', r1.text);

// ── Phase 2: "restart" — create a new agent instance, reuse session ───────────
//
// In production this simulates a server restart or a new request handler.
// As long as the sessionStore is shared (e.g. Redis / SQLite), the new agent
// instance can resume the conversation with zero changes to the code.

console.log('\n=== Phase 2: resumed in a new agent instance ===');

const newBot = agent({
  name: 'ResumeBot',
  instructions: 'You are a helpful assistant with a good memory.',
  sessionStore, // same store — could be Redis/SQLite in production
});

const resumed = newBot.resume(sessionId);

const r2 = await resumed.run('What cities did I say I want to visit?');
console.log('Agent (resumed):', r2.text);

const r3 = await resumed.run('What month am I travelling?');
console.log('Agent (resumed):', r3.text);

// ── Session history ───────────────────────────────────────────────────────────

const history = await newBot.getSessionMessages(sessionId);
console.log(`\nTotal stored messages across both phases: ${history.length}`);
