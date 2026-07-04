import { describe, it, expect } from 'vitest';

import { InMemoryEventStore } from '../src/graph/event-store.js';
import { RunRecorder } from '../src/graph/run-recorder.js';
import { verifyChain } from '../src/graph/audit.js';

describe('tamper-evident audit chain', () => {
  it('verifies an untampered chain', async () => {
    const store = new InMemoryEventStore();
    const rec = new RunRecorder(store, { hashChain: true });
    await rec.agentStart({ agent: 'a', prompt: 'p' });
    await rec.llmResult({ step: 1, text: 't' });
    await rec.agentEnd({ text: 't', steps: 1, finishReason: 'stop' });

    const events = await store.load(rec.executionId);
    expect(verifyChain(events).valid).toBe(true);
  });

  it('detects tampering with a recorded event', async () => {
    const store = new InMemoryEventStore();
    const rec = new RunRecorder(store, { hashChain: true });
    await rec.agentStart({ agent: 'a', prompt: 'p' });
    await rec.llmResult({ step: 1, text: 'original' });
    await rec.agentEnd({ text: 'x', steps: 1, finishReason: 'stop' });

    const events = await store.load(rec.executionId);
    (events[1]!.data as any).text = 'FORGED'; // mutate a persisted event

    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.reason).toContain('tampered');
  });

  it('flags events lacking audit metadata', () => {
    const bogus = [
      { id: 'x', type: 'agent.started', executionId: 'e', graphId: 'g', timestamp: 0, sequence: 0, data: {} },
    ] as any;
    expect(verifyChain(bogus).valid).toBe(false);
  });
});
