/**
 * DAG Execution Engine — The heart of the graph runtime
 *
 * This engine executes a GraphDef by:
 * 1. Computing a topological ordering
 * 2. Determining which nodes are "ready" (all dependencies met)
 * 3. Executing ready nodes in parallel (respecting concurrency limits)
 * 4. Handling routing, branching, joining, retries, and timeouts
 * 5. Emitting events for every state transition (enables event sourcing)
 *
 * Key design decisions:
 * - Single-threaded coordinator, parallel node execution via Promise.all
 * - State is immutable between transitions — mutations are batched
 * - Every state change emits a GraphEvent for durability
 * - Execution can be paused/resumed/cancelled at any point
 * - Deterministic replay: given the same events, produces the same state
 */

import {
  type GraphDef,
  type GraphNodeDef,
  type GraphState,
  type NodeState,
  type GraphEvent,
  type GraphPlugin,
  type NodeContext,
  type NodeLogger,
  type EventStore,
  type Checkpoint,
  type NodeId,
  type ExecutionId,
  NodeKind,
  NodeStatus,
  ExecutionStatus,
  GraphEventType,
  executionId as createExecutionId,
  uid,
} from './types.js';

// ── Execution Options ───────────────────────────────────────────────────────

export interface ExecuteOptions {
  /** Pre-set execution ID (for resuming) */
  executionId?: ExecutionId;
  /** Initial variables */
  variables?: Record<string, unknown>;
  /** Max concurrent nodes (overrides graph default) */
  maxConcurrency?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Event store for durability */
  eventStore?: EventStore;
  /** Checkpoint interval (every N events) */
  checkpointInterval?: number;
  /** Plugins */
  plugins?: GraphPlugin[];
  /** Resume from checkpoint */
  resumeFrom?: Checkpoint;
  /** Custom logger factory */
  loggerFactory?: (nodeId: NodeId, nodeName: string) => NodeLogger;
}

export interface ExecutionResult {
  executionId: ExecutionId;
  status: ExecutionStatus;
  state: GraphState;
  events: GraphEvent[];
  durationMs: number;
  error?: string;
}

// ── Default Logger ──────────────────────────────────────────────────────────

function createDefaultLogger(nodeId: NodeId, nodeName: string): NodeLogger {
  const prefix = `[${nodeName}:${nodeId.slice(0, 8)}]`;
  return {
    debug: (_msg, _data) => { /* silent in production */ },
    info: (msg, data) => console.log(`${prefix} ${msg}`, data ?? ''),
    warn: (msg, data) => console.warn(`${prefix} ${msg}`, data ?? ''),
    error: (msg, data) => console.error(`${prefix} ${msg}`, data ?? ''),
  };
}

// ── DAG Engine ──────────────────────────────────────────────────────────────

export class DAGEngine {
  private graph: GraphDef;
  private state: GraphState;
  private events: GraphEvent[] = [];
  private sequence = 0;
  private exId: ExecutionId;
  private plugins: GraphPlugin[] = [];
  private eventStore?: EventStore;
  private checkpointInterval: number;
  private loggerFactory: (nodeId: NodeId, nodeName: string) => NodeLogger;
  private maxConcurrency: number;
  private abortController: AbortController;
  private eventListeners: Map<string, Set<(event: GraphEvent) => void>> = new Map();
  private pendingSignals: Map<string, (value?: unknown) => void> = new Map();
  // O(1) active-node tracking (array kept in sync for checkpoint serialisation)
  private _activeNodeSet: Set<NodeId> = new Set();
  // Promise-based completion notification — replaces 5 ms polling
  private _completionResolvers: Set<() => void> = new Set();
  // Candidate nodes that might be ready — avoids O(V+E) full scan per loop tick
  private _readyCandidates: Set<NodeId> = new Set();

  constructor(graph: GraphDef) {
    this.graph = graph;
    this.exId = createExecutionId();
    this.state = this._createInitialState();
    this.checkpointInterval = 10;
    this.loggerFactory = createDefaultLogger;
    this.maxConcurrency = graph.maxConcurrency ?? 8;
    this.abortController = new AbortController();
  }

  // ── Public API ────────────────────────────────────────────────────────

  async execute(options: ExecuteOptions = {}): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Apply options
    if (options.executionId) this.exId = options.executionId;
    if (options.variables) {
      this.state.variables = { ...this.state.variables, ...options.variables };
    }
    if (options.maxConcurrency) this.maxConcurrency = options.maxConcurrency;
    if (options.signal) {
      options.signal.addEventListener('abort', () => this.abortController.abort());
    }
    if (options.eventStore) this.eventStore = options.eventStore;
    if (options.checkpointInterval) this.checkpointInterval = options.checkpointInterval;
    if (options.plugins) this.plugins = options.plugins;
    if (options.loggerFactory) this.loggerFactory = options.loggerFactory;

    // Resume from checkpoint if provided
    if (options.resumeFrom) {
      this.state = { ...options.resumeFrom.state };
      this.sequence = options.resumeFrom.sequence;
      // Rebuild in-memory Set from restored serialised array
      this._activeNodeSet = new Set(this.state.activeNodes as NodeId[]);
      this._emitEvent(GraphEventType.CHECKPOINT_LOADED, undefined, {
        sequence: options.resumeFrom.sequence,
      });
    }

    // Notify plugins
    for (const p of this.plugins) {
      await p.onExecutionStart?.(this.exId, this.graph, this.state);
    }

    this._emitEvent(GraphEventType.EXECUTION_STARTED, undefined, {
      graphId: this.graph.id,
      graphName: this.graph.name,
      nodeCount: this.graph.nodes.size,
    });

    this.state.status = ExecutionStatus.RUNNING;

    try {
      await this._runLoop();

      // Determine final status
      const allCompleted = Object.values(this.state.nodes).every(
        n => n.status === NodeStatus.COMPLETED || n.status === NodeStatus.SKIPPED
      );

      if (allCompleted) {
        this.state.status = ExecutionStatus.COMPLETED;
        this._emitEvent(GraphEventType.EXECUTION_COMPLETED, undefined, {
          durationMs: Date.now() - startTime,
        });
      } else if ((this.state.status as ExecutionStatus) === ExecutionStatus.PAUSED || (this.state.status as ExecutionStatus) === ExecutionStatus.SUSPENDED) {
        // Stays as-is
      } else {
        this.state.status = ExecutionStatus.FAILED;
      }
    } catch (err) {
      this.state.status = ExecutionStatus.FAILED;
      this.state.error = err instanceof Error ? err.message : String(err);
      this._emitEvent(GraphEventType.EXECUTION_FAILED, undefined, {
        error: this.state.error,
      });
    }

    // Final checkpoint
    await this._saveCheckpoint();

    // Notify plugins
    for (const p of this.plugins) {
      await p.onExecutionComplete?.(this.exId, this.state, Date.now() - startTime);
    }

    return {
      executionId: this.exId,
      status: this.state.status,
      state: this.state,
      events: this.events,
      durationMs: Date.now() - startTime,
      error: this.state.error,
    };
  }

  /**
   * Pause execution. Running nodes will complete, but no new nodes will be started.
   */
  pause(): void {
    this.state.status = ExecutionStatus.PAUSED;
    this._emitEvent(GraphEventType.EXECUTION_PAUSED);
  }

  /**
   * Resume a paused execution.
   */
  async resume(options?: { variables?: Record<string, unknown> }): Promise<ExecutionResult> {
    if (this.state.status !== ExecutionStatus.PAUSED && this.state.status !== ExecutionStatus.SUSPENDED) {
      throw new Error(`Cannot resume execution in state: ${this.state.status}`);
    }

    if (options?.variables) {
      this.state.variables = { ...this.state.variables, ...options.variables };
    }

    this._emitEvent(GraphEventType.EXECUTION_RESUMED);
    this.state.status = ExecutionStatus.RUNNING;

    return this.execute({
      executionId: this.exId,
      resumeFrom: {
        executionId: this.exId,
        graphId: this.graph.id,
        state: this.state,
        sequence: this.sequence,
        timestamp: Date.now(),
      },
    });
  }

  /**
   * Cancel execution.
   */
  cancel(): void {
    this.abortController.abort();
    this.state.status = ExecutionStatus.CANCELLED;
    this._emitEvent(GraphEventType.EXECUTION_CANCELLED);
  }

  /**
   * Send a signal to a waiting node.
   */
  signal(signalName: string, value?: unknown): void {
    const resolver = this.pendingSignals.get(signalName);
    if (resolver) {
      resolver(value);
      this.pendingSignals.delete(signalName);
      this._emitEvent(GraphEventType.SIGNAL_RECEIVED, undefined, { signalName, value });
    }
  }

  /**
   * Subscribe to execution events.
   */
  on(eventType: string, handler: (event: GraphEvent) => void): () => void {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, new Set());
    }
    this.eventListeners.get(eventType)!.add(handler);
    return () => this.eventListeners.get(eventType)?.delete(handler);
  }

  /**
   * Get current state snapshot.
   */
  getState(): Readonly<GraphState> {
    return this.state;
  }

  /**
   * Get all events emitted so far.
   */
  getEvents(): readonly GraphEvent[] {
    return this.events;
  }

  // ── Core Execution Loop ───────────────────────────────────────────────

  private async _runLoop(): Promise<void> {
    // Seed the candidate set from current state (fresh run or checkpoint resume)
    this._initReadyCandidates();
    while (true) {
      if (this.abortController.signal.aborted) {
        this.state.status = ExecutionStatus.CANCELLED;
        return;
      }

      if (this.state.status === ExecutionStatus.PAUSED || this.state.status === ExecutionStatus.SUSPENDED) {
        return;
      }

      // Fail-fast: once a node has failed (which sets state.status = FAILED),
      // stop scheduling NEW work. Let already in-flight nodes settle, then halt.
      if (this.state.status === ExecutionStatus.FAILED) {
        if (this._activeNodeSet.size > 0) {
          await this._waitForAnyCompletion();
          continue;
        }
        return;
      }

      // Find nodes that are ready to execute
      const readyNodes = this._getReadyNodes();

      if (readyNodes.length === 0) {
        // Check if there are still running nodes
        const hasRunning = this._activeNodeSet.size > 0;
        if (!hasRunning) {
          // No ready nodes and nothing running — we're done
          return;
        }
        // Wait for a running node to complete (Promise-based, no polling)
        await this._waitForAnyCompletion();
        continue;
      }

      // Execute ready nodes in parallel, respecting concurrency limit
      const available = this.maxConcurrency - this._activeNodeSet.size;
      const batch = readyNodes.slice(0, Math.max(1, available));

      // Execute batch in parallel
      const promises = batch.map(nid => this._executeNode(nid));
      await Promise.allSettled(promises);
    }
  }

  /**
   * Seed the ready-candidate set from the current execution state.
   * Called once at the start of _runLoop (works for both fresh runs and resumes).
   */
  private _initReadyCandidates(): void {
    this._readyCandidates.clear();
    for (const [nid] of this.graph.nodes) {
      const nodeState = this.state.nodes[nid];
      if (!nodeState || (nodeState.status !== NodeStatus.PENDING && nodeState.status !== NodeStatus.READY)) {
        continue;
      }
      const incomingEdgeIds = this.graph.incoming.get(nid) ?? [];
      if (incomingEdgeIds.length === 0) {
        // Start nodes — always candidates
        this._readyCandidates.add(nid);
        continue;
      }
      // Add nodes whose at least one predecessor is already complete
      const anyPredComplete = incomingEdgeIds.some(eid => {
        const edge = this.graph.edges.get(eid)!;
        return this.state.nodes[edge.from]?.status === NodeStatus.COMPLETED;
      });
      if (anyPredComplete) this._readyCandidates.add(nid);
    }
  }

  /**
   * Determine which nodes are ready to execute.
   * Checks only _readyCandidates — O(candidates) instead of O(V+E) per loop tick.
   * Stale candidates (no longer PENDING/READY) are pruned inline.
   */
  private _getReadyNodes(): NodeId[] {
    const ready: NodeId[] = [];
    const stale: NodeId[] = [];

    for (const nid of this._readyCandidates) {
      const nodeState = this.state.nodes[nid];
      if (!nodeState || (nodeState.status !== NodeStatus.PENDING && nodeState.status !== NodeStatus.READY)) {
        stale.push(nid);
        continue;
      }

      // Check all incoming edges
      const incomingEdgeIds = this.graph.incoming.get(nid) ?? [];

      // Start node has no incoming edges — always ready
      if (incomingEdgeIds.length === 0) {
        ready.push(nid);
        continue;
      }

      // Check if at least one incoming edge has its source completed
      const anySourceCompleted = incomingEdgeIds.some(eid => {
        const edge = this.graph.edges.get(eid)!;
        const sourceState = this.state.nodes[edge.from];
        return sourceState?.status === NodeStatus.COMPLETED;
      });

      if (!anySourceCompleted) continue; // Stay in candidates — predecessor may complete later

      // Determine the join strategy. Default for any node with multiple
      // incoming edges is 'all' (fan-in waits for ALL predecessors), matching
      // DefaultScheduler.getReadyNodes' `.every(...)` semantics. A node opts
      // into race/any behaviour via JOIN kind + joinStrategy or metadata.
      const nodeDef = this.graph.nodes.get(nid)!;
      const joinStrategy = nodeDef.metadata?.joinStrategy as string | undefined;
      const strategy = joinStrategy ?? 'all';
      const isRaceJoin =
        (nodeDef.kind === NodeKind.JOIN || joinStrategy !== undefined) &&
        (strategy === 'race' || strategy === 'settled' || strategy === 'any');

      if (!isRaceJoin && incomingEdgeIds.length > 1) {
        // Fan-in: require ALL predecessors to have completed (or been skipped).
        const allCompleted = incomingEdgeIds.every(eid => {
          const edge = this.graph.edges.get(eid)!;
          const sourceState = this.state.nodes[edge.from];
          return sourceState?.status === NodeStatus.COMPLETED || sourceState?.status === NodeStatus.SKIPPED;
        });
        if (!allCompleted) continue; // Stay in candidates
      }
      // Race/any join (or single in-edge): at least one completed is enough.

      ready.push(nid);
    }

    for (const nid of stale) this._readyCandidates.delete(nid);
    return ready;
  }

  // ── Node Execution ────────────────────────────────────────────────────

  private async _executeNode(nid: NodeId): Promise<void> {
    const nodeDef = this.graph.nodes.get(nid)!;
    const nodeState = this.state.nodes[nid];
    const attempt = (nodeState?.attempts ?? 0) + 1;

    // Update state to running
    this._updateNodeState(nid, {
      status: NodeStatus.RUNNING,
      attempts: attempt,
      startedAt: Date.now(),
    });
    this._activeNodeSet.add(nid);
    this.state.activeNodes = Array.from(this._activeNodeSet);

    this._emitEvent(GraphEventType.NODE_STARTED, nid, { attempt, kind: nodeDef.kind });

    // Notify plugins
    const ctx = this._createNodeContext(nid, nodeDef, attempt);
    for (const p of this.plugins) {
      await p.onNodeStart?.(nid, ctx);
    }

    try {
      let output: unknown;

      switch (nodeDef.kind) {
        case NodeKind.TASK:
        case NodeKind.START:
        case NodeKind.END:
          output = await this._executeTaskNode(nid, nodeDef, ctx);
          break;
        case NodeKind.ROUTER:
          output = await this._executeRouterNode(nid, nodeDef, ctx);
          break;
        case NodeKind.PARALLEL:
          output = await this._executeParallelNode(nid, nodeDef, ctx);
          break;
        case NodeKind.JOIN:
          output = await this._executeJoinNode(nid, nodeDef, ctx);
          break;
        case NodeKind.AGENT:
          output = await this._executeAgentNode(nid, nodeDef, ctx);
          break;
        case NodeKind.WAIT:
          output = await this._executeWaitNode(nid, nodeDef, ctx);
          break;
        case NodeKind.SUBGRAPH:
          output = await this._executeSubgraphNode(nid, nodeDef, ctx);
          break;
        default:
          output = undefined;
      }

      // Mark completed
      const completedAt = Date.now();
      this._updateNodeState(nid, {
        status: NodeStatus.COMPLETED,
        output,
        completedAt,
        durationMs: completedAt - (nodeState?.startedAt ?? completedAt),
      });

      // Store result by name
      this.state.results[nodeDef.name] = output;

      // Successors of this node may now be ready — add them to the candidate set
      // Conditional edges: only matching target added, else default fallback
      const outgoing = this.graph.outgoing.get(nid) ?? [];
      const added = new Set<string>();
      for (const eid of outgoing) {
        const edge = this.graph.edges.get(eid)!;
        // If edge has conditional mapping, evaluate it against output
        if (edge.conditional && Object.keys(edge.conditional).length > 0) {
          // Find which conditional value matches the node output
          const outputKey = typeof output === 'string'
            ? output
            : (output && typeof output === 'object' && 'value' in (output as object)
              ? (output as Record<string, unknown>).value as string
              : undefined);
          if (outputKey !== undefined && edge.conditional[outputKey]) {
            const targetId = edge.conditional[outputKey];
            if (!added.has(targetId)) {
              this._readyCandidates.add(targetId);
              added.add(targetId);
            }
          } else if (edge.label === '__default__' && !added.has(edge.to)) {
            // Default edge: only add if no conditional matched
            this._readyCandidates.add(edge.to);
            added.add(edge.to);
          }
        } else if (edge.label !== '__default__' || !outgoing.some(
          e => this.graph.edges.get(e)?.conditional && Object.keys(this.graph.edges.get(e)?.conditional ?? {}).length > 0
        )) {
          // Non-conditional edge: always add (skip explicit __default__ labels
          // when conditional edges exist on the same source)
          if (!added.has(edge.to)) {
            this._readyCandidates.add(edge.to);
            added.add(edge.to);
          }
        }
      }

      this._emitEvent(GraphEventType.NODE_COMPLETED, nid, {
        durationMs: completedAt - (nodeState?.startedAt ?? completedAt),
        hasOutput: output !== undefined,
        // Persist the actual output so durable resume can restore state.results
        // for downstream nodes (correctness over payload size).
        output,
        nodeName: nodeDef.name,
      });

      // Notify plugins
      for (const p of this.plugins) {
        await p.onNodeComplete?.(nid, output, completedAt - (nodeState?.startedAt ?? completedAt));
      }
    } catch (err) {
      await this._handleNodeError(nid, nodeDef, err, attempt);
    } finally {
      // Remove from active nodes (O(1) with Set)
      this._activeNodeSet.delete(nid);
      this.state.activeNodes = Array.from(this._activeNodeSet);
      // Wake up the run loop waiting in _waitForAnyCompletion
      this._notifyCompletion();
    }

    // Checkpoint periodically
    if (this.events.length % this.checkpointInterval === 0) {
      await this._saveCheckpoint();
    }
  }

  private async _executeTaskNode(_nid: NodeId, def: GraphNodeDef, ctx: NodeContext): Promise<unknown> {
    if (!def.execute) return undefined;

    const timeoutMs = def.timeout?.timeoutMs ?? this.graph.defaultTimeout?.timeoutMs;

    if (timeoutMs) {
      let timer: NodeJS.Timeout | undefined;
      try {
        return await Promise.race([
          def.execute(ctx),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error(`Node "${def.name}" timed out after ${timeoutMs}ms`));
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    return def.execute(ctx);
  }

  private async _executeRouterNode(nid: NodeId, def: GraphNodeDef, ctx: NodeContext): Promise<unknown> {
    if (!def.route) {
      throw new Error(`Router node "${def.name}" has no route function`);
    }

    const routeLabel = await def.route(ctx);

    this._emitEvent(GraphEventType.ROUTE_DECIDED, nid, { route: routeLabel });

    // Find the edge matching this route label
    const outEdgeIds = this.graph.outgoing.get(nid) ?? [];
    let taken = false;

    for (const eid of outEdgeIds) {
      const edge = this.graph.edges.get(eid)!;
      if (edge.label === routeLabel) {
        this._emitEvent(GraphEventType.EDGE_TAKEN, nid, { edgeId: eid, to: edge.to, label: routeLabel });
        // Mark the target as ready and add to the candidate set
        this._updateNodeState(edge.to, { status: NodeStatus.READY, attempts: 0 });
        this._readyCandidates.add(edge.to);
        taken = true;
      } else {
        // Skip nodes on non-taken routes
        this._markSubtreeSkipped(edge.to, nid);
      }
    }

    if (!taken) {
      throw new Error(`Router node "${def.name}" returned route "${routeLabel}" but no edge matches`);
    }

    return routeLabel;
  }

  private async _executeParallelNode(_nid: NodeId, _def: GraphNodeDef, _ctx: NodeContext): Promise<unknown> {
    // Parallel node is a control flow node — it just marks all outgoing targets as ready
    // The actual parallel execution happens in _runLoop
    return undefined;
  }

  private async _executeJoinNode(nid: NodeId, def: GraphNodeDef, ctx: NodeContext): Promise<unknown> {
    // Collect results from all incoming branches
    if (def.execute) {
      return def.execute(ctx);
    }

    // Default: collect all upstream results
    const incomingEdgeIds = this.graph.incoming.get(nid) ?? [];
    const results: Record<string, unknown> = {};

    for (const eid of incomingEdgeIds) {
      const edge = this.graph.edges.get(eid)!;
      const sourceDef = this.graph.nodes.get(edge.from)!;
      results[sourceDef.name] = this.state.results[sourceDef.name];
    }

    return results;
  }

  private async _executeAgentNode(_nid: NodeId, def: GraphNodeDef, ctx: NodeContext): Promise<unknown> {
    // Agent nodes delegate to the LLM provider system.
    // The actual LLM call is handled externally via a plugin or the agentConfig.
    // Here we prepare the context and invoke execute if provided.
    if (def.execute) {
      return def.execute(ctx);
    }

    // If no execute function, return the agent config for external handling
    return { agentConfig: def.agentConfig, input: ctx.input };
  }

  private async _executeWaitNode(nid: NodeId, def: GraphNodeDef, _ctx: NodeContext): Promise<unknown> {
    if (!def.waitConfig) return undefined;

    this._updateNodeState(nid, { status: NodeStatus.WAITING });
    this._emitEvent(GraphEventType.NODE_WAITING, nid, { waitType: def.waitConfig.type });

    switch (def.waitConfig.type) {
      case 'timer': {
        const delay = def.waitConfig.delayMs ?? 0;
        await new Promise<void>(resolve => setTimeout(resolve, delay));
        return { waited: delay };
      }
      case 'signal': {
        const signalName = def.waitConfig.signalName ?? def.name;
        const timeoutMs = def.waitConfig.timeoutMs ?? 0;

        return new Promise((resolve, reject) => {
          let signalTimer: ReturnType<typeof setTimeout> | undefined;

          this.pendingSignals.set(signalName, (value?: unknown) => {
            if (signalTimer !== undefined) clearTimeout(signalTimer);
            resolve(value);
          });

          if (timeoutMs > 0) {
            signalTimer = setTimeout(() => {
              if (this.pendingSignals.has(signalName)) {
                this.pendingSignals.delete(signalName);
                reject(new Error(`Signal "${signalName}" timed out after ${timeoutMs}ms`));
              }
            }, timeoutMs);
          }
        });
      }
      case 'human':
      case 'webhook': {
        // Suspend execution — external system must call signal() or resume()
        this.state.status = ExecutionStatus.SUSPENDED;
        return undefined;
      }
    }
  }

  private async _executeSubgraphNode(_nid: NodeId, def: GraphNodeDef, ctx: NodeContext): Promise<unknown> {
    // Subgraph execution is handled externally — return config for the caller
    if (def.execute) {
      return def.execute(ctx);
    }
    return { subgraphId: def.subgraphId, input: ctx.input };
  }

  // ── Error Handling ────────────────────────────────────────────────────

  private async _handleNodeError(nid: NodeId, def: GraphNodeDef, err: unknown, attempt: number): Promise<void> {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const retry = def.retry ?? this.graph.defaultRetry;

    // Notify plugins
    for (const p of this.plugins) {
      await p.onNodeError?.(nid, err, attempt);
    }

    if (retry && attempt < retry.maxRetries) {
      // Check if error is retryable
      if (retry.retryOn && !retry.retryOn(err)) {
        this._failNode(nid, errorMsg);
        return;
      }

      // Calculate backoff
      const base = retry.exponentialBase ?? 2;
      const delay = Math.min(
        retry.backoffMs * Math.pow(base, attempt - 1),
        retry.maxBackoffMs ?? 30000
      );

      this._updateNodeState(nid, { status: NodeStatus.RETRYING });
      this._emitEvent(GraphEventType.NODE_RETRYING, nid, {
        attempt,
        nextAttempt: attempt + 1,
        delayMs: delay,
        error: errorMsg,
      });

      // Wait for backoff
      await new Promise(resolve => setTimeout(resolve, delay));

      // Retry: reset to PENDING so _runLoop picks it up
      this._updateNodeState(nid, { status: NodeStatus.PENDING });
    } else {
      this._failNode(nid, errorMsg);
    }
  }

  private _failNode(nid: NodeId, error: string): void {
    this._updateNodeState(nid, {
      status: NodeStatus.FAILED,
      error,
      completedAt: Date.now(),
    });
    this._emitEvent(GraphEventType.NODE_FAILED, nid, { error });

    // Cancel downstream nodes
    this._markSubtreeSkipped(nid, nid);

    // Fail the whole execution
    this.state.status = ExecutionStatus.FAILED;
    this.state.error = `Node "${this.graph.nodes.get(nid)?.name}" failed: ${error}`;
  }

  // ── State Management ──────────────────────────────────────────────────

  private _createInitialState(): GraphState {
    const nodes: Record<string, NodeState> = {};

    for (const [nid] of this.graph.nodes) {
      nodes[nid] = {
        nodeId: nid,
        status: NodeStatus.PENDING,
        attempts: 0,
      };
    }

    return {
      variables: {},
      results: {},
      nodes,
      status: ExecutionStatus.CREATED,
      activeNodes: [],
    };
  }

  private _updateNodeState(nid: NodeId, patch: Partial<NodeState>): void {
    const current = this.state.nodes[nid];
    if (!current) return;
    this.state.nodes[nid] = { ...current, ...patch, nodeId: nid };
  }

  private _createNodeContext(nid: NodeId, def: GraphNodeDef, attempt: number): NodeContext {
    // Collect input from upstream node outputs
    const incomingEdgeIds = this.graph.incoming.get(nid) ?? [];
    let input: unknown = this.state.variables;

    if (incomingEdgeIds.length === 1) {
      const edge = this.graph.edges.get(incomingEdgeIds[0])!;
      const sourceDef = this.graph.nodes.get(edge.from);
      if (sourceDef) {
        const sourceOutput = this.state.results[sourceDef.name];
        input = sourceOutput !== undefined ? sourceOutput : this.state.variables;
        // Apply edge transform if present
        if (edge.transform) {
          const transformedState = edge.transform({ ...this.state });
          input = transformedState.variables;
        }
      }
    } else if (incomingEdgeIds.length > 1) {
      // Multiple inputs: collect into an object
      const collected: Record<string, unknown> = {};
      for (const eid of incomingEdgeIds) {
        const edge = this.graph.edges.get(eid)!;
        const sourceDef = this.graph.nodes.get(edge.from);
        if (sourceDef) {
          collected[sourceDef.name] = this.state.results[sourceDef.name];
        }
      }
      input = collected;
    }

    return {
      executionId: this.exId,
      nodeId: nid,
      nodeName: def.name,
      input,
      state: Object.freeze({ ...this.state }),
      setVariable: (key, value) => {
        this.state.variables[key] = value;
        this._emitEvent(GraphEventType.VARIABLE_SET, nid, { key, value });
      },
      getVariable: <T = unknown>(key: string): T | undefined => this.state.variables[key] as T | undefined,
      getNodeOutput: <T = unknown>(name: string): T | undefined => this.state.results[name] as T | undefined,
      signal: this.abortController.signal,
      emit: (event, data) => {
        this._emitEvent(GraphEventType.STATE_UPDATED, nid, { customEvent: event, data });
      },
      log: this.loggerFactory(nid, def.name),
      attempt,
      metadata: def.metadata ?? {},
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private _markSubtreeSkipped(startNodeId: NodeId, _fromNodeId: NodeId): void {
    const visited = new Set<NodeId>();
    const queue: NodeId[] = [startNodeId];
    let head = 0; // head pointer — O(1) dequeue instead of O(n) shift()

    while (head < queue.length) {
      const current = queue[head++];
      if (visited.has(current)) continue;
      visited.add(current);

      const nodeState = this.state.nodes[current];
      // Only skip nodes that haven't started
      if (nodeState && (nodeState.status === NodeStatus.PENDING || nodeState.status === NodeStatus.READY)) {
        this._updateNodeState(current, { status: NodeStatus.SKIPPED });
        this._emitEvent(GraphEventType.NODE_SKIPPED, current);

        // Continue to downstream nodes
        const outEdgeIds = this.graph.outgoing.get(current) ?? [];
        for (const eid of outEdgeIds) {
          const edge = this.graph.edges.get(eid)!;
          queue.push(edge.to);
        }
      }
    }
  }

  /** Notify all waiters that a node has completed. */
  private _notifyCompletion(): void {
    if (this._completionResolvers.size === 0) return;
    const resolvers = this._completionResolvers;
    this._completionResolvers = new Set();
    for (const r of resolvers) r();
  }

  private _waitForAnyCompletion(): Promise<void> {
    // Fast path: nothing active
    if (this._activeNodeSet.size === 0 || this.abortController.signal.aborted) {
      return Promise.resolve();
    }
    // Suspend until _notifyCompletion() is called from _executeNode's finally block
    return new Promise<void>(resolve => {
      this._completionResolvers.add(resolve);
    });
  }

  // ── Event Emission ────────────────────────────────────────────────────

  private _emitEvent(type: GraphEventType, nodeId?: NodeId, data?: Record<string, unknown>): void {
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

    // Notify listeners
    const listeners = this.eventListeners.get(type) ?? new Set();
    const allListeners = this.eventListeners.get('*') ?? new Set();
    for (const handler of listeners) handler(event);
    for (const handler of allListeners) handler(event);

    // Notify plugins
    for (const p of this.plugins) {
      p.onEvent?.(event);
    }

    // Persist to event store
    this.eventStore?.append([event]).catch(() => {
      // Non-blocking — log error but don't fail execution
    });
  }

  // ── Checkpointing ────────────────────────────────────────────────────

  private async _saveCheckpoint(): Promise<void> {
    if (!this.eventStore) return;

    const checkpoint: Checkpoint = {
      executionId: this.exId,
      graphId: this.graph.id,
      state: structuredClone(this.state),
      sequence: this.sequence,
      timestamp: Date.now(),
    };

    await this.eventStore.saveCheckpoint(checkpoint);
    this._emitEvent(GraphEventType.CHECKPOINT_SAVED, undefined, { sequence: this.sequence });
  }
}

// ── Durable Executor ────────────────────────────────────────────────────────

/**
 * DurableExecutor — crash-safe wrapper over DAGEngine.
 *
 * Every state transition is persisted to an EventStore. On resume,
 * events are replayed to reconstruct state; nodes that already have a
 * NODE_COMPLETED event are not re-executed (idempotency guarantee).
 *
 * @example
 *   const durable = new DurableExecutor(graph, store);
 *   const result  = await durable.run({ variables: { x: 1 } });
 *   // process crashes …
 *   const resumed = await durable.resume(result.executionId);
 */
export class DurableExecutor {
  constructor(
    private readonly graph: GraphDef,
    private readonly eventStore: EventStore,
  ) {}

  /** Start a fresh execution. An execution ID is auto-generated. */
  async run(options: Omit<ExecuteOptions, 'eventStore' | 'resumeFrom'> = {}): Promise<ExecutionResult> {
    const engine = new DAGEngine(this.graph);
    return engine.execute({ ...options, eventStore: this.eventStore });
  }

  /**
   * Resume an interrupted execution from its persisted event log.
   *
   * Steps:
   * 1. Load all events for `executionId` from the EventStore.
   * 2. Reconstruct state via `replayState()`.
   * 3. If the run already reached a terminal status, return immediately.
   * 4. Verify graph version compatibility (optional — only when both sides carry a version).
   * 5. Reset nodes that were RUNNING at crash time back to PENDING.
   * 6. Resume execution from the reconstructed checkpoint.
   */
  async resume(
    executionId: ExecutionId,
    options: Omit<ExecuteOptions, 'eventStore' | 'resumeFrom' | 'executionId'> = {},
  ): Promise<ExecutionResult> {
    const storedEvents = await this.eventStore.load(executionId);
    if (storedEvents.length === 0) {
      throw new Error(`DurableExecutor: no events found for execution "${executionId}"`);
    }

    // Optional graph version compatibility check
    const startEvent = storedEvents.find(e => e.type === GraphEventType.EXECUTION_STARTED);
    const runVersion = startEvent?.data?.graphVersion as string | undefined;
    if (runVersion && this.graph.version && runVersion !== this.graph.version) {
      throw new Error(
        `DurableExecutor: graph version mismatch — run started with v${runVersion}, ` +
        `current graph is v${this.graph.version}. Cannot safely resume.`,
      );
    }

    // Reconstruct state from the event log
    const reconstituted = replayState(storedEvents, this.graph);

    // Already terminal — nothing to re-execute
    if (
      reconstituted.status === ExecutionStatus.COMPLETED ||
      reconstituted.status === ExecutionStatus.FAILED ||
      reconstituted.status === ExecutionStatus.CANCELLED
    ) {
      return {
        executionId,
        status: reconstituted.status,
        state: reconstituted,
        events: storedEvents,
        durationMs: 0,
        error: reconstituted.error,
      };
    }

    // Idempotency: collect node IDs that have a NODE_COMPLETED record
    const completedNodeIds = new Set<string>(
      storedEvents
        .filter(e => e.type === GraphEventType.NODE_COMPLETED && e.nodeId)
        .map(e => e.nodeId!),
    );

    // Reset mid-flight nodes (crashed while RUNNING / RETRYING) back to PENDING
    for (const [nid, ns] of Object.entries(reconstituted.nodes)) {
      if (
        (ns.status === NodeStatus.RUNNING || ns.status === NodeStatus.RETRYING) &&
        !completedNodeIds.has(nid)
      ) {
        reconstituted.nodes[nid] = { ...ns, status: NodeStatus.PENDING, attempts: 0 };
      }
    }
    reconstituted.activeNodes = [];
    reconstituted.status = ExecutionStatus.RUNNING;

    const lastSeq = storedEvents.reduce((m, e) => Math.max(m, e.sequence), 0);

    const engine = new DAGEngine(this.graph);
    return engine.execute({
      ...options,
      executionId,
      eventStore: this.eventStore,
      resumeFrom: {
        executionId,
        graphId: this.graph.id,
        state: reconstituted,
        sequence: lastSeq,
        timestamp: Date.now(),
      },
    });
  }
}

// ── Replay Engine ───────────────────────────────────────────────────────────

/**
 * Deterministic replay: reconstruct state from events.
 * This is the read-side of event sourcing.
 */
export function replayState(events: GraphEvent[], graph: GraphDef): GraphState {
  const state: GraphState = {
    variables: {},
    results: {},
    nodes: {},
    status: ExecutionStatus.CREATED,
    activeNodes: [],
  };

  // Initialize all nodes
  for (const [nid] of graph.nodes) {
    state.nodes[nid] = {
      nodeId: nid,
      status: NodeStatus.PENDING,
      attempts: 0,
    };
  }

  // Replay events in sequence order
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);

  for (const event of sorted) {
    switch (event.type) {
      case GraphEventType.EXECUTION_STARTED:
        state.status = ExecutionStatus.RUNNING;
        break;
      case GraphEventType.EXECUTION_COMPLETED:
        state.status = ExecutionStatus.COMPLETED;
        break;
      case GraphEventType.EXECUTION_FAILED:
        state.status = ExecutionStatus.FAILED;
        state.error = event.data?.error as string;
        break;
      case GraphEventType.EXECUTION_PAUSED:
        state.status = ExecutionStatus.PAUSED;
        break;
      case GraphEventType.EXECUTION_CANCELLED:
        state.status = ExecutionStatus.CANCELLED;
        break;
      case GraphEventType.NODE_STARTED:
        if (event.nodeId) {
          state.nodes[event.nodeId] = {
            ...state.nodes[event.nodeId],
            nodeId: event.nodeId,
            status: NodeStatus.RUNNING,
            attempts: (event.data?.attempt as number) ?? 1,
            startedAt: event.timestamp,
          };
          if (!state.activeNodes.includes(event.nodeId)) {
            state.activeNodes.push(event.nodeId);
          }
        }
        break;
      case GraphEventType.NODE_COMPLETED:
        if (event.nodeId) {
          const completedOutput = event.data?.output;
          state.nodes[event.nodeId] = {
            ...state.nodes[event.nodeId],
            nodeId: event.nodeId,
            status: NodeStatus.COMPLETED,
            output: completedOutput,
            completedAt: event.timestamp,
            durationMs: event.data?.durationMs as number,
          };
          // Restore the node's output into state.results so downstream nodes
          // resume with the correct inputs. Prefer the persisted node name,
          // falling back to the graph definition.
          const resultName =
            (event.data?.nodeName as string | undefined) ??
            graph.nodes.get(event.nodeId)?.name;
          if (resultName) {
            state.results[resultName] = completedOutput;
          }
          state.activeNodes = state.activeNodes.filter(id => id !== event.nodeId);
        }
        break;
      case GraphEventType.NODE_FAILED:
        if (event.nodeId) {
          state.nodes[event.nodeId] = {
            ...state.nodes[event.nodeId],
            nodeId: event.nodeId,
            status: NodeStatus.FAILED,
            error: event.data?.error as string,
            completedAt: event.timestamp,
          };
          state.activeNodes = state.activeNodes.filter(id => id !== event.nodeId);
        }
        break;
      case GraphEventType.NODE_SKIPPED:
        if (event.nodeId) {
          state.nodes[event.nodeId] = {
            ...state.nodes[event.nodeId],
            nodeId: event.nodeId,
            status: NodeStatus.SKIPPED,
          };
        }
        break;
      case GraphEventType.VARIABLE_SET:
        if (event.data?.key) {
          state.variables[event.data.key as string] = event.data.value;
        }
        break;
    }
  }

  return state;
}
