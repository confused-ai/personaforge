/**
 * @confused-ai/graph — DAG execution engine, event store, scheduler, and durable executor.
 *
 * Package barrel — re-exports everything from the implementation modules.
 * Use `@confused-ai/core` imports for the bridge utilities (no root src/ dependency).
 */

// ── Core Types ──────────────────────────────────────────────────────────────

export {
  type NodeId,
  type EdgeId,
  type GraphId,
  type ExecutionId,
  type WorkerId,
  nodeId,
  edgeId,
  graphId,
  executionId,
  workerId,
  uid,

  NodeKind,
  NodeStatus,
  ExecutionStatus,
  GraphEventType,

  type GraphNodeDef,
  type GraphEdgeDef,
  type RetryPolicy,
  type TimeoutPolicy,
  type AgentNodeConfig,
  type WaitConfig,
  type GraphDef,
  type GraphState,
  type NodeState,
  type NodeContext,
  type NodeLogger,
  type GraphEvent,
  type EventStore,
  type Checkpoint,
  type TaskEnvelope,
  type TaskResult,
  type StateMutation,
  type TaskQueue,
  type Scheduler,
  type GraphPlugin,
  type KVStore,
  type VectorMemory,
  type VectorSearchResult,
  type LLMProvider,
  type LLMMessage,
  type LLMOptions,
  type LLMToolDef,
  type LLMToolCall,
  type LLMResponse,
  type LLMChunk,
  type ToolDef,
  type ToolContext,
} from './types.js';

// ── Graph Builder ───────────────────────────────────────────────────────────

export {
  GraphBuilder,
  createGraph,
  type TaskNodeConfig,
  type RouterNodeConfig,
  type ParallelNodeConfig,
  type JoinNodeConfig,
  type AgentNodeShortConfig,
  type WaitNodeShortConfig,
  type NodeConfig,
  type EdgeConfig,
} from './builder.js';

// ── DAG Engine ──────────────────────────────────────────────────────────────

export {
  DAGEngine,
  replayState,
  DurableExecutor,
  type ExecuteOptions,
  type ExecutionResult,
} from './engine.js';

// ── Event Store ─────────────────────────────────────────────────────────────

export {
  InMemoryEventStore,
  SqliteEventStore,
} from './event-store.js';

// Records an ordinary agent.run() into the same durable event log.
export { RunRecorder, redactSecrets } from './run-recorder.js';
export type { RunRecorderOptions } from './run-recorder.js';

// Deterministic replay of a recorded execution (zero external calls).
export { replay, buildReplayProvider, buildReplayTools } from './replay.js';

// ── Scheduler & Workers ─────────────────────────────────────────────────────

export {
  InMemoryTaskQueue,
  RedisTaskQueue,
  DefaultScheduler,
  GraphWorker,
  DistributedEngine,
  computeWaves,
  BackpressureController,
  type WorkerStats,
} from './scheduler.js';

// ── Multi-Agent Orchestration ───────────────────────────────────────────────

export {
  AgentRuntime,
  MultiAgentOrchestrator,
  agentNode,
  type AgentDef,
  type AgentStep,
  type AgentResult,
  type ToolCallResult,
  type AgentMessage,
  type OrchestratorResult,
  type OrchestratorRound,
} from './orchestrator.js';

// ── Memory System ───────────────────────────────────────────────────────────

export {
  InMemoryStore,
  InMemoryVectorMemory,
  ContextWindowManager,
  MemoryManager,
} from './memory.js';

// ── Plugins ─────────────────────────────────────────────────────────────────

export {
  TelemetryPlugin,
  LoggingPlugin,
  OpenTelemetryPlugin,
  AuditPlugin,
  RateLimitPlugin,
  type MetricsSummary,
  type LogLevel,
  type LogEntry,
} from './plugins.js';

// ── Core ↔ Graph Bridge ─────────────────────────────────────────────────────

import type { LLMProvider as CoreLLMProvider, Message as CoreMessage, GenerateResult } from '../core/index.js';
import type { LLMProvider as GraphLLMProvider, LLMMessage, LLMResponse } from './types.js';

/**
 * Bridge a `@confused-ai/core` LLMProvider into the graph engine's
 * `LLMProvider` interface. Use this when you want to pass the same LLM provider
 * you use with `createAgent()` into the graph engine or `AgentRuntime`.
 */
export function wrapCoreLLM(name: string, provider: CoreLLMProvider): GraphLLMProvider {
  return {
    name,
    async generate(messages: LLMMessage[], options): Promise<LLMResponse> {
      const coreMessages: CoreMessage[] = messages.map(m => ({
        role: m.role,
        content: m.content,
      }));

      const coreOpts = {
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
        ...(options?.maxTokens !== undefined && { maxTokens: options.maxTokens }),
        ...(options?.stop !== undefined && { stop: options.stop }),
        ...(options?.tools !== undefined && {
          tools: options.tools.map(t => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters,
          })),
        }),
      };

      const result: GenerateResult = await provider.generateText(coreMessages, coreOpts);

      const response: LLMResponse = {
        content: result.text,
        ...(result.finishReason === 'stop' && { finishReason: 'stop' as const }),
      };

      if (result.toolCalls?.length) {
        response.toolCalls = result.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }

      if (result.usage) {
        response.usage = {
          promptTokens: result.usage.promptTokens ?? 0,
          completionTokens: result.usage.completionTokens ?? 0,
          totalTokens: result.usage.totalTokens ?? 0,
        };
      }

      return response;
    },
  };
}
