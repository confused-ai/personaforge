/**
 * System registry types — the Mastra/Agno-style top-level app container.
 */

import type { CreateAgentResult } from '../create-agent/types.js';
import type { LightweightTool } from '../tools/core/tool-helper.js';
import type { RunnableWorkflow } from '../tools/core/workflow-as-tool.js';
import type { RunnablePipeline } from '../tools/core/pipeline-as-tool.js';
import type { HarnessConfig } from '../harness/create-harness.js';
import type { ResilienceConfig } from '../production/resilient-agent.js';

/** A registered agent with a required description for supervisor discovery. */
export interface SystemAgentRegistration {
    readonly agent: CreateAgentResult;
    /** Human/LLM-readable capability description (required for supervisor routing). */
    readonly description: string;
    /** Optional structured output schema hint for tool wrapping. */
    readonly outputSchema?: import('../tools/core/tool-helper.js').ToolSchemaLike<unknown>;
}

export interface SystemWorkflowRegistration {
    readonly workflow: RunnableWorkflow;
    readonly description: string;
    readonly parameters?: import('../tools/core/tool-helper.js').ToolObjectSchemaLike<Record<string, unknown>>;
    readonly outputSchema?: import('../tools/core/tool-helper.js').ToolSchemaLike<unknown>;
}

export interface SystemPipelineRegistration {
    readonly pipeline: RunnablePipeline;
    readonly description: string;
    readonly parameters?: import('../tools/core/tool-helper.js').ToolObjectSchemaLike<Record<string, unknown>>;
    readonly outputSchema?: import('../tools/core/tool-helper.js').ToolSchemaLike<unknown>;
}

export interface SystemConfig {
    /** System / app name (shown in OpenAPI, control plane, logs). */
    readonly name: string;
    /** Optional human description. */
    readonly description?: string;
    /** Named agents available to supervisors and HTTP serving. */
    readonly agents?: Record<string, SystemAgentRegistration | CreateAgentResult>;
    /** Named SDK/graph workflows exposable as tools. */
    readonly workflows?: Record<string, SystemWorkflowRegistration | RunnableWorkflow>;
    /** Named compose()/pipe() pipelines. */
    readonly pipelines?: Record<string, SystemPipelineRegistration | RunnablePipeline>;
    /** Shared tools available to every supervisor by default. */
    readonly tools?: Record<string, LightweightTool> | readonly LightweightTool[];
    /** Default production harness options applied to supervisors. */
    readonly harness?: Omit<HarnessConfig, 'agent'>;
    /** Default resilience for supervisors (false to disable). */
    readonly resilience?: ResilienceConfig | false;
    /** Default model for auto-built supervisors when not overridden. */
    readonly model?: string;
}

export interface SupervisorOptions {
    /** Supervisor agent name. Default: `${system.name}-supervisor`. */
    readonly name?: string;
    /** Instructions for the coordinating agent. */
    readonly instructions?: string;
    /** Model id (e.g. gpt-4o-mini). Falls back to system.model. */
    readonly model?: string;
    /**
     * Inject a pre-built coordinator (tests / custom runtimes).
     * When set, `model` / `instructions` are ignored for agent construction.
     */
    readonly createCoordinator?: (
        tools: import('../tools/core/tool-helper.js').LightweightTool[],
    ) => import('../create-agent/types.js').CreateAgentResult;
    /** Subset of registered agent keys to expose. Default: all. */
    readonly agents?: readonly string[];
    /** Subset of registered workflow keys. Default: all. */
    readonly workflows?: readonly string[];
    /** Subset of registered pipeline keys. Default: all. */
    readonly pipelines?: readonly string[];
    /** Extra tools beyond system.tools. */
    readonly extraTools?: readonly LightweightTool[];
    /** Max agent-as-tool nesting depth. */
    readonly maxDepth?: number;
    /** Override harness options for this supervisor. */
    readonly harness?: Omit<HarnessConfig, 'agent'>;
}
