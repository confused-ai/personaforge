/**
 * Graph-based State Management for Agent Workflows
 *
 * A DAG-based state machine where:
 * - Each node is a workflow step/state
 * - Edges represent transitions with conditions
 * - Branches can execute in parallel
 * - State is fully durable and replayable
 */

import { EntityId, generateEntityId } from '../core/index.js';

// ── State Graph Core Types ──────────────────────────────────────────────────

export enum NodeType {
  TASK = 'task',
  DECISION = 'decision',
  PARALLEL = 'parallel',
  MERGE = 'merge',
  START = 'start',
  END = 'end',
}

export enum TransitionType {
  UNCONDITIONAL = 'unconditional',
  CONDITIONAL = 'conditional',
  TIMEOUT = 'timeout',
  ERROR = 'error',
  SUCCESS = 'success',
}

export interface StateNodeConfig {
  id?: EntityId;
  type: NodeType;
  name: string;
  description?: string;
  entry?: (ctx: WorkflowContext) => Promise<unknown>;
  exit?: (ctx: WorkflowContext, result: unknown) => Promise<void>;
  timeoutMs?: number;
  retryPolicy?: RetryPolicyConfig;
  metadata?: Record<string, unknown>;
}

export interface TransitionConfig {
  from: EntityId;
  to: EntityId;
  type: TransitionType;
  condition?: (ctx: WorkflowContext) => Promise<boolean>;
  timeout?: number;
  guard?: string;
  metadata?: Record<string, unknown>;
}

export interface RetryPolicyConfig {
  maxRetries: number;
  backoffMs: number;
  maxBackoffMs?: number;
  exponentialBase?: number;
}

export interface WorkflowContext {
  workflowId: EntityId;
  executionId: EntityId;
  currentNodeId: EntityId;
  variables: Map<string, unknown>;
  history: NodeExecutionRecord[];
  startedAt: Date;
  metadata: Record<string, unknown>;
}

export interface NodeExecutionRecord {
  nodeId: EntityId;
  startedAt: Date;
  completedAt?: Date;
  result?: unknown;
  error?: WorkflowError;
  attempts: number;
}

export interface WorkflowError {
  code: string;
  message: string;
  nodeId: EntityId;
  retryable: boolean;
  cause?: unknown;
}

export interface StateGraphSnapshot {
  workflowId: EntityId;
  executionId: EntityId;
  currentNodes: EntityId[];
  activeBranches: EntityId[];
  variables: Record<string, unknown>;
  history: NodeExecutionRecord[];
  status: WorkflowStatus;
}

export enum WorkflowStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export interface WorkflowConfig {
  id?: EntityId;
  name: string;
  description?: string;
  nodes: StateNodeConfig[];
  transitions: TransitionConfig[];
  initialNode?: EntityId;
  contextTimeoutMs?: number;
  maxConcurrency?: number;
  onNodeStart?: (nodeId: EntityId, ctx: WorkflowContext) => void;
  onNodeComplete?: (nodeId: EntityId, result: unknown, ctx: WorkflowContext) => void;
  onNodeError?: (nodeId: EntityId, error: WorkflowError, ctx: WorkflowContext) => void;
  onTransition?: (from: EntityId, to: EntityId, ctx: WorkflowContext) => void;
  onWorkflowComplete?: (ctx: WorkflowContext) => void;
  onWorkflowError?: (error: WorkflowError, ctx: WorkflowContext) => void;
}

// ── Graph Building ─────────────────────────────────────────────────────────

export class StateGraph {
  readonly id: EntityId;
  readonly name: string;
  readonly description?: string;

  private nodes: Map<EntityId, StateNode> = new Map();
  private adjacencyList: Map<EntityId, Set<EntityId>> = new Map();
  private incomingEdges: Map<EntityId, Set<EntityId>> = new Map();
  private initialNodeId?: EntityId;

  constructor(config: { id?: EntityId; name: string; description?: string }) {
    this.id = config.id ?? generateEntityId();
    this.name = config.name;
    this.description = config.description;
  }

  addNode(nodeConfig: StateNodeConfig): StateGraph {
    const node = new StateNode(nodeConfig);
    this.nodes.set(node.id, node);
    this.adjacencyList.set(node.id, new Set());
    this.incomingEdges.set(node.id, new Set());
    if (nodeConfig.type === NodeType.START) {
      this.initialNodeId = node.id;
    }
    return this;
  }

  addTransition(config: TransitionConfig): StateGraph {
    const { from, to } = config;
    if (!this.nodes.has(from)) {
      throw new Error(`Source node "${from}" does not exist`);
    }
    if (!this.nodes.has(to)) {
      throw new Error(`Target node "${to}" does not exist`);
    }

    const fromNode = this.nodes.get(from)!;
    const toNode = this.nodes.get(to)!;

    fromNode.addOutgoing(to);
    toNode.addIncoming(from);
    this.adjacencyList.get(from)!.add(to);
    this.incomingEdges.get(to)!.add(from);

    return this;
  }

  getNode(id: EntityId): StateNode | undefined {
    return this.nodes.get(id);
  }

  getNodes(): StateNode[] {
    return Array.from(this.nodes.values());
  }

  getOutgoing(nodeId: EntityId): EntityId[] {
    return Array.from(this.adjacencyList.get(nodeId) ?? []);
  }

  getIncoming(nodeId: EntityId): EntityId[] {
    return Array.from(this.incomingEdges.get(nodeId) ?? []);
  }

  getInitialNode(): StateNode | undefined {
    if (this.initialNodeId) {
      return this.nodes.get(this.initialNodeId);
    }
    return this.nodes.values().next().value;
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (this.nodes.size === 0) {
      errors.push('Graph must have at least one node');
    }

    const endNodes = Array.from(this.nodes.values()).filter(n => n.type === NodeType.END);

    if (this.nodes.size > 0 && endNodes.length === 0) {
      errors.push('Graph must have at least one END node');
    }

    const reachable = new Set<EntityId>();
    const startNode = this.getInitialNode();
    if (startNode) {
      this.dfsReachable(startNode.id, reachable);
    }

    for (const node of this.nodes.values()) {
      if (node.type !== NodeType.START && !reachable.has(node.id)) {
        errors.push(`Unreachable node: ${node.name} (${node.id})`);
      }
    }

    if (this.hasCycle()) {
      errors.push('Graph contains cycles (DAG required)');
    }

    return { valid: errors.length === 0, errors };
  }

  private dfsReachable(nodeId: EntityId, visited: Set<EntityId>): void {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    for (const nextId of this.adjacencyList.get(nodeId) ?? []) {
      this.dfsReachable(nextId, visited);
    }
  }

  private hasCycle(): boolean {
    const visited = new Set<EntityId>();
    const recursionStack = new Set<EntityId>();

    const dfs = (nodeId: EntityId): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      for (const neighbor of this.adjacencyList.get(nodeId) ?? []) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true;
        } else if (recursionStack.has(neighbor)) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of this.nodes.keys()) {
      if (!visited.has(nodeId)) {
        if (dfs(nodeId)) return true;
      }
    }

    return false;
  }

  getTopologicalOrder(): EntityId[] {
    const inDegree = new Map<EntityId, number>();
    const queue: EntityId[] = [];
    const result: EntityId[] = [];

    for (const nodeId of this.nodes.keys()) {
      inDegree.set(nodeId, this.incomingEdges.get(nodeId)?.size ?? 0);
    }

    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) queue.push(nodeId);
    }

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      result.push(nodeId);

      for (const neighbor of this.adjacencyList.get(nodeId) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          queue.push(neighbor);
        }
      }
    }

    return result;
  }

  toJSON(): object {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      nodes: Array.from(this.nodes.values()).map(n => n.toJSON()),
      transitions: this.getAllTransitions(),
    };
  }

  private getAllTransitions(): object[] {
    const transitions: object[] = [];
    for (const [from, targets] of this.adjacencyList) {
      for (const to of targets) {
        transitions.push({ from, to });
      }
    }
    return transitions;
  }

  static fromJSON(data: { id?: EntityId; name: string; description?: string; nodes: unknown[]; transitions: unknown[] }): StateGraph {
    const graph = new StateGraph({ id: data.id, name: data.name, description: data.description });
    for (const nodeData of data.nodes as any[]) {
      graph.addNode(StateNode.fromJSON(nodeData));
    }
    for (const trans of data.transitions as any[]) {
      graph.addTransition({ from: trans.from, to: trans.to, type: TransitionType.UNCONDITIONAL });
    }
    return graph;
  }
}

export class StateNode {
  readonly id: EntityId;
  readonly type: NodeType;
  readonly name: string;
  readonly description?: string;
  readonly entry?: (ctx: WorkflowContext) => Promise<unknown>;
  readonly exit?: (ctx: WorkflowContext, result: unknown) => Promise<void>;
  readonly timeoutMs?: number;
  readonly retryPolicy?: RetryPolicyConfig;
  readonly metadata: Record<string, unknown>;

  private _outgoing: Set<EntityId> = new Set();
  private _incoming: Set<EntityId> = new Set();

  constructor(config: StateNodeConfig) {
    this.id = config.id ?? generateEntityId();
    this.type = config.type;
    this.name = config.name;
    this.description = config.description;
    this.entry = config.entry;
    this.exit = config.exit;
    this.timeoutMs = config.timeoutMs;
    this.retryPolicy = config.retryPolicy;
    this.metadata = config.metadata ?? {};
  }

  addOutgoing(nodeId: EntityId): void {
    this._outgoing.add(nodeId);
  }

  addIncoming(nodeId: EntityId): void {
    this._incoming.add(nodeId);
  }

  getOutgoing(): Set<EntityId> {
    return new Set(this._outgoing);
  }

  getIncoming(): Set<EntityId> {
    return new Set(this._incoming);
  }

  canExecute(
    history: NodeExecutionRecord[],
    historyByNodeId?: ReadonlyMap<EntityId, NodeExecutionRecord>,
  ): boolean {
    // Fast path: caller supplied an index → O(deps) instead of O(deps · history).
    if (historyByNodeId) {
      for (const incomingId of this._incoming) {
        const record = historyByNodeId.get(incomingId);
        if (!record || record.error) return false;
      }
      return true;
    }
    for (const incomingId of this._incoming) {
      const record = history.find(r => r.nodeId === incomingId);
      if (!record || record.error) {
        return false;
      }
    }
    return true;
  }

  toJSON(): object {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      description: this.description,
      timeoutMs: this.timeoutMs,
      retryPolicy: this.retryPolicy,
      metadata: this.metadata,
      outgoing: Array.from(this._outgoing),
      incoming: Array.from(this._incoming),
    };
  }

  static fromJSON(data: Record<string, unknown>): StateNode {
    return new StateNode({
      id: data.id as string,
      type: data.type as NodeType,
      name: data.name as string,
      description: data.description as string | undefined,
      timeoutMs: data.timeoutMs as number | undefined,
      retryPolicy: data.retryPolicy as RetryPolicyConfig | undefined,
      metadata: data.metadata as Record<string, unknown> | undefined,
    });
  }
}

// ── Workflow Engine ─────────────────────────────────────────────────────────

export interface WorkflowExecutorConfig {
  maxConcurrency?: number;
  defaultTimeoutMs?: number;
  checkpointInterval?: number;
}

export interface WorkflowExecutorResult {
  executionId: EntityId;
  status: WorkflowStatus;
  outputVariables: Record<string, unknown>;
  history: NodeExecutionRecord[];
  totalDurationMs: number;
  error?: WorkflowError;
}

export class WorkflowExecutor {
  private graph: StateGraph;
  private config: Required<WorkflowExecutorConfig>;
  private activeExecutions: Map<EntityId, WorkflowRuntime> = new Map();

  constructor(graph: StateGraph, config: WorkflowExecutorConfig = {}) {
    this.graph = graph;
    this.config = {
      maxConcurrency: config.maxConcurrency ?? 4,
      defaultTimeoutMs: config.defaultTimeoutMs ?? 30000,
      checkpointInterval: config.checkpointInterval ?? 5,
    };
  }

  async execute(
    inputVariables: Record<string, unknown> = {},
    options: { executionId?: EntityId; signal?: AbortSignal } = {}
  ): Promise<WorkflowExecutorResult> {
    const executionId = options.executionId ?? generateEntityId();
    const startNode = this.graph.getInitialNode();

    if (!startNode) {
      throw new Error('Workflow has no start node');
    }

    const ctx: WorkflowContext = {
      workflowId: this.graph.id,
      executionId,
      currentNodeId: startNode.id,
      variables: new Map(Object.entries(inputVariables)),
      history: [],
      startedAt: new Date(),
      metadata: {},
    };

    const runtime = new WorkflowRuntime(this.graph, ctx, this.config, options.signal);
    this.activeExecutions.set(executionId, runtime);

    try {
      const result = await runtime.execute();
      return result;
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  async pause(executionId: EntityId): Promise<boolean> {
    const runtime = this.activeExecutions.get(executionId);
    if (runtime) {
      return runtime.pause();
    }
    return false;
  }

  async resume(executionId: EntityId): Promise<boolean> {
    const runtime = this.activeExecutions.get(executionId);
    if (runtime) {
      return runtime.resume();
    }
    return false;
  }

  async cancel(executionId: EntityId): Promise<boolean> {
    const runtime = this.activeExecutions.get(executionId);
    if (runtime) {
      return runtime.cancel();
    }
    return false;
  }

  getSnapshot(executionId: EntityId): StateGraphSnapshot | undefined {
    const runtime = this.activeExecutions.get(executionId);
    return runtime?.getSnapshot();
  }
}

class WorkflowRuntime {
  private graph: StateGraph;
  private ctx: WorkflowContext;
  private config: Required<WorkflowExecutorConfig>;
  private signal?: AbortSignal;
  private status: WorkflowStatus = WorkflowStatus.PENDING;
  private _cancelled = false;

  constructor(
    graph: StateGraph,
    ctx: WorkflowContext,
    config: Required<WorkflowExecutorConfig>,
    signal?: AbortSignal
  ) {
    this.graph = graph;
    this.ctx = ctx;
    this.config = config;
    this.signal = signal;
  }

  /** Compare runtime status without tripping TS literal narrowing. */
  private _statusIs(s: WorkflowStatus): boolean {
    return this.status === s;
  }

  async execute(): Promise<WorkflowExecutorResult> {
    this.status = WorkflowStatus.RUNNING;
    const startTime = Date.now();

    try {
      const startNode = this.graph.getInitialNode();
      if (!startNode) {
        throw new Error('No start node found');
      }

      await this.executeNode(startNode.id);
      if (this._cancelled || this._statusIs(WorkflowStatus.CANCELLED)) {
        this.status = WorkflowStatus.CANCELLED;
        return {
          executionId: this.ctx.executionId,
          status: WorkflowStatus.CANCELLED,
          outputVariables: Object.fromEntries(this.ctx.variables),
          history: this.ctx.history,
          totalDurationMs: Date.now() - startTime,
        };
      }
      await this.executeNext();

    } catch (error) {
      this.status = WorkflowStatus.FAILED;
      const workflowError: WorkflowError = {
        code: 'WORKFLOW_ERROR',
        message: error instanceof Error ? error.message : String(error),
        nodeId: this.ctx.currentNodeId,
        retryable: false,
        cause: error,
      };
      return {
        executionId: this.ctx.executionId,
        status: WorkflowStatus.FAILED,
        outputVariables: Object.fromEntries(this.ctx.variables),
        history: this.ctx.history,
        totalDurationMs: Date.now() - startTime,
        error: workflowError,
      };
    }

    if (this._statusIs(WorkflowStatus.PAUSED)) {
      // Workflow paused mid-execution; return paused state
      return {
        executionId: this.ctx.executionId,
        status: WorkflowStatus.PAUSED,
        outputVariables: Object.fromEntries(this.ctx.variables),
        history: this.ctx.history,
        totalDurationMs: Date.now() - startTime,
      };
    }
    this.status = WorkflowStatus.COMPLETED;
    return {
      executionId: this.ctx.executionId,
      status: WorkflowStatus.COMPLETED,
      outputVariables: Object.fromEntries(this.ctx.variables),
      history: this.ctx.history,
      totalDurationMs: Date.now() - startTime,
    };
  }

  private async executeNode(nodeId: EntityId): Promise<unknown> {
    if (this._cancelled || this.signal?.aborted) {
      throw new Error('Workflow cancelled');
    }

    const node = this.graph.getNode(nodeId);
    if (!node) {
      throw new Error(`Node ${nodeId} not found`);
    }

    this.ctx.currentNodeId = nodeId;

    const record: NodeExecutionRecord = {
      nodeId,
      startedAt: new Date(),
      attempts: 1,
    };

    try {
      let result: unknown;

      if (node.entry) {
        const timeoutMs = node.timeoutMs ?? this.config.defaultTimeoutMs;
        result = await this.withTimeout(node.entry(this.ctx), timeoutMs);
      }

      record.completedAt = new Date();
      record.result = result;
      this.ctx.history.push(record);

      if (node.exit) {
        await node.exit(this.ctx, result);
      }

      return result;
    } catch (error) {
      record.completedAt = new Date();
      record.error = {
        code: 'NODE_ERROR',
        message: error instanceof Error ? error.message : String(error),
        nodeId,
        retryable: (node.retryPolicy?.maxRetries ?? 0) > 0,
        cause: error,
      };
      this.ctx.history.push(record);

      if (record.error.retryable && node.retryPolicy && (node.retryPolicy.maxRetries ?? 0) > 0) {
        return this.retryNode(node, record);
      }

      throw error;
    }
  }

  private async retryNode(node: StateNode, failedRecord: NodeExecutionRecord): Promise<unknown> {
    const policy = node.retryPolicy!;
    let attempt = 2;

    while (attempt <= policy.maxRetries) {
      const backoff = Math.min(
        policy.backoffMs * Math.pow(policy.exponentialBase ?? 2, attempt - 2),
        policy.maxBackoffMs ?? Infinity
      );

      await new Promise(resolve => setTimeout(resolve, backoff));

      try {
        const record: NodeExecutionRecord = {
          nodeId: node.id,
          startedAt: new Date(),
          attempts: attempt,
        };

        if (node.entry) {
          const result = await this.withTimeout(
            node.entry(this.ctx),
            node.timeoutMs ?? this.config.defaultTimeoutMs
          );
          record.completedAt = new Date();
          record.result = result;
          this.ctx.history.push(record);
          return result;
        }
      } catch {
        // Continue to next retry
      }

      attempt++;
    }

    throw failedRecord.error;
  }

  private async executeNext(): Promise<void> {
    if (this._cancelled || this._statusIs(WorkflowStatus.CANCELLED)) {
      return;
    }
    if (this._statusIs(WorkflowStatus.PAUSED)) {
      // Status stays PAUSED; caller must call resume() then re-execute
      return;
    }
    const completedNodeId = this.ctx.currentNodeId;
    const outgoing = this.graph.getOutgoing(completedNodeId);

    if (outgoing.length === 0) {
      return;
    }

    // Build a nodeId → last-record index once per fan-out, not per neighbour.
    const historyIndex = new Map<EntityId, NodeExecutionRecord>();
    // Keep first occurrence to match the previous Array.find() semantics.
    for (const rec of this.ctx.history) if (!historyIndex.has(rec.nodeId)) historyIndex.set(rec.nodeId, rec);

    for (const nextNodeId of outgoing) {
      const nextNode = this.graph.getNode(nextNodeId);
      if (!nextNode) continue;

      if (nextNode.canExecute(this.ctx.history, historyIndex)) {
        await this.executeNode(nextNodeId);
        await this.executeNext();
      }
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then(result => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch(err => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  pause(): boolean {
    this.status = WorkflowStatus.PAUSED;
    return true;
  }

  resume(): boolean {
    this.status = WorkflowStatus.RUNNING;
    return true;
  }

  cancel(): boolean {
    this._cancelled = true;
    this.status = WorkflowStatus.CANCELLED;
    return true;
  }

  getSnapshot(): StateGraphSnapshot {
    const activeNodes = this.ctx.history
      .filter(r => !r.completedAt)
      .map(r => r.nodeId);

    return {
      workflowId: this.ctx.workflowId,
      executionId: this.ctx.executionId,
      currentNodes: activeNodes.length > 0 ? activeNodes : [this.ctx.currentNodeId],
      activeBranches: [],
      variables: Object.fromEntries(this.ctx.variables),
      history: this.ctx.history,
      status: this.status,
    };
  }
}

// ── Workflow Builder DSL ───────────────────────────────────────────────────

export class WorkflowBuilder {
  private _nodes: StateNodeConfig[] = [];
  private _name: string;
  private _description?: string;

  constructor(name: string) {
    this._name = name;
  }

  description(desc: string): WorkflowBuilder {
    this._description = desc;
    return this;
  }

  task(
    name: string,
    entry: (ctx: WorkflowContext) => Promise<unknown>,
    options?: { id?: EntityId; description?: string; timeoutMs?: number; retryPolicy?: RetryPolicyConfig }
  ): WorkflowBuilder {
    this._nodes.push({
      id: options?.id,
      type: NodeType.TASK,
      name,
      description: options?.description,
      entry,
      timeoutMs: options?.timeoutMs,
      retryPolicy: options?.retryPolicy,
    });
    return this;
  }

  decision(
    name: string,
    condition: (ctx: WorkflowContext) => Promise<boolean>,
    options?: { id?: EntityId; description?: string }
  ): WorkflowBuilder {
    this._nodes.push({
      id: options?.id,
      type: NodeType.DECISION,
      name,
      description: options?.description,
      entry: async (ctx) => condition(ctx),
    });
    return this;
  }

  start(name?: string): WorkflowBuilder {
    this._nodes.push({
      type: NodeType.START,
      name: name ?? 'start',
    });
    return this;
  }

  end(name?: string): WorkflowBuilder {
    this._nodes.push({
      type: NodeType.END,
      name: name ?? 'end',
    });
    return this;
  }

  build(): StateGraph {
    const graph = new StateGraph({
      name: this._name,
      description: this._description,
    });

    for (const nodeConfig of this._nodes) {
      graph.addNode(nodeConfig);
    }

    // Auto-link sequential nodes
    for (let i = 0; i < this._nodes.length - 1; i++) {
      const from = this._nodes[i];
      const to = this._nodes[i + 1];
      if (from.id && to.id) {
        graph.addTransition({
          from: from.id,
          to: to.id,
          type: TransitionType.UNCONDITIONAL,
        });
      }
    }

    return graph;
  }
}

// ── Checkpoint/Durability ──────────────────────────────────────────────────

export interface CheckpointStore {
  save(snapshot: StateGraphSnapshot): Promise<void>;
  load(executionId: EntityId): Promise<StateGraphSnapshot | null>;
  delete(executionId: EntityId): Promise<void>;
  list(workflowId: EntityId): Promise<EntityId[]>;
}

export class InMemoryCheckpointStore implements CheckpointStore {
  private checkpoints: Map<EntityId, StateGraphSnapshot> = new Map();

  async save(snapshot: StateGraphSnapshot): Promise<void> {
    this.checkpoints.set(snapshot.executionId, snapshot);
  }

  async load(executionId: EntityId): Promise<StateGraphSnapshot | null> {
    return this.checkpoints.get(executionId) ?? null;
  }

  async delete(executionId: EntityId): Promise<void> {
    this.checkpoints.delete(executionId);
  }

  async list(workflowId: EntityId): Promise<EntityId[]> {
    return Array.from(this.checkpoints.values())
      .filter(s => s.workflowId === workflowId)
      .map(s => s.executionId);
  }
}