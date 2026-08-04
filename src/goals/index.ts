/**
 * @personaforge/goals — durable, thread-scoped objectives.
 *
 * A goal is a standing instruction the agent keeps working toward across loop
 * iterations until a judge model decides it's satisfied or a run budget is
 * exhausted. Objectives persist in thread state and are evaluated in-loop.
 *
 * ```ts
 * const worker = agent({
 *   instructions: 'You complete software tasks end to end.',
 *   model: 'openai/gpt-5',
 *   goal: { judge: 'openai/gpt-5-mini', maxRuns: 50 },
 * });
 *
 * await worker.setObjective('Add and test a /health endpoint', { threadId, resourceId });
 * const stream = await worker.stream('Start working on the goal', {
 *   memory: { thread: threadId, resource: resourceId },
 * });
 * ```
 */

export * from './store.js';
export * from './judge.js';
