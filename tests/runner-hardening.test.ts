import { describe, it, expect } from 'vitest';
import { AgentRunner } from '../src/core/runner/agent-runner.js';

// ── Minimal mocks (match existing runner-test conventions) ───────────────────

function makeTools(defs: Array<{ name: string; parameters?: Record<string, unknown>; execute?: (a: unknown) => Promise<unknown> }>) {
  const tools: any[] = defs.map((d) => ({
    name: d.name,
    description: '',
    parameters: d.parameters ?? {},
    execute: d.execute ?? (async () => ({ ok: true })),
  }));
  return {
    list: () => tools,
    get: (n: string) => tools.find((t) => t.name === n),
    has: (n: string) => tools.some((t) => t.name === n),
    register: () => {},
    unregister: () => {},
    clear: () => {},
  } as any;
}

const toolCall = (name: string, args: unknown, id = 't1') => ({
  text: '',
  toolCalls: [{ id, name, arguments: args }],
  finishReason: 'tool_calls',
});

// ── Loop detection ────────────────────────────────────────────────────────────

describe('AgentRunner loop detection', () => {
  it('exits with loop_detected when the same action repeats', async () => {
    const llm = { generateText: async () => toolCall('echo', { v: 1 }) } as any;
    const tools = makeTools([{ name: 'echo' }]);

    const runner = new AgentRunner({
      name: 'bot', instructions: 'x', llm, tools,
      maxSteps: 50,
      loopDetection: { threshold: 3, window: 1 },
    });

    const result = await runner.run({ instructions: 'x', prompt: 'go' });
    expect(result.finishReason).toBe('loop_detected');
    expect(result.steps).toBeLessThan(50);
  });

  it('detects a two-step oscillation when window > 1', async () => {
    let call = 0;
    const llm = {
      generateText: async () => {
        call++;
        return call % 2 === 1 ? toolCall('a', {}, 'a1') : toolCall('b', {}, 'b1');
      },
    } as any;
    const tools = makeTools([{ name: 'a' }, { name: 'b' }]);

    const runner = new AgentRunner({
      name: 'bot', instructions: 'x', llm, tools,
      maxSteps: 50,
      loopDetection: { threshold: 3, window: 2 },
    });

    const result = await runner.run({ instructions: 'x', prompt: 'go' });
    expect(result.finishReason).toBe('loop_detected');
    expect(result.steps).toBeLessThan(50);
  });

  it('does not flag when loopDetection.enabled is false', async () => {
    const llm = { generateText: async () => toolCall('echo', { v: 1 }) } as any;
    const tools = makeTools([{ name: 'echo' }]);

    const runner = new AgentRunner({
      name: 'bot', instructions: 'x', llm, tools,
      maxSteps: 4,
      loopDetection: { enabled: false },
    });

    const result = await runner.run({ instructions: 'x', prompt: 'go' });
    expect(result.finishReason).toBe('max_steps');
  });
});

// ── Tool argument validation ──────────────────────────────────────────────────

describe('AgentRunner tool argument validation', () => {
  it('rejects missing required arguments with a self-correctable message', async () => {
    let call = 0;
    const llm = {
      generateText: async () => {
        call++;
        return call === 1
          ? toolCall('search', {}) // missing required 'query'
          : { text: 'done', toolCalls: [], finishReason: 'stop' };
      },
    } as any;

    let executed = false;
    const tools = makeTools([{
      name: 'search',
      parameters: { type: 'object', required: ['query'] },
      execute: async () => { executed = true; return { results: [] }; },
    }]);

    const runner = new AgentRunner({ name: 'bot', instructions: 'x', llm, tools });

    const result = await runner.run({ instructions: 'x', prompt: 'go' });
    expect(executed).toBe(false);

    const toolMsg = result.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('missing required argument');
    expect(toolMsg?.content).toContain('query');
  });

  it('skips validation when validateToolArgs is false', async () => {
    const llm = {
      generateText: async () => toolCall('search', { query: 'x' }),
    } as any;

    const tools = makeTools([{ name: 'search', parameters: { type: 'object', required: ['query'] } }]);

    const runner = new AgentRunner({
      name: 'bot', instructions: 'x', llm, tools,
      maxSteps: 2,
      validateToolArgs: false,
    });

    // With validation disabled and a single tool call, the run proceeds normally
    // (no "missing required argument" rejection) and reaches max_steps on repeat.
    const result = await runner.run({ instructions: 'x', prompt: 'go' });
    const toolMsg = result.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).not.toContain('missing required argument');
  });
});

// ── Parallel tool dispatch (item 8) ───────────────────────────────────────────

describe('AgentRunner tool dispatch — parallel', () => {
  it('executes independent tool calls concurrently while preserving message order', async () => {
    // Two tools with a controllable delay; if the runner is sequential, wall
    // time ~= 2 * delay. If parallel, wall time ~= delay.
    const delayMs = 80;
    let call = 0;
    const llm = {
      generateText: async () => {
        call++;
        if (call === 1) {
          return {
            text: '',
            toolCalls: [
              { id: 't1', name: 'slow_a', arguments: {} },
              { id: 't2', name: 'slow_b', arguments: {} },
            ],
            finishReason: 'tool_calls',
          };
        }
        return { text: 'done', toolCalls: [], finishReason: 'stop' };
      },
    } as any;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const tools = makeTools([
      { name: 'slow_a', execute: async () => { await sleep(delayMs); return 'A'; } },
      { name: 'slow_b', execute: async () => { await sleep(delayMs); return 'B'; } },
    ]);

    const runner = new AgentRunner({
      name: 'bot', instructions: 'x', llm, tools,
      maxSteps: 5, toolConcurrency: 8,
    });

    const start = Date.now();
    const result = await runner.run({ instructions: 'x', prompt: 'go' });
    const elapsed = Date.now() - start;

    // Parallel: expect well under 2× the tool delay (allow generous margin for CI).
    expect(elapsed).toBeLessThan(delayMs * 1.8);

    // Message order must still match tool_call order.
    const toolMsgs = result.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(['t1', 't2']);
  });

  it('honours toolConcurrency=1 for fully sequential dispatch', async () => {
    const delayMs = 60;
    let call = 0;
    const llm = {
      generateText: async () => {
        call++;
        if (call === 1) {
          return {
            text: '',
            toolCalls: [
              { id: 't1', name: 'seq_a', arguments: {} },
              { id: 't2', name: 'seq_b', arguments: {} },
            ],
            finishReason: 'tool_calls',
          };
        }
        return { text: 'done', toolCalls: [], finishReason: 'stop' };
      },
    } as any;

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const tools = makeTools([
      { name: 'seq_a', execute: async () => { await sleep(delayMs); return 'A'; } },
      { name: 'seq_b', execute: async () => { await sleep(delayMs); return 'B'; } },
    ]);

    const runner = new AgentRunner({
      name: 'bot', instructions: 'x', llm, tools,
      maxSteps: 5, toolConcurrency: 1,
    });

    const start = Date.now();
    await runner.run({ instructions: 'x', prompt: 'go' });
    const elapsed = Date.now() - start;

    // Sequential: expect at least the sum of both delays.
    expect(elapsed).toBeGreaterThanOrEqual(delayMs * 2);
  });
});

// ── Admission control (item 7) ────────────────────────────────────────────────

describe('AgentRunner admission control', () => {
  it('rejects the run with LoadShedError when admissionControl denies', async () => {
    const llm = { generateText: async () => ({ text: 'ok', toolCalls: [], finishReason: 'stop' }) } as any;
    const runner = new AgentRunner({
      name: 'bot', instructions: 'x', llm, tools: makeTools([]),
      admissionControl: () => ({ admit: false, reason: 'overloaded', retryAfterMs: 2000 }),
    });

    await expect(runner.run({ instructions: 'x', prompt: 'go' })).rejects.toMatchObject({
      name: 'LoadShedError',
      code: 'LOAD_SHED',
      retryAfterMs: 2000,
    });
  });

  it('admits the run when admissionControl approves', async () => {
    const llm = { generateText: async () => ({ text: 'ok', toolCalls: [], finishReason: 'stop' }) } as any;
    const runner = new AgentRunner({
      name: 'bot', instructions: 'x', llm, tools: makeTools([]),
      admissionControl: () => ({ admit: true }),
    });
    const result = await runner.run({ instructions: 'x', prompt: 'go' });
    expect(result.finishReason).toBe('stop');
  });

  it('getLoadShedDecision defaults to admit=true when no hook is configured', async () => {
    const llm = { generateText: async () => ({ text: 'ok', toolCalls: [], finishReason: 'stop' }) } as any;
    const runner = new AgentRunner({ name: 'bot', instructions: 'x', llm, tools: makeTools([]) });
    const decision = await runner.getLoadShedDecision();
    expect(decision.admit).toBe(true);
  });
});

// ── Idempotent tool memoization (item 12) ─────────────────────────────────────

describe('AgentRunner idempotent tool memoization', () => {
  it('executes an idempotent tool once for identical args within a run', async () => {
    let calls = 0;
    let step = 0;
    const llm = {
      generateText: async () => {
        step++;
        if (step <= 2) {
          return { text: '', toolCalls: [{ id: `t${step}`, name: 'calc', arguments: { a: 1, b: 2 } }], finishReason: 'tool_calls' };
        }
        return { text: 'done', toolCalls: [], finishReason: 'stop' };
      },
    } as any;
    const tools = makeTools([
      { name: 'calc', execute: async () => { calls++; return 3; } },
    ]);
    (tools.get('calc') as any).idempotent = true;

    const runner = new AgentRunner({ name: 'bot', instructions: 'x', llm, tools, maxSteps: 5 });
    await runner.run({ instructions: 'x', prompt: 'go' });
    expect(calls).toBe(1);
  });

  it('re-executes a non-idempotent tool every call', async () => {
    let calls = 0;
    let step = 0;
    const llm = {
      generateText: async () => {
        step++;
        if (step <= 2) {
          return { text: '', toolCalls: [{ id: `t${step}`, name: 'sideeffect', arguments: { a: 1 } }], finishReason: 'tool_calls' };
        }
        return { text: 'done', toolCalls: [], finishReason: 'stop' };
      },
    } as any;
    const tools = makeTools([{ name: 'sideeffect', execute: async () => { calls++; return calls; } }]);

    const runner = new AgentRunner({ name: 'bot', instructions: 'x', llm, tools, maxSteps: 5 });
    await runner.run({ instructions: 'x', prompt: 'go' });
    expect(calls).toBe(2);
  });
});

// ── LLM response cache + coalescing (item 13) ─────────────────────────────────

describe('AgentRunner LLM response cache', () => {
  it('serves a cached response instead of re-calling the provider', async () => {
    let providerCalls = 0;
    const llm = {
      generateText: async () => { providerCalls++; return { text: 'hi', toolCalls: [], finishReason: 'stop' }; },
    } as any;
    const store = new Map<string, any>();
    const responseCache = {
      get: (k: string) => store.get(k),
      set: (k: string, v: any) => { store.set(k, v); },
    };
    const cfg = { name: 'bot', instructions: 'x', llm, tools: makeTools([]), responseCache };

    await new AgentRunner(cfg).run({ instructions: 'x', prompt: 'go' });
    await new AgentRunner(cfg).run({ instructions: 'x', prompt: 'go' });
    // Second identical run hits the shared cache → provider called only once.
    expect(providerCalls).toBe(1);
  });
});

// ── W3C trace header injection (item 15) ──────────────────────────────────────

describe('AgentRunner trace propagation', () => {
  it('injects a W3C traceparent header into the provider call when traceId is set', async () => {
    let seenHeaders: Record<string, string> | undefined;
    const traceId = 'abcdefabcdefabcdefabcdefabcdef01';
    const llm = {
      generateText: async (_msgs: unknown, opts?: { headers?: Record<string, string> }) => {
        seenHeaders = opts?.headers;
        return { text: 'ok', toolCalls: [], finishReason: 'stop' };
      },
    } as any;
    const runner = new AgentRunner({ name: 'bot', instructions: 'x', llm, tools: makeTools([]) });
    await runner.run({ instructions: 'x', prompt: 'go', traceId });
    expect(seenHeaders?.traceparent).toMatch(new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`));
  });
});
