/**
 * @personaforge/execution — task-scheduling & step-workflow engine.
 *
 * This engine models work as *plans of tasks* and *step workflows* with a
 * concurrency-controlled scheduler, a real OS-thread pool for CPU-bound jobs,
 * and a state-machine graph with checkpointing. Reach for `personaforge/execution`
 * when you want an imperative plan/step DSL and parallel task fan-out.
 *
 * NOTE ON NAMING: this module's `EventStore` / `InMemoryEventStore` /
 * `ExecutionStatus` are DIFFERENT types from the same-named exports in
 * `personaforge/graph` (the event-sourced substrate engine). They are not
 * interchangeable — do not cross-import. If you need deterministic replay,
 * audit, or time-travel, use `personaforge/graph` instead. See
 * docs/superpowers/specs/2026-07-23-consolidation-and-path-to-1.md §3.2.
 *
 * Capabilities:
 *   - ExecutionEngineImpl: Task-based plan execution
 *   - ExecutionGraphBuilder: Build DAG execution graphs from plans
 *   - WorkerPool: Logical (Promise) parallel task scheduling with concurrency control
 *   - ThreadPool: Real OS-thread parallelism (node:worker_threads) for CPU-bound jobs
 *   - StepWorkflow: Fluent step-chaining DSL
 *   - StateGraph + WorkflowExecutor: State-machine graph workflows with checkpointing
 *   - StepExecutor + PipelineBuilder: Event-driven v2 engine with backpressure
 *
 * @experimental The durable execution engine and v2 pipeline are newer and not
 * yet semver-stable — their APIs (event-store contracts, engine config) may
 * change in a minor release.
 */

export * from './types.js';
export { ExecutionEngineImpl } from './engine.js';
export { ExecutionGraphBuilder } from './graph-builder.js';
export { WorkerPool } from './worker-pool.js';

// Real OS-thread parallelism for CPU-bound pure functions (opt-in).
export { ThreadPool, createThreadPool } from './thread-pool.js';
export type { ThreadPoolOptions, ThreadJob } from './thread-pool.js';

// Step-chaining workflows
export {
    createWorkflow as createStepWorkflow,
    createStep,
    Workflow as StepWorkflow,
    WorkflowBuilder as StepWorkflowBuilder,
} from './workflow.js';
export type {
    WorkflowConfig as StepWorkflowConfig,
    StepConfig,
    WorkflowStep as StepWorkflowStep,
    ParallelStepGroup,
    StepResult,
    WorkflowExecutionResult,
    WorkflowStepStatus,
    StepExecutionContext,
} from './workflow.js';

// Graph-based state management
export {
    StateGraph,
    StateNode,
    WorkflowStatus,
    NodeType,
    TransitionType,
    WorkflowExecutor,
    InMemoryCheckpointStore as GraphCheckpointStore,
} from './state-graph.js';
export type {
    NodeExecutionRecord,
    WorkflowError,
    StateNodeConfig,
    TransitionConfig,
    WorkflowConfig,
    WorkflowExecutorConfig,
    StateGraphSnapshot,
    RetryPolicyConfig,
    CheckpointStore,
    WorkflowContext,
    WorkflowExecutorResult,
} from './state-graph.js';

// Event-driven execution engine v2
export {
    StepExecutor,
    PipelineBuilder,
    executeParallel,
    BackpressureQueue,
    EngineEvent,
    StepPriority,
} from './engine-v2.js';
export type {
    StepConfig as StepExecutorStepConfig,
    StepContext,
    StepResult as StepExecutorResult,
    StepErrorPolicy,
    StepExecutorConfig,
    WorkflowExecutionResultV2,
    ExecutionStatus,
    QueuedStep,
    EngineEventPayload,
    EngineEventType,
} from './engine-v2.js';

// Durable Execution Engine (P0)
export {
    DurableRuntime,
    DurableWorkflowContext,
    InMemoryEventStore,
    WorkflowPausedError,
    WorkflowStateError,
} from './durable.js';
export type {
    WorkflowEventType,
    WorkflowEvent,
    EventStore,
    DurableRetryPolicy,
    WorkflowFunction,
} from './durable.js';

// Lightweight Agent State Machine (P1)
export {
    AgentStateMachine,
    stateMachine,
} from './state-machine.js';
export type {
    AgentLifecycleState,
    StateHandler,
    StateMachineConfig,
    StateMachineOptions,
    StateMachineSnapshot,
} from './state-machine.js';
