/**
 * Graph Builder — Fluent API for constructing execution graphs
 *
 * Design: Builder pattern that produces an immutable GraphDef.
 * The API reads naturally:
 *
 *   const graph = new GraphBuilder('my-workflow')
 *     .addNode('fetch', { kind: 'task', execute: fetchData })
 *     .addNode('analyze', { kind: 'task', execute: analyzeData })
 *     .addEdge('fetch', 'analyze')
 *     .build();
 *
 * For complex graphs with branching:
 *
 *   const graph = new GraphBuilder('classifier')
 *     .addNode('classify', { kind: 'router', route: classifyInput })
 *     .addNode('sentiment', { kind: 'task', execute: runSentiment })
 *     .addNode('ner', { kind: 'task', execute: runNer })
 *     .addEdge('classify', 'sentiment', { label: 'sentiment' })
 *     .addEdge('classify', 'ner', { label: 'ner' })
 *     .build();
 */

import {
  type GraphDef,
  type GraphNodeDef,
  type GraphEdgeDef,
  type RetryPolicy,
  type TimeoutPolicy,
  type NodeId,
  type EdgeId,
  type GraphId,
  NodeKind,
  nodeId,
  edgeId,
  graphId,
  type NodeContext,
  type GraphState,
} from './types.js';

// ── Node Config Shorthand ───────────────────────────────────────────────────

export interface TaskNodeConfig<TInput = unknown, TOutput = unknown> {
  execute: (ctx: NodeContext<TInput>) => Promise<TOutput>;
  retry?: RetryPolicy;
  timeout?: TimeoutPolicy;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface RouterNodeConfig<TInput = unknown> {
  route: (ctx: NodeContext<TInput>) => Promise<string>;
  description?: string;
}

export interface ParallelNodeConfig {
  description?: string;
  /** Max concurrent branches (defaults to unlimited) */
  maxConcurrency?: number;
}

export interface JoinNodeConfig<TInput = unknown, TOutput = unknown> {
  /** Merge function for results from parallel branches */
  merge?: (results: Record<string, unknown>, ctx: NodeContext<TInput>) => Promise<TOutput>;
  /** Wait for all branches or just the first */
  strategy?: 'all' | 'race' | 'settled';
  description?: string;
}

export interface AgentNodeShortConfig {
  instructions: string;
  tools?: string[];
  model?: string;
  provider?: string;
  maxSteps?: number;
  temperature?: number;
  retry?: RetryPolicy;
  timeout?: TimeoutPolicy;
  description?: string;
}

export interface WaitNodeShortConfig {
  type: 'human' | 'webhook' | 'timer' | 'signal';
  delayMs?: number;
  signalName?: string;
  timeoutMs?: number;
  description?: string;
}

export type NodeConfig =
  | ({ kind: 'task' } & TaskNodeConfig)
  | ({ kind: 'router' } & RouterNodeConfig)
  | ({ kind: 'parallel' } & ParallelNodeConfig)
  | ({ kind: 'join' } & JoinNodeConfig)
  | ({ kind: 'agent' } & AgentNodeShortConfig)
  | ({ kind: 'wait' } & WaitNodeShortConfig)
  | ({ kind: 'subgraph'; subgraphId: string; description?: string })
  | ({ kind: 'start'; description?: string })
  | ({ kind: 'end'; description?: string });

export interface EdgeConfig {
  label?: string;
  condition?: (state: GraphState) => Promise<boolean> | boolean;
  priority?: number;
  transform?: (state: GraphState) => GraphState;
}

// ── Graph Builder ───────────────────────────────────────────────────────────

export class GraphBuilder {
  private _id: GraphId;
  private _name: string;
  private _description?: string;
  private _version?: string;
  private _nodes: Map<NodeId, GraphNodeDef> = new Map();
  private _edges: Map<EdgeId, GraphEdgeDef> = new Map();
  private _outgoing: Map<NodeId, EdgeId[]> = new Map();
  private _incoming: Map<NodeId, EdgeId[]> = new Map();
  private _startNodeId?: NodeId;
  private _defaultRetry?: RetryPolicy;
  private _defaultTimeout?: TimeoutPolicy;
  private _maxConcurrency?: number;
  private _metadata?: Record<string, unknown>;
  private _nodeNames: Map<string, NodeId> = new Map();

  constructor(name: string, options?: { id?: string; description?: string; version?: string }) {
    this._id = graphId(options?.id);
    this._name = name;
    this._description = options?.description;
    this._version = options?.version;
  }

  // ── Configuration ───────────────────────────────────────────────────────

  description(desc: string): this {
    this._description = desc;
    return this;
  }

  version(v: string): this {
    this._version = v;
    return this;
  }

  defaultRetry(policy: RetryPolicy): this {
    this._defaultRetry = policy;
    return this;
  }

  defaultTimeout(policy: TimeoutPolicy): this {
    this._defaultTimeout = policy;
    return this;
  }

  maxConcurrency(n: number): this {
    this._maxConcurrency = n;
    return this;
  }

  meta(data: Record<string, unknown>): this {
    this._metadata = { ...this._metadata, ...data };
    return this;
  }

  // ── Node Addition ─────────────────────────────────────────────────────

  addNode(name: string, config: NodeConfig): this {
    const id = nodeId();
    this._nodeNames.set(name, id);

    const nodeDef: GraphNodeDef = {
      id,
      kind: kindStringToEnum(config.kind),
      name,
      description: config.description,
      metadata: 'metadata' in config ? config.metadata : undefined,
    };

    switch (config.kind) {
      case 'task':
        nodeDef.execute = config.execute;
        nodeDef.retry = config.retry;
        nodeDef.timeout = config.timeout;
        break;
      case 'router':
        nodeDef.route = config.route;
        break;
      case 'parallel':
        if (config.maxConcurrency) {
          nodeDef.metadata = { ...nodeDef.metadata, maxConcurrency: config.maxConcurrency };
        }
        break;
      case 'join':
        if (config.merge) {
          nodeDef.execute = async (ctx) => {
            const results: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(ctx.state.results)) {
              results[k] = v;
            }
            return (config as JoinNodeConfig).merge!(results, ctx);
          };
        }
        if (config.strategy) {
          nodeDef.metadata = { ...nodeDef.metadata, joinStrategy: config.strategy };
        }
        break;
      case 'agent':
        nodeDef.agentConfig = {
          instructions: config.instructions,
          tools: config.tools,
          model: config.model,
          provider: config.provider,
          maxSteps: config.maxSteps,
          temperature: config.temperature,
        };
        nodeDef.retry = config.retry;
        nodeDef.timeout = config.timeout;
        break;
      case 'wait':
        nodeDef.waitConfig = {
          type: config.type,
          delayMs: config.delayMs,
          signalName: config.signalName,
          timeoutMs: config.timeoutMs,
        };
        break;
      case 'subgraph':
        nodeDef.subgraphId = graphId(config.subgraphId);
        break;
      case 'start':
        this._startNodeId = id;
        break;
      case 'end':
        break;
    }

    this._nodes.set(id, nodeDef);
    this._outgoing.set(id, []);
    this._incoming.set(id, []);

    return this;
  }

  // ── Edge Addition ─────────────────────────────────────────────────────

  /**
   * Add conditional edges: node output value determines which edge to follow.
   * LangGraph parity — maps output values to target nodes.
   *
   * @example
   * 
   */
  /**
   * Add conditional edges: node output value determines which edge to follow.
   * LangGraph parity — maps output values to target nodes.
   *
   * @example
   * addConditionalEdges('classify', {
   *   map: { positive: 'handlePositive', negative: 'handleNegative' },
   *   default: 'handleNeutral',
   * })
   */
  addConditionalEdges(
    fromName: string,
    conditional: { map: Record<string, string>; default?: string },
  ): this {
    const fromId = this._resolveNodeId(fromName);
    for (const [value, toName] of Object.entries(conditional.map)) {
      const toId = this._resolveNodeId(toName);
      const id = `edge-${fromId}-${value}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      this._edges.set(id, {
        id,
        from: fromId,
        to: toId,
        label: value,
        conditional: { [value]: toId },
        priority: 0,
      });
      this._outgoing.get(fromId)!.push(id);
      this._incoming.get(toId)!.push(id);
    }
    if (conditional.default) {
      const defaultId = this._resolveNodeId(conditional.default);
      const existing = Array.from(this._edges.values()).find(
        e => e.from === fromId && e.to === defaultId && e.label === '__default__'
      );
      if (!existing) {
        const id = `edge-${fromId}-default-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        this._edges.set(id, {
          id,
          from: fromId,
          to: defaultId,
          label: '__default__',
          priority: 999,
        });
        this._outgoing.get(fromId)!.push(id);
        this._incoming.get(defaultId)!.push(id);
      }
    }
    return this;
  }

  addEdge(fromName: string, toName: string, config?: EdgeConfig): this {
    const fromId = this._resolveNodeId(fromName);
    const toId = this._resolveNodeId(toName);
    const id = edgeId();

    const edge: GraphEdgeDef = {
      id,
      from: fromId,
      to: toId,
      label: config?.label,
      condition: config?.condition,
      priority: config?.priority,
      transform: config?.transform,
    };

    this._edges.set(id, edge);
    this._outgoing.get(fromId)!.push(id);
    this._incoming.get(toId)!.push(id);

    return this;
  }

  // ── Convenience: Chain ────────────────────────────────────────────────

  /**
   * Add a linear chain: a -> b -> c -> d
   */
  chain(...names: string[]): this {
    for (let i = 0; i < names.length - 1; i++) {
      this.addEdge(names[i], names[i + 1]);
    }
    return this;
  }

  /**
   * Add parallel fan-out from a node to multiple targets
   */
  fanOut(from: string, targets: string[]): this {
    for (const t of targets) {
      this.addEdge(from, t);
    }
    return this;
  }

  /**
   * Add fan-in from multiple sources to a single node
   */
  fanIn(sources: string[], to: string): this {
    for (const s of sources) {
      this.addEdge(s, to);
    }
    return this;
  }

  // ── Build ─────────────────────────────────────────────────────────────

  build(): GraphDef {
    // Auto-detect start node if not explicitly set
    if (!this._startNodeId) {
      // Find nodes with no incoming edges
      for (const [nid] of this._nodes) {
        const incoming = this._incoming.get(nid) ?? [];
        if (incoming.length === 0) {
          this._startNodeId = nid;
          break;
        }
      }
    }

    if (!this._startNodeId && this._nodes.size > 0) {
      throw new Error('Graph must have a start node (a node with no incoming edges, or a node of kind "start")');
    }

    // Validate: check for cycles in non-loop graphs
    this._validateNoCycles();

    return {
      id: this._id,
      name: this._name,
      description: this._description,
      version: this._version,
      nodes: new Map(this._nodes),
      edges: new Map(this._edges),
      outgoing: new Map(this._outgoing),
      incoming: new Map(this._incoming),
      startNodeId: this._startNodeId!,
      defaultRetry: this._defaultRetry,
      defaultTimeout: this._defaultTimeout,
      maxConcurrency: this._maxConcurrency,
      metadata: this._metadata,
    };
  }

  // ── Private ───────────────────────────────────────────────────────────

  private _resolveNodeId(name: string): NodeId {
    const id = this._nodeNames.get(name);
    if (!id) {
      throw new Error(`Node "${name}" not found. Did you call addNode('${name}', ...) first?`);
    }
    return id;
  }

  private _validateNoCycles(): void {
    const visited = new Set<NodeId>();
    const stack = new Set<NodeId>();

    const dfs = (nid: NodeId): boolean => {
      if (stack.has(nid)) return true; // Cycle!
      if (visited.has(nid)) return false;
      visited.add(nid);
      stack.add(nid);

      for (const eid of this._outgoing.get(nid) ?? []) {
        const edge = this._edges.get(eid)!;
        if (dfs(edge.to)) return true;
      }

      stack.delete(nid);
      return false;
    };

    for (const [nid] of this._nodes) {
      if (dfs(nid)) {
        throw new Error(`Cycle detected in graph starting from node "${this._nodes.get(nid)!.name}". Use explicit loop constructs instead.`);
      }
    }
  }
}

// ── Shorthand Helpers ───────────────────────────────────────────────────────

/**
 * Create a graph with the fluent builder API
 *
 * @example
 * const graph = createGraph('my-workflow')
 *   .addNode('start', { kind: 'start' })
 *   .addNode('process', { kind: 'task', execute: processData })
 *   .addNode('end', { kind: 'end' })
 *   .chain('start', 'process', 'end')
 *   .build();
 */
export function createGraph(name: string, options?: { id?: string; description?: string; version?: string }): GraphBuilder {
  return new GraphBuilder(name, options);
}

function kindStringToEnum(kind: string): NodeKind {
  switch (kind) {
    case 'task': return NodeKind.TASK;
    case 'router': return NodeKind.ROUTER;
    case 'parallel': return NodeKind.PARALLEL;
    case 'join': return NodeKind.JOIN;
    case 'subgraph': return NodeKind.SUBGRAPH;
    case 'agent': return NodeKind.AGENT;
    case 'wait': return NodeKind.WAIT;
    case 'start': return NodeKind.START;
    case 'end': return NodeKind.END;
    default: throw new Error(`Unknown node kind: ${kind}`);
  }
}
