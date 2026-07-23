/**
 * @personaforge/workflow — supervisor pattern.
 * Map<string, WorkflowAgent> for O(1) sub-agent lookup.
 */

import type { AgentRunResult, SupervisorOptions } from './types.js';

const DEFAULT_MAX_ROUNDS = 10;

export function createSupervisor(opts: SupervisorOptions): { run(prompt: string): Promise<AgentRunResult> } {
  const { supervisor, agents, maxRounds = DEFAULT_MAX_ROUNDS } = opts;

  // Build capability manifest once — O(n agents)
  const manifest = Array.from(agents.entries())
    .map(([name, agent]) => `- ${name}: ${agent.instructions}`)
    .join('\n');

  return {
    async run(initialPrompt: string): Promise<AgentRunResult> {
      const history: string[] = [];
      let round = 0;

      while (round < maxRounds) {
        round++;

        const context = [
          `You are orchestrating a team of agents. Available agents:\n${manifest}`,
          `\nTask: ${initialPrompt}`,
          history.length > 0 ? `\nWork so far:\n${history.join('\n')}` : '',
          '\nRespond with JSON: { "agent": "<name>", "prompt": "<task>" } to delegate, or { "done": true, "answer": "<final answer>" } when complete.',
        ].join('');

        const supervisorResult = await supervisor.run(context);
        const raw = supervisorResult.text.trim();

        let parsed: { agent?: string; prompt?: string; done?: boolean; answer?: string };
        try {
          const jsonMatch = /\{[\s\S]*\}/.exec(raw);
          parsed = JSON.parse(jsonMatch?.[0] ?? raw) as { agent?: string; prompt?: string; done?: boolean; answer?: string };
        } catch {
          return supervisorResult;
        }

        if (parsed.done === true) {
          return { ...supervisorResult, text: parsed.answer ?? raw };
        }

        if (!parsed.agent || !parsed.prompt) {
          return supervisorResult;
        }

        // O(1) Map lookup
        const subAgent = agents.get(parsed.agent);
        if (!subAgent) {
          history.push(`[round ${String(round)}] Agent "${parsed.agent}" not found.`);
          continue;
        }

        const subResult = await subAgent.run(parsed.prompt);
        history.push(`[round ${String(round)}] ${parsed.agent}: ${subResult.text}`);
      }

      return supervisor.run(
        `${initialPrompt}\n\nMax rounds reached. Summarise progress:\n${history.join('\n')}`,
      );
    },
  };
}
