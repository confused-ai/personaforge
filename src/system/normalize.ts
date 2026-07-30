import type { CreateAgentResult } from '../create-agent/types.js';
import type { LightweightTool } from '../tools/core/tool-helper.js';
import type { RunnableWorkflow } from '../tools/core/workflow-as-tool.js';
import type { RunnablePipeline } from '../tools/core/pipeline-as-tool.js';
import type {
    SystemAgentRegistration,
    SystemWorkflowRegistration,
    SystemPipelineRegistration,
} from './types.js';

export function normalizeAgent(
    key: string,
    value: SystemAgentRegistration | CreateAgentResult,
): SystemAgentRegistration {
    if (value && typeof value === 'object' && 'agent' in value) {
        return value;
    }
    const agent = value as CreateAgentResult;
    return {
        agent,
        description:
            (agent as CreateAgentResult & { description?: string }).description ??
            `Agent "${key}" (${agent.name})`,
    };
}

export function normalizeWorkflow(
    key: string,
    value: SystemWorkflowRegistration | RunnableWorkflow,
): SystemWorkflowRegistration {
    if (value && typeof value === 'object' && 'workflow' in value) {
        return value;
    }
    return {
        workflow: value as RunnableWorkflow,
        description: `Workflow "${key}"`,
    };
}

export function normalizePipeline(
    key: string,
    value: SystemPipelineRegistration | RunnablePipeline,
): SystemPipelineRegistration {
    if (value && typeof value === 'object' && 'pipeline' in value) {
        return value;
    }
    return {
        pipeline: value as RunnablePipeline,
        description: `Pipeline "${key}"`,
    };
}

export function normalizeTools(
    tools: Record<string, LightweightTool> | readonly LightweightTool[] | undefined,
): LightweightTool[] {
    if (!tools) return [];
    if (Array.isArray(tools)) return [...tools];
    return Object.values(tools);
}
