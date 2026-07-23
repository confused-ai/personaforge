/**
 * Team execution planner — generates a step-by-step execution plan
 * via a single LLM call before any agent runs.
 *
 * The plan is injected into every agent's context so all team members
 * share the same strategic intent, preventing agents from working at
 * cross-purposes and reducing unnecessary tool calls.
 *
 * Design:
 *   - One LLM call, structured JSON output with graceful fallback.
 *   - Zero external dependencies beyond `@personaforge/agentic` LLM types.
 *   - Returns a typed `ExecutionPlan` usable both programmatically
 *     and as a human-readable string.
 */

import type { LLMProvider } from '../../core/index.js';
import type { RoleAgent } from './define-role.js';
import type { TaskHandle } from './define-task.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlanStep {
  /** 1-based sequence number. */
  step: number;
  /** Agent responsible for this step. */
  agent: string;
  /** What this step should accomplish. */
  action: string;
  /** What output is expected from this step. */
  expectedOutput: string;
  /** Names of steps this step depends on (may be empty). */
  dependsOn: string[];
}

export interface ExecutionPlan {
  /** One-sentence strategic summary. */
  summary: string;
  /** Ordered execution steps. */
  steps: PlanStep[];
  /** Raw reasoning from the planner LLM. Useful for debugging. */
  reasoning: string;
}

// ── Prompt construction ───────────────────────────────────────────────────────

function buildPlannerPrompt(
  teamGoal: string,
  agents: RoleAgent[],
  tasks: TaskHandle[],
): string {
  const agentDescriptions = agents
    .map((a) => `- **${a.name}**: ${a.systemPrompt.slice(0, 300).replace(/\n/g, ' ')}`)
    .join('\n');

  const taskDescriptions =
    tasks.length > 0
      ? tasks
          .map(
            (t) =>
              `- **${t.name}**: ${t.description.trim()} → expected: ${t.expectedOutput.trim()}`,
          )
          .join('\n')
      : '(No explicit tasks defined — derive steps from the team goal and agent roles.)';

  return `You are a strategic planning assistant for a multi-agent AI team.

## Team goal
${teamGoal}

## Available agents
${agentDescriptions}

## Defined tasks
${taskDescriptions}

## Your job
Create a precise, step-by-step execution plan that assigns tasks to the right agents and sequences work correctly. Identify dependencies between steps.

Respond with ONLY valid JSON in this exact schema:
{
  "summary": "<one-sentence strategic summary>",
  "reasoning": "<2-3 sentences of reasoning>",
  "steps": [
    {
      "step": 1,
      "agent": "<agent name>",
      "action": "<concrete action description>",
      "expectedOutput": "<expected output description>",
      "dependsOn": []
    }
  ]
}

Rules:
- Assign each step to the single most qualified agent.
- Steps with no dependencies should have "dependsOn": [].
- Use agent names exactly as listed above.
- Keep actions concrete and actionable, not vague.
- Do NOT wrap in markdown code fences.`;
}

// ── JSON parsing with fallback ────────────────────────────────────────────────

function parsePlan(raw: string, agents: RoleAgent[], tasks: TaskHandle[]): ExecutionPlan {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as Partial<ExecutionPlan>;
    if (parsed.steps && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
      return {
        summary: parsed.summary ?? 'Execute team goal.',
        reasoning: parsed.reasoning ?? '',
        steps: parsed.steps.map((s, i) => ({
          step: s.step ?? i + 1,
          agent: s.agent ?? agents[i % agents.length]!.name,
          action: s.action ?? '',
          expectedOutput: s.expectedOutput ?? '',
          dependsOn: Array.isArray(s.dependsOn) ? s.dependsOn : [],
        })),
      };
    }
  } catch {
    // Fall through to synthetic plan
  }

  // Graceful fallback — build a sequential plan from tasks or agents
  const sources: Array<{ name: string; description: string; agent: string }> =
    tasks.length > 0
      ? tasks.map((t, i) => ({
          name: t.name,
          description: t.description,
          agent: t.agent?.name ?? agents[i % agents.length]!.name,
        }))
      : agents.map((a, _i) => ({
          name: a.name,
          description: a.systemPrompt.slice(0, 200),
          agent: a.name,
        }));

  return {
    summary: 'Sequential execution of all team steps.',
    reasoning: 'Could not parse planner output — using sequential fallback.',
    steps: sources.map((s, i) => ({
      step: i + 1,
      agent: s.agent,
      action: s.description.trim(),
      expectedOutput: tasks[i]?.expectedOutput ?? 'Completion of assigned work.',
      dependsOn: i > 0 ? [sources[i - 1]!.name] : [],
    })),
  };
}

// ── Plan rendering ────────────────────────────────────────────────────────────

/** Format a plan as a concise string to inject into agent prompts. */
export function renderPlanBlock(plan: ExecutionPlan): string {
  const lines: string[] = [
    '[Execution Plan]',
    `Summary: ${plan.summary}`,
    '',
  ];
  for (const s of plan.steps) {
    const deps = s.dependsOn.length > 0 ? ` (after: ${s.dependsOn.join(', ')})` : '';
    lines.push(`Step ${s.step} — ${s.agent}${deps}: ${s.action}`);
  }
  return lines.join('\n');
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface PlannerOptions {
  /** LLM to use for plan generation. Defaults to the first agent's LLM. */
  llm: LLMProvider;
  /** Team goal / original user prompt. */
  teamGoal: string;
  /** All agents in the team. */
  agents: RoleAgent[];
  /** Explicit tasks, if defined. May be empty. */
  tasks: TaskHandle[];
}

/**
 * Generate an execution plan before the team runs.
 *
 * Uses a single LLM call with structured JSON output. On parse failure
 * falls back to a sequential plan derived from tasks/agents — the team
 * always gets _some_ plan, never throws.
 */
export async function generateExecutionPlan(opts: PlannerOptions): Promise<ExecutionPlan> {
  const { llm, teamGoal, agents, tasks } = opts;
  const prompt = buildPlannerPrompt(teamGoal, agents, tasks);

  const result = await llm.generateText(
    [
      { role: 'user', content: prompt },
    ],
    { temperature: 0.2, maxTokens: 1024, toolChoice: 'none' },
  );

  return parsePlan(result.text ?? '', agents, tasks);
}
