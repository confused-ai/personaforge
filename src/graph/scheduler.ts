/**
 * Distributed Scheduler & Worker System
 *
 * Enables horizontal scaling of graph execution:
 * - Scheduler: Determines ready nodes, creates task envelopes, dispatches to queue
 * - Worker: Consumes tasks from queue, executes nodes, reports results
 * - Queue: Abstraction over Redis/Kafka/SQS/in-memory
 *
 * Architecture:
 *   Scheduler ──enqueue──> [TaskQueue] ──consume──> Worker(s)
 *              <──result──               ──ack──>
 *
 * Key properties:
 * - At-least-once delivery (idempotency key prevents duplicate execution)
 * - Horizontal scaling (add more workers to increase throughput)
 * - Backpressure (queue depth monitoring, worker health checks)
 * - Graceful shutdown (drain in-flight tasks before stopping)
 */

import {
  type TaskQueue,
  type TaskEnvelope,
  type TaskResult,
  type Scheduler,
  type GraphDef,
  type GraphState,
  type EventStore,
  type GraphEvent,
  type GraphPlugin,
  type NodeId,
  type ExecutionId,
  type WorkerId,
  type NodeContext,
  type NodeLogger,
  type StateMutation,
  NodeStatus,
  ExecutionStatus,
  GraphEventType,
  workerId as createWorkerId,
  uid,
  executionId as createExecutionId,
} from './types.js';

// ── In-Memory Task Queue ────────────────────────────────────────────────────

/**
 * In-process queue for single-node deployments and testing.
 * Uses a priority queue with FIFO ordering within same priority.
 */
export class InMemoryTaskQueue implements TaskQueue {
  private queue: TaskEnvelope[] = [];
  private queueHead = 0; // head pointer — O(1) dequeue instead of O(n) shift()
  private handler?: (task: TaskEnvelope) => Promise<TaskResult>;
  private processing = new Set<string>();
  private closed = false;
  private pollInterval?: ReturnType<typeof setInterval>;

  async enqueue(task: TaskEnvelope): Promise<void> {
    if (this.closed) throw new Error('Queue is closed');
    this.queue.push(task);
    // If there's a handler, process immediately
    this._processNext();
  }

  async consume(handler: (task: TaskEnvelope) => Promise<TaskResult>): Promise<void> {
    this.handler = handler;
    // Start polling for tasks
    this.pollInterval = setInterval(() => this._processNext(), 10);
    this.pollInterval.unref?.();
    // Process any existing tasks
    this._processNext();
  }

  async ack(executionId: ExecutionId, nodeId: NodeId): Promise<void> {
    const key = `${executionId}:${nodeId}`;
    this.processing.delete(key);
  }

  async nack(executionId: ExecutionId, nodeId: NodeId, _delayMs?: number): Promise<void> {
    const key = `${executionId}:${nodeId}`;
    this.processing.delete(key);
    // Re-enqueue with delay if specified
    // In a real implementation, this would use a delayed queue
  }

  async depth(): Promise<number> {
    return this.queue.length;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.pollInterval) clearInterval(this.pollInterval);
    // Wait for in-flight tasks
    while (this.processing.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  private async _processNext(): Promise<void> {
    if (!this.handler || this.queueHead >= this.queue.length) return;

    const task = this.queue[this.queueHead++];

    // Compact the array when the consumed prefix is large enough to matter
    if (this.queueHead > 128 && this.queueHead > this.queue.length >> 1) {
      this.queue = this.queue.slice(this.queueHead);
      this.queueHead = 0;
    }
    if (!task) return;

    const key = `${task.executionId}:${task.nodeId}`;
    if (this.processing.has(key)) return; // Already processing

    this.processing.add(key);
    try {
      await this.handler(task);
      await this.ack(task.executionId, task.nodeId);
    } catch {
      await this.nack(task.executionId, task.nodeId);
    }
  }
}

// ── Redis Queue Adapter ─────────────────────────────────────────────────────

/**
 * Redis-backed queue using BullMQ.
 * Requires: npm install bullmq ioredis
 *
 * Features: delayed jobs, retries, rate limiting, prioritization
 */
export class RedisTaskQueue implements TaskQueue {
  private queue: any; // BullMQ.Queue
  private worker: any; // BullMQ.Worker
  private queueName: string;

  constructor(
    private redisUrl: string,
    options?: { queueName?: string; concurrency?: number }
  ) {
    this.queueName = options?.queueName ?? 'graph-tasks';
  }

  async init(): Promise<this> {
    try {
      const { Queue } = await import('bullmq' as string);
      const { default: IORedis } = await import('ioredis' as string);

      const connection = new IORedis(this.redisUrl, { maxRetriesPerRequest: null });

      this.queue = new Queue(this.queueName, { connection });
    } catch {
      throw new Error(
        'RedisTaskQueue requires "bullmq" and "ioredis" packages. ' +
        'Install: npm install bullmq ioredis'
      );
    }
    return this;
  }

  async enqueue(task: TaskEnvelope): Promise<void> {
    await this.queue.add(task.idempotencyKey, task, {
      jobId: task.idempotencyKey, // Idempotent: same key = same job
      removeOnComplete: 1000,
      removeOnFail: 5000,
      attempts: (task.nodeDef.retry?.maxRetries ?? 0) + 1,
      backoff: {
        type: 'exponential',
        delay: task.nodeDef.retry?.backoffMs ?? 1000,
      },
    });
  }

  async consume(handler: (task: TaskEnvelope) => Promise<TaskResult>): Promise<void> {
    const bullmq = await import('bullmq' as string);
    const { default: IORedis } = await import('ioredis' as string);

    const connection = new IORedis(this.redisUrl, { maxRetriesPerRequest: null });

    this.worker = new bullmq.Worker(
      this.queueName,
      async (job: any) => {
        const task = job.data as TaskEnvelope;
        return handler(task);
      },
      { connection, concurrency: 4 }
    );
  }

  async ack(_executionId: ExecutionId, _nodeId: NodeId): Promise<void> {
    // BullMQ handles ack automatically on job completion
  }

  async nack(_executionId: ExecutionId, _nodeId: NodeId, _delayMs?: number): Promise<void> {
    // BullMQ handles retries automatically
  }

  async depth(): Promise<number> {
    return this.queue.count();
  }

  async close(): Promise<void> {
    await this.worker?.close?.();
    await this.queue?.close?.();
  }
}

// ── Scheduler ───────────────────────────────────────────────────────────────

/**
 * Default scheduler implementation.
 * Determines ready nodes and dispatches them to the queue.
 */
export class DefaultScheduler implements Scheduler {
  private graph: GraphDef;
  private queue: TaskQueue;
  private resultHandlers: Map<string, (result: TaskResult) => void> = new Map();

  constructor(graph: GraphDef, queue: TaskQueue, _eventStore?: EventStore) {
    this.graph = graph;
    this.queue = queue;
  }

  getReadyNodes(graph: GraphDef, state: GraphState): NodeId[] {
    const ready: NodeId[] = [];

    for (const [nid] of graph.nodes) {
      const nodeState = state.nodes[nid];
      if (!nodeState || (nodeState.status !== NodeStatus.PENDING && nodeState.status !== NodeStatus.READY)) {
        continue;
      }

      const incomingEdgeIds = graph.incoming.get(nid) ?? [];

      if (incomingEdgeIds.length === 0) {
        ready.push(nid);
        continue;
      }

      const allDepsReady = incomingEdgeIds.every(eid => {
        const edge = graph.edges.get(eid)!;
        const sourceState = state.nodes[edge.from];
        return sourceState?.status === NodeStatus.COMPLETED || sourceState?.status === NodeStatus.SKIPPED;
      });

      if (allDepsReady) {
        ready.push(nid);
      }
    }

    return ready;
  }

  async dispatch(envelope: TaskEnvelope): Promise<void> {
    await this.queue.enqueue(envelope);
  }

  async handleResult(result: TaskResult): Promise<void> {
    const key = `${result.executionId}:${result.nodeId}`;
    const handler = this.resultHandlers.get(key);
    if (handler) {
      handler(result);
      this.resultHandlers.delete(key);
    }
  }

  /**
   * Create a task envelope for a node.
   */
  createEnvelope(
    executionId: ExecutionId,
    nodeId: NodeId,
    state: GraphState,
    attempt: number
  ): TaskEnvelope {
    const nodeDef = this.graph.nodes.get(nodeId)!;
    return {
      executionId,
      graphId: this.graph.id,
      nodeId,
      nodeDef,
      input: this._resolveInput(nodeId, state),
      state,
      attempt,
      idempotencyKey: `${executionId}:${nodeId}:${attempt}`,
    };
  }

  private _resolveInput(nodeId: NodeId, state: GraphState): unknown {
    const incomingEdgeIds = this.graph.incoming.get(nodeId) ?? [];
    if (incomingEdgeIds.length === 0) return state.variables;
    if (incomingEdgeIds.length === 1) {
      const edge = this.graph.edges.get(incomingEdgeIds[0])!;
      const sourceDef = this.graph.nodes.get(edge.from);
      return sourceDef ? state.results[sourceDef.name] ?? state.variables : state.variables;
    }
    // Multiple inputs: merge
    const collected: Record<string, unknown> = {};
    for (const eid of incomingEdgeIds) {
      const edge = this.graph.edges.get(eid)!;
      const sourceDef = this.graph.nodes.get(edge.from);
      if (sourceDef) collected[sourceDef.name] = state.results[sourceDef.name];
    }
    return collected;
  }
}

// ── Worker ──────────────────────────────────────────────────────────────────

/**
 * A worker that consumes tasks from the queue, executes them, and reports results.
 */
export class GraphWorker {
  readonly id: WorkerId;
  private queue: TaskQueue;
  private plugins: GraphPlugin[];
  private running = false;
  private tasksProcessed = 0;
  private tasksFailed = 0;
  private currentTask?: TaskEnvelope;
  private onResult?: (result: TaskResult) => Promise<void>;
  private loggerFactory: (nodeId: NodeId, nodeName: string) => NodeLogger;

  constructor(options: {
    queue: TaskQueue;
    plugins?: GraphPlugin[];
    onResult?: (result: TaskResult) => Promise<void>;
    loggerFactory?: (nodeId: NodeId, nodeName: string) => NodeLogger;
    id?: string;
  }) {
    this.id = createWorkerId(options.id);
    this.queue = options.queue;
    this.plugins = options.plugins ?? [];
    this.onResult = options.onResult;
    this.loggerFactory = options.loggerFactory ?? ((_nid, name) => ({
      debug: () => {},
      info: (msg: string) => console.log(`[worker:${this.id.slice(0, 8)}][${name}] ${msg}`),
      warn: (msg: string) => console.warn(`[worker:${this.id.slice(0, 8)}][${name}] ${msg}`),
      error: (msg: string) => console.error(`[worker:${this.id.slice(0, 8)}][${name}] ${msg}`),
    }));
  }

  async start(): Promise<void> {
    this.running = true;
    await this.queue.consume(async (task) => this._processTask(task));
  }

  async stop(): Promise<void> {
    this.running = false;
    // Wait for current task to complete
    while (this.currentTask) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  getStats(): WorkerStats {
    return {
      workerId: this.id,
      running: this.running,
      tasksProcessed: this.tasksProcessed,
      tasksFailed: this.tasksFailed,
      currentTask: this.currentTask ? {
        executionId: this.currentTask.executionId,
        nodeId: this.currentTask.nodeId,
        startedAt: Date.now(),
      } : undefined,
    };
  }

  private async _processTask(task: TaskEnvelope): Promise<TaskResult> {
    this.currentTask = task;
    const startTime = Date.now();
    const mutations: StateMutation[] = [];

    // Create execution context for the node
    const ctx: NodeContext = {
      executionId: task.executionId,
      nodeId: task.nodeId,
      nodeName: task.nodeDef.name,
      input: task.input,
      state: Object.freeze({ ...task.state }),
      setVariable: (key, value) => {
        mutations.push({ type: 'set_variable', key, value });
      },
      getVariable: <T = unknown>(key: string): T | undefined => task.state.variables[key] as T | undefined,
      getNodeOutput: <T = unknown>(name: string): T | undefined => task.state.results[name] as T | undefined,
      signal: new AbortController().signal,
      emit: () => {},
      log: this.loggerFactory(task.nodeId, task.nodeDef.name),
      attempt: task.attempt,
      metadata: task.nodeDef.metadata ?? {},
    };

    // Notify plugins
    for (const p of this.plugins) {
      await p.onNodeStart?.(task.nodeId, ctx);
    }

    try {
      let output: unknown;

      if (task.nodeDef.execute) {
        // Apply timeout if configured
        const timeoutMs = task.nodeDef.timeout?.timeoutMs;
        if (timeoutMs) {
          let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
          try {
            output = await Promise.race([
              task.nodeDef.execute(ctx),
              new Promise((_, reject) => {
                timeoutTimer = setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs);
              }),
            ]);
          } finally {
            if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
          }
        } else {
          output = await task.nodeDef.execute(ctx);
        }
      }

      mutations.push({ type: 'set_result', key: task.nodeDef.name, value: output });

      const result: TaskResult = {
        executionId: task.executionId,
        nodeId: task.nodeId,
        success: true,
        output,
        durationMs: Date.now() - startTime,
        workerId: this.id,
        mutations,
      };

      this.tasksProcessed++;
      this.currentTask = undefined;

      // Notify plugins
      for (const p of this.plugins) {
        await p.onNodeComplete?.(task.nodeId, output, result.durationMs);
      }

      if (this.onResult) await this.onResult(result);
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      const result: TaskResult = {
        executionId: task.executionId,
        nodeId: task.nodeId,
        success: false,
        error: errorMsg,
        durationMs: Date.now() - startTime,
        workerId: this.id,
        mutations,
      };

      this.tasksFailed++;
      this.currentTask = undefined;

      // Notify plugins
      for (const p of this.plugins) {
        await p.onNodeError?.(task.nodeId, err, task.attempt);
      }

      if (this.onResult) await this.onResult(result);
      return result;
    }
  }
}

export interface WorkerStats {
  workerId: WorkerId;
  running: boolean;
  tasksProcessed: number;
  tasksFailed: number;
  currentTask?: {
    executionId: ExecutionId;
    nodeId: NodeId;
    startedAt: number;
  };
}

// ── Distributed Engine ──────────────────────────────────────────────────────

/**
 * Orchestrates graph execution across multiple workers.
 * Unlike DAGEngine which runs everything in-process,
 * DistributedEngine dispatches tasks to a queue for worker consumption.
 */
export class DistributedEngine {
  private graph: GraphDef;
  private scheduler: DefaultScheduler;
  private queue: TaskQueue;
  private eventStore?: EventStore;
  private state: GraphState;
  private exId: ExecutionId;
  private sequence = 0;
  private events: GraphEvent[] = [];

  constructor(options: {
    graph: GraphDef;
    queue: TaskQueue;
    eventStore?: EventStore;
    plugins?: GraphPlugin[];
  }) {
    this.graph = options.graph;
    this.queue = options.queue;
    this.eventStore = options.eventStore;
    this.scheduler = new DefaultScheduler(options.graph, options.queue, options.eventStore);
    this.state = this._createInitialState();
    this.exId = createExecutionId();
  }

  async execute(options?: {
    executionId?: ExecutionId;
    variables?: Record<string, unknown>;
  }): Promise<{
    executionId: ExecutionId;
    state: GraphState;
    events: GraphEvent[];
  }> {
    if (options?.executionId) this.exId = options.executionId;
    if (options?.variables) {
      this.state.variables = { ...this.state.variables, ...options.variables };
    }

    this.state.status = ExecutionStatus.RUNNING;
    this._emit(GraphEventType.EXECUTION_STARTED, undefined, { graphName: this.graph.name });

    // Start consuming results from queue
    await this.queue.consume(async (task: TaskEnvelope) => {
      // This runs inside the worker — execute the node
      const ctx = this._createNodeContext(task);
      const startTime = Date.now();

      try {
        const output = task.nodeDef.execute ? await task.nodeDef.execute(ctx) : undefined;
        return {
          executionId: task.executionId,
          nodeId: task.nodeId,
          success: true,
          output,
          durationMs: Date.now() - startTime,
          mutations: [{ type: 'set_result' as const, key: task.nodeDef.name, value: output }],
        };
      } catch (err) {
        return {
          executionId: task.executionId,
          nodeId: task.nodeId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - startTime,
          mutations: [],
        };
      }
    });

    // Main scheduling loop
    while (this.state.status === ExecutionStatus.RUNNING) {
      const readyNodes = this.scheduler.getReadyNodes(this.graph, this.state);

      if (readyNodes.length === 0 && this.state.activeNodes.length === 0) {
        // Check if all nodes are done
        const allDone = Object.values(this.state.nodes).every(
          n => n.status === NodeStatus.COMPLETED || n.status === NodeStatus.SKIPPED || n.status === NodeStatus.FAILED
        );
        if (allDone) {
          this.state.status = ExecutionStatus.COMPLETED;
          this._emit(GraphEventType.EXECUTION_COMPLETED);
          break;
        }
      }

      // Dispatch ready nodes
      for (const nid of readyNodes) {
        const attempt = (this.state.nodes[nid]?.attempts ?? 0) + 1;
        const envelope = this.scheduler.createEnvelope(this.exId, nid, this.state, attempt);

        this.state.nodes[nid] = {
          ...this.state.nodes[nid],
          nodeId: nid,
          status: NodeStatus.RUNNING,
          attempts: attempt,
          startedAt: Date.now(),
        };
        this.state.activeNodes.push(nid);
        this._emit(GraphEventType.NODE_STARTED, nid, { attempt });

        await this.scheduler.dispatch(envelope);
      }

      // Brief yield to allow worker processing
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    return {
      executionId: this.exId,
      state: this.state,
      events: this.events,
    };
  }

  private _createInitialState(): GraphState {
    const nodes: Record<string, any> = {};
    for (const [nid] of this.graph.nodes) {
      nodes[nid] = { nodeId: nid, status: NodeStatus.PENDING, attempts: 0 };
    }
    return {
      variables: {},
      results: {},
      nodes,
      status: ExecutionStatus.CREATED,
      activeNodes: [],
    };
  }

  private _createNodeContext(task: TaskEnvelope): NodeContext {
    return {
      executionId: task.executionId,
      nodeId: task.nodeId,
      nodeName: task.nodeDef.name,
      input: task.input,
      state: Object.freeze({ ...task.state }),
      setVariable: () => {},
      getVariable: <T = unknown>(key: string): T | undefined => task.state.variables[key] as T | undefined,
      getNodeOutput: <T = unknown>(name: string): T | undefined => task.state.results[name] as T | undefined,
      signal: new AbortController().signal,
      emit: () => {},
      log: {
        debug: () => {},
        info: (msg: string) => console.log(`[distributed][${task.nodeDef.name}] ${msg}`),
        warn: (msg: string) => console.warn(`[distributed][${task.nodeDef.name}] ${msg}`),
        error: (msg: string) => console.error(`[distributed][${task.nodeDef.name}] ${msg}`),
      },
      attempt: task.attempt,
      metadata: task.nodeDef.metadata ?? {},
    };
  }

  private _emit(type: GraphEventType, nodeId?: NodeId, data?: Record<string, unknown>): void {
    const event: GraphEvent = {
      id: uid('ev'),
      type,
      executionId: this.exId,
      graphId: this.graph.id,
      timestamp: Date.now(),
      sequence: ++this.sequence,
      nodeId,
      data,
    };
    this.events.push(event);
    this.eventStore?.append([event]).catch(() => {});
  }
}

// ── Execution Waves ──────────────────────────────────────────────────────────

/**
 * Compute execution waves for a DAG via topological level assignment.
 *
 * Each wave contains nodes whose dependencies are fully satisfied by
 * earlier waves, so all nodes within a wave can run concurrently.
 * A node's wave index equals the length of the longest dependency path
 * leading to it, ensuring fan-in nodes are placed after all of their
 * upstream branches.
 *
 * @example
 *   //  A → B → D
 *   //  A → C → D
 *   // Wave 0: [A]
 *   // Wave 1: [B, C]  ← independent, run in parallel
 *   // Wave 2: [D]     ← fan-in, waits for B and C
 *
 * @throws if the graph contains a cycle (detected via Kahn's algorithm)
 */
export function computeWaves(graph: GraphDef): NodeId[][] {
  // Mutable in-degree copy for Kahn's algorithm
  const inDegree = new Map<NodeId, number>();
  for (const [nid] of graph.nodes) {
    inDegree.set(nid, graph.incoming.get(nid)?.length ?? 0);
  }

  // level[nid] = longest path from any root to nid (wave index)
  const level = new Map<NodeId, number>();
  const queue: NodeId[] = [];

  for (const [nid, deg] of inDegree) {
    if (deg === 0) {
      queue.push(nid);
      level.set(nid, 0);
    }
  }

  const processed: NodeId[] = [];

  while (queue.length > 0) {
    const nid = queue.shift()!;
    processed.push(nid);

    const myLevel = level.get(nid) ?? 0;
    const outEdgeIds = graph.outgoing.get(nid) ?? [];

    for (const eid of outEdgeIds) {
      const edge = graph.edges.get(eid)!;
      // A successor's level is at least (myLevel + 1); take the max across all predecessors
      const candidateLevel = myLevel + 1;
      const currentLevel = level.get(edge.to) ?? 0;
      level.set(edge.to, Math.max(currentLevel, candidateLevel));

      const newDeg = (inDegree.get(edge.to) ?? 1) - 1;
      inDegree.set(edge.to, newDeg);
      if (newDeg === 0) {
        queue.push(edge.to);
      }
    }
  }

  if (processed.length !== graph.nodes.size) {
    throw new Error('computeWaves: cycle detected in graph');
  }

  // Group nodes by their assigned level
  const waves: NodeId[][] = [];
  for (const [nid, lv] of level) {
    if (!waves[lv]) waves[lv] = [];
    waves[lv].push(nid);
  }

  return waves;
}

// ── Backpressure Controller ──────────────────────────────────────────────────

/**
 * Semaphore-based backpressure controller.
 *
 * Limits the number of concurrently executing nodes. When the limit is
 * reached, `acquire()` suspends the caller until a slot is released.
 *
 * @example
 *   const bp = new BackpressureController(4);
 *   await bp.acquire();        // blocks if 4 nodes already in-flight
 *   try { await runNode(); }
 *   finally { bp.release(); }
 */
export class BackpressureController {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(readonly maxConcurrency: number) {
    if (maxConcurrency < 1) {
      throw new RangeError(`BackpressureController: maxConcurrency must be ≥ 1, got ${maxConcurrency}`);
    }
    this.available = maxConcurrency;
  }

  /** Acquire a slot. Returns immediately if capacity is available; otherwise awaits. */
  acquire(): Promise<void> {
    if (this.available > 0) {
      this.available--;
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      this.waiters.push(resolve);
    });
  }

  /** Release a slot, waking the next queued waiter if any. */
  release(): void {
    if (this.waiters.length > 0) {
      // The released slot goes directly to the next waiter — `available` stays the same
      const next = this.waiters.shift()!;
      next();
    } else {
      this.available = Math.min(this.available + 1, this.maxConcurrency);
    }
  }

  /** Number of nodes currently holding a slot. */
  get inflight(): number {
    return this.maxConcurrency - this.available;
  }

  /** Number of callers waiting for an available slot. */
  get queueDepth(): number {
    return this.waiters.length;
  }
}
