/**
 * @personaforge/sdk — High-level SDK for the personaforge agent framework.
 *
 * Provides typed agent definitions, multi-step workflows, and orchestration adapters.
 */

export type { AgentDefinitionConfig, AgentRunConfig, WorkflowResult } from './types.js';
export { defineAgent, defineAgentFromConfig, DefinedAgent, AgentBuilder } from './defined-agent.js';
export type { TypedAgent, TypedAgentResult, AgentStreamEvent } from './defined-agent.js';
export { createWorkflow, WorkflowBuilder, Workflow, isSuspended } from './workflow.js';
export type { WorkflowStep, WorkflowSuspension, WorkflowCompletion, WorkflowExecuteResult } from './workflow.js';
export { asOrchestratorAgent } from './orchestrator-adapter.js';

// Re-export core types for convenience (explicit to avoid ambiguity with tools/planner/execution)
export type {
    Agent,
    AgentRunOptions,
    AgentRunResult,
    AgentLifecycleHooks,
    Message,
    MultiModalInput,
    EntityId,
    LLMProvider,
    GenerateOptions,
    GenerateResult,
    StreamChunk,
    AgentState,
    AgentInput,
    AgentOutput,
    AgentContext,
    ITextGenerator,
    IStreamingProvider,
    IToolCallProvider,
    IEmbeddingProvider,
    IFullLLMProvider,
} from '../core/index.js';
export { generateEntityId } from '../core/index.js';
// createAgent now lives in the single factory (Mastermind + recorder wired).
export { createAgent } from '../create-agent/index.js';
// Tools
export * from '../tools/index.js';
// Planner, memory, execution — only unique members
export * from '../memory/index.js';
export * from '../planner/index.js';
export * from '../execution/index.js';
