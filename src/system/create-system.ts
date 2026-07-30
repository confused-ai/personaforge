/**
 * createSystem() — production app container (edge over Mastra `new Mastra()` / Agno AgentOS).
 *
 * One registry for agents, workflows, pipelines, and tools.
 * Spin up supervisors, expose HTTP, and treat the whole system as a tool.
 *
 * ```ts
 * import { createSystem, agent, tool } from 'personaforge';
 *
 * const research = agent({ name: 'research', instructions: 'Research topics.', description: 'Deep research' });
 * const writer = agent({ name: 'writer', instructions: 'Write clearly.', description: 'Writing' });
 *
 * const system = createSystem({
 *   name: 'content-studio',
 *   agents: {
 *     research: { agent: research, description: 'Deep research specialist' },
 *     writer: { agent: writer, description: 'Clear technical writer' },
 *   },
 *   tools: {
 *     search: tool({ name: 'web_search', description: '...', parameters: z.object({ q: z.string() }), execute: async () => ({}) }),
 *   },
 *   resilience: { rateLimit: { maxRpm: 120 } },
 * });
 *
 * const boss = system.supervisor({
 *   instructions: 'Coordinate research then writing.',
 * });
 * const result = await boss.generate('Write a brief on TypeScript 5.5');
 *
 * // LangGraph-style streaming
 * for await (const ev of system.streamEvents('...', { streamMode: ['messages', 'updates'] })) {
 *   if (ev.type === 'token') process.stdout.write(ev.data);
 * }
 *
 * // Control plane dashboard
 * await system.serve(4100);
 * ```
 */

import type { CreateAgentResult } from '../create-agent/types.js';
import type { LightweightTool } from '../tools/core/tool-helper.js';
import type { StreamEvent } from '../streaming/index.js';
import {
    createControlPlane,
    type ControlPlaneConfig,
    type ControlPlaneServer,
} from '../control-plane/index.js';
import { buildSupervisor, type SupervisorHandle } from './supervisor.js';
import {
    normalizeAgent,
    normalizeWorkflow,
    normalizePipeline,
    normalizeTools,
} from './normalize.js';
import {
    streamAgentEvents,
    streamAgentText,
    type SystemStreamOptions,
} from './stream.js';
import type {
    SystemConfig,
    SystemAgentRegistration,
    SystemWorkflowRegistration,
    SystemPipelineRegistration,
    SupervisorOptions,
    SystemServeOptions,
} from './types.js';

export interface PersonaForgeSystem {
    readonly name: string;
    readonly description?: string;
    /** Get a registered agent by key. */
    getAgent(name: string): CreateAgentResult;
    /** List registered agent keys. */
    listAgents(): string[];
    /** List registered workflow keys. */
    listWorkflows(): string[];
    /** List registered pipeline keys. */
    listPipelines(): string[];
    /** Shared tools. */
    listTools(): LightweightTool[];
    /** Register an agent at runtime. */
    addAgent(name: string, registration: SystemAgentRegistration | CreateAgentResult): void;
    /** Register a workflow at runtime. */
    addWorkflow(name: string, registration: SystemWorkflowRegistration | import('../tools/core/workflow-as-tool.js').RunnableWorkflow): void;
    /** Register a pipeline at runtime. */
    addPipeline(name: string, registration: SystemPipelineRegistration | import('../tools/core/pipeline-as-tool.js').RunnablePipeline): void;
    /** Build a supervisor that can call registered specialists as tools. */
    supervisor(options?: SupervisorOptions): SupervisorHandle;
    /** Treat the default supervisor as a single callable tool (for nesting systems). */
    asTool(options?: { name?: string; description?: string; supervisor?: SupervisorOptions }): LightweightTool;
    /** Token stream via the default supervisor. */
    stream(prompt: string, options?: Omit<SystemStreamOptions, 'streamMode'> & { supervisor?: SupervisorOptions }): AsyncIterable<string>;
    /**
     * LangGraph-style event stream via the default supervisor.
     * Modes: `values` | `updates` | `messages` | `debug` | `custom`.
     */
    streamEvents(prompt: string, options?: SystemStreamOptions & { supervisor?: SupervisorOptions }): AsyncIterable<StreamEvent>;
    /** Build a control-plane server bound to this system's agents + snapshot. */
    controlPlane(options?: SystemServeOptions): ControlPlaneServer;
    /** Start the control-plane dashboard (default port 4100). */
    serve(portOrOptions?: number | SystemServeOptions): Promise<ControlPlaneServer>;
    /** Snapshot of registrations (for control plane / OpenAPI). */
    toJSON(): {
        name: string;
        description?: string;
        agents: string[];
        workflows: string[];
        pipelines: string[];
        tools: string[];
    };
}

function buildControlPlaneAgents(
    system: PersonaForgeSystem,
    supervisorOpts?: SupervisorOptions,
): ControlPlaneConfig['agents'] {
    const agents: NonNullable<ControlPlaneConfig['agents']> = [];

    const boss = system.supervisor(supervisorOpts);
    agents.push({
        name: boss.agent.name,
        run: async (prompt) => {
            const result = await boss.run(prompt) as { text?: string };
            return { text: result?.text ?? String(result ?? '') };
        },
        streamEvents: (prompt, opts) => boss.streamEvents(prompt, opts),
    });

    for (const key of system.listAgents()) {
        const a = system.getAgent(key);
        agents.push({
            name: key,
            run: async (prompt) => {
                const result = await a.run(prompt);
                return { text: result.text };
            },
            streamEvents: (prompt, opts) =>
                streamAgentEvents(a, prompt, {
                    streamMode: opts?.streamMode,
                    node: key,
                }),
        });
    }

    return agents;
}

export function createSystem(config: SystemConfig): PersonaForgeSystem {
    const agents: Record<string, SystemAgentRegistration> = {};
    const workflows: Record<string, SystemWorkflowRegistration> = {};
    const pipelines: Record<string, SystemPipelineRegistration> = {};

    for (const [key, value] of Object.entries(config.agents ?? {})) {
        agents[key] = normalizeAgent(key, value);
    }
    for (const [key, value] of Object.entries(config.workflows ?? {})) {
        workflows[key] = normalizeWorkflow(key, value);
    }
    for (const [key, value] of Object.entries(config.pipelines ?? {})) {
        pipelines[key] = normalizePipeline(key, value);
    }

    const sharedTools = normalizeTools(config.tools);

    const system: PersonaForgeSystem = {
        name: config.name,
        ...(config.description !== undefined ? { description: config.description } : {}),

        getAgent(name: string) {
            const reg = agents[name];
            if (!reg) throw new Error(`System "${config.name}": unknown agent "${name}"`);
            return reg.agent;
        },

        listAgents: () => Object.keys(agents),
        listWorkflows: () => Object.keys(workflows),
        listPipelines: () => Object.keys(pipelines),
        listTools: () => [...sharedTools],

        addAgent(name, registration) {
            agents[name] = normalizeAgent(name, registration);
        },

        addWorkflow(name, registration) {
            workflows[name] = normalizeWorkflow(name, registration);
        },

        addPipeline(name, registration) {
            pipelines[name] = normalizePipeline(name, registration);
        },

        supervisor(options = {}) {
            return buildSupervisor({
                systemName: config.name,
                ...(config.model !== undefined ? { systemModel: config.model } : {}),
                agents,
                workflows,
                pipelines,
                sharedTools,
                options,
                ...(config.harness !== undefined ? { defaultHarness: config.harness } : {}),
                ...(config.resilience !== undefined ? { defaultResilience: config.resilience } : {}),
            });
        },

        asTool(options = {}) {
            const handle = system.supervisor(options.supervisor);
            return handle.asTool({
                name: options.name ?? `${config.name}_system`,
                description:
                    options.description ??
                    config.description ??
                    `Full "${config.name}" multi-agent system`,
            });
        },

        stream(prompt, options = {}) {
            const { supervisor: supervisorOpts, ...streamOpts } = options;
            const handle = system.supervisor(supervisorOpts);
            return streamAgentText(handle.agent, prompt, streamOpts);
        },

        streamEvents(prompt, options = {}) {
            const { supervisor: supervisorOpts, ...streamOpts } = options;
            const handle = system.supervisor(supervisorOpts);
            return streamAgentEvents(handle.agent, prompt, {
                ...streamOpts,
                node: streamOpts.node ?? handle.agent.name,
            });
        },

        controlPlane(options = {}) {
            const stores = options.stores ?? {};
            return createControlPlane({
                agents: buildControlPlaneAgents(system, options.supervisor),
                system: system.toJSON(),
                ...(stores.sessionStore !== undefined ? { sessionStore: stores.sessionStore } : {}),
                ...(stores.evalStore !== undefined ? { evalStore: stores.evalStore } : {}),
                ...(stores.traceStore !== undefined ? { traceStore: stores.traceStore } : {}),
                ...(stores.approvalStore !== undefined ? { approvalStore: stores.approvalStore } : {}),
                ...(stores.knowledgeStore !== undefined ? { knowledgeStore: stores.knowledgeStore } : {}),
            });
        },

        async serve(portOrOptions) {
            const options: SystemServeOptions =
                typeof portOrOptions === 'number'
                    ? { port: portOrOptions }
                    : (portOrOptions ?? {});
            const port = options.port ?? 4100;
            const cp = system.controlPlane(options);
            await cp.start(port);
            return cp;
        },

        toJSON() {
            return {
                name: config.name,
                ...(config.description !== undefined ? { description: config.description } : {}),
                agents: Object.keys(agents),
                workflows: Object.keys(workflows),
                pipelines: Object.keys(pipelines),
                tools: sharedTools.map((t) => t.name),
            };
        },
    };

    return system;
}

/** Alias preferred by Agno/Mastra migrants. */
export const System = createSystem;
