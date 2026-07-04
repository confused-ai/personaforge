/**
 * Deterministic replay — re-run a recorded execution with zero external calls.
 *
 * The durable log already captures every LLM result and tool output. Replay
 * builds an LLM provider and a tool registry that *serve those recorded values*
 * in order, then re-runs the agent. No model is called and no tool side effect
 * fires — the run reproduces from the log alone. This is the difference between
 * node-granular resume and bit-for-bit replay (time-travel debugging, sim).
 */

import { type EventStore, type ExecutionId, GraphEventType } from './types.js';
import type { GenerateResult, LLMProvider, Tool, ToolRegistry } from '../contracts/index.js';
import type { AgentRunResult } from '../core/runner/types.js';
import { AgentRunner } from '../core/runner/agent-runner.js';

interface RecordedLlm {
  text?: string;
  toolCalls?: GenerateResult['toolCalls'];
  finishReason?: GenerateResult['finishReason'];
  usage?: GenerateResult['usage'];
}
interface RecordedTool {
  name: string;
  output: unknown;
}

/** LLM provider that replays recorded `LLM_CALL` results in sequence. */
export async function buildReplayProvider(
  store: EventStore,
  executionId: ExecutionId,
): Promise<LLMProvider> {
  const events = await store.load(executionId);
  const results = events
    .filter((e) => e.type === GraphEventType.LLM_CALL)
    .map((e) => e.data as RecordedLlm);
  let i = 0;
  return {
    generateText: async (): Promise<GenerateResult> => {
      const rec = results[i++];
      if (!rec) {
        throw new Error(`replay: no recorded LLM result at index ${i - 1} for execution ${executionId}`);
      }
      return {
        text: rec.text ?? '',
        ...(rec.toolCalls && { toolCalls: rec.toolCalls }),
        finishReason: rec.finishReason ?? 'stop',
        ...(rec.usage && { usage: rec.usage }),
      };
    },
  };
}

/** Tool registry that replays recorded `TOOL_CALL` outputs per tool, in call order. */
export async function buildReplayTools(
  store: EventStore,
  executionId: ExecutionId,
): Promise<ToolRegistry> {
  const events = await store.load(executionId);
  const recorded = events
    .filter((e) => e.type === GraphEventType.TOOL_CALL)
    .map((e) => e.data as unknown as RecordedTool);

  const queues = new Map<string, unknown[]>();
  for (const t of recorded) {
    const q = queues.get(t.name) ?? [];
    q.push(t.output);
    queues.set(t.name, q);
  }
  const cursors = new Map<string, number>();

  const makeTool = (name: string): Tool => ({
    name,
    description: '',
    parameters: {},
    execute: async () => {
      const idx = cursors.get(name) ?? 0;
      cursors.set(name, idx + 1);
      return (queues.get(name) ?? [])[idx];
    },
  });

  return {
    list: () => [...queues.keys()].map(makeTool),
    get: (name: string) => (queues.has(name) ? makeTool(name) : undefined),
    has: (name: string) => queues.has(name),
    register: () => undefined,
    unregister: () => undefined,
    clear: () => queues.clear(),
  };
}

/**
 * Re-run a recorded execution deterministically from its log.
 * Returns the reproduced run result; no external calls are made.
 */
export async function replay(
  store: EventStore,
  executionId: ExecutionId,
  agent: { name: string; instructions: string },
): Promise<AgentRunResult> {
  const events = await store.load(executionId);
  const start = events.find((e) => e.type === GraphEventType.AGENT_STARTED);
  const prompt = (start?.data as { prompt?: string } | undefined)?.prompt ?? '';

  const llm = await buildReplayProvider(store, executionId);
  const tools = await buildReplayTools(store, executionId);
  const runner = new AgentRunner({ name: agent.name, instructions: agent.instructions, llm, tools });
  return runner.run({ instructions: agent.instructions, prompt });
}
