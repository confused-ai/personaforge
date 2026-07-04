import { describe, it, expect } from 'vitest';

import { InMemoryEventStore } from '../src/graph/event-store.js';
import { BatchingEventStore } from '../src/graph/batching-store.js';
import { RunRecorder } from '../src/graph/run-recorder.js';

describe('BatchingEventStore', () => {
  it('buffers appends off the hot path until flushed', async () => {
    const inner = new InMemoryEventStore();
    const batch = new BatchingEventStore(inner, { maxBatch: 1000, flushIntervalMs: 0 });
    const rec = new RunRecorder(batch);

    await rec.agentStart({ agent: 'a', prompt: 'p' });
    await rec.agentEnd({ text: 'x', steps: 1, finishReason: 'stop' });
    const id = rec.executionId;

    // Nothing persisted to the inner store yet — it's buffered.
    expect((await inner.load(id)).length).toBe(0);

    await batch.flush();
    expect((await inner.load(id)).length).toBe(2);
  });

  it('reads flush first, so load() is always consistent', async () => {
    const inner = new InMemoryEventStore();
    const batch = new BatchingEventStore(inner, { maxBatch: 1000, flushIntervalMs: 0 });
    const rec = new RunRecorder(batch);

    await rec.agentStart({ agent: 'a', prompt: 'p' });
    await rec.agentEnd({ text: 'x', steps: 1, finishReason: 'stop' });

    // Reading through the batching store flushes pending events first.
    expect((await batch.load(rec.executionId)).length).toBe(2);
  });

  it('auto-flushes when the buffer reaches maxBatch', async () => {
    const inner = new InMemoryEventStore();
    const batch = new BatchingEventStore(inner, { maxBatch: 1, flushIntervalMs: 0 });
    const rec = new RunRecorder(batch);

    await rec.agentStart({ agent: 'a', prompt: 'p' });
    // maxBatch=1 → each append flushes immediately.
    expect((await inner.load(rec.executionId)).length).toBe(1);
  });

  it('close() flushes remaining events', async () => {
    const inner = new InMemoryEventStore();
    const batch = new BatchingEventStore(inner, { maxBatch: 1000, flushIntervalMs: 0 });
    const rec = new RunRecorder(batch);

    await rec.agentStart({ agent: 'a', prompt: 'p' });
    const id = rec.executionId;
    await batch.close();
    expect((await inner.load(id)).length).toBe(1);
  });
});
