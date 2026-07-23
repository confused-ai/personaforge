/**
 * Tests for Graph Execution Engine
 *
 * Covers:
 * 1. Graph builder API
 * 2. DAG engine: sequential, parallel, branching, joining
 * 3. Event sourcing + replay
 * 4. Durability: checkpoint save/load
 * 5. Error handling + retries
 * 6. Scheduler + worker model
 * 7. Multi-agent orchestration
 * 8. Memory system
 * 9. Plugin system
 * 10. DurableExecutor: crash recovery + idempotency
 * 11. computeWaves + BackpressureController
 * 12. createTestRunner + mock utilities

 * 7. Multi-agent orchestration
 * 8. Memory system
 * 9. Plugin system
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  // Builder
  createGraph,
  GraphBuilder,
  // Engine
  DAGEngine,
  replayState,
  DurableExecutor,
  // Event store
  InMemoryEventStore,
  // Scheduler
  InMemoryTaskQueue,
  DefaultScheduler,
  GraphWorker,
  computeWaves,
  BackpressureController,
  // Orchestrator
  AgentRuntime,
  MultiAgentOrchestrator,
  agentNode,
  // Memory
  InMemoryStore,
  InMemoryVectorMemory,
  ContextWindowManager,
  MemoryManager,
  // Plugins
  TelemetryPlugin,
  LoggingPlugin,
  AuditPlugin,
  RateLimitPlugin,
  // Types
  NodeKind,
  NodeStatus,
  ExecutionStatus,
  GraphEventType,
  type NodeContext,
  type LLMProvider,
  type LLMMessage,
  type LLMResponse,
  type AgentDef,
  type GraphPlugin,
} from '@personaforge/graph';

import {
  createTestRunner,
  createMockLLMProvider,
  expectEventSequence,
  assertExactEventSequence,
} from '../src/testing/graph-runner.js';

// ── Test Helpers ────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Simple mock LLM that returns predetermined responses */
function createMockLLM(name: string, response?: string): LLMProvider {
  return {
    name,
    async generate(messages: LLMMessage[]): Promise<LLMResponse> {
      return {
        content: response ?? `[${name}] Response to: ${messages[messages.length - 1]?.content?.slice(0, 50)}`,
        usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
        finishReason: 'stop',
      };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Graph Builder Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('GraphBuilder', () => {
  it('should build a simple linear graph', () => {
    const graph = createGraph('linear')
      .addNode('a', { kind: 'task', execute: async () => 'a-done' })
      .addNode('b', { kind: 'task', execute: async () => 'b-done' })
      .addNode('c', { kind: 'task', execute: async () => 'c-done' })
      .chain('a', 'b', 'c')
      .build();

    expect(graph.name).toBe('linear');
    expect(graph.nodes.size).toBe(3);
    expect(graph.edges.size).toBe(2);
  });

  it('should build a graph with fan-out and fan-in', () => {
    const graph = createGraph('fan')
      .addNode('start', { kind: 'start' })
      .addNode('a', { kind: 'task', execute: async () => 'a' })
      .addNode('b', { kind: 'task', execute: async () => 'b' })
      .addNode('c', { kind: 'task', execute: async () => 'c' })
      .addNode('merge', { kind: 'join' })
      .fanOut('start', ['a', 'b', 'c'])
      .fanIn(['a', 'b', 'c'], 'merge')
      .build();

    expect(graph.nodes.size).toBe(5);
    expect(graph.edges.size).toBe(6); // 3 out + 3 in
  });

  it('should detect cycles', () => {
    expect(() => {
      createGraph('cyclic')
        .addNode('start', { kind: 'start' })
        .addNode('a', { kind: 'task', execute: async () => {} })
        .addNode('b', { kind: 'task', execute: async () => {} })
        .addEdge('start', 'a')
        .addEdge('a', 'b')
        .addEdge('b', 'a')
        .build();
    }).toThrow(/Cycle detected/);
  });

  it('should throw when referencing non-existent node', () => {
    expect(() => {
      createGraph('bad')
        .addNode('a', { kind: 'task', execute: async () => {} })
        .addEdge('a', 'nonexistent');
    }).toThrow(/not found/);
  });

  it('should support metadata and versioning', () => {
    const graph = createGraph('versioned', {
      description: 'test graph',
      version: '2.0.0',
    })
      .addNode('a', { kind: 'task', execute: async () => {} })
      .meta({ author: 'test' })
      .build();

    expect(graph.description).toBe('test graph');
    expect(graph.version).toBe('2.0.0');
    expect(graph.metadata?.author).toBe('test');
  });

  it('should support router nodes with labels', () => {
    const graph = createGraph('router')
      .addNode('classify', {
        kind: 'router',
        route: async () => 'positive',
      })
      .addNode('pos', { kind: 'task', execute: async () => 'positive' })
      .addNode('neg', { kind: 'task', execute: async () => 'negative' })
      .addEdge('classify', 'pos', { label: 'positive' })
      .addEdge('classify', 'neg', { label: 'negative' })
      .build();

    expect(graph.nodes.size).toBe(3);
    expect(graph.edges.size).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DAG Engine Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('DAGEngine', () => {
  it('should execute a linear graph sequentially', async () => {
    const order: string[] = [];

    const graph = createGraph('linear')
      .addNode('a', { kind: 'task', execute: async () => { order.push('a'); return 'a-out'; } })
      .addNode('b', { kind: 'task', execute: async () => { order.push('b'); return 'b-out'; } })
      .addNode('c', { kind: 'task', execute: async () => { order.push('c'); return 'c-out'; } })
      .chain('a', 'b', 'c')
      .build();

    const engine = new DAGEngine(graph);
    const result = await engine.execute();

    expect(result.status).toBe(ExecutionStatus.COMPLETED);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(result.state.results['a']).toBe('a-out');
    expect(result.state.results['b']).toBe('b-out');
    expect(result.state.results['c']).toBe('c-out');
  });

  it('should execute independent nodes in parallel', async () => {
    const startTimes: Record<string, number> = {};

    const graph = createGraph('parallel')
      .addNode('start', { kind: 'start' })
      .addNode('a', {
        kind: 'task',
        execute: async () => {
          startTimes['a'] = Date.now();
          await delay(50);
          return 'a';
        },
      })
      .addNode('b', {
        kind: 'task',
        execute: async () => {
          startTimes['b'] = Date.now();
          await delay(50);
          return 'b';
        },
      })
      .addNode('c', {
        kind: 'task',
        execute: async () => {
          startTimes['c'] = Date.now();
          await delay(50);
          return 'c';
        },
      })
      .addEdge('start', 'a')
      .addEdge('start', 'b')
      .addEdge('start', 'c')
      .build();

    const engine = new DAGEngine(graph);
    const result = await engine.execute();

    expect(result.status).toBe(ExecutionStatus.COMPLETED);
    expect(result.state.results['a']).toBe('a');
    expect(result.state.results['b']).toBe('b');
    expect(result.state.results['c']).toBe('c');

    // Verify parallel execution: a, b, c should start within 20ms of each other
    const times = Object.values(startTimes);
    const maxDiff = Math.max(...times) - Math.min(...times);
    expect(maxDiff).toBeLessThan(30);
  });

  it('should handle routing (branching)', async () => {
    const executed: string[] = [];

    const graph = createGraph('router')
      .addNode('start', { kind: 'start' })
      .addNode('classify', {
        kind: 'router',
        route: async (ctx) => {
          const val = ctx.getVariable<string>('type');
          return val ?? 'default';
        },
      })
      .addNode('path-a', {
        kind: 'task',
        execute: async () => { executed.push('a'); return 'a'; },
      })
      .addNode('path-b', {
        kind: 'task',
        execute: async () => { executed.push('b'); return 'b'; },
      })
      .addEdge('start', 'classify')
      .addEdge('classify', 'path-a', { label: 'type-a' })
      .addEdge('classify', 'path-b', { label: 'type-b' })
      .build();

    const engine = new DAGEngine(graph);
    const result = await engine.execute({
      variables: { type: 'type-a' },
    });

    expect(result.status).toBe(ExecutionStatus.COMPLETED);
    expect(executed).toEqual(['a']);
    expect(result.state.nodes[Array.from(graph.nodes.entries()).find(([_, n]) => n.name === 'path-b')![0]]?.status)
      .toBe(NodeStatus.SKIPPED);
  });

  it('should pass variables between nodes', async () => {
    const graph = createGraph('variables')
      .addNode('producer', {
        kind: 'task',
        execute: async (ctx) => {
          ctx.setVariable('shared', 42);
          return 'produced';
        },
      })
      .addNode('consumer', {
        kind: 'task',
        execute: async (ctx) => {
          const val = ctx.getVariable<number>('shared');
          return `consumed-${val}`;
        },
      })
      .chain('producer', 'consumer')
      .build();

    const engine = new DAGEngine(graph);
    const result = await engine.execute();

    expect(result.status).toBe(ExecutionStatus.COMPLETED);
    expect(result.state.variables['shared']).toBe(42);
    expect(result.state.results['consumer']).toBe('consumed-42');
  });

  it('should handle node failures', async () => {
    const graph = createGraph('failure')
      .addNode('will-fail', {
        kind: 'task',
        execute: async () => { throw new Error('boom'); },
      })
      .build();

    const engine = new DAGEngine(graph);
    const result = await engine.execute();

    expect(result.status).toBe(ExecutionStatus.FAILED);
    expect(result.error).toContain('boom');
  });

  it('should retry failed nodes', async () => {
    let attempts = 0;

    const graph = createGraph('retry')
      .addNode('flaky', {
        kind: 'task',
        execute: async () => {
          attempts++;
          if (attempts < 3) throw new Error(`fail-${attempts}`);
          return 'success';
        },
        retry: { maxRetries: 3, backoffMs: 10 },
      })
      .build();

    const engine = new DAGEngine(graph);
    const result = await engine.execute();

    expect(result.status).toBe(ExecutionStatus.COMPLETED);
    expect(attempts).toBe(3);
    expect(result.state.results['flaky']).toBe('success');
  });

  it('should support cancellation via AbortSignal', async () => {
    const controller = new AbortController();

    const graph = createGraph('cancel')
      .addNode('slow', {
        kind: 'task',
        execute: async (ctx) => {
          // Check abort signal during execution
          for (let i = 0; i < 50; i++) {
            if (ctx.signal.aborted) throw new Error('Cancelled');
            await delay(10);
          }
          return 'done';
        },
      })
      .build();

    const engine = new DAGEngine(graph);

    // Cancel after 50ms
    setTimeout(() => controller.abort(), 50);

    const result = await engine.execute({ signal: controller.signal });
    expect([ExecutionStatus.CANCELLED, ExecutionStatus.FAILED]).toContain(result.status);
  });

  it('should emit events for all state transitions', async () => {
    const eventStore = new InMemoryEventStore();

    const graph = createGraph('events')
      .addNode('a', { kind: 'task', execute: async () => 'a' })
      .addNode('b', { kind: 'task', execute: async () => 'b' })
      .chain('a', 'b')
      .build();

    const engine = new DAGEngine(graph);
    const result = await engine.execute({ eventStore });

    const events = await eventStore.load(result.executionId);
    // Should have events for execution lifecycle + node transitions
    expect(events.length).toBeGreaterThanOrEqual(4);

    const nodeStarted = events.filter(e => e.type === GraphEventType.NODE_STARTED);
    const nodeCompleted = events.filter(e => e.type === GraphEventType.NODE_COMPLETED);
    expect(nodeStarted.length).toBeGreaterThanOrEqual(2);
    expect(nodeCompleted.length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Event Store & Replay Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('EventStore & Replay', () => {
  it('InMemoryEventStore should store and retrieve events', async () => {
    const store = new InMemoryEventStore();

    const events = [
      {
        id: 'e1',
        type: GraphEventType.EXECUTION_STARTED,
        executionId: 'x1' as any,
        graphId: 'g1' as any,
        timestamp: Date.now(),
        sequence: 1,
      },
      {
        id: 'e2',
        type: GraphEventType.NODE_STARTED,
        executionId: 'x1' as any,
        graphId: 'g1' as any,
        timestamp: Date.now(),
        sequence: 2,
        nodeId: 'n1' as any,
        data: { attempt: 1 },
      },
    ];

    await store.append(events);
    const loaded = await store.load('x1' as any);

    expect(loaded.length).toBe(2);
    expect(loaded[0].type).toBe(GraphEventType.EXECUTION_STARTED);
    expect(loaded[1].nodeId).toBe('n1');
  });

  it('InMemoryEventStore should be idempotent', async () => {
    const store = new InMemoryEventStore();
    const event = {
      id: 'e1',
      type: GraphEventType.EXECUTION_STARTED,
      executionId: 'x1' as any,
      graphId: 'g1' as any,
      timestamp: Date.now(),
      sequence: 1,
    };

    await store.append([event]);
    await store.append([event]); // Duplicate

    const loaded = await store.load('x1' as any);
    expect(loaded.length).toBe(1); // Not duplicated
  });

  it('should replay state from events', () => {
    const graph = createGraph('replay-test')
      .addNode('a', { kind: 'task', execute: async () => {} })
      .addNode('b', { kind: 'task', execute: async () => {} })
      .chain('a', 'b')
      .build();

    const nodeIds = Array.from(graph.nodes.keys());

    const events = [
      {
        id: 'e1', type: GraphEventType.EXECUTION_STARTED,
        executionId: 'x1' as any, graphId: graph.id,
        timestamp: 1000, sequence: 1,
      },
      {
        id: 'e2', type: GraphEventType.NODE_STARTED,
        executionId: 'x1' as any, graphId: graph.id,
        timestamp: 1001, sequence: 2, nodeId: nodeIds[0],
        data: { attempt: 1 },
      },
      {
        id: 'e3', type: GraphEventType.NODE_COMPLETED,
        executionId: 'x1' as any, graphId: graph.id,
        timestamp: 1050, sequence: 3, nodeId: nodeIds[0],
        data: { durationMs: 49 },
      },
      {
        id: 'e4', type: GraphEventType.NODE_STARTED,
        executionId: 'x1' as any, graphId: graph.id,
        timestamp: 1051, sequence: 4, nodeId: nodeIds[1],
        data: { attempt: 1 },
      },
      {
        id: 'e5', type: GraphEventType.NODE_COMPLETED,
        executionId: 'x1' as any, graphId: graph.id,
        timestamp: 1100, sequence: 5, nodeId: nodeIds[1],
        data: { durationMs: 49 },
      },
      {
        id: 'e6', type: GraphEventType.EXECUTION_COMPLETED,
        executionId: 'x1' as any, graphId: graph.id,
        timestamp: 1101, sequence: 6,
      },
    ] as any;

    const state = replayState(events, graph);

    expect(state.status).toBe(ExecutionStatus.COMPLETED);
    expect(state.nodes[nodeIds[0]].status).toBe(NodeStatus.COMPLETED);
    expect(state.nodes[nodeIds[1]].status).toBe(NodeStatus.COMPLETED);
    expect(state.activeNodes.length).toBe(0);
  });

  it('should handle checkpoint save/load', async () => {
    const store = new InMemoryEventStore();

    const checkpoint = {
      executionId: 'x1' as any,
      graphId: 'g1' as any,
      state: {
        variables: { key: 'value' },
        results: { nodeA: 'output' },
        nodes: {},
        status: ExecutionStatus.PAUSED,
        activeNodes: [],
      },
      sequence: 5,
      timestamp: Date.now(),
    };

    await store.saveCheckpoint(checkpoint);
    const loaded = await store.getCheckpoint('x1' as any);

    expect(loaded).not.toBeNull();
    expect(loaded!.state.variables.key).toBe('value');
    expect(loaded!.sequence).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Scheduler & Worker Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Scheduler & Workers', () => {
  it('InMemoryTaskQueue should enqueue and consume tasks', async () => {
    const queue = new InMemoryTaskQueue();
    const results: string[] = [];

    await queue.consume(async (task) => {
      results.push(task.nodeDef.name);
      return {
        executionId: task.executionId,
        nodeId: task.nodeId,
        success: true,
        output: 'done',
        durationMs: 10,
        mutations: [],
      };
    });

    await queue.enqueue({
      executionId: 'x1' as any,
      graphId: 'g1' as any,
      nodeId: 'n1' as any,
      nodeDef: { id: 'n1' as any, kind: NodeKind.TASK, name: 'test-task' },
      input: {},
      state: { variables: {}, results: {}, nodes: {}, status: ExecutionStatus.RUNNING, activeNodes: [] },
      attempt: 1,
      idempotencyKey: 'x1:n1:1',
    });

    await delay(50);
    expect(results).toContain('test-task');

    await queue.close();
  });

  it('DefaultScheduler should identify ready nodes', () => {
    const graph = createGraph('sched-test')
      .addNode('a', { kind: 'task', execute: async () => {} })
      .addNode('b', { kind: 'task', execute: async () => {} })
      .addNode('c', { kind: 'task', execute: async () => {} })
      .chain('a', 'b', 'c')
      .build();

    const queue = new InMemoryTaskQueue();
    const scheduler = new DefaultScheduler(graph, queue);
    const nodeIds = Array.from(graph.nodes.keys());

    // Initially, only 'a' (no deps) should be ready
    const state = {
      variables: {},
      results: {},
      nodes: {
        [nodeIds[0]]: { nodeId: nodeIds[0], status: NodeStatus.PENDING, attempts: 0 },
        [nodeIds[1]]: { nodeId: nodeIds[1], status: NodeStatus.PENDING, attempts: 0 },
        [nodeIds[2]]: { nodeId: nodeIds[2], status: NodeStatus.PENDING, attempts: 0 },
      } as any,
      status: ExecutionStatus.RUNNING,
      activeNodes: [],
    };

    const ready1 = scheduler.getReadyNodes(graph, state);
    expect(ready1.length).toBe(1);
    expect(ready1[0]).toBe(nodeIds[0]);

    // After 'a' completes, 'b' should be ready
    state.nodes[nodeIds[0]].status = NodeStatus.COMPLETED;
    const ready2 = scheduler.getReadyNodes(graph, state);
    expect(ready2.length).toBe(1);
    expect(ready2[0]).toBe(nodeIds[1]);
  });

  it('GraphWorker should process tasks', async () => {
    const queue = new InMemoryTaskQueue();
    const processed: string[] = [];

    const worker = new GraphWorker({
      queue,
      onResult: async (result) => {
        processed.push(result.nodeId);
      },
    });

    await worker.start();

    await queue.enqueue({
      executionId: 'x1' as any,
      graphId: 'g1' as any,
      nodeId: 'n1' as any,
      nodeDef: {
        id: 'n1' as any,
        kind: NodeKind.TASK,
        name: 'worker-task',
        execute: async () => 'worker-done',
      },
      input: {},
      state: { variables: {}, results: {}, nodes: {}, status: ExecutionStatus.RUNNING, activeNodes: [] },
      attempt: 1,
      idempotencyKey: 'x1:n1:1',
    });

    await delay(100);

    const stats = worker.getStats();
    expect(stats.running).toBe(true);
    expect(stats.tasksProcessed).toBeGreaterThanOrEqual(1);

    await worker.stop();
    await queue.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Multi-Agent Orchestration Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Multi-Agent Orchestration', () => {
  const mockAgent = (name: string): AgentDef => ({
    name,
    instructions: `You are ${name}`,
    llm: createMockLLM(name),
  });

  it('AgentRuntime should run a simple agent', async () => {
    const agent = mockAgent('test-agent');
    const runtime = new AgentRuntime(agent);

    const result = await runtime.run('Hello!');

    expect(result.text).toContain('test-agent');
    expect(result.finishReason).toBe('stop');
    expect(result.steps.length).toBeGreaterThan(0);
  });

  it('Pipeline should process agents sequentially', async () => {
    const orchestrator = new MultiAgentOrchestrator();
    orchestrator
      .addAgent(mockAgent('agent-a'))
      .addAgent(mockAgent('agent-b'))
      .addAgent(mockAgent('agent-c'));

    const result = await orchestrator.runPipeline({
      agents: ['agent-a', 'agent-b', 'agent-c'],
      input: 'Process this',
    });

    expect(Object.keys(result.agentResults).length).toBe(3);
    expect(result.text).toBeDefined();
    expect(result.messages.length).toBe(3);
  });

  it('Consensus should aggregate results', async () => {
    const orchestrator = new MultiAgentOrchestrator();
    orchestrator
      .addAgent(mockAgent('voter-1'))
      .addAgent(mockAgent('voter-2'))
      .addAgent(mockAgent('voter-3'));

    const result = await orchestrator.runConsensus({
      agents: ['voter-1', 'voter-2', 'voter-3'],
      task: 'What is 2+2?',
      strategy: 'merge',
    });

    expect(Object.keys(result.agentResults).length).toBe(3);
    expect(result.text).toContain('voter-1');
    expect(result.text).toContain('voter-2');
    expect(result.text).toContain('voter-3');
  });

  it("Consensus 'best' without a judge throws instead of guessing", async () => {
    const orchestrator = new MultiAgentOrchestrator();
    orchestrator.addAgent(mockAgent('a')).addAgent(mockAgent('b'));

    await expect(
      orchestrator.runConsensus({ agents: ['a', 'b'], task: 'q', strategy: 'best' }),
    ).rejects.toThrow(/requires a judge/);
  });

  it("Consensus 'best' with a judge returns the judge's pick", async () => {
    const orchestrator = new MultiAgentOrchestrator();
    orchestrator.addAgent(mockAgent('a')).addAgent(mockAgent('b'));

    const result = await orchestrator.runConsensus({
      agents: ['a', 'b'],
      task: 'q',
      strategy: 'best',
      judge: { name: 'judge', instructions: 'judge', llm: createMockLLM('judge', 'JUDGE PICK') },
    });

    expect(result.text).toBe('JUDGE PICK');
    expect(result.agentResults.judge).toBeDefined();
  });

  it("Consensus 'majority' throws when every response is distinct", async () => {
    const orchestrator = new MultiAgentOrchestrator();
    // mockAgent responses are unique per name → no real majority
    orchestrator.addAgent(mockAgent('a')).addAgent(mockAgent('b')).addAgent(mockAgent('c'));

    await expect(
      orchestrator.runConsensus({ agents: ['a', 'b', 'c'], task: 'q', strategy: 'majority' }),
    ).rejects.toThrow(/no agreement/);
  });

  it("Consensus 'majority' returns the agreed answer when agents match", async () => {
    const orchestrator = new MultiAgentOrchestrator();
    const agree = (name: string): AgentDef => ({ name, instructions: name, llm: createMockLLM(name, 'approved') });
    orchestrator.addAgent(agree('a')).addAgent(agree('b')).addAgent(mockAgent('c'));

    const result = await orchestrator.runConsensus({
      agents: ['a', 'b', 'c'],
      task: 'Approve?',
      strategy: 'majority',
    });

    expect(result.text).toBe('approved');
  });

  it('Competitive should return first result', async () => {
    const fastAgent: AgentDef = {
      name: 'fast',
      instructions: 'Be fast',
      llm: createMockLLM('fast', 'Quick response!'),
    };

    const slowAgent: AgentDef = {
      name: 'slow',
      instructions: 'Be thorough',
      llm: {
        name: 'slow-llm',
        async generate(): Promise<LLMResponse> {
          await delay(100);
          return { content: 'Slow response', usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 } };
        },
      },
    };

    const orchestrator = new MultiAgentOrchestrator();
    orchestrator.addAgent(fastAgent).addAgent(slowAgent);

    const result = await orchestrator.runCompetitive({
      agents: ['fast', 'slow'],
      task: 'Race!',
    });

    expect(result.winner).toBeDefined();
    expect(result.text).toBeDefined();
  });

  it('agentNode should create graph-compatible agent nodes', async () => {
    const agent = mockAgent('graph-agent');

    const graph = createGraph('agent-graph')
      .addNode('run-agent', agentNode('run-agent', agent))
      .build();

    const engine = new DAGEngine(graph);
    const result = await engine.execute({
      variables: { text: 'Test input' },
    });

    expect(result.status).toBe(ExecutionStatus.COMPLETED);
    const agentResult = result.state.results['run-agent'] as { text: string };
    expect(agentResult.text).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Memory System Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Memory System', () => {
  describe('InMemoryStore', () => {
    let store: InMemoryStore;

    beforeEach(() => {
      store = new InMemoryStore();
    });

    it('should set and get values', async () => {
      await store.set('key', 'value');
      expect(await store.get('key')).toBe('value');
    });

    it('should handle TTL', async () => {
      await store.set('expiring', 'data', 50); // 50ms TTL
      expect(await store.get('expiring')).toBe('data');

      await delay(60);
      expect(await store.get('expiring')).toBeUndefined();
    });

    it('should list keys with prefix', async () => {
      await store.set('user:1', 'alice');
      await store.set('user:2', 'bob');
      await store.set('session:1', 'data');

      const userKeys = await store.keys('user:');
      expect(userKeys).toHaveLength(2);
      expect(userKeys).toContain('user:1');
      expect(userKeys).toContain('user:2');
    });

    it('should delete keys', async () => {
      await store.set('key', 'value');
      expect(await store.delete('key')).toBe(true);
      expect(await store.get('key')).toBeUndefined();
    });
  });

  describe('InMemoryVectorMemory', () => {
    it('should store and search vectors', async () => {
      const vecMem = new InMemoryVectorMemory();

      await vecMem.store('doc1', [1, 0, 0], { topic: 'math' });
      await vecMem.store('doc2', [0, 1, 0], { topic: 'science' });
      await vecMem.store('doc3', [0.9, 0.1, 0], { topic: 'math' });

      const results = await vecMem.search([1, 0, 0], 2);
      expect(results.length).toBe(2);
      expect(results[0].id).toBe('doc1'); // Most similar
      expect(results[0].score).toBeCloseTo(1.0, 1);
    });

    it('should filter by metadata', async () => {
      const vecMem = new InMemoryVectorMemory();

      await vecMem.store('a', [1, 0], { type: 'article' });
      await vecMem.store('b', [0.9, 0.1], { type: 'note' });
      await vecMem.store('c', [0.8, 0.2], { type: 'article' });

      const results = await vecMem.search([1, 0], 10, { type: 'article' });
      expect(results.length).toBe(2);
      expect(results.every(r => r.metadata?.type === 'article')).toBe(true);
    });
  });

  describe('ContextWindowManager', () => {
    it('should trim messages to fit budget', () => {
      const mgr = new ContextWindowManager({ maxTokens: 100, reservedForOutput: 20 });

      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'A'.repeat(100) },
        { role: 'assistant', content: 'B'.repeat(100) },
        { role: 'user', content: 'C'.repeat(100) },
        { role: 'assistant', content: 'D'.repeat(50) },
      ];

      const trimmed = mgr.trimMessages(messages);
      // Should keep system + most recent messages that fit
      expect(trimmed[0].role).toBe('system');
      expect(trimmed.length).toBeLessThan(messages.length);
    });

    it('should compress older messages', () => {
      const mgr = new ContextWindowManager();

      const messages: LLMMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Old message 1' },
        { role: 'assistant', content: 'Old response 1' },
        { role: 'user', content: 'Old message 2' },
        { role: 'assistant', content: 'Old response 2' },
        { role: 'user', content: 'Recent message' },
        { role: 'assistant', content: 'Recent response' },
      ];

      const { summary, recent } = mgr.compress(messages, 2);
      expect(summary).toContain('Previous conversation summary');
      expect(recent.length).toBe(3); // system + 2 recent
    });
  });

  describe('MemoryManager', () => {
    it('should manage session memory', async () => {
      const mgr = new MemoryManager();

      await mgr.addToSession('s1', { role: 'user', content: 'Hello' });
      await mgr.addToSession('s1', { role: 'assistant', content: 'Hi!' });

      const messages = await mgr.getSessionMessages('s1');
      expect(messages.length).toBe(2);

      await mgr.clearSession('s1');
      const after = await mgr.getSessionMessages('s1');
      expect(after.length).toBe(0);
    });

    it('should manage long-term memory', async () => {
      const mgr = new MemoryManager();

      await mgr.remember('user', 'name', 'Alice');
      await mgr.remember('user', 'age', 30);

      expect(await mgr.recall('user', 'name')).toBe('Alice');
      expect(await mgr.recall('user', 'age')).toBe(30);
      expect(await mgr.recall('user', 'nonexistent')).toBeUndefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Plugin Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Plugins', () => {
  it('TelemetryPlugin should collect metrics', async () => {
    const telemetry = new TelemetryPlugin();

    const graph = createGraph('telemetry-test')
      .addNode('a', { kind: 'task', execute: async () => { await delay(10); return 'a'; } })
      .addNode('b', { kind: 'task', execute: async () => { await delay(10); return 'b'; } })
      .chain('a', 'b')
      .build();

    const engine = new DAGEngine(graph);
    await engine.execute({ plugins: [telemetry] });

    const metrics = telemetry.getMetrics();
    expect(metrics.totalExecutions).toBe(1);
    expect(metrics.completedExecutions).toBe(1);
    expect(metrics.failedExecutions).toBe(0);
    expect(metrics.completedNodes).toBe(2);
    expect(metrics.successRate).toBe(1.0);
    expect(metrics.avgExecutionMs).toBeGreaterThan(0);
  });

  it('AuditPlugin should record all events', async () => {
    const audit = new AuditPlugin();

    const graph = createGraph('audit-test')
      .addNode('task1', { kind: 'task', execute: async () => 'done' })
      .build();

    const engine = new DAGEngine(graph);
    await engine.execute({ plugins: [audit] });

    const log = audit.getAuditLog();
    expect(log.length).toBeGreaterThan(0);

    const nodeEvents = audit.getEventsByType(GraphEventType.NODE_COMPLETED);
    expect(nodeEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('LoggingPlugin should produce structured logs', async () => {
    const logs: any[] = [];
    const logging = new LoggingPlugin({
      logger: (entry) => logs.push(entry),
      level: 'debug',
    });

    const graph = createGraph('log-test')
      .addNode('task1', { kind: 'task', execute: async () => 'done' })
      .build();

    const engine = new DAGEngine(graph);
    await engine.execute({ plugins: [logging] });

    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].event).toBe('execution.started');
    expect(logs[0].level).toBe('info');
  });

  it('Multiple plugins should compose', async () => {
    const telemetry = new TelemetryPlugin();
    const audit = new AuditPlugin();
    const logs: any[] = [];
    const logging = new LoggingPlugin({
      logger: (entry) => logs.push(entry),
      level: 'info',
    });

    const graph = createGraph('multi-plugin')
      .addNode('a', { kind: 'task', execute: async () => 'a' })
      .addNode('b', { kind: 'task', execute: async () => 'b' })
      .chain('a', 'b')
      .build();

    const engine = new DAGEngine(graph);
    await engine.execute({ plugins: [telemetry, logging, audit] });

    expect(telemetry.getMetrics().completedNodes).toBe(2);
    expect(audit.getAuditLog().length).toBeGreaterThan(0);
    expect(logs.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('Integration', () => {
  it('should run a complete workflow with all features', async () => {
    const eventStore = new InMemoryEventStore();
    const telemetry = new TelemetryPlugin();
    const audit = new AuditPlugin();

    // Build a complex graph with parallelism and joining
    const graph = createGraph('integration', { version: '1.0' })
      .addNode('start', { kind: 'start' })
      .addNode('fetch-a', {
        kind: 'task',
        execute: async (ctx) => {
          await delay(20);
          ctx.setVariable('source-a', true);
          return { data: 'from-a' };
        },
      })
      .addNode('fetch-b', {
        kind: 'task',
        execute: async (ctx) => {
          await delay(15);
          ctx.setVariable('source-b', true);
          return { data: 'from-b' };
        },
      })
      .addNode('merge', {
        kind: 'join',
        merge: async (results) => ({
          combined: Object.values(results),
          count: Object.keys(results).length,
        }),
      })
      .addNode('process', {
        kind: 'task',
        execute: async (ctx) => {
          const merged = ctx.getNodeOutput('merge');
          return { processed: true, input: merged };
        },
      })
      .addNode('end', { kind: 'end' })

      // Fan out then join
      .addEdge('start', 'fetch-a')
      .addEdge('start', 'fetch-b')
      .addEdge('fetch-a', 'merge')
      .addEdge('fetch-b', 'merge')
      .addEdge('merge', 'process')
      .addEdge('process', 'end')

      .defaultRetry({ maxRetries: 2, backoffMs: 10 })
      .maxConcurrency(4)
      .build();

    const engine = new DAGEngine(graph);
    const result = await engine.execute({
      eventStore,
      plugins: [telemetry, audit],
      variables: { runId: 'test-123' },
    });

    // Verify execution completed
    expect(result.status).toBe(ExecutionStatus.COMPLETED);

    // Verify parallel execution happened
    expect(result.state.variables['source-a']).toBe(true);
    expect(result.state.variables['source-b']).toBe(true);

    // Verify join worked
    const mergeResult = result.state.results['merge'] as any;
    expect(mergeResult.count).toBeGreaterThanOrEqual(2);

    // Verify event store has data
    const events = eventStore.getAllEvents();
    expect(events.length).toBeGreaterThan(5);

    // Verify replay produces same state
    const storedEvents = await eventStore.load(result.executionId);
    const replayed = replayState(storedEvents, graph);
    expect(replayed.status).toBe(result.state.status);

    // Verify metrics
    const metrics = telemetry.getMetrics();
    expect(metrics.completedExecutions).toBe(1);
    expect(metrics.successRate).toBe(1.0);

    // Verify audit trail
    expect(audit.getAuditLog().length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DurableExecutor Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('DurableExecutor', () => {
  it('should run a graph and persist events', async () => {
    const store = new InMemoryEventStore();
    const graph = createGraph('durable-basic')
      .addNode('a', { kind: 'task', execute: async () => 'a-out' })
      .addNode('b', { kind: 'task', execute: async () => 'b-out' })
      .chain('a', 'b')
      .build();

    const durable = new DurableExecutor(graph, store);
    const result = await durable.run();

    expect(result.status).toBe(ExecutionStatus.COMPLETED);

    // Events must be persisted to the store
    const stored = await store.load(result.executionId);
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.some(e => e.type === GraphEventType.EXECUTION_STARTED)).toBe(true);
    expect(stored.some(e => e.type === GraphEventType.EXECUTION_COMPLETED)).toBe(true);
  });

  it('should resume a completed run without re-executing nodes', async () => {
    const store = new InMemoryEventStore();
    const executions: string[] = [];

    const graph = createGraph('durable-resume')
      .addNode('once', {
        kind: 'task',
        execute: async () => {
          executions.push('ran');
          return 'result';
        },
      })
      .build();

    const durable = new DurableExecutor(graph, store);
    const first = await durable.run();

    expect(first.status).toBe(ExecutionStatus.COMPLETED);
    expect(executions.length).toBe(1);

    // Resume the already-completed run — no node should re-execute
    const resumed = await durable.resume(first.executionId);
    expect(resumed.status).toBe(ExecutionStatus.COMPLETED);
    expect(executions.length).toBe(1); // No re-execution
  });

  it('should detect graph version mismatch on resume', async () => {
    const store = new InMemoryEventStore();

    // Seed a start event with v1.0.0
    await store.append([{
      id: 'ev1',
      type: GraphEventType.EXECUTION_STARTED,
      executionId: 'old-run' as any,
      graphId: 'g1' as any,
      timestamp: Date.now(),
      sequence: 1,
      data: { graphVersion: '1.0.0' },
    }]);

    const graph = createGraph('versioned', { version: '2.0.0' })
      .addNode('a', { kind: 'task', execute: async () => {} })
      .build();

    const durable = new DurableExecutor(graph, store);
    await expect(durable.resume('old-run' as any))
      .rejects.toThrow(/version mismatch/);
  });

  it('should throw when resuming unknown run-id', async () => {
    const store = new InMemoryEventStore();
    const graph = createGraph('g')
      .addNode('a', { kind: 'task', execute: async () => {} })
      .build();

    const durable = new DurableExecutor(graph, store);
    await expect(durable.resume('nonexistent' as any))
      .rejects.toThrow(/no events found/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// computeWaves & BackpressureController Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('computeWaves', () => {
  it('should assign a single root node to wave 0', () => {
    const graph = createGraph('single')
      .addNode('only', { kind: 'task', execute: async () => {} })
      .build();

    const waves = computeWaves(graph);
    expect(waves.length).toBe(1);
    expect(waves[0].length).toBe(1);
  });

  it('should produce three waves for a linear 3-node chain', () => {
    const graph = createGraph('chain')
      .addNode('a', { kind: 'task', execute: async () => {} })
      .addNode('b', { kind: 'task', execute: async () => {} })
      .addNode('c', { kind: 'task', execute: async () => {} })
      .chain('a', 'b', 'c')
      .build();

    const waves = computeWaves(graph);
    expect(waves.length).toBe(3);
    waves.forEach(w => expect(w.length).toBe(1));
  });

  it('should place parallel branches in the same wave', () => {
    // start → [b, c] → end
    const graph = createGraph('fan')
      .addNode('start', { kind: 'start' })
      .addNode('b', { kind: 'task', execute: async () => {} })
      .addNode('c', { kind: 'task', execute: async () => {} })
      .addNode('end', { kind: 'end' })
      .addEdge('start', 'b')
      .addEdge('start', 'c')
      .addEdge('b', 'end')
      .addEdge('c', 'end')
      .build();

    const waves = computeWaves(graph);
    // Wave 0: start
    // Wave 1: b, c  (parallel)
    // Wave 2: end
    expect(waves.length).toBe(3);
    expect(waves[1].length).toBe(2); // b and c run together
  });

  it('should throw on a cyclic graph', () => {
    // Build a valid graph first, then patch its adjacency to introduce a cycle
    const graph = createGraph('ok')
      .addNode('a', { kind: 'task', execute: async () => {} })
      .addNode('b', { kind: 'task', execute: async () => {} })
      .chain('a', 'b')
      .build();

    const [aId, bId] = Array.from(graph.nodes.keys());
    const fakeEdgeId = 'e_cycle' as any;

    // Add a back-edge b → a to introduce a cycle
    const patchedOutgoing = new Map(graph.outgoing);
    patchedOutgoing.set(bId, [...(patchedOutgoing.get(bId) ?? []), fakeEdgeId]);

    const patchedIncoming = new Map(graph.incoming);
    patchedIncoming.set(aId, [...(patchedIncoming.get(aId) ?? []), fakeEdgeId]);

    const patchedEdges = new Map(graph.edges);
    patchedEdges.set(fakeEdgeId, { id: fakeEdgeId, from: bId, to: aId });

    const cyclic = { ...graph, outgoing: patchedOutgoing, incoming: patchedIncoming, edges: patchedEdges };

    expect(() => computeWaves(cyclic as any)).toThrow(/cycle/i);
  });
});

describe('BackpressureController', () => {
  it('should allow up to maxConcurrency acquires without blocking', async () => {
    const bp = new BackpressureController(3);
    // Three immediate acquires should not block
    await bp.acquire();
    await bp.acquire();
    await bp.acquire();
    expect(bp.inflight).toBe(3);
    expect(bp.queueDepth).toBe(0);
  });

  it('should queue a fourth acquire when limit is reached', async () => {
    const bp = new BackpressureController(2);
    await bp.acquire();
    await bp.acquire();
    expect(bp.inflight).toBe(2);

    let resolved = false;
    const waiting = bp.acquire().then(() => { resolved = true; });

    // Not yet resolved — still blocked
    expect(resolved).toBe(false);
    expect(bp.queueDepth).toBe(1);

    // Release one slot — waiter should resolve
    bp.release();
    await waiting;
    expect(resolved).toBe(true);
    expect(bp.inflight).toBe(2); // still 2: waiter took the released slot
  });

  it('should increment available after release when no waiters', async () => {
    const bp = new BackpressureController(2);
    await bp.acquire();
    bp.release();
    expect(bp.inflight).toBe(0);
    expect(bp.queueDepth).toBe(0);
  });

  it('should throw for maxConcurrency < 1', () => {
    expect(() => new BackpressureController(0)).toThrow(/maxConcurrency/);
  });

  it('should enforce parallelism under load', async () => {
    const bp = new BackpressureController(2);
    const maxInFlight: number[] = [];
    let current = 0;

    const task = async () => {
      await bp.acquire();
      current++;
      maxInFlight.push(current);
      await delay(10);
      current--;
      bp.release();
    };

    await Promise.all(Array.from({ length: 6 }, task));
    // Peak concurrency should never exceed 2
    expect(Math.max(...maxInFlight)).toBeLessThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// createTestRunner Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('createTestRunner', () => {
  it('should run a graph and return event types', async () => {
    const runner = createTestRunner();
    const graph = createGraph('runner-test')
      .addNode('a', { kind: 'task', execute: async () => 'hello' })
      .build();

    const result = await runner.run(graph);

    expect(result.status).toBe(ExecutionStatus.COMPLETED);
    expect(result.eventTypes).toContain(GraphEventType.EXECUTION_STARTED);
    expect(result.eventTypes).toContain(GraphEventType.NODE_STARTED);
    expect(result.eventTypes).toContain(GraphEventType.NODE_COMPLETED);
    expect(result.eventTypes).toContain(GraphEventType.EXECUTION_COMPLETED);
  });

  it('should forward initialState as variables', async () => {
    const runner = createTestRunner();
    const graph = createGraph('with-vars')
      .addNode('reader', {
        kind: 'task',
        execute: async (ctx) => ctx.getVariable<string>('msg'),
      })
      .build();

    const result = await runner.run(graph, { msg: 'hello-world' });
    expect(result.state.results['reader']).toBe('hello-world');
  });

  it('should expose the embedded event store', async () => {
    const runner = createTestRunner();
    const graph = createGraph('store-access')
      .addNode('x', { kind: 'task', execute: async () => 42 })
      .build();

    const result = await runner.run(graph);
    const fromStore = await result.eventStore.load(result.executionId);
    expect(fromStore.length).toBe(result.storedEvents.length);
  });
});

describe('expectEventSequence / assertExactEventSequence', () => {
  it('expectEventSequence should pass for a matching subsequence', () => {
    const actual = [
      GraphEventType.EXECUTION_STARTED,
      GraphEventType.NODE_STARTED,
      GraphEventType.NODE_COMPLETED,
      GraphEventType.EXECUTION_COMPLETED,
    ];
    expect(() =>
      expectEventSequence(actual, [
        GraphEventType.EXECUTION_STARTED,
        GraphEventType.NODE_COMPLETED,
        GraphEventType.EXECUTION_COMPLETED,
      ]),
    ).not.toThrow();
  });

  it('expectEventSequence should throw when a type is missing', () => {
    const actual = [GraphEventType.EXECUTION_STARTED, GraphEventType.EXECUTION_COMPLETED];
    expect(() =>
      expectEventSequence(actual, [GraphEventType.NODE_STARTED]),
    ).toThrow(/could not find/);
  });

  it('assertExactEventSequence should pass for exact match', () => {
    const types = [GraphEventType.EXECUTION_STARTED, GraphEventType.EXECUTION_COMPLETED];
    expect(() => assertExactEventSequence(types, types)).not.toThrow();
  });

  it('assertExactEventSequence should throw on length mismatch', () => {
    expect(() =>
      assertExactEventSequence(
        [GraphEventType.EXECUTION_STARTED],
        [GraphEventType.EXECUTION_STARTED, GraphEventType.EXECUTION_COMPLETED],
      ),
    ).toThrow(/length mismatch/);
  });

  it('assertExactEventSequence should throw on type mismatch', () => {
    expect(() =>
      assertExactEventSequence(
        [GraphEventType.EXECUTION_STARTED, GraphEventType.NODE_FAILED],
        [GraphEventType.EXECUTION_STARTED, GraphEventType.EXECUTION_COMPLETED],
      ),
    ).toThrow(/mismatch at index/);
  });
});

describe('createMockLLMProvider', () => {
  it('should drain responses in order', async () => {
    const llm = createMockLLMProvider('test-llm', [
      { content: 'response-1' },
      { content: 'response-2' },
    ]);

    const r1 = await llm.generate([{ role: 'user', content: 'q1' }]);
    const r2 = await llm.generate([{ role: 'user', content: 'q2' }]);
    // Third call beyond queue end returns last entry
    const r3 = await llm.generate([{ role: 'user', content: 'q3' }]);

    expect(r1.content).toBe('response-1');
    expect(r2.content).toBe('response-2');
    expect(r3.content).toBe('response-2'); // last repeated
  });

  it('should set finishReason=tool_calls when toolCalls present', async () => {
    const llm = createMockLLMProvider('tool-llm', [
      { content: '', toolCalls: [{ id: 'tc1', name: 'search', arguments: {} }] },
    ]);

    const r = await llm.generate([{ role: 'user', content: 'search something' }]);
    expect(r.finishReason).toBe('tool_calls');
  });

  it('should throw when given empty responses array', () => {
    expect(() => createMockLLMProvider('empty', [])).toThrow(/must not be empty/);
  });
});

