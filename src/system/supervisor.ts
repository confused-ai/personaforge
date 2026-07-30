/**
 * Modern supervisor — Mastra's recommended pattern, with personaforge edges:
 *   - Agents, workflows, AND pipelines all become tools
 *   - Output schemas + nesting depth limits
 *   - Production harness (circuit breaker / rate limit) optional
 *   - Works with createAgent / agent() results directly (no CoreAgent cast)
 */

import { z } from 'zod';
import { agent } from '../dx/agent.js';
import { agentAsTool } from '../tools/core/agent-as-tool.js';
import { workflowAsTool } from '../tools/core/workflow-as-tool.js';
import { pipelineAsTool } from '../tools/core/pipeline-as-tool.js';
import type { LightweightTool } from '../tools/core/tool-helper.js';
import { createHarness, type AgentHarness } from '../harness/create-harness.js';
import type { CreateAgentResult } from '../create-agent/types.js';
import type { StreamEvent } from '../streaming/index.js';
import {
    streamAgentEvents,
    streamAgentText,
    type SystemStreamOptions,
} from './stream.js';
import type {
    SystemAgentRegistration,
    SystemWorkflowRegistration,
    SystemPipelineRegistration,
    SupervisorOptions,
} from './types.js';

export interface BuildSupervisorInput {
    readonly systemName: string;
    readonly systemModel?: string;
    readonly agents: Record<string, SystemAgentRegistration>;
    readonly workflows: Record<string, SystemWorkflowRegistration>;
    readonly pipelines: Record<string, SystemPipelineRegistration>;
    readonly sharedTools: readonly LightweightTool[];
    readonly options: SupervisorOptions;
    readonly defaultHarness?: SupervisorOptions['harness'];
    readonly defaultResilience?: false | import('../production/resilient-agent.js').ResilienceConfig;
}

export interface SupervisorHandle {
    readonly agent: CreateAgentResult;
    readonly harness: AgentHarness;
    readonly tools: LightweightTool[];
    run(prompt: string, options?: Parameters<CreateAgentResult['run']>[1]): Promise<unknown>;
    generate(prompt: string, options?: Parameters<CreateAgentResult['run']>[1]): Promise<unknown>;
    /** Token stream (text chunks). */
    stream(prompt: string, options?: Omit<SystemStreamOptions, 'streamMode'>): AsyncIterable<string>;
    /**
     * LangGraph-style event stream.
     * Modes: `values` | `updates` | `messages` | `debug` | `custom` (combinable).
     */
    streamEvents(prompt: string, options?: SystemStreamOptions): AsyncIterable<StreamEvent>;
    asTool(options: { name: string; description: string }): LightweightTool;
}

function buildSpecialistTools(input: BuildSupervisorInput): LightweightTool[] {
    const {
        agents,
        workflows,
        pipelines,
        sharedTools,
        options,
    } = input;

    const agentKeys = options.agents ?? Object.keys(agents);
    const workflowKeys = options.workflows ?? Object.keys(workflows);
    const pipelineKeys = options.pipelines ?? Object.keys(pipelines);
    const maxDepth = options.maxDepth ?? 5;

    const tools: LightweightTool[] = [];

    for (const key of agentKeys) {
        const reg = agents[key];
        if (!reg) throw new Error(`Supervisor: unknown agent "${key}"`);
        tools.push(
            agentAsTool({
                name: key,
                description: reg.description,
                agent: reg.agent as unknown as import('../tools/core/agent-as-tool.js').RunnableAgent,
                parameters: z.object({
                    prompt: z.string().describe(`Task for the ${key} agent`),
                }),
                ...(reg.outputSchema !== undefined ? { outputSchema: reg.outputSchema } : {}),
                maxDepth,
                tags: ['supervisor-agent', key],
            }),
        );
    }

    for (const key of workflowKeys) {
        const reg = workflows[key];
        if (!reg) throw new Error(`Supervisor: unknown workflow "${key}"`);
        tools.push(
            workflowAsTool({
                name: key,
                description: reg.description,
                workflow: reg.workflow,
                parameters:
                    reg.parameters ??
                    (z.object({
                        input: z.record(z.string(), z.unknown()).optional(),
                    }).passthrough() as import('../tools/core/tool-helper.js').ToolObjectSchemaLike<Record<string, unknown>>),
                ...(reg.outputSchema !== undefined ? { outputSchema: reg.outputSchema } : {}),
                tags: ['supervisor-workflow', key],
            }),
        );
    }

    for (const key of pipelineKeys) {
        const reg = pipelines[key];
        if (!reg) throw new Error(`Supervisor: unknown pipeline "${key}"`);
        tools.push(
            pipelineAsTool({
                name: key,
                description: reg.description,
                pipeline: reg.pipeline,
                ...(reg.parameters !== undefined ? { parameters: reg.parameters } : {}),
                ...(reg.outputSchema !== undefined ? { outputSchema: reg.outputSchema } : {}),
                tags: ['supervisor-pipeline', key],
            }),
        );
    }

    tools.push(...sharedTools);
    if (options.extraTools) tools.push(...options.extraTools);

    return tools;
}

function defaultInstructions(tools: LightweightTool[], systemName: string): string {
    const catalog = tools
        .map((t) => `- ${t.name}: ${t.description}`)
        .join('\n');
    return [
        `You are the supervisor for "${systemName}".`,
        'Delegate to the best specialist tool for each sub-task.',
        'You may call multiple tools. Synthesize a clear final answer for the user.',
        'Never invent tool results — only use returned data.',
        '',
        'Available capabilities:',
        catalog || '(none registered)',
    ].join('\n');
}

export function buildSupervisor(input: BuildSupervisorInput): SupervisorHandle {
    const tools = buildSpecialistTools(input);
    const name = input.options.name ?? `${input.systemName}-supervisor`;
    const instructions =
        input.options.instructions ?? defaultInstructions(tools, input.systemName);
    const model = input.options.model ?? input.systemModel ?? 'gpt-4o-mini';

    const coordinator = input.options.createCoordinator
        ? input.options.createCoordinator(tools)
        : agent({
            name,
            instructions,
            model,
            tools,
        });

    const harnessOpts = input.options.harness ?? input.defaultHarness ?? {};
    const harness = createHarness({
        agent: coordinator as unknown as import('../tools/core/agent-as-tool.js').RunnableAgent & {
            name?: string;
            instructions?: string;
        },
        ...harnessOpts,
        resilience:
            harnessOpts.resilience !== undefined
                ? harnessOpts.resilience
                : (input.defaultResilience ?? false),
        nesting: { maxDepth: input.options.maxDepth ?? 5 },
    });

    return {
        agent: coordinator,
        harness,
        tools,
        run: (prompt, options) => coordinator.run(prompt, options),
        generate: (prompt, options) => coordinator.run(prompt, options),
        stream: (prompt, options) => streamAgentText(coordinator, prompt, options),
        streamEvents: (prompt, options) =>
            streamAgentEvents(coordinator, prompt, {
                ...options,
                node: options?.node ?? name,
            }),
        asTool: (opts) =>
            harness.asTool({
                name: opts.name,
                description: opts.description,
            }),
    };
}
