/**
 * Simulation harness — a wind tunnel for agents.
 *
 * Runs an agent against many scenarios, records every run into the durable log
 * (so any outcome is replayable), and aggregates pass/fail statistics. Because
 * each run is recorded, the log doubles as a reproducible test corpus: a failing
 * scenario can be replayed bit-for-bit for debugging.
 */

import type { LLMProvider, ToolRegistry } from '../contracts/index.js';
import type { AgentRunResult } from '../core/runner/types.js';
import { AgentRunner } from '../core/runner/agent-runner.js';
import { RunRecorder } from '../graph/run-recorder.js';
import { InMemoryEventStore } from '../graph/event-store.js';
import type { EventStore, ExecutionId } from '../graph/types.js';

export interface SimAgentConfig {
  name: string;
  instructions: string;
  llm: LLMProvider;
  tools?: ToolRegistry;
}

export interface Scenario {
  name: string;
  prompt: string;
  /** Optional assertion; scenario passes when it returns true (default: always pass). */
  expect?: (result: AgentRunResult) => boolean;
}

export interface ScenarioOutcome {
  name: string;
  prompt: string;
  text: string;
  steps: number;
  finishReason: string;
  passed: boolean;
  executionId: ExecutionId;
}

export interface SimReport {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  outcomes: ScenarioOutcome[];
}

export interface SimulateOptions {
  /** Where runs are recorded. Defaults to a fresh in-memory store. */
  store?: EventStore;
  /** Max concurrent scenarios. Default 4. */
  concurrency?: number;
}

const emptyRegistry = (): ToolRegistry => ({
  list: () => [],
  get: () => undefined,
  has: () => false,
  register: () => undefined,
  unregister: () => undefined,
  clear: () => undefined,
});

/** Bounded-concurrency map that preserves input order. */
async function mapPool<T, R>(items: readonly T[], fn: (item: T) => Promise<R>, limit: number): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Run every scenario, record each run, and return aggregate statistics. */
export async function simulate(
  config: SimAgentConfig,
  scenarios: readonly Scenario[],
  opts: SimulateOptions = {},
): Promise<SimReport> {
  const store = opts.store ?? new InMemoryEventStore();
  const tools = config.tools ?? emptyRegistry();

  const runOne = async (s: Scenario): Promise<ScenarioOutcome> => {
    // One recorder per scenario → independent executions, safe under concurrency.
    const recorder = new RunRecorder(store);
    const runner = new AgentRunner({ name: config.name, instructions: config.instructions, llm: config.llm, tools, recorder });
    const result = await runner.run({ instructions: config.instructions, prompt: s.prompt });
    const passed = s.expect ? !!s.expect(result) : true;
    return {
      name: s.name,
      prompt: s.prompt,
      text: result.text,
      steps: result.steps,
      finishReason: String(result.finishReason),
      passed,
      executionId: recorder.executionId,
    };
  };

  const outcomes = await mapPool(scenarios, runOne, opts.concurrency ?? 4);
  const passed = outcomes.filter((o) => o.passed).length;
  return {
    total: outcomes.length,
    passed,
    failed: outcomes.length - passed,
    passRate: outcomes.length ? passed / outcomes.length : 0,
    outcomes,
  };
}
