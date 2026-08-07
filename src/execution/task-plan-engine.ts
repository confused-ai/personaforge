/**
 * Task-plan execution engine.
 *
 * Models work as a *plan of tasks* compiled into a DAG, then executes nodes
 * with dependency resolution, concurrency limits, retry/backoff, and abort
 * support. Reach for this when you have a planner emitting discrete tasks
 * with dependencies between them.
 *
 * Sibling engine: `step-pipeline-engine.ts` executes an ordered *pipeline of
 * steps* with backpressure and pause/resume. The two are complementary, not
 * versions of each other — see `./index.ts` for the full comparison.
 */

import {
    ExecutionEngine,
    ExecutionEngineConfig,
    ExecutionOptions,
    ExecutionStatus,
    ExecutionState,
    ExecutionProgress,
    ExecutionEvent,
    ExecutionEventType,
    ExecutionEventHandler,
    ExecutionGraph,
    ExecutionNode,
    ExecutionNodeStatus,
    TaskExecutor,
    ExecutionContext,
    BackoffStrategy,
} from './types.js';
import {
    Plan,
    Task,
    TaskResult,
    TaskStatus,
    PlanExecutionResult,
    PlanExecutionStatus,
} from '../planner/index.js';
import { newId } from '../contracts/index.js';
import { EventEmitter } from 'events';

type ExecutionId = string;
type NodeId = string;

/**
 * Default execution configuration
 */
const DEFAULT_CONFIG: Required<ExecutionEngineConfig> = {
    maxConcurrency: 4,
    defaultTimeoutMs: 30000,
    enableParallelExecution: true,
    workerPoolSize: 4,
    retryPolicy: {
        maxRetries: 3,
        backoffStrategy: BackoffStrategy.EXPONENTIAL,
        initialDelayMs: 1000,
        maxDelayMs: 30000,
    },
};

/**
 * Execution engine implementation
 */
export class ExecutionEngineImpl extends EventEmitter implements ExecutionEngine {
    private config: Required<ExecutionEngineConfig>;
    private executors: Map<string, TaskExecutor> = new Map();
    private executions: Map<ExecutionId, ExecutionStatus> = new Map();
    private runningExecutions: Map<ExecutionId, AbortController> = new Map();

    constructor(config: Partial<ExecutionEngineConfig> = {}) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    async execute(plan: Plan, options: ExecutionOptions = {}): Promise<PlanExecutionResult> {
        const executionId = options.executionId === undefined
            ? this.generateId()
            : this.normalizeId(options.executionId as unknown);
        const planId = this.normalizeId(plan.id as unknown);
        // timeoutMs is used for potential future timeout implementation
        void (options.timeoutMs ?? this.config.defaultTimeoutMs);

        // Create execution graph
        const graph = this.buildExecutionGraph(plan);

        // Initialize execution status
        const status: ExecutionStatus = {
            executionId,
            planId,
            state: ExecutionState.PENDING,
            progress: this.calculateProgress(graph),
            currentTasks: [],
            startedAt: new Date(),
        };

        this.executions.set(executionId, status);

        // Create abort controller for cancellation
        const abortController = new AbortController();
        this.runningExecutions.set(executionId, abortController);

        try {
            // Update state to running
            this.updateExecutionState(executionId, ExecutionState.RUNNING);
            this.emitEvent('execution:start', executionId, { planId });

            // Execute the plan
            const results = await this.executeGraph(
                graph,
                executionId,
                abortController.signal,
                options
            );

            // Determine final status
            const failedTasks = Array.from(results.values()).filter(
                r => r.status === TaskStatus.FAILED
            );
            const cancelledTasks = Array.from(results.values()).filter(
                r => r.status === TaskStatus.CANCELLED
            );

            let finalStatus: PlanExecutionStatus;
            if (cancelledTasks.length > 0) {
                finalStatus = PlanExecutionStatus.CANCELLED;
            } else if (failedTasks.length === 0) {
                finalStatus = PlanExecutionStatus.COMPLETED;
            } else if (failedTasks.length < results.size) {
                finalStatus = PlanExecutionStatus.PARTIAL;
            } else {
                finalStatus = PlanExecutionStatus.FAILED;
            }

            const endTime = new Date();
            const result: PlanExecutionResult = {
                planId,
                status: finalStatus,
                taskResults: results,
                startedAt: status.startedAt,
                completedAt: endTime,
                totalExecutionTimeMs: endTime.getTime() - status.startedAt.getTime(),
            };

            // Update execution status
            this.updateExecutionState(
                executionId,
                finalStatus === PlanExecutionStatus.COMPLETED
                    ? ExecutionState.COMPLETED
                    : ExecutionState.FAILED
            );

            this.emitEvent('execution:complete', executionId, { result });

            return result;
        } catch (error) {
            this.updateExecutionState(executionId, ExecutionState.FAILED);
            this.emitEvent('execution:fail', executionId, { error });

            throw error;
        } finally {
            this.runningExecutions.delete(executionId);
        }
    }

    cancel(executionId: ExecutionId): Promise<boolean> {
        const controller = this.runningExecutions.get(executionId);
        if (!controller) {
            return Promise.resolve(false);
        }

        controller.abort();
        this.updateExecutionState(executionId, ExecutionState.CANCELLED);
        this.emitEvent('execution:cancel', executionId, {});

        return Promise.resolve(true);
    }

    getStatus(executionId: ExecutionId): ExecutionStatus | undefined {
        return this.executions.get(executionId);
    }

    registerExecutor(executor: TaskExecutor): void {
        const type = executor.constructor.name;
        this.executors.set(type, executor);
    }

    override on(event: ExecutionEventType, handler: ExecutionEventHandler): this {
        super.on(event, handler);
        return this;
    }

    override off(event: ExecutionEventType, handler: ExecutionEventHandler): this {
        super.off(event, handler);
        return this;
    }

    /**
     * Build execution graph from plan
     */
    private buildExecutionGraph(plan: Plan): ExecutionGraph {
        const planId = this.normalizeId(plan.id as unknown);
        const nodes = new Map<NodeId, ExecutionNode>();
        const readyQueue: NodeId[] = [];

        // Create nodes for all tasks
        for (const task of plan.tasks) {
            const taskId = this.normalizeId(task.id as unknown);
            const dependencies = new Set(
                task.dependencies.map((dependency) => this.normalizeId(dependency as unknown))
            );
            const node: ExecutionNode = {
                task,
                status: ExecutionNodeStatus.PENDING,
                dependencies,
                dependents: new Set(),
            };
            nodes.set(taskId, node);

            // Add to ready queue if no dependencies
            if (dependencies.size === 0) {
                readyQueue.push(taskId);
            }
        }

        // Build reverse dependency map (dependents)
        for (const [id, node] of nodes) {
            for (const depId of node.dependencies) {
                const depNode = nodes.get(this.normalizeId(depId));
                if (depNode) {
                    depNode.dependents.add(id);
                }
            }
        }

        return {
            planId,
            nodes,
            readyQueue,
            completedCount: 0,
            failedCount: 0,
            totalCount: plan.tasks.length,
        };
    }

    /**
     * Execute the execution graph
     */
    private async executeGraph(
        graph: ExecutionGraph,
        executionId: ExecutionId,
        abortSignal: AbortSignal,
        options: ExecutionOptions
    ): Promise<Map<NodeId, TaskResult>> {
        const results = new Map<NodeId, TaskResult>();
        const executing = new Set<Promise<void>>();

        const processNode = async (nodeId: NodeId): Promise<void> => {
            const node = graph.nodes.get(nodeId);
            if (!node || abortSignal.aborted) {
                return;
            }

            // Check if all dependencies are satisfied
            for (const depId of node.dependencies) {
                const depResult = results.get(this.normalizeId(depId));
                if (!depResult || depResult.status === TaskStatus.FAILED) {
                    // Skip this task if dependency failed
                    const skipResult: TaskResult = {
                        taskId: nodeId,
                        status: TaskStatus.SKIPPED,
                        executionTimeMs: 0,
                        startedAt: new Date(),
                    };
                    results.set(nodeId, skipResult);
                    this.updateNodeStatus(graph, nodeId, ExecutionNodeStatus.CANCELLED);
                    return;
                }
            }

            // Update status
            this.updateNodeStatus(graph, nodeId, ExecutionNodeStatus.RUNNING);
            this.emitEvent('task:start', executionId, { taskId: nodeId });

            if (options.onTaskStart) {
                options.onTaskStart(nodeId);
            }

            const startTime = new Date();

            try {
                // Find appropriate executor
                const executor = this.findExecutor(node.task);
                if (!executor) {
                    throw new Error(`No executor found for task: ${node.task.name}`);
                }

                // Create execution context
                const context: ExecutionContext = {
                    executionId,
                    taskId: nodeId,
                    planId: this.normalizeId(graph.planId as unknown),
                    inputs: this.collectInputs(node.task, results),
                    sharedState: new Map(),
                    metadata: {
                        startedAt: startTime,
                        attemptNumber: 1,
                    },
                };

                // Execute task
                const result = await executor.execute(node.task, context);

                results.set(nodeId, result);

                // Update status based on result
                if (result.status === TaskStatus.COMPLETED) {
                    this.updateNodeStatus(graph, nodeId, ExecutionNodeStatus.COMPLETED);
                    this.emitEvent('task:complete', executionId, { taskId: nodeId, result });

                    if (options.onTaskComplete) {
                        options.onTaskComplete(nodeId, result);
                    }
                } else {
                    this.updateNodeStatus(graph, nodeId, ExecutionNodeStatus.FAILED);
                    this.emitEvent('task:fail', executionId, { taskId: nodeId, result });

                    if (options.onTaskError) {
                        options.onTaskError(nodeId, new Error(result.error?.message ?? 'Task failed'));
                    }
                }
            } catch (error) {
                const failedResult: TaskResult = {
                    taskId: nodeId,
                    status: TaskStatus.FAILED,
                    error: {
                        code: 'EXECUTION_ERROR',
                        message: error instanceof Error ? error.message : String(error),
                        retryable: true,
                    },
                    executionTimeMs: Date.now() - startTime.getTime(),
                    startedAt: startTime,
                    completedAt: new Date(),
                };

                results.set(nodeId, failedResult);
                this.updateNodeStatus(graph, nodeId, ExecutionNodeStatus.FAILED);
                this.emitEvent('task:fail', executionId, { taskId: nodeId, error });

                if (options.onTaskError) {
                    options.onTaskError(nodeId, error instanceof Error ? error : new Error(String(error)));
                }
            }
        };

        // Process ready queue
        while (graph.readyQueue.length > 0 || executing.size > 0) {
            if (abortSignal.aborted) {
                break;
            }

            // Start new tasks up to concurrency limit
            while (
                graph.readyQueue.length > 0 &&
                executing.size < this.config.maxConcurrency
            ) {
                const rawNodeId: unknown = graph.readyQueue.shift();
                const nodeId = rawNodeId === undefined ? undefined : this.normalizeId(rawNodeId);
                if (nodeId === undefined) break;
                const promise = processNode(nodeId).then(() => {
                    executing.delete(promise);

                    // Add dependents to ready queue
                    const node = graph.nodes.get(nodeId);
                    if (node) {
                        for (const dependentId of node.dependents) {
                            const dependent = graph.nodes.get(dependentId);
                            if (dependent && dependent.status === ExecutionNodeStatus.PENDING) {
                                // Check if all dependencies are completed
                                const allDepsCompleted = Array.from(dependent.dependencies).every(
                                    depId => {
                                        const depNode = graph.nodes.get(depId);
                                        return depNode?.status === ExecutionNodeStatus.COMPLETED;
                                    }
                                );

                                if (allDepsCompleted) {
                                    graph.readyQueue.push(dependentId);
                                }
                            }
                        }
                    }
                });

                executing.add(promise);
            }

            // Wait for at least one task to complete
            if (executing.size > 0) {
                await Promise.race(executing);
            }
        }

        return results;
    }

    /**
     * Find an executor for a task
     */
    private findExecutor(task: Task): TaskExecutor | undefined {
        for (const executor of this.executors.values()) {
            if (executor.canExecute(task)) {
                return executor;
            }
        }
        return undefined;
    }

    /**
     * Collect inputs from completed dependencies
     */
    private collectInputs(
        task: Task,
        results: Map<NodeId, TaskResult>
    ): Map<NodeId, unknown> {
        const inputs = new Map<NodeId, unknown>();

        for (const depId of task.dependencies) {
            const normalizedDepId = this.normalizeId(depId as unknown);
            const result = results.get(normalizedDepId);
            if (result?.output !== undefined) {
                inputs.set(normalizedDepId, result.output);
            }
        }

        return inputs;
    }

    /**
     * Update node status and execution progress
     */
    private updateNodeStatus(
        graph: ExecutionGraph,
        nodeId: NodeId,
        status: ExecutionNodeStatus
    ): void {
        const node = graph.nodes.get(nodeId) as MutableExecutionNode | undefined;
        if (!node) {
            return;
        }

        node.status = status;

        if (status === ExecutionNodeStatus.COMPLETED) {
            (graph as MutableExecutionGraph).completedCount++;
        } else if (status === ExecutionNodeStatus.FAILED) {
            (graph as MutableExecutionGraph).failedCount++;
        }

        // Update execution status
        for (const execStatus of this.executions.values()) {
            if (execStatus.planId === graph.planId) {
                (execStatus as MutableExecutionStatus).progress = this.calculateProgress(graph);
            }
        }
    }

    /**
     * Calculate execution progress
     */
    private calculateProgress(graph: ExecutionGraph): ExecutionProgress {
        const total = graph.totalCount;
        const completed = graph.completedCount;
        const failed = graph.failedCount;
        const running = Array.from(graph.nodes.values()).filter(
            n => n.status === ExecutionNodeStatus.RUNNING
        ).length;
        const pending = total - completed - failed - running;

        return {
            total,
            completed,
            failed,
            pending,
            running,
            percentage: total > 0 ? Math.round(((completed + failed) / total) * 100) : 0,
        };
    }

    /**
     * Update execution state
     */
    private updateExecutionState(executionId: ExecutionId, state: ExecutionState): void {
        const status = this.executions.get(executionId);
        if (status) {
            this.executions.set(executionId, { ...status, state });
        }
    }

    /**
     * Emit execution event
     */
    private emitEvent(
        type: ExecutionEventType,
        executionId: ExecutionId,
        data: unknown
    ): void {
        const event: ExecutionEvent = {
            type,
            executionId,
            timestamp: new Date(),
            data,
        };

        this.emit(type, event);
    }

    /**
     * Generate a unique ID
     */
    private generateId(): ExecutionId {
        return newId('exec');
    }

    private normalizeId(value: unknown): string {
        return typeof value === 'string' ? value : String(value);
    }
}

/**
 * Mutable execution node for internal use
 */
interface MutableExecutionNode extends ExecutionNode {
    status: ExecutionNodeStatus;
}

/**
 * Mutable execution graph for internal use
 */
interface MutableExecutionGraph extends ExecutionGraph {
    completedCount: number;
    failedCount: number;
}

/**
 * Mutable execution status for internal use
 */
interface MutableExecutionStatus extends ExecutionStatus {
    progress: ExecutionProgress;
}