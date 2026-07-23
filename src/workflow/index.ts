/**
 * @personaforge/workflow — multi-agent orchestration patterns.
 *
 * SOLID:
 *   SRP  — each pattern (compose, supervisor, swarm) is a separate file.
 *   OCP  — add patterns by adding files; the Agent interface is stable.
 *   LSP  — all patterns accept and return Agent (from @personaforge/core).
 *   ISP  — each pattern has its own focused option type.
 *   DIP  — depends on Agent interface, not concrete agent classes.
 */

export { compose }          from './compose.js';
export { createSupervisor } from './supervisor.js';
export { createSwarm }      from './swarm.js';
export type { PipelineStep, SupervisorOptions, SwarmOptions } from './types.js';

// ── Branching & loop primitives ───────────────────────────────────────────
export { branch, loopUntil, forEach, race, retry } from './branching.js';
export type {
    WorkflowStep,
    BranchBuilder,
    BranchCondition,
    LoopUntilOptions,
    ForEachOptions,
    ForEachResult,
    RaceOptions,
    WorkflowRetryOptions,
} from './branching.js';
