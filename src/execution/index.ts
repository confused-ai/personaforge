/**
 * @personaforge/execution — Event-driven workflow and graph execution engine.
 *
 * Capabilities:
 *   - ExecutionEngineImpl: Task-based plan execution
 *   - ExecutionGraphBuilder: Build DAG execution graphs from plans
 *   - WorkerPool: Parallel task execution with concurrency control
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
