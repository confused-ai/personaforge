/**
 * @personaforge/test-utils — Testing utilities for the personaforge framework.
 *
 * SOLID:
 *   SRP  — each exported function serves one testing concern.
 *   OCP  — extend by composing helpers, not by modifying them.
 *   DIP  — MockLLM and MockAgent implement the same interfaces as production code.
 */

// ── Re-export canonical interfaces from contracts ─────────────────────────────
export type { LLMProvider, Message, GenerateResult } from '../contracts/index.js';
import type { LLMProvider, Message, GenerateResult } from '../contracts/index.js';

// ── MockLLMProvider — drop-in LLM stub for examples and tests ─────────────────

/**
 * A simple LLM stub that returns canned responses.
 * Suitable for examples and unit tests that don't need a real API key.
 *
 * @example
 * ```ts
 * import { MockLLMProvider } from './index.js';
 * const llm = new MockLLMProvider({ response: 'Paris' });
 * ```
 */
export class MockLLMProvider implements LLMProvider {
    private opts: { response?: string; responses?: string[]; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>; delay?: number };
    private callIndex = 0;

    constructor(opts: { response?: string; responses?: string[]; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>; delay?: number } = {}) {
        this.opts = opts;
    }

    async generateText(_messages: Message[]): Promise<GenerateResult> {
        if (this.opts.delay) await new Promise<void>((r) => setTimeout(r, this.opts.delay));
        this.callIndex++;
        const responses = this.opts.responses ?? (this.opts.response ? [this.opts.response] : ['mock response']);
        const text = responses[(this.callIndex - 1) % responses.length] ?? '';
        const toolCalls = this.opts.toolCalls ?? [];
        return {
            text,
            finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
            ...(toolCalls.length > 0 ? { toolCalls } : {}),
        };
    }

    streamText = this.generateText.bind(this);
}

export interface AgentRunResult {
  text:         string;
  messages:     Message[];
  steps:        number;
  finishReason: 'stop' | 'tool_calls' | 'length';
}

export interface MockableAgent {
  name:         string;
  instructions: string;
  run(prompt: string): Promise<AgentRunResult>;
  stream(prompt: string): AsyncIterable<string>;
  streamEvents(prompt: string): AsyncIterable<{ type: string; [k: string]: unknown }>;
  createSession(userId?: string): Promise<string>;
  getSessionMessages(sessionId: string): Promise<Message[]>;
}

// ── createMockLLM ─────────────────────────────────────────────────────────────

export interface MockLLMCall {
  messages: Message[];
  response: string;
  callNumber: number;
}

export interface MockLLMOptions {
  /** Responses to cycle through. Wraps around. Default: ['mock response']. */
  responses?:  string[];
  /** Simulate network latency in ms. Default: 0. */
  latencyMs?:  number;
  /** Throw on the Nth call (1-indexed). */
  failOnCall?: number;
}

export interface MockLLMHandle {
  llm:   LLMProvider;
  calls: MockLLMCall[];
  reset(): void;
}

/**
 * Create a deterministic mock LLMProvider.
 * Responses cycle through the `responses` array. Tracks all calls.
 *
 * @example
 * ```ts
 * const { llm, calls } = createMockLLM({ responses: ['Paris'] });
 * const result = await llm.generateText([{ role: 'user', content: 'Capital?' }]);
 * expect(result.text).toBe('Paris');
 * ```
 */
export function createMockLLM(opts: MockLLMOptions = {}): MockLLMHandle {
  const responses  = opts.responses ?? ['mock response'];
  const latencyMs  = opts.latencyMs ?? 0;
  const failOnCall = opts.failOnCall;

  // Shared mutable state — accessed via closure for reset support.
  let callIndex = 0;
  const calls: MockLLMCall[] = [];

  async function generateText(messages: Message[]): Promise<GenerateResult> {
    callIndex++;
    const currentCall = callIndex;

    if (latencyMs > 0) {
      await new Promise<void>((r) => setTimeout(r, latencyMs));
    }

    if (failOnCall !== undefined && currentCall === failOnCall) {
      throw new Error(`[mock-llm] forced failure on call ${String(failOnCall)}`);
    }

    const response = responses[(currentCall - 1) % responses.length] ?? '';
    calls.push({ messages, response, callNumber: currentCall });

    return { text: response, finishReason: 'stop' };
  }

  return {
    llm: { generateText, streamText: generateText },
    calls,
    reset() {
      callIndex = 0;
      calls.length = 0;
    },
  };
}

// ── createMockAgent ────────────────────────────────────────────────────────────

export interface MockAgentRun {
  prompt: string;
  result: AgentRunResult;
}

export interface MockAgentOptions {
  name?:        string;
  instructions?: string;
  responses?:   string[];
  latencyMs?:   number;
}

export interface MockAgentHandle {
  agent: MockableAgent;
  runs:  MockAgentRun[];
  reset(): void;
}

/**
 * Create a deterministic mock Agent.
 * All interface methods are implemented; stream and streamEvents use the same
 * response cycle as run().
 *
 * @example
 * ```ts
 * const { agent, runs } = createMockAgent({ responses: ['done'] });
 * const r = await agent.run('task');
 * expect(r.text).toBe('done');
 * ```
 */
export function createMockAgent(opts: MockAgentOptions = {}): MockAgentHandle {
  const name         = opts.name         ?? 'mock-agent';
  const instructions = opts.instructions ?? 'You are a mock agent for testing.';
  const responses    = opts.responses    ?? ['mock response'];
  const latencyMs    = opts.latencyMs    ?? 0;

  let runIndex = 0;
  const runs: MockAgentRun[] = [];

  // In-memory session store — O(1) all ops.
  const sessions = new Map<string, Message[]>();

  function nextResponse(): string {
    const resp = responses[runIndex % responses.length] ?? '';
    runIndex++;
    return resp;
  }

  async function run(prompt: string): Promise<AgentRunResult> {
    if (latencyMs > 0) await new Promise<void>((r) => setTimeout(r, latencyMs));
    const text   = nextResponse();
    const result: AgentRunResult = { text, messages: [], steps: 1, finishReason: 'stop' };
    runs.push({ prompt, result });
    return result;
  }

  async function* stream(prompt: string): AsyncIterable<string> {
    if (latencyMs > 0) await new Promise<void>((r) => setTimeout(r, latencyMs));
    const text = nextResponse();
    runs.push({ prompt, result: { text, messages: [], steps: 1, finishReason: 'stop' } });
    yield text;
  }

  async function* streamEvents(prompt: string): AsyncIterable<{ type: string; [k: string]: unknown }> {
    if (latencyMs > 0) await new Promise<void>((r) => setTimeout(r, latencyMs));
    const text = nextResponse();
    runs.push({ prompt, result: { text, messages: [], steps: 1, finishReason: 'stop' } });
    yield { type: 'text-delta', delta: text };
    yield { type: 'run-finish', text };
  }

  const agent: MockableAgent = {
    name,
    instructions,
    run,
    stream,
    streamEvents,
    createSession(_userId?: string): Promise<string> {
      const id = crypto.randomUUID();
      sessions.set(id, []);
      return Promise.resolve(id);
    },
    getSessionMessages(sessionId: string): Promise<Message[]> {
      return Promise.resolve([...(sessions.get(sessionId) ?? [])]);
    },
  };

  return {
    agent,
    runs,
    reset() {
      runIndex = 0;
      runs.length = 0;
      sessions.clear();
    },
  };
}

// ── runScenario ────────────────────────────────────────────────────────────────

export interface ScenarioStep {
  prompt:           string;
  expectedKeywords?: string[];
  minSteps?:        number;
  maxSteps?:        number;
}

export interface ScenarioStepResult {
  step:   number;
  prompt: string;
  text:   string;
  passed: boolean;
  reason: string;
}

export interface ScenarioResult {
  passed:  boolean;
  results: ScenarioStepResult[];
}

/**
 * runScenario — run a sequence of prompts against an agent and assert outcomes.
 *
 * Each step can assert:
 *  - `expectedKeywords`: all must appear in the response (case-insensitive)
 *  - `minSteps` / `maxSteps`: bounds on agent.run().steps
 *
 * @example
 * ```ts
 * const { agent } = createMockAgent({ responses: ['Paris is the capital.'] });
 * const { passed } = await runScenario(agent, [
 *   { prompt: 'What is the capital?', expectedKeywords: ['Paris'] },
 * ]);
 * expect(passed).toBe(true);
 * ```
 */
export async function runScenario(
  agent: Pick<MockableAgent, 'run'>,
  steps: ScenarioStep[],
): Promise<ScenarioResult> {
  const results: ScenarioStepResult[] = [];

  for (const [i, step] of steps.entries()) {
    const result = await agent.run(step.prompt);
    const text   = result.text.toLowerCase();

    let passed = true;
    let reason = 'ok';

    // Keyword check — O(k) where k = keyword count.
    if (step.expectedKeywords && step.expectedKeywords.length > 0) {
      const missing = step.expectedKeywords.filter((kw) => !text.includes(kw.toLowerCase()));
      if (missing.length > 0) {
        passed = false;
        reason = `Missing keywords: ${missing.join(', ')}`;
      }
    }

    // Steps check.
    if (passed && step.minSteps !== undefined && result.steps < step.minSteps) {
      passed = false;
      reason = `Expected ≥${String(step.minSteps)} steps, got ${String(result.steps)}`;
    }
    if (passed && step.maxSteps !== undefined && result.steps > step.maxSteps) {
      passed = false;
      reason = `Expected ≤${String(step.maxSteps)} steps, got ${String(result.steps)}`;
    }

    results.push({ step: i + 1, prompt: step.prompt, text: result.text, passed, reason });
  }

  return {
    passed: results.every((r) => r.passed),
    results,
  };
}
