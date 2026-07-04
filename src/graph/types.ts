/**
 * Graph Execution Engine — Core Type Definitions
 *
 * This is the foundation of the DAG-based execution engine.
 * All types are dependency-free — no imports from other modules.
 *
 * Design decisions:
 * - Branded types for IDs to prevent mixing node/edge/execution IDs
 * - Discriminated unions for node types enable exhaustive pattern matching
 * - All timestamps are numbers (Date.now()) for serialization efficiency
 * - Maps use plain objects for JSON-safe snapshots
 */

// ── Branded ID Types ────────────────────────────────────────────────────────

export type NodeId = string & { readonly __brand: 'NodeId' };
export type EdgeId = string & { readonly __brand: 'EdgeId' };
export type GraphId = string & { readonly __brand: 'GraphId' };
export type ExecutionId = string & { readonly __brand: 'ExecutionId' };
export type WorkerId = string & { readonly __brand: 'WorkerId' };

import { newId } from '../contracts/index.js';

export function uid(prefix = ''): string {
  return newId(prefix || undefined);
}

export const nodeId = (s?: string): NodeId => (s ?? uid('n')) as NodeId;
export const edgeId = (s?: string): EdgeId => (s ?? uid('e')) as EdgeId;
export const graphId = (s?: string): GraphId => (s ?? uid('g')) as GraphId;
export const executionId = (s?: string): ExecutionId => (s ?? uid('x')) as ExecutionId;
export const workerId = (s?: string): WorkerId => (s ?? uid('w')) as WorkerId;

// ── Node Types ──────────────────────────────────────────────────────────────

export enum NodeKind {
  /** Executes an async function */
  TASK = 'task',
  /** Routes to different branches based on condition */
  ROUTER = 'router',
  /** Fans out to multiple parallel branches */
  PARALLEL = 'parallel',
  /** Waits for all incoming branches to complete */
  JOIN = 'join',
  /** Calls a sub-graph */
  SUBGRAPH = 'subgraph',
  /** Invokes an LLM agent */
  AGENT = 'agent',
  /** Waits for external input (human-in-the-loop, webhook) */
  WAIT = 'wait',
  /** Entry point */
  START = 'start',
  /** Terminal node */
  END = 'end',
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMs: number;
  maxBackoffMs?: number;
  exponentialBase?: number;
  retryOn?: (error: unknown) => boolean;
}

export interface TimeoutPolicy {
  timeoutMs: number;
  onTimeout?: 'fail' | 'skip' | 'retry';
}

/**
 * Base node definition. Each node in the graph is one of these.
 */
export interface GraphNodeDef<TInput = unknown, TOutput = unknown> {
  id: NodeId;
  kind: NodeKind;
  name: string;
  description?: string;

  /** The actual execution function */
  execute?: (ctx: NodeContext<TInput>) => Promise<TOutput>;

  /** For ROUTER nodes: determines which edge to follow */
  route?: (ctx: NodeContext<TInput>) => Promise<string>;

  /** For AGENT nodes: agent configuration */
  agentConfig?: AgentNodeConfig;

  /** For SUBGRAPH nodes: the sub-graph to execute */
  subgraphId?: GraphId;

  /** For WAIT nodes: what to wait for */
  waitConfig?: WaitConfig;

  /** Retry policy for this node */
  retry?: RetryPolicy;

  /** Timeout configuration */
  timeout?: TimeoutPolicy;

  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

export interface AgentNodeConfig {
  /** Which LLM provider to use */
  provider?: string;
  /** System prompt / instructions */
  instructions?: string;
  /** Tool names available to this agent */
  tools?: string[];
  /** Max LLM turns */
  maxSteps?: number;
  /** Temperature */
  temperature?: number;
  /** Model name override */
  model?: string;
}

export interface WaitConfig {
  /** Type of wait */
  type: 'human' | 'webhook' | 'timer' | 'signal';
  /** For timer: milliseconds to wait */
  delayMs?: number;
  /** For signal: signal name to wait for */
  signalName?: string;
  /** Timeout for the wait */
  timeoutMs?: number;
}

// ── Edge Types ──────────────────────────────────────────────────────────────

export interface GraphEdgeDef {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  /** For conditional routing: the route label this edge matches */
  label?: string;
  /** Optional guard: edge only taken if condition returns true */
  condition?: (state: GraphState) => Promise<boolean> | boolean;
  /** Priority when multiple edges match (lower = higher priority) */
  priority?: number;
  /** Transform state before passing to target node */
  transform?: (state: GraphState) => GraphState;
}

// ── Graph Definition ────────────────────────────────────────────────────────

export interface GraphDef {
  id: GraphId;
  name: string;
  description?: string;
  version?: string;

  nodes: Map<NodeId, GraphNodeDef>;
  edges: Map<EdgeId, GraphEdgeDef>;

  /** Adjacency list: nodeId -> outgoing edgeIds */
  outgoing: Map<NodeId, EdgeId[]>;
  /** Reverse adjacency: nodeId -> incoming edgeIds */
  incoming: Map<NodeId, EdgeId[]>;

  /** Entry point node */
  startNodeId: NodeId;

  /** Default retry policy for all nodes */
  defaultRetry?: RetryPolicy;
  /** Default timeout for all nodes */
  defaultTimeout?: TimeoutPolicy;
  /** Max concurrent node executions */
  maxConcurrency?: number;

  metadata?: Record<string, unknown>;
}

// ── Execution State ─────────────────────────────────────────────────────────

export enum NodeStatus {
  PENDING = 'pending',
  READY = 'ready',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
  WAITING = 'waiting',
  CANCELLED = 'cancelled',
  RETRYING = 'retrying',
}

export enum ExecutionStatus {
  CREATED = 'created',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  SUSPENDED = 'suspended',
}

export interface NodeState {
  nodeId: NodeId;
  status: NodeStatus;
  attempts: number;
  output?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
  workerId?: WorkerId;
}

/**
 * The graph-level shared state. This is the "blackboard" that nodes
 * read from and write to. It's a plain object for easy serialization.
 */
export interface GraphState {
  /** Execution-level variables (set by user or accumulated by nodes) */
  variables: Record<string, unknown>;
  /** Per-node outputs keyed by node name */
  results: Record<string, unknown>;
  /** Per-node execution states */
  nodes: Record<string, NodeState>;
  /** Current execution status */
  status: ExecutionStatus;
  /** Current set of active (running) node IDs */
  activeNodes: string[];
  /** Error if execution failed */
  error?: string;
}

// ── Node Execution Context ──────────────────────────────────────────────────

export interface NodeContext<TInput = unknown> {
  /** The execution ID */
  executionId: ExecutionId;
  /** This node's ID */
  nodeId: NodeId;
  /** This node's name */
  nodeName: string;
  /** Input data (from upstream nodes or initial variables) */
  input: TInput;
  /** Full graph state (read-only snapshot) */
  state: Readonly<GraphState>;
  /** Set a variable in the graph state */
  setVariable: (key: string, value: unknown) => void;
  /** Get a variable from the graph state */
  getVariable: <T = unknown>(key: string) => T | undefined;
  /** Get the output of a specific node */
  getNodeOutput: <T = unknown>(nodeName: string) => T | undefined;
  /** Abort signal for cancellation */
  signal: AbortSignal;
  /** Emit a custom event */
  emit: (event: string, data?: unknown) => void;
  /** Logger scoped to this node */
  log: NodeLogger;
  /** Attempt number (starts at 1) */
  attempt: number;
  /** Metadata bag */
  metadata: Record<string, unknown>;
}

export interface NodeLogger {
  debug: (msg: string, data?: Record<string, unknown>) => void;
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
}

// ── Events (for event sourcing + observability) ─────────────────────────────

export enum GraphEventType {
  // Execution lifecycle
  EXECUTION_STARTED = 'execution.started',
  EXECUTION_COMPLETED = 'execution.completed',
  EXECUTION_FAILED = 'execution.failed',
  EXECUTION_PAUSED = 'execution.paused',
  EXECUTION_RESUMED = 'execution.resumed',
  EXECUTION_CANCELLED = 'execution.cancelled',

  // Node lifecycle
  NODE_ENQUEUED = 'node.enqueued',
  NODE_STARTED = 'node.started',
  NODE_COMPLETED = 'node.completed',
  NODE_FAILED = 'node.failed',
  NODE_RETRYING = 'node.retrying',
  NODE_SKIPPED = 'node.skipped',
  NODE_WAITING = 'node.waiting',
  NODE_CANCELLED = 'node.cancelled',

  // State changes
  STATE_UPDATED = 'state.updated',
  VARIABLE_SET = 'state.variable_set',

  // Routing
  EDGE_TAKEN = 'edge.taken',
  ROUTE_DECIDED = 'route.decided',

  // System
  CHECKPOINT_SAVED = 'checkpoint.saved',
  CHECKPOINT_LOADED = 'checkpoint.loaded',
  SIGNAL_RECEIVED = 'signal.received',

  // Agent-level (the single-agent runner emits these into the same log)
  AGENT_STARTED = 'agent.started',
  AGENT_COMPLETED = 'agent.completed',
  LLM_CALL = 'llm.call',
  TOOL_CALL = 'tool.call',
}

export interface GraphEvent {
  id: string;
  type: GraphEventType;
  executionId: ExecutionId;
  graphId: GraphId;
  timestamp: number;
  /** Monotonic sequence number within an execution */
  sequence: number;
  /** The node this event relates to (if any) */
  nodeId?: NodeId;
  /** Event-specific payload */
  data?: Record<string, unknown>;
}

// ── Event Store (for durability) ────────────────────────────────────────────

export interface EventStore {
  /** Append events (must be idempotent on event.id) */
  append(events: GraphEvent[]): Promise<void>;
  /** Load all events for an execution, ordered by sequence */
  load(executionId: ExecutionId): Promise<GraphEvent[]>;
  /** Load events after a specific sequence number */
  loadAfter(executionId: ExecutionId, afterSequence: number): Promise<GraphEvent[]>;
  /** Get the latest snapshot/checkpoint */
  getCheckpoint(executionId: ExecutionId): Promise<Checkpoint | null>;
  /** Save a checkpoint */
  saveCheckpoint(checkpoint: Checkpoint): Promise<void>;
  /**
   * Permanently erase all events and checkpoints for an execution
   * (right-to-erasure / GDPR / DPDP). Optional — stores that cannot delete
   * omit it. Breaks the append-only guarantee by design, for compliance.
   */
  purge?(executionId: ExecutionId): Promise<void>;
}

export interface Checkpoint {
  executionId: ExecutionId;
  graphId: GraphId;
  state: GraphState;
  sequence: number;
  timestamp: number;
}

// ── Scheduler & Worker Contracts ────────────────────────────────────────────

export interface TaskEnvelope {
  executionId: ExecutionId;
  graphId: GraphId;
  nodeId: NodeId;
  nodeDef: GraphNodeDef;
  input: unknown;
  state: GraphState;
  attempt: number;
  /** Idempotency key to prevent duplicate execution */
  idempotencyKey: string;
}

export interface TaskResult {
  executionId: ExecutionId;
  nodeId: NodeId;
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
  workerId?: WorkerId;
  /** State mutations to apply */
  mutations?: StateMutation[];
}

export interface StateMutation {
  type: 'set_variable' | 'set_result';
  key: string;
  value: unknown;
}

/**
 * Queue abstraction for distributed execution.
 * Implementations: InMemory, Redis (BullMQ), Kafka, SQS
 */
export interface TaskQueue {
  /** Enqueue a task for execution */
  enqueue(task: TaskEnvelope): Promise<void>;
  /** Register a worker to process tasks */
  consume(handler: (task: TaskEnvelope) => Promise<TaskResult>): Promise<void>;
  /** Acknowledge task completion */
  ack(executionId: ExecutionId, nodeId: NodeId): Promise<void>;
  /** Return task to queue (nack) */
  nack(executionId: ExecutionId, nodeId: NodeId, delayMs?: number): Promise<void>;
  /** Get queue depth */
  depth(): Promise<number>;
  /** Graceful shutdown */
  close(): Promise<void>;
}

/**
 * Scheduler decides which nodes are ready and dispatches them.
 */
export interface Scheduler {
  /** Given current state + graph, return nodes ready to execute */
  getReadyNodes(graph: GraphDef, state: GraphState): NodeId[];
  /** Dispatch a ready node to the queue */
  dispatch(envelope: TaskEnvelope): Promise<void>;
  /** Handle a completed task result */
  handleResult(result: TaskResult): Promise<void>;
}

// ── Graph Builder Fluent API ────────────────────────────────────────────────

export interface GraphBuilderNode<TInput = unknown, TOutput = unknown> {
  id: NodeId;
  kind: NodeKind;
  name: string;
  config: Partial<GraphNodeDef<TInput, TOutput>>;
}

// ── Plugin Types ────────────────────────────────────────────────────────────

export interface GraphPlugin {
  name: string;
  /** Called before execution starts */
  onExecutionStart?: (executionId: ExecutionId, graph: GraphDef, state: GraphState) => Promise<void> | void;
  /** Called before each node executes */
  onNodeStart?: (nodeId: NodeId, ctx: NodeContext) => Promise<void> | void;
  /** Called after each node completes */
  onNodeComplete?: (nodeId: NodeId, result: unknown, durationMs: number) => Promise<void> | void;
  /** Called when a node fails */
  onNodeError?: (nodeId: NodeId, error: unknown, attempt: number) => Promise<void> | void;
  /** Called when execution completes */
  onExecutionComplete?: (executionId: ExecutionId, state: GraphState, durationMs: number) => Promise<void> | void;
  /** Called on every event (for custom event processing) */
  onEvent?: (event: GraphEvent) => Promise<void> | void;
}

// ── Graph-Specific KV Store Types ─────────────────────────────────────────────
//
// These are the graph engine's KV-style memory interfaces. They differ from
// the core `memory/types.ts` MemoryStore (which tracks MemoryEntry objects
// with embeddings, types, and timestamps) — the graph KVStore is a simpler
// key-value abstraction used for ephemeral per-execution state.
//
// Canonical core types:
//   import type { KVStore } from '../contracts/index.js';

export interface KVStore {
  /** Get a value by key */
  get<T = unknown>(key: string): Promise<T | undefined>;
  /** Set a value */
  set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void>;
  /** Delete a key */
  delete(key: string): Promise<boolean>;
  /** Check if key exists */
  has(key: string): Promise<boolean>;
  /** List keys matching a prefix */
  keys(prefix?: string): Promise<string[]>;
  /** Clear all entries */
  clear(): Promise<void>;
}

export interface VectorMemory {
  /** Store a vector with metadata */
  store(id: string, vector: number[], metadata?: Record<string, unknown>): Promise<void>;
  /** Search for similar vectors */
  search(vector: number[], topK?: number, filter?: Record<string, unknown>): Promise<VectorSearchResult[]>;
  /** Delete a vector */
  delete(id: string): Promise<void>;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

// ── Graph-Specific LLM Types ────────────────────────────────────────────────
//
// The graph engine uses a simplified LLM interface (`generate()` with `LLMMessage[]`)
// that is structurally different from the canonical `providers/types.ts` LLMProvider
// (which uses `generateText()` with `Message[]`).
//
// To bridge a canonical provider into the graph engine, use:
//   const graphLlm: LLMProvider = {
//     name: 'my-llm',
//     generate: (msgs, opts) => coreProvider.generateText(
//       msgs.map(m => ({ role: m.role, content: m.content })),
//       opts,
//     ).then(r => ({ content: r.text, toolCalls: ..., usage: r.usage })),
//   };
//
// Canonical core types:
//   import type { LLMProvider as CoreLLMProvider } from '../providers/types.js';
//   import type { Message } from '../providers/types.js';

export interface LLMProvider {
  name: string;
  generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse>;
  stream?(messages: LLMMessage[], options?: LLMOptions): AsyncIterable<LLMChunk>;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: LLMToolCall[];
}

export interface LLMToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: LLMToolDef[];
  responseFormat?: { type: 'json_object' | 'text' };
  stop?: string[];
}

export interface LLMToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMResponse {
  content: string;
  toolCalls?: LLMToolCall[];
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'content_filter';
  model?: string;
}

export interface LLMChunk {
  content?: string;
  toolCalls?: Partial<LLMToolCall>[];
  finishReason?: string;
}

// ── Graph-Specific Tool Types ───────────────────────────────────────────────
//
// The graph engine's ToolDef is a simpler interface than the canonical
// `tools/core/types.ts` Tool (which has Zod schemas, permissions, categories,
// versioning, and validation). This is intentional — graph tools are
// lightweight function descriptors for the orchestrator's ReAct loop.
//
// Canonical core types:
//   import type { Tool } from '../tools/core/types.js';
//   import type { ToolContext as CoreToolContext } from '../tools/core/types.js';

export interface ToolDef<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (input: TInput, ctx?: ToolContext) => Promise<TOutput>;
  /** If true, requires human approval before execution */
  needsApproval?: boolean;
}

export interface ToolContext {
  executionId?: ExecutionId;
  nodeId?: NodeId;
  agentName?: string;
  metadata?: Record<string, unknown>;
}

