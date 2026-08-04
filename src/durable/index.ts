/**
 * @personaforge/durable — long-running, resumable agent execution.
 *
 * Wrap any agent so its loop runs in the background, publish events per runId,
 * and let late subscribers replay or reconnect (`observe`). Supports tool
 * approval / suspend + resume, `untilIdle`, and crash recovery.
 */

export * from './types.js';
export * from './registry.js';
export {
    DurableAgent,
    createDurableAgent,
    createEventedAgent,
    durableRunId,
    registryOutput,
} from './durable-agent.js';
export type { DurableRunHandle } from './registry.js';
