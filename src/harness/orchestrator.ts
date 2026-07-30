/**
 * createOrchestrator — compose specialist agents/workflows/pipelines into a
 * single coordinating agent via tool delegation.
 */

import { z } from 'zod';
import { agentAsTool, multiAgentTool, type RunnableAgent } from '../tools/core/agent-as-tool.js';
import { workflowAsTool, type RunnableWorkflow } from '../tools/core/workflow-as-tool.js';
import { pipelineAsTool, type RunnablePipeline } from '../tools/core/pipeline-as-tool.js';
import type { LightweightTool, ToolSchemaLike } from '../tools/core/tool-helper.js';
import { createHarness, type HarnessConfig, type AgentHarness } from './create-harness.js';

export interface OrchestratorSpecialist {
    readonly name: string;
    readonly description: string;
    readonly agent?: RunnableAgent;
    readonly workflow?: RunnableWorkflow;
    readonly pipeline?: RunnablePipeline;
    readonly outputSchema?: ToolSchemaLike<unknown>;
    readonly timeoutMs?: number;
}

export interface OrchestratorConfig {
    /** Coordinating agent factory — receives specialist tools and returns a runnable agent. */
    readonly createCoordinator: (tools: LightweightTool[]) => RunnableAgent & { name?: string; instructions?: string };
    /** Specialists exposed to the coordinator as tools. */
    readonly specialists: readonly OrchestratorSpecialist[];
    /** Optional harness hardening for the coordinator. */
    readonly harness?: Omit<HarnessConfig, 'agent'>;
}

export interface Orchestrator {
    readonly coordinator: RunnableAgent;
    readonly harness?: AgentHarness;
    readonly tools: LightweightTool[];
    run(input: Record<string, unknown> | string, options?: { sessionId?: string }): Promise<unknown>;
    asTool(options: { name: string; description: string }): LightweightTool;
}

function specialistToTool(spec: OrchestratorSpecialist): LightweightTool {
    if (spec.agent) {
        return agentAsTool({
            name: spec.name,
            description: spec.description,
            agent: spec.agent,
            parameters: z.object({ prompt: z.string() }),
            ...(spec.outputSchema !== undefined ? { outputSchema: spec.outputSchema } : {}),
            ...(spec.timeoutMs !== undefined ? { timeoutMs: spec.timeoutMs } : {}),
        });
    }
    if (spec.workflow) {
        return workflowAsTool({
            name: spec.name,
            description: spec.description,
            workflow: spec.workflow,
            parameters: z.object({ input: z.record(z.string(), z.unknown()).optional() }).passthrough(),
            ...(spec.outputSchema !== undefined ? { outputSchema: spec.outputSchema } : {}),
            ...(spec.timeoutMs !== undefined ? { timeoutMs: spec.timeoutMs } : {}),
        });
    }
    if (spec.pipeline) {
        return pipelineAsTool({
            name: spec.name,
            description: spec.description,
            pipeline: spec.pipeline,
            ...(spec.outputSchema !== undefined ? { outputSchema: spec.outputSchema } : {}),
            ...(spec.timeoutMs !== undefined ? { timeoutMs: spec.timeoutMs } : {}),
        });
    }
    throw new Error(`Orchestrator specialist "${spec.name}" must provide agent, workflow, or pipeline.`);
}

export function createOrchestrator(config: OrchestratorConfig): Orchestrator {
    const tools = config.specialists.map(specialistToTool);
    const coordinator = config.createCoordinator(tools);

    const harness = config.harness
        ? createHarness({ ...config.harness, agent: coordinator })
        : undefined;

    const runner: RunnableAgent = harness?.agent ?? coordinator;

    return {
        coordinator: runner,
        ...(harness !== undefined ? { harness } : {}),
        tools,
        run: (input, options) => runner.run(input, options),
        asTool: (options) =>
            (harness ?? createHarness({ agent: coordinator })).asTool({
                name: options.name,
                description: options.description,
            }),
    };
}

export { multiAgentTool };
