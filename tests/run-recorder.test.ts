import { describe, it, expect } from 'vitest';

import { InMemoryEventStore } from '../src/graph/event-store.js';
import { RunRecorder } from '../src/graph/run-recorder.js';
import { GraphEventType } from '../src/graph/types.js';
import { AgentRunner } from '../src/core/runner/agent-runner.js';

describe('RunRecorder', () => {
  it('appends ordered, monotonically-sequenced events', async () => {
    const store = new InMemoryEventStore();
    const rec = new RunRecorder(store);

    await rec.agentStart({ agent: 'a', prompt: 'hi' });
    await rec.llmResult({ step: 1, text: 'thinking', toolCalls: [{ name: 'search' }] });
    await rec.toolResult({ step: 1, name: 'search', args: {}, output: 'ok' });
    await rec.llmResult({ step: 2, text: 'done' });
    await rec.agentEnd({ text: 'done', steps: 2, finishReason: 'stop' });

    const events = await store.load(rec.executionId);
    expect(events.map((e) => e.type)).toEqual([
      GraphEventType.AGENT_STARTED,
      GraphEventType.LLM_CALL,
      GraphEventType.TOOL_CALL,
      GraphEventType.LLM_CALL,
      GraphEventType.AGENT_COMPLETED,
    ]);
    expect(events.map((e) => e.sequence)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('AgentRunner emits events via recorder', () => {
  it('records start, llm, tool, completion for a tool-using run', async () => {
    const store = new InMemoryEventStore();
    const rec = new RunRecorder(store);

    let call = 0;
    const llm = {
      generateText: async () => {
        call++;
        return call === 1
          ? { text: '', toolCalls: [{ id: 't1', name: 'echo', arguments: { v: 1 } }], finishReason: 'tool_calls' }
          : { text: 'final', toolCalls: [], finishReason: 'stop' };
      },
    } as any;

    const echo = {
      name: 'echo',
      description: '',
      parameters: {} as any,
      execute: async (a: any) => ({ echoed: a }),
    };
    const tools = {
      list: () => [echo],
      get: (n: string) => (n === 'echo' ? echo : undefined),
    } as any;

    const runner = new AgentRunner({ name: 'bot', instructions: 'x', llm, tools, recorder: rec });
    await runner.run({ instructions: 'x', prompt: 'go' });

    const types = (await store.load(rec.executionId)).map((e) => e.type);
    expect(types[0]).toBe(GraphEventType.AGENT_STARTED);
    expect(types).toContain(GraphEventType.LLM_CALL);
    expect(types).toContain(GraphEventType.TOOL_CALL);
    expect(types.at(-1)).toBe(GraphEventType.AGENT_COMPLETED);
  });

  it('is a no-op when no recorder is configured', async () => {
    const llm = { generateText: async () => ({ text: 'hello', toolCalls: [], finishReason: 'stop' }) } as any;
    const tools = { list: () => [], get: () => undefined } as any;
    const runner = new AgentRunner({ name: 'bot', instructions: 'x', llm, tools });
    const result = await runner.run({ instructions: 'x', prompt: 'go' });
    expect(result.text).toBe('hello');
  });
});
