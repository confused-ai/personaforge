import { describe, it, expect } from 'vitest';

import { createAgent } from '../src/core/agent.js';
import { RunRecorder } from '../src/graph/run-recorder.js';
import { InMemoryEventStore } from '../src/graph/event-store.js';
import { GraphEventType } from '../src/graph/types.js';

const fakeLLM = {
  generateText: async () => ({ text: 'hi', toolCalls: [], finishReason: 'stop' }),
} as any;

describe('createAgent with recorder', () => {
  it('records each run as its own execution in the store', async () => {
    const store = new InMemoryEventStore();
    const recorder = new RunRecorder(store);
    const agent = createAgent({ name: 'bot', instructions: 'be brief', llm: fakeLLM, tools: false, recorder });

    await agent.run('first');
    const id1 = recorder.executionId;
    await agent.run('second');
    const id2 = recorder.executionId;

    expect(id1).not.toBe(id2);

    const e1 = await store.load(id1);
    const e2 = await store.load(id2);
    expect(e1[0]?.type).toBe(GraphEventType.AGENT_STARTED);
    expect(e1.at(-1)?.type).toBe(GraphEventType.AGENT_COMPLETED);
    expect(e2[0]?.type).toBe(GraphEventType.AGENT_STARTED);
    expect(e2.at(-1)?.type).toBe(GraphEventType.AGENT_COMPLETED);
  });
});
