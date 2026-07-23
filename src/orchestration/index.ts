/**
 * @confused-ai/orchestration — Multi-agent coordination patterns.
 *
 * Capabilities:
 *   - Team: Named agents collaborating with shared context
 *   - Swarm: Autonomous agents with handoffs and dynamic routing  
 *   - Supervisor: Hierarchical agent with worker delegation
 *   - Pipeline: Sequential agent workflows with stage outputs
 *   - Consensus: Multi-agent voting and agreement protocols
 *   - Handoff: Agent-to-agent context transfers
 *   - Router: Semantic and keyword routing to specialized agents
 *   - A2A (Agent-to-Agent): HTTP Google protocol for distributed agents
 *   - MCP Toolkit: Model Context Protocol client/server integration
 *   - Orchestrator: Core agent registration and delegation
 *   - Message Bus: Pub/sub communication between agents
 *   - Load Balancer: Round-robin and least-loaded agent selection
 *
 * @example
 * ```ts
 * import { AgentTeam, AgentSwarm, AgentPipeline } from './index.js';
 *
 * const team = new AgentTeam([researchAgent, writeAgent, reviewAgent]);
 * const result = await team.run('Research and write a blog post about AI');
 * ```
 */

// ── Core infrastructure ────────────────────────────────────────────────────
export * from './core/types.js';
export * from './core/orchestrator.js';
export * from './core/message-bus.js';
export * from './core/load-balancer.js';
export * from './core/mcp-types.js';
export * from './core/toolkit.js';
export * from './core/agent-adapter.js';
// actor: explicit to avoid name collisions
export { Actor, ActorSystem } from './core/actor.js';
export type { ActorConfig, ActorMessage, ActorMessageType } from './core/actor.js';
// cqrs: explicit — EventHandler aliased to avoid conflict with event-bus.js
export {
    CommandBus,
    EventBus,
} from './core/cqrs.js';
export type {
    Command,
    DomainEvent,
    CommandHandler,
    EventHandler as CQRSEventHandler,
    StartWorkflowPayload,
    ExecuteToolPayload,
    PauseWorkflowPayload,
    WorkflowStartedPayload,
    ToolExecutedPayload,
    WorkflowRecoveredPayload,
} from './core/cqrs.js';

// ── Multi-agent patterns ───────────────────────────────────────────────────
export * from './multi-agent/team.js';
export * from './multi-agent/swarm.js';
export * from './multi-agent/supervisor.js';
export * from './multi-agent/pipeline.js';
export * from './multi-agent/consensus.js';
export * from './multi-agent/handoff.js';
export * from './multi-agent/router.js';
export * from './multi-agent/ralph.js';
export * from './multi-agent/gsd.js';
export * from './multi-agent/patterns.js';



// ── Agent-to-Agent (A2A) protocol ─────────────────────────────────────────
export * from './a2a/types.js';
export * from './a2a/client.js';
export * from './a2a/http-client.js';
export * from './a2a/server.js';

// ── Developer-experience helpers ──────────────────────────────────────────
// defineRole: role builder → structured system prompt + agent
// defineTask: task primitive with dependency resolution and context injection
// createTeam: ergonomic team factory with planning and delegation support
export { defineRole, buildSystemPrompt, buildDelegationTools } from './dx/define-role.js';
export type { RoleDefinition, RoleAgent } from './dx/define-role.js';
export { defineTask, resolveTaskBatches, buildTaskPrompt, buildTaskContextBlock, TaskCycleError } from './dx/define-task.js';
export type { TaskDefinition, TaskHandle } from './dx/define-task.js';
export { generateExecutionPlan, renderPlanBlock } from './dx/planner.js';
export type { ExecutionPlan, PlanStep, PlannerOptions } from './dx/planner.js';
export { createTeam } from './dx/create-team.js';
export type { TeamMode, TeamOptions, TeamHandle, TeamRunResult } from './dx/create-team.js';

// ── Context builder ────────────────────────────────────────────────────────
export { AgentContextBuilder } from './_context-builder.js';

// ── Trace context ─────────────────────────────────────────────────────────
export {
    extractTraceContext,
    injectTraceHeaders,
    generateTraceparent,
} from './_trace-context.js';
export type { TraceContext } from './_trace-context.js';

// ── Typed agent event bus ──────────────────────────────────────────────────
export { createAgentEventBus, AgentEventBusTimeoutError } from './event-bus.js';
export type {
    AgentEventBus,
    AgentEventBusOptions,
    AgentEventBusMetrics,
    EventMap,
    EventHandler,
    WildcardHandler,
    EventSubscription,
} from './event-bus.js';

// ── Team modes (route | coordinate | collaborate) ─────────────────────────────
export { createModeTeam } from './team-modes.js';
export type {
    TeamAgent as ModeTeamAgent,
    TeamMode as ModeTeamMode,
    TeamConfig as ModeTeamConfig,
    TeamResult as ModeTeamResult,
} from './team-modes.js';
