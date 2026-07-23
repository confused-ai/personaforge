/**
 * defineTask — Structured task primitive with dependency resolution.
 *
 * Tasks are the unit of work in a multi-agent team. They carry:
 *   - A clear description of what to do
 *   - An expected output shape (used in agent prompts and planning)
 *   - Optional preferred agent assignment
 *   - Optional context dependencies (outputs of other tasks)
 *
 * Dependency resolution is topological — tasks are executed in the
 * correct order automatically, parallelising independent branches.
 *
 * @example
 * ```ts
 * import { defineTask, defineRole, createTeam } from 'personaforge/orchestration';
 *
 * const researcher = defineRole({ role: 'Researcher', backstory: '...', goal: '...', llm });
 * const writer     = defineRole({ role: 'Writer',     backstory: '...', goal: '...', llm });
 *
 * const research = defineTask({
 *   name:           'Research Phase',
 *   description:    'Find the top 5 AI frameworks released in 2025.',
 *   expectedOutput: 'A bullet-point list of frameworks with one-line descriptions.',
 *   agent:          researcher,
 * });
 *
 * const article = defineTask({
 *   name:           'Write Article',
 *   description:    'Write a 500-word blog post based on the research.',
 *   expectedOutput: 'A complete, publication-ready blog post in markdown.',
 *   agent:          writer,
 *   context:        [research],   // article waits for research to complete
 * });
 *
 * const team = createTeam({
 *   name:  'ContentTeam',
 *   agents: [researcher, writer],
 *   tasks:  [research, article],
 * });
 *
 * const result = await team.run('Write about AI frameworks in 2025');
 * ```
 */

import type { RoleAgent } from './define-role.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TaskDefinition {
  /** Display name used in logs, plans, and error messages. */
  name: string;
  /**
   * Full description of what this task should accomplish.
   * Injected verbatim into the executing agent's prompt.
   */
  description: string;
  /**
   * Describes the expected output format, shape, or length.
   * Guides the agent and is included in planning prompts.
   */
  expectedOutput: string;
  /**
   * Preferred agent to execute this task.
   * When omitted the team assigns the next available agent by position.
   */
  agent?: RoleAgent;
  /**
   * Tasks this task depends on. Their outputs are automatically
   * prepended to this task's prompt as `[Context from <name>]` sections.
   *
   * The dependency graph is resolved topologically — circular dependencies
   * are detected at definition time and throw a `TaskCycleError`.
   */
  context?: TaskHandle[];
  /**
   * Optional stable key under which this task's output is accessible
   * in `TeamRunResult.taskOutputs`.
   */
  outputKey?: string;
}

/** Returned by `defineTask()`. Opaque at runtime; the team runner resolves it. */
export interface TaskHandle extends TaskDefinition {
  /** Internal discriminant so the team runner can detect TaskHandle objects. */
  readonly _isTaskHandle: true;
}

// ── Error ─────────────────────────────────────────────────────────────────────

export class TaskCycleError extends Error {
  constructor(cycle: string[]) {
    super(`Task dependency cycle detected: ${cycle.join(' → ')}`);
    this.name = 'TaskCycleError';
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Define a structured task.
 *
 * Call this at module level — `defineTask()` is a pure value builder.
 * Dependency validation (cycle detection) happens eagerly at definition time.
 */
export function defineTask(def: TaskDefinition): TaskHandle {
  const handle: TaskHandle = { ...def, _isTaskHandle: true };
  // Detect cycles eagerly so misconfigured tasks blow up at startup, not mid-run.
  detectCycle(handle, []);
  return handle;
}

// ── Topological resolution ────────────────────────────────────────────────────

/**
 * Resolve a list of TaskHandles into execution batches (waves).
 * Each wave contains tasks that can run concurrently because all their
 * dependencies were satisfied in previous waves.
 *
 * Algorithm: Kahn's BFS topological sort.
 */
export function resolveTaskBatches(tasks: TaskHandle[]): TaskHandle[][] {
  // Build index: task → its direct dependencies (context tasks) limited to
  // the provided set (external deps are treated as already satisfied).
  const taskSet = new Set(tasks);
  const inDegree = new Map<TaskHandle, number>();
  const dependents = new Map<TaskHandle, TaskHandle[]>(); // task → tasks that depend on it

  for (const task of tasks) {
    if (!inDegree.has(task)) inDegree.set(task, 0);
    for (const dep of task.context ?? []) {
      if (!taskSet.has(dep)) continue; // external dep — already satisfied
      inDegree.set(task, (inDegree.get(task) ?? 0) + 1);
      if (!dependents.has(dep)) dependents.set(dep, []);
      dependents.get(dep)!.push(task);
    }
  }

  const batches: TaskHandle[][] = [];
  let frontier = tasks.filter((t) => (inDegree.get(t) ?? 0) === 0);

  while (frontier.length > 0) {
    batches.push(frontier);
    const next: TaskHandle[] = [];
    for (const completed of frontier) {
      for (const dependent of dependents.get(completed) ?? []) {
        const remaining = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, remaining);
        if (remaining === 0) next.push(dependent);
      }
    }
    frontier = next;
  }

  const resolved = batches.flat();
  if (resolved.length !== tasks.length) {
    // Some tasks were never added — must be a cycle not caught at definition time.
    const resolvedSet = new Set(resolved);
    const unresolved = tasks.filter((t) => !resolvedSet.has(t)).map((t) => t.name);
    throw new TaskCycleError(unresolved);
  }

  return batches;
}

/**
 * Build the context injection string for a task.
 * Called at run time after dependency outputs are available.
 */
export function buildTaskContextBlock(
  task: TaskHandle,
  outputs: Map<TaskHandle, string>,
): string {
  const sections: string[] = [];
  for (const dep of task.context ?? []) {
    const out = outputs.get(dep);
    if (out) {
      sections.push(`[Context from "${dep.name}"]\n${out.trim()}`);
    }
  }
  return sections.join('\n\n');
}

/**
 * Compose the full prompt sent to the agent for a given task.
 */
export function buildTaskPrompt(
  task: TaskHandle,
  teamGoal: string,
  outputs: Map<TaskHandle, string>,
): string {
  const lines: string[] = [];

  lines.push(`## Task: ${task.name}`);
  lines.push('');
  lines.push(task.description.trim());
  lines.push('');
  lines.push(`**Expected output:** ${task.expectedOutput.trim()}`);

  const ctx = buildTaskContextBlock(task, outputs);
  if (ctx) {
    lines.push('');
    lines.push('---');
    lines.push('## Context from previous tasks');
    lines.push('');
    lines.push(ctx);
  }

  lines.push('');
  lines.push('---');
  lines.push(`## Overall team goal`);
  lines.push(teamGoal);

  return lines.join('\n');
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function detectCycle(task: TaskHandle, visited: TaskHandle[]): void {
  if (visited.includes(task)) {
    throw new TaskCycleError([...visited.map((t) => t.name), task.name]);
  }
  for (const dep of task.context ?? []) {
    detectCycle(dep, [...visited, task]);
  }
}
