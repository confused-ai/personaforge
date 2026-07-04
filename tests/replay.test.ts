import { describe, it, expect } from 'vitest';

import { InMemoryEventStore } from '../src/graph/event-store.js';
import { RunRecorder } from '../src/graph/run-recorder.js';
import { replay } from '../src/graph/replay.js';
import { AgentRunner } from '../src/core/runner/agent-runner.js';

describe('deterministic replay', () => {
  it('reproduces a tool-using run with zero real LLM or tool calls', async () => {
    const store = new InMemoryEventStore();
    const rec = new RunRecorder(store);

    let llmCalls = 0;
    let toolExecs = 0;
    let step = 0;
    const llm = {
      generateText: async () => {
        llmCalls++;
        step++;
        return step === 1
          ? { text: 'let me check', toolCalls: [{ id: 't1', name: 'echo', arguments: { v: 42 } }], finishReason: 'tool_calls' }
          : { text: 'answer: 42', toolCalls: [], finishReason: 'stop' };
      },
    } as any;
    const echo = {
      name: 'echo',
      description: '',
      parameters: {} as any,
      execute: async (a: any) => {
        toolExecs++;
        return { echoed: a };
      },
    };
    const tools = {
      list: () => [echo],
      get: (n: string) => (n === 'echo' ? echo : undefined),
      has: (n: string) => n === 'echo',
      register: () => undefined,
      unregister: () => undefined,
    } as any;

    // Live run — records the durable log.
    const live = await new AgentRunner({ name: 'bot', instructions: 'be brief', llm, tools, recorder: rec }).run({
      instructions: 'be brief',
      prompt: 'what is 42?',
    });
    const id = rec.executionId;

    expect(live.text).toBe('answer: 42');
    expect(llmCalls).toBe(2);
    expect(toolExecs).toBe(1);

    // Replay — reproduce output from the log alone, no external calls.
    const replayed = await replay(store, id, { name: 'bot', instructions: 'be brief' });

    expect(replayed.text).toBe('answer: 42');
    expect(llmCalls).toBe(2); // unchanged: no real LLM call during replay
    expect(toolExecs).toBe(1); // unchanged: no real tool exec during replay
  });
});
