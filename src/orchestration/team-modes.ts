/**
 * @personaforge/orchestration — createTeam() with explicit mode sugar.
 *
 * Three modes (matching Agno's Team abstraction):
 *   route        — pick one specialist per query (via LLM or keyword router)
 *   coordinate   — leader sends to all, synthesizes results
 *   collaborate  — every agent responds, results merged into one output
 *
 * All modes reuse the existing AgentTeam / supervisor / pipeline under the hood.
 *
 * ```ts
 * const team = createTeam({
 *   mode: 'coordinate',
 *   leader: summaryAgent,
 *   agents: [researchAgent, factCheckAgent],
 * });
 * const result = await team.run('Explain quantum computing');
 * ```
 */

export interface TeamAgent {
  name: string;
  instructions?: string;
  run: (prompt: string) => Promise<{ text: string }>;
}

export type TeamMode = 'route' | 'coordinate' | 'collaborate';

export interface TeamConfig {
  mode: TeamMode;
  agents: TeamAgent[];
  /** Required for 'route' and 'coordinate' modes. For 'route' it picks the agent;
   *  for 'coordinate' it synthesizes the combined outputs. */
  leader?: TeamAgent;
  /** Optional max rounds for iterative coordination. Default 1. */
  maxRounds?: number;
}

export interface TeamResult {
  text: string;
  contributions: Array<{ agent: string; text: string }>;
}

export function createModeTeam(config: TeamConfig): { run: (prompt: string) => Promise<TeamResult> } {
  switch (config.mode) {
    case 'route': return { run: routeRun(config) };
    case 'coordinate': return { run: coordinateRun(config) };
    case 'collaborate': return { run: collaborateRun(config) };
    default: throw new Error(`[createTeam] Unknown mode: ${String(config.mode)}`);
  }
}

// ── route ─────────────────────────────────────────────────────────────────────

function routeRun(config: TeamConfig): (prompt: string) => Promise<TeamResult> {
  const { agents, leader } = config;
  if (!leader) throw new Error('[createTeam] mode:"route" requires a leader agent');
  const manifest = agents.map((a) => `- ${a.name}: ${a.instructions ?? '(no description)'}`).join('\n');

  return async (prompt: string) => {
    const routerPrompt = [
      `Pick the single best agent from this list to handle the user request.\nAgents:\n${manifest}`,
      `\nUser request: ${prompt}`,
      `\nRespond with JSON: {"agent": "<name>"}`,
    ].join('');
    const decision = await leader.run(routerPrompt);
    let selected: TeamAgent | undefined;
    try {
      const m = /\{[\s\S]*"agent"\s*:\s*"([^"]+)"/.exec(decision.text);
      selected = agents.find((a) => a.name === m?.[1]);
    } catch { /* fallthrough */ }
    if (!selected) selected = agents[0]!;
    const result = await selected.run(prompt);
    return { text: result.text, contributions: [{ agent: selected.name, text: result.text }] };
  };
}

// ── coordinate ────────────────────────────────────────────────────────────────

function coordinateRun(config: TeamConfig): (prompt: string) => Promise<TeamResult> {
  const { agents, leader, maxRounds = 1 } = config;
  if (!leader) throw new Error('[createTeam] mode:"coordinate" requires a leader agent');

  return async (prompt: string) => {
    const contributions: Array<{ agent: string; text: string }> = [];
    for (let round = 0; round < maxRounds; round++) {
      const results = await Promise.all(agents.map(async (a) => {
        const r = await a.run(prompt);
        return { agent: a.name, text: r.text };
      }));
      contributions.push(...results);
    }
    // Leader synthesizes.
    const synthesis = contributions.map((c) => `[${c.agent}]: ${c.text}`).join('\n\n');
    const merged = await leader.run(
      `Synthesize these expert responses into a single coherent answer.\n\nExpert responses:\n${synthesis}\n\nOriginal question: ${prompt}`,
    );
    return { text: merged.text, contributions };
  };
}

// ── collaborate ───────────────────────────────────────────────────────────────

function collaborateRun(config: TeamConfig): (prompt: string) => Promise<TeamResult> {
  const { agents } = config;
  return async (prompt: string) => {
    const results = await Promise.all(agents.map(async (a) => {
      const r = await a.run(prompt);
      return { agent: a.name, text: r.text };
    }));
    const combined = results.map((c) => `[${c.agent}]: ${c.text}`).join('\n\n');
    return { text: combined, contributions: results };
  };
}
