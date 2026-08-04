/**
 * Multi-Agent Orchestrator Implementation
 *
 * Coordinates multiple agents with message passing and load balancing
 */

import {
    Orchestrator,
    AgentRegistration,
    AgentRole,
    MessageType,
    MessagePriority,
    DelegationTask,
    DelegationResult,
    DelegationStatus,
    DelegationPriority,
    CoordinationTask,
    CoordinationResult,
    CoordinationType,
    CoordinationStatus,
} from './types.js';
import type { MessageBus, Subscription } from './types.js';
import { MessageBusImpl } from './message-bus.js';
import { RoundRobinLoadBalancer } from './load-balancer.js';
import type { OrchestrableAgent } from './types.js';
import type { AgentInput, AgentContext } from '../../core/index.js';
import type { AgentOutput } from '../../core/index.js';
import { AgentState } from '../../core/index.js';
import type { EntityId } from '../../core/index.js';
import type { LoadBalancer } from './types.js';
import { AgentContextBuilder } from '../_context-builder.js';
import { InMemoryStore } from '../../memory/index.js';
import { ToolRegistryImpl } from '../../tools/index.js';
import { ClassicalPlanner } from '../../planner/index.js';
import { PlanningAlgorithm } from '../../planner/index.js';

const ORCHESTRATOR_ID = 'orchestrator' as EntityId;

/**
 * Orchestrator implementation
 */
export class OrchestratorImpl implements Orchestrator {
    private agents: Map<EntityId, AgentRegistration> = new Map();
    private subscriptions: Map<EntityId, Subscription> = new Map();
    private messageBus: MessageBus;
    private loadBalancer: LoadBalancer;
    private readonly memoryStore: import('../../memory/index.js').MemoryStore;
    private _isRunning = false;
    // Inverted indexes for O(1)/O(k) lookups instead of O(n) full scans
    private readonly _capabilityIndex: Map<string, Set<EntityId>> = new Map();
    private readonly _roleIndex: Map<string, Set<EntityId>> = new Map();

    constructor(
        messageBus?: MessageBus,
        loadBalancer?: LoadBalancer,
        memoryStore?: import('../../memory/index.js').MemoryStore,
    ) {
        this.messageBus = messageBus ?? new MessageBusImpl();
        this.loadBalancer = loadBalancer ?? new RoundRobinLoadBalancer();
        this.memoryStore = memoryStore ?? new InMemoryStore();
    }

    async registerAgent(agent: OrchestrableAgent, role: AgentRole): Promise<void> {
        const registration: AgentRegistration = {
            agent,
            role,
            capabilities: role.responsibilities,
            metadata: {
                registeredAt: new Date(),
                totalTasksCompleted: 0,
                totalTasksFailed: 0,
                averageExecutionTimeMs: 0,
                currentLoad: 0,
                maxConcurrentTasks: role.permissions.canExecuteTools ? 5 : 1,
            },
        };

        this.agents.set(agent.id, registration);

        // Update inverted indexes
        for (const cap of role.responsibilities) {
            let set = this._capabilityIndex.get(cap);
            if (!set) { set = new Set(); this._capabilityIndex.set(cap, set); }
            set.add(agent.id);
        }
        const roleSet = this._roleIndex.get(role.name) ?? new Set<EntityId>();
        roleSet.add(agent.id);
        this._roleIndex.set(role.name, roleSet);

        const subscription = this.messageBus.subscribe(
            agent.id,
            { types: [MessageType.QUERY] },
            async (msg) => {
                const payload = msg.payload as { type?: string; task?: AgentInput };
                const taskInput = (payload?.task ?? payload) as AgentInput;
                const ctx = createMinimalContext(agent, this.memoryStore);
                try {
                    const output = await agent.run(taskInput, ctx);
                    await this.messageBus.send({
                        from: agent.id,
                        to: ORCHESTRATOR_ID,
                        type: MessageType.TASK_RESPONSE,
                        payload: output,
                        correlationId: msg.correlationId,
                        priority: MessagePriority.NORMAL,
                    });
                } catch (err) {
                    const errorOutput: AgentOutput = {
                        result: err instanceof Error ? err.message : String(err),
                        state: AgentState.FAILED,
                        metadata: { startTime: new Date(), iterations: 0 },
                    };
                    await this.messageBus.send({
                        from: agent.id,
                        to: ORCHESTRATOR_ID,
                        type: MessageType.TASK_RESPONSE,
                        payload: errorOutput,
                        correlationId: msg.correlationId,
                        priority: MessagePriority.NORMAL,
                    });
                }
            }
        );
        this.subscriptions.set(agent.id, subscription);

        // Notify other agents
        await this.broadcast({
            type: 'agent_registered',
            agentId: agent.id,
            role: role.name,
        }, MessageType.EVENT);
    }

    async unregisterAgent(agentId: EntityId): Promise<void> {
        const registration = this.agents.get(agentId);
        if (!registration) {
            throw new Error(`Agent ${agentId} not found`);
        }

        const subscription = this.subscriptions.get(agentId);
        if (subscription) {
            this.messageBus.unsubscribe(subscription);
            this.subscriptions.delete(agentId);
        }
        this.agents.delete(agentId);

        // Remove from inverted indexes
        for (const cap of registration.capabilities) {
            this._capabilityIndex.get(cap)?.delete(agentId);
        }
        this._roleIndex.get(registration.role.name)?.delete(agentId);

        await this.broadcast({
            type: 'agent_unregistered',
            agentId,
        }, MessageType.EVENT);
    }

    getAgent(agentId: EntityId): AgentRegistration | undefined {
        return this.agents.get(agentId);
    }

    listAgents(): AgentRegistration[] {
        return Array.from(this.agents.values());
    }

    findAgentsByRole(roleName: string): AgentRegistration[] {
        const ids = this._roleIndex.get(roleName);
        if (!ids || ids.size === 0) return [];
        const result: AgentRegistration[] = [];
        for (const id of ids) {
            const reg = this.agents.get(id);
            if (reg) result.push(reg);
        }
        return result;
    }

    findAgentsByCapability(capability: string): AgentRegistration[] {
        const ids = this._capabilityIndex.get(capability);
        if (!ids || ids.size === 0) return [];
        const result: AgentRegistration[] = [];
        for (const id of ids) {
            const reg = this.agents.get(id);
            if (reg) result.push(reg);
        }
        return result;
    }

    async delegateTask(task: DelegationTask, options?: { timeoutMs?: number; retryCount?: number }): Promise<DelegationResult> {
        const startTime = Date.now();

        // Find candidates with required capabilities
        const candidates = this.findAgentsByCapabilities(task.requiredCapabilities);

        if (candidates.length === 0) {
            return {
                taskId: task.id,
                assignedAgentId: '',
                status: DelegationStatus.FAILED,
                error: 'No agents found with required capabilities',
                executionTimeMs: Date.now() - startTime,
            };
        }

        // Select best agent using load balancer
        const selected = this.loadBalancer.selectAgent(candidates, task);

        if (!selected) {
            return {
                taskId: task.id,
                assignedAgentId: '',
                status: DelegationStatus.REJECTED,
                error: 'No agent available to handle task',
                executionTimeMs: Date.now() - startTime,
            };
        }

        try {
            // Send task to selected agent
            const response = await this.messageBus.request(
                selected.agent.id,
                {
                    type: 'task',
                    task: task.input,
                },
                options?.timeoutMs ?? 30000
            );

            // Update metrics
            this.loadBalancer.updateMetrics(
                selected.agent.id,
                Date.now() - startTime,
                true
            );

            return {
                taskId: task.id,
                assignedAgentId: selected.agent.id,
                status: DelegationStatus.COMPLETED,
                output: response as AgentOutput,
                executionTimeMs: Date.now() - startTime,
            };
        } catch (error) {
            // Update metrics
            this.loadBalancer.updateMetrics(
                selected.agent.id,
                Date.now() - startTime,
                false
            );

            return {
                taskId: task.id,
                assignedAgentId: selected.agent.id,
                status: DelegationStatus.FAILED,
                error: error instanceof Error ? error.message : String(error),
                executionTimeMs: Date.now() - startTime,
            };
        }
    }

    async broadcast(payload: unknown, type: MessageType = MessageType.NOTIFICATION): Promise<void> {
        for (const [agentId] of this.agents) {
            await this.messageBus.send({
                from: ORCHESTRATOR_ID,
                to: agentId,
                type,
                payload,
                priority: MessagePriority.NORMAL,
            });
        }
    }

    getMessageBus(): MessageBus {
        return this.messageBus;
    }

    async start(): Promise<void> {
        this._isRunning = true;
    }

    async stop(): Promise<void> {
        this._isRunning = false;
    }

    /**
     * Check if orchestrator is running
     */
    isRunning(): boolean {
        return this._isRunning;
    }

    /**
     * Coordinate multiple agents for a complex task
     */
    async coordinate(agents: AgentRegistration[], task: CoordinationTask): Promise<CoordinationResult> {
        const startTime = Date.now();
        const results = new Map<EntityId, AgentOutput>();

        switch (task.coordinationType) {
            case CoordinationType.SEQUENTIAL:
                for (const agentReg of agents) {
                    const result = await this.delegateTask({
                        id: `${task.id}-${agentReg.agent.id}`,
                        description: task.description,
                        requiredCapabilities: agentReg.capabilities,
                        input: { prompt: task.description },
                        priority: DelegationPriority.NORMAL,
                    });

                    if (result.output) {
                        results.set(agentReg.agent.id, result.output);
                    }
                }
                break;

            case CoordinationType.PARALLEL:
                const promises = agents.map(agentReg =>
                    this.delegateTask({
                        id: `${task.id}-${agentReg.agent.id}`,
                        description: task.description,
                        requiredCapabilities: agentReg.capabilities,
                        input: { prompt: task.description },
                        priority: DelegationPriority.NORMAL,
                    })
                );

                const parallelResults = await Promise.all(promises);
                for (let i = 0; i < agents.length; i++) {
                    const output = parallelResults[i].output;
                    if (output) {
                        results.set(agents[i].agent.id, output);
                    }
                }
                break;

            default:
                // Default to sequential
                for (const agentReg of agents) {
                    const result = await this.delegateTask({
                        id: `${task.id}-${agentReg.agent.id}`,
                        description: task.description,
                        requiredCapabilities: agentReg.capabilities,
                        input: { prompt: task.description },
                        priority: DelegationPriority.NORMAL,
                    });

                    if (result.output) {
                        results.set(agentReg.agent.id, result.output);
                    }
                }
        }

        return {
            taskId: task.id,
            status: results.size === agents.length
                ? CoordinationStatus.SUCCESS
                : results.size > 0
                    ? CoordinationStatus.PARTIAL
                    : CoordinationStatus.FAILED,
            results,
            executionTimeMs: Date.now() - startTime,
        };
    }

    private findAgentsByCapabilities(requiredCapabilities: string[]): AgentRegistration[] {
        if (!Array.isArray(requiredCapabilities) || requiredCapabilities.length === 0) {
            return Array.from(this.agents.values());
        }
        // Intersect index sets: start from the smallest to minimise work
        const sets = requiredCapabilities
            .map(cap => this._capabilityIndex.get(cap))
            .filter((s): s is Set<EntityId> => s !== undefined && s.size > 0);

        if (sets.length < requiredCapabilities.length) return []; // some cap has no agents

        // Sort ascending by size so we iterate the smallest set
        sets.sort((a, b) => a.size - b.size);
        const [smallest, ...rest] = sets as [Set<EntityId>, ...Set<EntityId>[]];

        const result: AgentRegistration[] = [];
        for (const id of smallest) {
            if (rest.every(s => s.has(id))) {
                const reg = this.agents.get(id);
                if (reg) result.push(reg);
            }
        }
        return result;
    }
}

/**
 * Create a minimal AgentContext for in-process agent execution
 */
function createMinimalContext(agent: OrchestrableAgent, memoryStore: import('../../memory/index.js').MemoryStore): AgentContext {
    return new AgentContextBuilder()
        .withAgentId(agent.id)
        .withMemory(memoryStore)
        .withTools(new ToolRegistryImpl())
        .withPlanner(new ClassicalPlanner({ algorithm: PlanningAlgorithm.HIERARCHICAL }))
        .build();
}
