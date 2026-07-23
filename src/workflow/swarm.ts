/**
 * @personaforge/workflow — swarm pattern.
 * Round-robin O(1) routing, sliding window O(n/concurrency) parallel batching.
 */

import type { AgentRunResult, SwarmOptions, WorkflowAgent } from './types.js';

export function createSwarm(opts: SwarmOptions): {
  run(prompt: string): Promise<AgentRunResult>;
  runAll(prompt: string): Promise<AgentRunResult[]>;
} {
  const { agents, route, concurrency } = opts;

  if (agents.length === 0) {
    throw new Error('[createSwarm] At least one agent is required.');
  }

  // Round-robin index — O(1) modulo increment
  let rrIndex = 0;

  const defaultRoute = (_prompt: string, agts: WorkflowAgent[]): WorkflowAgent => {
    const agent = agts[rrIndex % agts.length];
    rrIndex++;
    if (!agent) throw new Error('[createSwarm] Agent list is empty.');
    return agent;
  };

  return {
    async run(prompt: string): Promise<AgentRunResult> {
      const selected = route ? await route(prompt, agents) : defaultRoute(prompt, agents);
      return selected.run(prompt);
    },

    async runAll(prompt: string): Promise<AgentRunResult[]> {
      const limit = concurrency ?? agents.length;
      const results: AgentRunResult[] = [];

      // Sliding window — O(ceil(n/limit)) batches
      for (let i = 0; i < agents.length; i += limit) {
        const batch   = agents.slice(i, i + limit);
        const settled = await Promise.allSettled(batch.map((a) => a.run(prompt)));
        for (const s of settled) {
          if (s.status === 'fulfilled') results.push(s.value);
        }
      }

      return results;
    },
  };
}
