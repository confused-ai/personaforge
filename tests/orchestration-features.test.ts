/**
 * Comprehensive tests for the three new orchestration features:
 *   1. defineTask() — shape, dependency resolution, topological batching, cycle detection
 *   2. Planning mode — plan generation, prompt injection, JSON fallback, task-driven combo
 *   3. allowDelegation — per-agent delegation tools, name normalisation, isolation
 *
 * Coverage goals:
 *   - Every public API surface: defineTask, resolveTaskBatches, buildTaskPrompt,
 *     buildTaskContextBlock, TaskCycleError, createTeam (task-driven + planning),
 *     defineRole (allowDelegation), buildDelegationTools
 *   - Happy paths, edge cases, and failure modes
 *   - Invariants: immutability, graceful degradation, correct ordering
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  defineTask,
  resolveTaskBatches,
  buildTaskPrompt,
  buildTaskContextBlock,
  TaskCycleError,
  buildDelegationTools,
} from '@personaforge/orchestration';
import type { TaskHandle } from '@personaforge/orchestration';
import { defineRole } from '@personaforge/orchestration';
import { createTeam } from '@personaforge/orchestration';
import type { LLMProvider, Message, GenerateResult } from '@personaforge/core';

// ── LLM stub helpers ─────────────────────────────────────────────────────────

function textResult(text: string): GenerateResult {
  return { text, finishReason: 'stop', toolCalls: [] };
}

function makeLlm(responses: GenerateResult[]): LLMProvider {
  let idx = 0;
  return {
    generateText: vi.fn(async () => responses[idx++ % responses.length] ?? textResult('')),
  };
}

/**
 * LLM that records every call's full messages array.
 * The captured `calls` array can be inspected after the agent runs.
 */
function capturingLlm(response: GenerateResult): { llm: LLMProvider; calls: Message[][] } {
  const calls: Message[][] = [];
  const llm: LLMProvider = {
    generateText: vi.fn(async (messages: Message[]) => {
      calls.push(messages);
      return response;
    }),
  };
  return { llm, calls };
}

/**
 * LLM that records both messages AND the options object passed alongside them.
 * Used to inspect what tool definitions the model is offered.
 */
function capturingLlmWithOpts(
  response: GenerateResult,
): { llm: LLMProvider; calls: Array<{ messages: Message[]; opts: unknown }> } {
  const calls: Array<{ messages: Message[]; opts: unknown }> = [];
  const llm: LLMProvider = {
    generateText: vi.fn(async (messages: Message[], opts?: unknown) => {
      calls.push({ messages, opts });
      return response;
    }),
  };
  return { llm, calls };
}

/** Extract all text from a messages array for full-text assertions. */
function messagesText(msgs: Message[]): string {
  return msgs
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join(' ');
}

/** Extract tool names offered to the LLM from captured opts. */
function toolNamesFrom(opts: unknown): string[] {
  if (!opts || typeof opts !== 'object') return [];
  const o = opts as Record<string, unknown>;
  if (!Array.isArray(o['tools'])) return [];
  return (o['tools'] as Array<{ name?: unknown }>).map((t) => String(t.name ?? ''));
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. defineTask() — shape and invariants
// ─────────────────────────────────────────────────────────────────────────────

describe('defineTask() — shape', () => {
  it('sets all required fields and the _isTaskHandle discriminant', () => {
    const t = defineTask({
      name: 'Research',
      description: 'Find AI trends.',
      expectedOutput: 'A bullet list.',
    });

    expect(t.name).toBe('Research');
    expect(t.description).toBe('Find AI trends.');
    expect(t.expectedOutput).toBe('A bullet list.');
    expect(t._isTaskHandle).toBe(true);
  });

  it('leaves optional fields undefined when omitted', () => {
    const t = defineTask({ name: 'T', description: 'd', expectedOutput: 'e' });

    expect(t.agent).toBeUndefined();
    expect(t.context).toBeUndefined();
    expect(t.outputKey).toBeUndefined();
  });

  it('preserves all provided optional fields', () => {
    const dep = defineTask({ name: 'Dep', description: 'd', expectedOutput: 'e' });
    const agent = defineRole({ role: 'R', backstory: 'b', goal: 'g' });

    const t = defineTask({
      name: 'Main',
      description: 'Main task',
      expectedOutput: 'Output',
      agent,
      context: [dep],
      outputKey: 'main_key',
    });

    expect(t.agent).toBe(agent);
    expect(t.context).toEqual([dep]);
    expect(t.outputKey).toBe('main_key');
  });

  it('accepts an empty context array without throwing', () => {
    expect(() =>
      defineTask({ name: 'T', description: 'd', expectedOutput: 'e', context: [] }),
    ).not.toThrow();
  });

  it('returns a frozen-shape handle (does not share identity with the def object)', () => {
    const def = { name: 'T', description: 'd', expectedOutput: 'e' };
    const t = defineTask(def);
    // Mutating the source def does not affect the handle
    (def as any).name = 'Mutated';
    expect(t.name).toBe('T');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. resolveTaskBatches() — topological ordering and cycle detection
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveTaskBatches()', () => {
  it('returns an empty array when given no tasks', () => {
    expect(resolveTaskBatches([])).toEqual([]);
  });

  it('returns a single wave for a single task with no deps', () => {
    const t = defineTask({ name: 'Solo', description: 'd', expectedOutput: 'e' });
    const batches = resolveTaskBatches([t]);

    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual([t]);
  });

  it('produces one wave per level in a linear chain', () => {
    const a = defineTask({ name: 'A', description: 'd', expectedOutput: 'e' });
    const b = defineTask({ name: 'B', description: 'd', expectedOutput: 'e', context: [a] });
    const c = defineTask({ name: 'C', description: 'd', expectedOutput: 'e', context: [b] });

    const batches = resolveTaskBatches([a, b, c]);

    expect(batches).toHaveLength(3);
    expect(batches[0]!.map((t) => t.name)).toEqual(['A']);
    expect(batches[1]!.map((t) => t.name)).toEqual(['B']);
    expect(batches[2]!.map((t) => t.name)).toEqual(['C']);
  });

  it('correctly resolves a 5-task diamond graph', () => {
    const t1 = defineTask({ name: 'T1', description: 'd', expectedOutput: 'e' });
    const t2 = defineTask({ name: 'T2', description: 'd', expectedOutput: 'e' });
    const t3 = defineTask({ name: 'T3', description: 'd', expectedOutput: 'e', context: [t1] });
    const t4 = defineTask({ name: 'T4', description: 'd', expectedOutput: 'e', context: [t1, t2] });
    const t5 = defineTask({ name: 'T5', description: 'd', expectedOutput: 'e', context: [t3, t4] });

    const batches = resolveTaskBatches([t1, t2, t3, t4, t5]);

    expect(batches).toHaveLength(3);
    expect(batches[0]!.map((t) => t.name).sort()).toEqual(['T1', 'T2']);
    expect(batches[1]!.map((t) => t.name).sort()).toEqual(['T3', 'T4']);
    expect(batches[2]!.map((t) => t.name)).toEqual(['T5']);
  });

  it('treats a context dep not present in the task list as already satisfied', () => {
    // externalDep is NOT included in the resolveTaskBatches call
    const externalDep = defineTask({ name: 'External', description: 'd', expectedOutput: 'e' });
    const dependsOnExternal = defineTask({
      name: 'Inner',
      description: 'd',
      expectedOutput: 'e',
      context: [externalDep],
    });

    // Inner should appear in wave 0 because its only dep is external (already satisfied)
    const batches = resolveTaskBatches([dependsOnExternal]);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.map((t) => t.name)).toEqual(['Inner']);
  });

  it('throws TaskCycleError for a two-node cycle introduced post-hoc', () => {
    const a = defineTask({ name: 'CycleA', description: 'd', expectedOutput: 'e' });
    const b = defineTask({ name: 'CycleB', description: 'd', expectedOutput: 'e', context: [a] });
    // Create cycle: a → b → a
    (a as any).context = [b];

    expect(() => resolveTaskBatches([a, b])).toThrow(TaskCycleError);
  });

  it('throws TaskCycleError for a three-node cycle (A→B→C→A)', () => {
    const a = defineTask({ name: 'CA', description: 'd', expectedOutput: 'e' });
    const b = defineTask({ name: 'CB', description: 'd', expectedOutput: 'e', context: [a] });
    const c = defineTask({ name: 'CC', description: 'd', expectedOutput: 'e', context: [b] });
    (a as any).context = [c];

    expect(() => resolveTaskBatches([a, b, c])).toThrow(TaskCycleError);
  });

  it('TaskCycleError is an instance of Error', () => {
    const a = defineTask({ name: 'EA', description: 'd', expectedOutput: 'e' });
    const b = defineTask({ name: 'EB', description: 'd', expectedOutput: 'e', context: [a] });
    (a as any).context = [b];

    try {
      resolveTaskBatches([a, b]);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TaskCycleError);
      expect(err).toBeInstanceOf(Error);
      expect((err as TaskCycleError).name).toBe('TaskCycleError');
      expect((err as TaskCycleError).message).toMatch(/cycle/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. buildTaskPrompt() and buildTaskContextBlock()
// ─────────────────────────────────────────────────────────────────────────────

describe('buildTaskPrompt()', () => {
  it('includes task name, description, expectedOutput, and team goal', () => {
    const t = defineTask({ name: 'Write', description: 'Write the post.', expectedOutput: 'Markdown.' });
    const prompt = buildTaskPrompt(t, 'Our team goal', new Map());

    expect(prompt).toContain('Write');
    expect(prompt).toContain('Write the post.');
    expect(prompt).toContain('Markdown.');
    expect(prompt).toContain('Our team goal');
  });

  it('does not include a context block when the task has no deps', () => {
    const t = defineTask({ name: 'Solo', description: 'd', expectedOutput: 'e' });
    const prompt = buildTaskPrompt(t, 'Goal', new Map());

    expect(prompt).not.toContain('Context from');
    expect(prompt).not.toContain('Context from previous tasks');
  });

  it('injects a single context dep output into the prompt', () => {
    const dep = defineTask({ name: 'Research', description: 'd', expectedOutput: 'e' });
    const main = defineTask({ name: 'Write', description: 'Write.', expectedOutput: 'Post.', context: [dep] });
    const outputs = new Map<TaskHandle, string>([[dep, 'AI is amazing.']]);

    const prompt = buildTaskPrompt(main, 'Goal', outputs);

    expect(prompt).toContain('Context from "Research"');
    expect(prompt).toContain('AI is amazing.');
  });

  it('injects all context deps in order when there are multiple', () => {
    const dep1 = defineTask({ name: 'Research', description: 'd', expectedOutput: 'e' });
    const dep2 = defineTask({ name: 'Analysis', description: 'd', expectedOutput: 'e' });
    const main = defineTask({ name: 'Write', description: 'Write.', expectedOutput: 'Post.', context: [dep1, dep2] });
    const outputs = new Map<TaskHandle, string>([
      [dep1, 'Research output.'],
      [dep2, 'Analysis output.'],
    ]);

    const prompt = buildTaskPrompt(main, 'Goal', outputs);
    const research = prompt.indexOf('Research output.');
    const analysis = prompt.indexOf('Analysis output.');

    expect(prompt).toContain('Context from "Research"');
    expect(prompt).toContain('Context from "Analysis"');
    expect(research).toBeLessThan(analysis); // order preserved
  });

  it('gracefully skips context deps whose output is missing from the map', () => {
    const dep = defineTask({ name: 'Missing', description: 'd', expectedOutput: 'e' });
    const main = defineTask({ name: 'Write', description: 'Write.', expectedOutput: 'Post.', context: [dep] });

    // Pass an empty outputs map — dep has no output
    const prompt = buildTaskPrompt(main, 'Goal', new Map());

    // Prompt is still valid; just no context block for the missing dep
    expect(prompt).toContain('Write');
    expect(prompt).not.toContain('Context from "Missing"');
  });
});

describe('buildTaskContextBlock()', () => {
  it('returns empty string when task has no context', () => {
    const t = defineTask({ name: 'T', description: 'd', expectedOutput: 'e' });
    expect(buildTaskContextBlock(t, new Map())).toBe('');
  });

  it('returns empty string when context deps have no output in the map', () => {
    const dep = defineTask({ name: 'Dep', description: 'd', expectedOutput: 'e' });
    const t = defineTask({ name: 'T', description: 'd', expectedOutput: 'e', context: [dep] });
    expect(buildTaskContextBlock(t, new Map())).toBe('');
  });

  it('returns a formatted block for each dep that has output', () => {
    const dep1 = defineTask({ name: 'D1', description: 'd', expectedOutput: 'e' });
    const dep2 = defineTask({ name: 'D2', description: 'd', expectedOutput: 'e' });
    const t = defineTask({ name: 'T', description: 'd', expectedOutput: 'e', context: [dep1, dep2] });
    const outputs = new Map<TaskHandle, string>([
      [dep1, 'Output one.'],
      [dep2, 'Output two.'],
    ]);

    const block = buildTaskContextBlock(t, outputs);
    expect(block).toContain('[Context from "D1"]');
    expect(block).toContain('Output one.');
    expect(block).toContain('[Context from "D2"]');
    expect(block).toContain('Output two.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. createTeam() — task-driven mode
// ─────────────────────────────────────────────────────────────────────────────

describe('createTeam() task-driven mode', () => {
  it('reports mode as "task-driven" when tasks are provided', () => {
    const agent = defineRole({ role: 'A', backstory: 'b', goal: 'g', llm: makeLlm([textResult('x')]) });
    const task = defineTask({ name: 'T', description: 'd', expectedOutput: 'e', agent });
    const team = createTeam({ name: 'Team', agents: [agent], tasks: [task] });

    expect(team.mode).toBe('task-driven');
  });

  it('single task: produces one agentResult with success: true', async () => {
    const llm = makeLlm([textResult('solo output')]);
    const agent = defineRole({ role: 'Solo', backstory: 'b', goal: 'g', llm });
    const task = defineTask({ name: 'OnlyTask', description: 'd', expectedOutput: 'e', agent });

    const result = await createTeam({ name: 'T', agents: [agent], tasks: [task] }).run('Go');

    expect(result.output).toBe('solo output');
    expect(result.agentResults).toHaveLength(1);
    expect(result.agentResults[0]!.success).toBe(true);
    expect(result.agentResults[0]!.name).toBe('OnlyTask');
    expect(result.taskOutputs['OnlyTask']).toBe('solo output');
  });

  it('uses outputKey as taskOutputs key when set; falls back to task name', async () => {
    const llm = makeLlm([textResult('out-a'), textResult('out-b')]);
    const agent = defineRole({ role: 'A', backstory: 'b', goal: 'g', llm });

    const withKey = defineTask({ name: 'Alpha', description: 'd', expectedOutput: 'e', agent, outputKey: 'my_key' });
    const withoutKey = defineTask({ name: 'Beta', description: 'd', expectedOutput: 'e', agent });

    const result = await createTeam({ name: 'T', agents: [agent], tasks: [withKey, withoutKey] }).run('Go');

    expect(result.taskOutputs['my_key']).toBe('out-a');
    expect(result.taskOutputs['Beta']).toBe('out-b');
    // 'Alpha' key must NOT exist — outputKey takes precedence
    expect(result.taskOutputs['Alpha']).toBeUndefined();
  });

  it('executes tasks in dependency order and populates taskOutputs correctly', async () => {
    const order: string[] = [];
    const researchLlm: LLMProvider = { generateText: vi.fn(async () => { order.push('research'); return textResult('Trend: speed.'); }) };
    const writerLlm: LLMProvider = { generateText: vi.fn(async () => { order.push('writer'); return textResult('Blog post.'); }) };

    const researcher = defineRole({ role: 'Researcher', backstory: 'b', goal: 'g', llm: researchLlm });
    const writer = defineRole({ role: 'Writer', backstory: 'b', goal: 'g', llm: writerLlm });

    const research = defineTask({ name: 'Research', description: 'd', expectedOutput: 'e', agent: researcher, outputKey: 'research_out' });
    const article = defineTask({ name: 'Article', description: 'd', expectedOutput: 'e', agent: writer, context: [research] });

    const result = await createTeam({ name: 'T', agents: [researcher, writer], tasks: [research, article] }).run('Write');

    expect(order).toEqual(['research', 'writer']); // strict ordering
    expect(result.output).toBe('Blog post.');
    expect(result.taskOutputs['research_out']).toBe('Trend: speed.');
    expect(result.taskOutputs['Article']).toBe('Blog post.');
    expect(result.agentResults[0]!.name).toBe('Research');
    expect(result.agentResults[1]!.name).toBe('Article');
  });

  it('injects context dep output into the dependent task prompt', async () => {
    const { llm: researchLlm } = capturingLlm(textResult('Trend: agents.'));
    const { llm: writerLlm, calls: writerCalls } = capturingLlm(textResult('Post.'));

    const researcher = defineRole({ role: 'Researcher', backstory: 'b', goal: 'g', llm: researchLlm });
    const writer = defineRole({ role: 'Writer', backstory: 'b', goal: 'g', llm: writerLlm });

    const research = defineTask({ name: 'Research', description: 'd', expectedOutput: 'e', agent: researcher });
    const article = defineTask({ name: 'Article', description: 'd', expectedOutput: 'e', agent: writer, context: [research] });

    await createTeam({ name: 'T', agents: [researcher, writer], tasks: [research, article] }).run('Goal');

    const writerText = messagesText(writerCalls[0] ?? []);
    expect(writerText).toContain('Context from "Research"');
    expect(writerText).toContain('Trend: agents.');
  });

  it('does not inject context block into non-dependent tasks', async () => {
    const { llm: llmA, calls: callsA } = capturingLlm(textResult('A output.'));
    const { llm: llmB, calls: callsB } = capturingLlm(textResult('B output.'));

    const agentA = defineRole({ role: 'AgentA', backstory: 'b', goal: 'g', llm: llmA });
    const agentB = defineRole({ role: 'AgentB', backstory: 'b', goal: 'g', llm: llmB });

    // No context relationship between the two tasks
    const tA = defineTask({ name: 'TaskA', description: 'd', expectedOutput: 'e', agent: agentA });
    const tB = defineTask({ name: 'TaskB', description: 'd', expectedOutput: 'e', agent: agentB });

    await createTeam({ name: 'T', agents: [agentA, agentB], tasks: [tA, tB] }).run('Go');

    expect(messagesText(callsA[0] ?? [])).not.toContain('Context from');
    expect(messagesText(callsB[0] ?? [])).not.toContain('Context from');
  });

  it('independent tasks in the same wave run concurrently', async () => {
    const startTimes: number[] = [];
    let seq = 0;
    const makeSlowLlm = (): LLMProvider => ({
      generateText: vi.fn(async () => {
        startTimes.push(Date.now());
        seq++;
        await new Promise<void>((r) => setTimeout(r, 30));
        return textResult(`done-${seq}`);
      }),
    });

    const a1 = defineRole({ role: 'A1', backstory: 'b', goal: 'g', llm: makeSlowLlm() });
    const a2 = defineRole({ role: 'A2', backstory: 'b', goal: 'g', llm: makeSlowLlm() });
    const a3 = defineRole({ role: 'A3', backstory: 'b', goal: 'g', llm: makeSlowLlm() });

    const t1 = defineTask({ name: 'T1', description: 'd', expectedOutput: 'e', agent: a1 });
    const t2 = defineTask({ name: 'T2', description: 'd', expectedOutput: 'e', agent: a2 });
    const t3 = defineTask({ name: 'T3', description: 'd', expectedOutput: 'e', agent: a3, context: [t1, t2] });

    const wallStart = Date.now();
    await createTeam({ name: 'T', agents: [a1, a2, a3], tasks: [t1, t2, t3] }).run('Go');

    // T1 and T2 launched at nearly the same time
    expect(Math.abs(startTimes[1]! - startTimes[0]!)).toBeLessThan(15);
    // Total wall time ≈ 2 × 30ms (two waves), not 3 × 30ms (sequential)
    expect(Date.now() - wallStart).toBeLessThan(300); // generous CI bound
  });

  it('marks a failed task as success: false and continues with remaining tasks', async () => {
    const failLlm: LLMProvider = { generateText: vi.fn(async () => { throw new Error('LLM exploded'); }) };
    const okLlm = makeLlm([textResult('Final output.')]);

    const badAgent = defineRole({ role: 'Flaky', backstory: 'b', goal: 'g', llm: failLlm });
    const goodAgent = defineRole({ role: 'Solid', backstory: 'b', goal: 'g', llm: okLlm });

    const bad = defineTask({ name: 'BadTask', description: 'd', expectedOutput: 'e', agent: badAgent });
    const good = defineTask({ name: 'GoodTask', description: 'd', expectedOutput: 'e', agent: goodAgent });

    // No dependency between them — both in wave 0, run in parallel
    const result = await createTeam({ name: 'T', agents: [badAgent, goodAgent], tasks: [bad, good] }).run('Go');

    const badResult = result.agentResults.find((r) => r.name === 'BadTask')!;
    const goodResult = result.agentResults.find((r) => r.name === 'GoodTask')!;

    expect(badResult.success).toBe(false);
    expect(goodResult.success).toBe(true);
    expect(goodResult.output).toBe('Final output.');
    // Final output is the last successful task
    expect(result.output).toBe('Final output.');
  });

  it('falls back to positional agent when a task has no assigned agent', async () => {
    const llmA = makeLlm([textResult('from A')]);
    const llmB = makeLlm([textResult('from B')]);
    const agentA = defineRole({ role: 'AgentA', backstory: 'b', goal: 'g', llm: llmA });
    const agentB = defineRole({ role: 'AgentB', backstory: 'b', goal: 'g', llm: llmB });

    // Neither task has an explicit agent assignment
    const t1 = defineTask({ name: 'T1', description: 'd', expectedOutput: 'e' });
    const t2 = defineTask({ name: 'T2', description: 'd', expectedOutput: 'e', context: [t1] });

    const result = await createTeam({
      name: 'T',
      agents: [agentA, agentB],
      tasks: [t1, t2],
    }).run('Go');

    // Both tasks must produce output (positional fallback worked)
    expect(result.agentResults[0]!.success).toBe(true);
    expect(result.agentResults[1]!.success).toBe(true);
  });

  it('populates durationMs with a positive value', async () => {
    const llm = makeLlm([textResult('done')]);
    const agent = defineRole({ role: 'A', backstory: 'b', goal: 'g', llm });
    const task = defineTask({ name: 'T', description: 'd', expectedOutput: 'e', agent });

    const result = await createTeam({ name: 'Team', agents: [agent], tasks: [task] }).run('Go');

    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. createTeam() — planning mode
// ─────────────────────────────────────────────────────────────────────────────

describe('createTeam() planning mode', () => {
  const planJson = JSON.stringify({
    summary: 'Research then write.',
    reasoning: 'Sequential is correct here.',
    steps: [
      { step: 1, agent: 'Researcher', action: 'Find trends.', expectedOutput: 'List.', dependsOn: [] },
      { step: 2, agent: 'Writer', action: 'Write the post.', expectedOutput: 'Post.', dependsOn: ['Step 1'] },
    ],
  });

  it('generates a plan and attaches it to the result', async () => {
    const plannerLlm = makeLlm([textResult(planJson)]);
    const agentLlm = makeLlm([textResult('Answer.')]);

    const researcher = defineRole({ role: 'Researcher', backstory: 'b', goal: 'g', llm: agentLlm });
    const writer = defineRole({ role: 'Writer', backstory: 'b', goal: 'g', llm: agentLlm });

    const result = await createTeam({
      name: 'T',
      mode: 'pipeline',
      agents: [researcher, writer],
      planning: { llm: plannerLlm },
    }).run('Produce an AI article');

    expect(result.plan).toBeDefined();
    expect(result.plan!.summary).toBe('Research then write.');
    expect(result.plan!.reasoning).toBe('Sequential is correct here.');
    expect(result.plan!.steps).toHaveLength(2);
    expect(result.plan!.steps[0]!.agent).toBe('Researcher');
    expect(result.plan!.steps[1]!.dependsOn).toEqual(['Step 1']);
  });

  it('injects the plan block into every agent prompt', async () => {
    const plannerLlm = makeLlm([textResult(planJson)]);
    const { llm: researchLlm, calls: researchCalls } = capturingLlm(textResult('Facts.'));
    const { llm: writerLlm, calls: writerCalls } = capturingLlm(textResult('Post.'));

    const researcher = defineRole({ role: 'Researcher', backstory: 'b', goal: 'g', llm: researchLlm });
    const writer = defineRole({ role: 'Writer', backstory: 'b', goal: 'g', llm: writerLlm });

    await createTeam({
      name: 'T',
      mode: 'pipeline',
      agents: [researcher, writer],
      planning: { llm: plannerLlm },
    }).run('Go');

    expect(messagesText(researchCalls[0] ?? [])).toContain('[Execution Plan]');
    expect(messagesText(researchCalls[0] ?? [])).toContain('Research then write.');
    expect(messagesText(writerCalls[0] ?? [])).toContain('[Execution Plan]');
  });

  it('planning: true uses the first agent LLM for planning', async () => {
    // We track how many times each LLM is called.
    // With planning: true the first agent's LLM must be called once extra (for the plan).
    let firstCalls = 0;
    let secondCalls = 0;

    const firstLlm: LLMProvider = { generateText: vi.fn(async () => { firstCalls++; return textResult('[]'); }) };
    const secondLlm: LLMProvider = { generateText: vi.fn(async () => { secondCalls++; return textResult('Result.'); }) };

    const a1 = defineRole({ role: 'Planner', backstory: 'b', goal: 'g', llm: firstLlm });
    const a2 = defineRole({ role: 'Worker', backstory: 'b', goal: 'g', llm: secondLlm });

    await createTeam({ name: 'T', mode: 'pipeline', agents: [a1, a2], planning: true }).run('Go');

    // First agent's LLM is called for both planning AND its own run step
    expect(firstCalls).toBeGreaterThanOrEqual(2);
    // Second agent's LLM is called only for its own run step
    expect(secondCalls).toBeGreaterThanOrEqual(1);
  });

  it('falls back gracefully when planner LLM returns invalid JSON', async () => {
    const plannerLlm = makeLlm([textResult('This is not JSON.')]);
    const agentLlm = makeLlm([textResult('Agent result.')]);
    const agent = defineRole({ role: 'Worker', backstory: 'b', goal: 'g', llm: agentLlm });

    const result = await createTeam({
      name: 'T',
      mode: 'pipeline',
      agents: [agent],
      planning: { llm: plannerLlm },
    }).run('Do some work');

    // Fallback plan must be present and have at least one step
    expect(result.plan).toBeDefined();
    expect(result.plan!.steps.length).toBeGreaterThan(0);
    // Agent still runs normally
    expect(result.output).toBe('Agent result.');
  });

  it('plan is absent on the result when planning is not enabled', async () => {
    const agentLlm = makeLlm([textResult('Result.')]);
    const agent = defineRole({ role: 'Worker', backstory: 'b', goal: 'g', llm: agentLlm });

    const result = await createTeam({ name: 'T', mode: 'pipeline', agents: [agent] }).run('Go');

    expect(result.plan).toBeUndefined();
  });

  it('planning works together with task-driven mode', async () => {
    const plannerLlm = makeLlm([textResult(planJson)]);
    const { llm: agentLlm, calls } = capturingLlm(textResult('Done.'));
    const agent = defineRole({ role: 'Worker', backstory: 'b', goal: 'g', llm: agentLlm });
    const task = defineTask({ name: 'T', description: 'd', expectedOutput: 'e', agent });

    const result = await createTeam({
      name: 'Team',
      agents: [agent],
      tasks: [task],
      planning: { llm: plannerLlm },
    }).run('Go');

    expect(result.plan).toBeDefined();
    expect(result.plan!.summary).toBe('Research then write.');
    // Plan block injected into the task agent's prompt
    expect(messagesText(calls[0] ?? [])).toContain('[Execution Plan]');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. allowDelegation
// ─────────────────────────────────────────────────────────────────────────────

describe('allowDelegation', () => {
  it('injects a delegate_to_<peer> tool when allowDelegation: true', async () => {
    const { llm: delegatorLlm, calls: delegatorCalls } = capturingLlmWithOpts(
      textResult('Delegated successfully.'),
    );
    const peerLlm = makeLlm([textResult('Peer answer.')]);

    const delegator = defineRole({ role: 'Delegator', backstory: 'b', goal: 'g', llm: delegatorLlm, allowDelegation: true });
    const peer = defineRole({ role: 'Specialist', backstory: 'b', goal: 'g', llm: peerLlm });

    await createTeam({ name: 'T', mode: 'pipeline', agents: [delegator, peer] }).run('Go');

    const tools = toolNamesFrom(delegatorCalls[0]?.opts);
    expect(tools).toContain('delegate_to_specialist');
  });

  it('does not inject delegation tools when allowDelegation is not set', async () => {
    const { llm: agentLlm, calls } = capturingLlmWithOpts(textResult('Answer.'));
    const agent = defineRole({ role: 'Worker', backstory: 'b', goal: 'g', llm: agentLlm });
    const peer = defineRole({ role: 'Peer', backstory: 'b', goal: 'g', llm: makeLlm([textResult('Peer.')]) });

    await createTeam({ name: 'T', mode: 'pipeline', agents: [agent, peer] }).run('Go');

    const delegationTools = toolNamesFrom(calls[0]?.opts).filter((n) => n.startsWith('delegate_to_'));
    expect(delegationTools).toHaveLength(0);
  });

  it('does not inject delegation tools when allowDelegation: false', async () => {
    const { llm: agentLlm, calls } = capturingLlmWithOpts(textResult('Answer.'));
    const agent = defineRole({ role: 'Worker', backstory: 'b', goal: 'g', llm: agentLlm, allowDelegation: false });
    const peer = defineRole({ role: 'Peer', backstory: 'b', goal: 'g', llm: makeLlm([textResult('Peer.')]) });

    await createTeam({ name: 'T', mode: 'pipeline', agents: [agent, peer] }).run('Go');

    const delegationTools = toolNamesFrom(calls[0]?.opts).filter((n) => n.startsWith('delegate_to_'));
    expect(delegationTools).toHaveLength(0);
  });

  it('single agent with no peers: no delegation tools even when allowDelegation: true', async () => {
    const { llm, calls } = capturingLlmWithOpts(textResult('Solo result.'));
    const solo = defineRole({ role: 'Solo', backstory: 'b', goal: 'g', llm, allowDelegation: true });

    await createTeam({ name: 'T', mode: 'pipeline', agents: [solo] }).run('Go');

    const delegationTools = toolNamesFrom(calls[0]?.opts).filter((n) => n.startsWith('delegate_to_'));
    expect(delegationTools).toHaveLength(0);
  });

  it('normalises role names with spaces to delegate_to_<snake_cased>', async () => {
    const { llm: delegatorLlm, calls } = capturingLlmWithOpts(textResult('Done.'));
    const peerLlm = makeLlm([textResult('Peer.')]);

    const delegator = defineRole({ role: 'Head Coordinator', backstory: 'b', goal: 'g', llm: delegatorLlm, allowDelegation: true });
    const peer = defineRole({ role: 'Data Analyst', backstory: 'b', goal: 'g', llm: peerLlm });

    await createTeam({ name: 'T', mode: 'pipeline', agents: [delegator, peer] }).run('Go');

    const tools = toolNamesFrom(calls[0]?.opts);
    expect(tools).toContain('delegate_to_data_analyst');
    expect(tools).not.toContain('delegate_to_Data Analyst');
  });

  it('injects ALL peers as tools when an agent has multiple colleagues', async () => {
    const { llm: coordLlm, calls } = capturingLlmWithOpts(textResult('Coordinated.'));
    const coord = defineRole({ role: 'Coordinator', backstory: 'b', goal: 'g', llm: coordLlm, allowDelegation: true });
    const peer1 = defineRole({ role: 'Frontend', backstory: 'b', goal: 'g', llm: makeLlm([textResult('UI.')]) });
    const peer2 = defineRole({ role: 'Backend', backstory: 'b', goal: 'g', llm: makeLlm([textResult('API.')]) });
    const peer3 = defineRole({ role: 'DevOps', backstory: 'b', goal: 'g', llm: makeLlm([textResult('Deploy.')]) });

    await createTeam({ name: 'T', mode: 'pipeline', agents: [coord, peer1, peer2, peer3] }).run('Ship');

    const tools = toolNamesFrom(calls[0]?.opts);
    expect(tools).toContain('delegate_to_frontend');
    expect(tools).toContain('delegate_to_backend');
    expect(tools).toContain('delegate_to_devops');
    // Agent must not see itself as a peer
    expect(tools).not.toContain('delegate_to_coordinator');
  });

  it('when both agents allow delegation, each sees the other as a tool', async () => {
    const { llm: llmA, calls: callsA } = capturingLlmWithOpts(textResult('A done.'));
    const { llm: llmB, calls: callsB } = capturingLlmWithOpts(textResult('B done.'));

    const alpha = defineRole({ role: 'Alpha', backstory: 'b', goal: 'g', llm: llmA, allowDelegation: true });
    const beta = defineRole({ role: 'Beta', backstory: 'b', goal: 'g', llm: llmB, allowDelegation: true });

    await createTeam({ name: 'T', mode: 'pipeline', agents: [alpha, beta] }).run('Go');

    expect(toolNamesFrom(callsA[0]?.opts)).toContain('delegate_to_beta');
    expect(toolNamesFrom(callsB[0]?.opts)).toContain('delegate_to_alpha');
  });

  it('does not mutate the original RoleAgent between runs', async () => {
    const delegatorLlm = makeLlm([textResult('Run 1.'), textResult('Run 2.')]);
    const peerLlm = makeLlm([textResult('Peer.')]);

    const delegator = defineRole({ role: 'Delegator', backstory: 'b', goal: 'g', llm: delegatorLlm, allowDelegation: true });
    const peer = defineRole({ role: 'Peer', backstory: 'b', goal: 'g', llm: peerLlm });

    const team = createTeam({ name: 'T', mode: 'pipeline', agents: [delegator, peer] });

    const originalDefinition = delegator.definition;

    await team.run('First run');
    await team.run('Second run');

    // Definition object must be the same reference — createTeam must not mutate it
    expect(delegator.definition).toBe(originalDefinition);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. buildDelegationTools() — unit tests for the tool builder itself
// ─────────────────────────────────────────────────────────────────────────────

describe('buildDelegationTools()', () => {
  it('returns an empty array when peers list is empty', () => {
    expect(buildDelegationTools([])).toEqual([]);
  });

  it('produces one tool per peer with correct naming', () => {
    const peerLlm = makeLlm([textResult('result')]);
    const peer = defineRole({ role: 'Data Scientist', backstory: 'b', goal: 'g', llm: peerLlm });

    const tools = buildDelegationTools([peer]);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe('delegate_to_data_scientist');
  });

  it('each tool has correct JSON schema with required "task" parameter', () => {
    const peer = defineRole({ role: 'Reviewer', backstory: 'b', goal: 'g', llm: makeLlm([textResult('ok')]) });
    const [tool] = buildDelegationTools([peer]);

    expect(tool!.parameters.type).toBe('object');
    expect(tool!.parameters.required).toContain('task');
    expect(tool!.parameters.properties).toHaveProperty('task');
  });

  it('execute() calls the peer agent and returns its text output', async () => {
    let receivedPrompt = '';
    const peerLlm: LLMProvider = {
      generateText: vi.fn(async (messages: Message[]) => {
        receivedPrompt = messagesText(messages);
        return textResult('Peer completed the subtask.');
      }),
    };
    const peer = defineRole({ role: 'Specialist', backstory: 'b', goal: 'g', llm: peerLlm });

    const [tool] = buildDelegationTools([peer]);
    const output = await tool!.execute({ task: 'Analyse the dataset.' });

    expect(output).toBe('Peer completed the subtask.');
    expect(receivedPrompt).toContain('Analyse the dataset.');
  });

  it('description mentions the peer name', () => {
    const peer = defineRole({ role: 'QA Engineer', backstory: 'b', goal: 'g', llm: makeLlm([textResult('ok')]) });
    const [tool] = buildDelegationTools([peer]);

    expect(tool!.description).toContain('QA Engineer');
  });
});
