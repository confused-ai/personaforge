/**
 * Quickstart 01 — Hello World
 *
 * The simplest possible agent. No tools, no session, one question.
 *
 * Run:
 *   OPENAI_API_KEY=sk-... bun examples/quickstart/01-hello.ts
 */

import { agent } from 'personaforge';

const bot = agent({
  name: 'HelloBot',
  instructions: 'You are a friendly assistant. Reply concisely.',
});

const result = await bot.run('What is the capital of France?');
console.log(result.text);
