/**
 * createTeam — Ergonomic multi-agent team factory.
 *
 * Features:
 *   - Four collaboration modes: route / coordinate / collaborate / pipeline
 *   - Structured task graph with `defineTask()` — dependency-aware, parallel batching
 *   - Pre-run planning with `planning: true` — one LLM call generates a shared execution plan
 *   - Per-agent delegation with `allowDelegation: true` on `defineRole()` — agents get peer
 *     agents as callable tools so they can autonomously hand off sub-tasks mid-run
 *
 * @example
 * ```ts
 * import { defineTask, defineRole, createTeam } from 'personaforge/orchestration';
 *
 * const researcher = defineRole({ role: 'Researcher', backstory: '...', goal: '...', llm, tools: [searchTool] });
 * const writer     = defineRole({ role: 'Writer',     backstory: '...', goal: '...', llm, allowDelegation: true });
 *
 * const research = defineTask({ name: 'Research', description: 'Find AI trends.', expectedOutput: 'Bullet list.', agent: researcher });
 * const article  = defineTask({ name: 'Article',  description: 'Write the post.', expectedOutput: 'Markdown post.', agent: writer, context: [research] });
 *
 * const team = createTeam({
 *   name: 'ContentTeam',
 *   agents: [researcher, writer],
 *   tasks:  [research, article],
 *   planning: true,
 * });
 *
 * const result = await team.run('Write a blog post about AI trends in 2025');
 * console.log(result.output);
 * console.log(result.taskOutputs);   // per-task outputs keyed by name or outputKey
 * console.log(result.plan?.summary); // the generated plan, if planning was enabled
 * ```
 */

import type { LLMProvider } from '../../core/index.js';
import type { AgenticRunResult } from '../../agentic/index.js';
import { createAgenticAgent } from '../../agentic/index.js';
import type { RoleAgent } from './define-role.js';
import { buildDelegationTools } from './define-role.js';
import type { TaskHandle } from './define-task.js';
import { resolveTaskBatches, buildTaskPrompt } from './define-task.js';
import type { ExecutionPlan } from './planner.js';
import { generateExecutionPlan, renderPlanBlock } from './planner.js';
import type { AgentRouterConfig, RoutableAgent } from '../multi-agent/router.js';
import { createAgentRouter } from '../multi-agent/router.js';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Collaboration mode for a team without explicit tasks. */
export type TeamMode = 'route' | 'coordinate' | 'collaborate' | 'pipeline';

export interface TeamOptions {
  /** Display name for the team. Used in logs and plan output. */
  name: string;
  /**
   * How agents collaborate when no explicit `tasks` are provided:
   * - `'route'`       — Capability-based routing; best-fit agent handles the task.
   * - `'coordinate'`  — All agents run in parallel; results are merged.
   * - `'collaborate'` — Sequential pipeline; each agent's output feeds the next.
   * - `'pipeline'`    — Alias for `'collaborate'`.
   *
   * When `tasks` are supplied, the mode is ignored — the dependency graph
   * derived from `defineTask(..., { context })` drives execution order.
   */
  mode?: TeamMode;
  /** Role agents composing the team. */
  agents: RoleAgent[];
  /**
   * Explicit task graph. When provided, execution is task-driven:
   * - Task `context` dependencies are resolved topologically.
   * - Independent tasks run concurrently within each wave.
   * - Each task can optionally specify a preferred `agent`.
   *
   * If omitted, the team falls back to `mode`-based execution.
   */
  tasks?: TaskHandle[];
  /**
   * Generate a step-by-step execution plan before any agent runs.
   *
   * When `true`, uses the first agent's LLM for plan generation.
   * Pass `{ llm }` to use a dedicated planner LLM (recommended for production
   * so your primary agents are not billed for planning tokens).
   *
   * The plan is injected into every agent's prompt context so all agents share
   * the same strategic intent.
   *
   * @default false
   */
  planning?: boolean | { llm: LLMProvider };
  /**
   * Timeout per `team.run()` call in milliseconds.
   * @default 120_000
   */
  timeoutMs?: number;
  /**
   * For `'route'` mode: capability tags per agent, index-aligned with `agents`.
   * If omitted, the agent's name is used as its single capability tag.
   */
  capabilities?: string[][];
}

export interface TeamRunResult {
  /** Final output text. In task mode, this is the last task's output. */
  output: string;
  /** Raw per-agent results for auditing and debugging. */
  agentResults: Array<{ name: string; output: string; success: boolean }>;
  /**
   * Per-task outputs keyed by `task.outputKey ?? task.name`.
   * Only populated when `tasks` are provided.
   */
  taskOutputs: Record<string, string>;
  /**
   * Generated execution plan. Only present when `planning` is enabled.
   */
  plan?: ExecutionPlan;
  /** Total wall-clock time in milliseconds. */
  durationMs: number;
}

export interface TeamHandle {
  readonly name: string;
  readonly mode: TeamMode | 'task-driven';
  run(prompt: string): Promise<TeamRunResult>;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function extractText(result: AgenticRunResult): string {
  return result.text;
}

/**
 * Wire delegation tools into a RoleAgent for a given run.
 * Returns a NEW temporary runner — never mutates the original RoleAgent.
 */
function buildAgentWithDelegation(
  agent: RoleAgent,
  peers: RoleAgent[],
): RoleAgent {
  if (!agent.definition.allowDelegation) return agent;

  const peerAgents = peers.filter((p) => p.name !== agent.name);
  if (peerAgents.length === 0) return agent;

  const delegationTools = buildDelegationTools(peerAgents);

  const augmentedRunner = createAgenticAgent({
    name: agent.name,
    instructions: agent.systemPrompt,
    llm: (agent.definition as any).llm,
    tools: [
      ...((agent.definition as any).tools ?? []),
      ...delegationTools,
    ] as any,
    maxSteps: agent.definition.maxSteps,
    timeoutMs: agent.definition.timeoutMs,
    retry: agent.definition.retry,
    hooks: agent.definition.hooks,
  });

  return {
    name: agent.name,
    systemPrompt: agent.systemPrompt,
    definition: agent.definition,
    run: (config, hooks) =>
      augmentedRunner.run({ ...config, instructions: agent.systemPrompt }, hooks),
  };
}

function withPlanContext(prompt: string, plan: ExecutionPlan | undefined): string {
  if (!plan) return prompt;
  return `${renderPlanBlock(plan)}\n\n---\n\n${prompt}`;
}

async function runTask(
  task: TaskHandle,
  teamGoal: string,
  agents: RoleAgent[],
  agentIndex: number,
  outputs: Map<TaskHandle, string>,
  plan: ExecutionPlan | undefined,
  allAgents: RoleAgent[],
): Promise<{ name: string; output: string; success: boolean }> {
  const assignedAgent = task.agent ?? agents[agentIndex % agents.length];
  if (!assignedAgent) {
    return { name: task.name, output: 'No agent available', success: false };
  }

  const agent = buildAgentWithDelegation(assignedAgent, allAgents);
  const taskPrompt = buildTaskPrompt(task, teamGoal, outputs);
  const prompt = withPlanContext(taskPrompt, plan);

  try {
    const result = await agent.run({ prompt });
    return { name: task.name, output: extractText(result), success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: task.name, output: msg, success: false };
  }
}

// ── createTeam ────────────────────────────────────────────────────────────────

export function createTeam(opts: TeamOptions): TeamHandle {
  const {
    name,
    agents,
    tasks,
    planning = false,
    timeoutMs: _timeoutMs = 120_000,
  } = opts;

  const mode: TeamMode = opts.mode ?? 'pipeline';

  if (agents.length === 0) {
    throw new Error(`createTeam("${name}"): at least one agent is required.`);
  }

  const plannerLlm: LLMProvider | undefined = planning
    ? (typeof planning === 'object' ? planning.llm : (agents[0]!.definition as any).llm)
    : undefined;

  // ── Task-driven mode ──────────────────────────────────────────────────────
  if (tasks && tasks.length > 0) {
    return {
      name,
      mode: 'task-driven',
      async run(prompt: string): Promise<TeamRunResult> {
        const start = Date.now();
        const agentResults: TeamRunResult['agentResults'] = [];
        const taskOutputs: Record<string, string> = {};
        const outputs = new Map<TaskHandle, string>();

        let plan: ExecutionPlan | undefined;
        if (plannerLlm) {
          plan = await generateExecutionPlan({ llm: plannerLlm, teamGoal: prompt, agents, tasks });
        }

        const batches = resolveTaskBatches(tasks);
        let agentIdx = 0;

        for (const batch of batches) {
          const batchResults = await Promise.allSettled(
            batch.map((task) =>
              runTask(task, prompt, agents, agentIdx++, outputs, plan, agents),
            ),
          );

          for (let i = 0; i < batch.length; i++) {
            const task = batch[i]!;
            const settled = batchResults[i]!;
            if (settled.status === 'fulfilled') {
              const r = settled.value;
              outputs.set(task, r.output);
              taskOutputs[task.outputKey ?? task.name] = r.output;
              agentResults.push(r);
            } else {
              const msg = settled.reason instanceof Error
                ? settled.reason.message
                : String(settled.reason);
              outputs.set(task, '');
              agentResults.push({ name: task.name, output: msg, success: false });
            }
          }
        }

        const lastSuccess = [...agentResults].reverse().find((r) => r.success);
        return {
          output: lastSuccess?.output ?? '',
          agentResults,
          taskOutputs,
          plan,
          durationMs: Date.now() - start,
        };
      },
    };
  }

  const normalizedMode: TeamMode = mode === 'pipeline' ? 'collaborate' : mode;

  // ── 'route' mode ──────────────────────────────────────────────────────────
  if (normalizedMode === 'route') {
    const routerAgents: AgentRouterConfig['agents'] = {};
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i]!;
      const caps = opts.capabilities?.[i] ?? [agent.name.toLowerCase().replace(/\s+/g, '-')];
      routerAgents[agent.name] = {
        agent: {
          id: agent.name,
          name: agent.name,
          run: (input: unknown) =>
            agent.run({ prompt: typeof input === 'string' ? input : String(input) }),
        } as unknown as RoutableAgent['agent'],
        capabilities: caps,
        description: agent.systemPrompt.slice(0, 200),
      };
    }

    const router = createAgentRouter({ agents: routerAgents, strategy: 'capability-match' });

    return {
      name,
      mode: 'route',
      async run(prompt): Promise<TeamRunResult> {
        const start = Date.now();
        let plan: ExecutionPlan | undefined;
        if (plannerLlm) {
          plan = await generateExecutionPlan({ llm: plannerLlm, teamGoal: prompt, agents, tasks: [] });
        }
        const result = await router.route(withPlanContext(prompt, plan));
        const text = typeof result.output === 'string'
          ? result.output
          : JSON.stringify(result.output ?? '');
        return {
          output: text,
          agentResults: [{ name: result.agentId ?? 'unknown', output: text, success: true }],
          taskOutputs: {},
          plan,
          durationMs: Date.now() - start,
        };
      },
    };
  }

  // ── 'coordinate' (parallel) mode ─────────────────────────────────────────
  if (normalizedMode === 'coordinate') {
    return {
      name,
      mode: 'coordinate',
      async run(prompt): Promise<TeamRunResult> {
        const start = Date.now();
        let plan: ExecutionPlan | undefined;
        if (plannerLlm) {
          plan = await generateExecutionPlan({ llm: plannerLlm, teamGoal: prompt, agents, tasks: [] });
        }
        const augmented = agents.map((a) => buildAgentWithDelegation(a, agents));
        const settled = await Promise.allSettled(
          augmented.map((a) => a.run({ prompt: withPlanContext(prompt, plan) })),
        );
        const agentResults = settled.map((s, i) => {
          if (s.status === 'fulfilled') {
            return { name: agents[i]!.name, output: extractText(s.value), success: true };
          }
          return { name: agents[i]!.name, output: String((s as PromiseRejectedResult).reason), success: false };
        });
        const output = agentResults
          .filter((r) => r.success)
          .map((r) => `### ${r.name}\n${r.output}`)
          .join('\n\n');
        return { output, agentResults, taskOutputs: {}, plan, durationMs: Date.now() - start };
      },
    };
  }

  // ── 'collaborate' (sequential / pipeline) mode ────────────────────────────
  return {
    name,
    mode: 'collaborate',
    async run(prompt): Promise<TeamRunResult> {
      const start = Date.now();
      const agentResults: TeamRunResult['agentResults'] = [];
      let plan: ExecutionPlan | undefined;
      if (plannerLlm) {
        plan = await generateExecutionPlan({ llm: plannerLlm, teamGoal: prompt, agents, tasks: [] });
      }
      let currentPrompt = withPlanContext(prompt, plan);
      for (const baseAgent of agents) {
        const agent = buildAgentWithDelegation(baseAgent, agents);
        try {
          const result = await agent.run({ prompt: currentPrompt });
          const text = extractText(result);
          agentResults.push({ name: baseAgent.name, output: text, success: true });
          currentPrompt = withPlanContext(
            `Original task: ${prompt}\n\nPrevious output from ${baseAgent.name}:\n${text}`,
            plan,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          agentResults.push({ name: baseAgent.name, output: msg, success: false });
        }
      }
      const lastSuccess = [...agentResults].reverse().find((r) => r.success);
      return {
        output: lastSuccess?.output ?? '',
        agentResults,
        taskOutputs: {},
        plan,
        durationMs: Date.now() - start,
      };
    },
  };
}
