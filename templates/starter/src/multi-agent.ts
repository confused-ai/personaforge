/**
 * Multi-agent team with supervisor pattern.
 *
 * Run: npx tsx src/multi-agent.ts
 */

import { agent, tool } from 'personaforge';
import { createSupervisor } from 'personaforge/workflow';
import { z } from 'zod';

// ── Shared tools ───────────────────────────────────────────────────────
const searchWeb = tool({
  name: 'search_web',
  description: 'Search the web for current information',
  schema: z.object({ query: z.string() }),
  execute: async ({ query }) => `[mock] Results for: ${query}`,
});

// ── Specialist agents ──────────────────────────────────────────────────
const researcher = agent({
  name: 'researcher',
  model: 'gpt-4o-mini',
  instructions: 'You are a researcher. Find accurate information using the search tool.',
  tools: [searchWeb],
});

const writer = agent({
  name: 'writer',
  model: 'gpt-4o-mini',
  instructions: 'You are a writer. Produce clear, engaging content from research findings.',
});

// ── Supervisor orchestrator ────────────────────────────────────────────
const team = createSupervisor({
  name: 'editor',
  model: 'gpt-4o',
  instructions: 'Coordinate research and writing to produce a complete report.',
  workers: [researcher, writer],
});

const result = await team.run('Research and write a brief on quantum computing breakthroughs in 2025.');
console.log(result.text);
