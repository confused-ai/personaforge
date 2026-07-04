import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { InMemoryEventStore, SqliteEventStore } from '../src/graph/event-store.js';
import { RunRecorder } from '../src/graph/run-recorder.js';

describe('right-to-erasure (GDPR purge)', () => {
  it('InMemoryEventStore.purge removes all events and the checkpoint', async () => {
    const store = new InMemoryEventStore();
    const rec = new RunRecorder(store);
    await rec.agentStart({ agent: 'a', prompt: 'p' });
    await rec.agentEnd({ text: 'x', steps: 1, finishReason: 'stop' });
    const id = rec.executionId;

    expect((await store.load(id)).length).toBe(2);
    await store.purge(id);
    expect((await store.load(id)).length).toBe(0);
    expect(await store.getCheckpoint(id)).toBeNull();
  });

  it('SqliteEventStore.purge deletes persisted rows', async () => {
    const dbPath = path.join(os.tmpdir(), `cai-erasure-${process.pid}-${Date.now()}.db`);
    try {
      const store = await new SqliteEventStore(dbPath).init();
      const rec = new RunRecorder(store);
      await rec.agentStart({ agent: 'a', prompt: 'p' });
      await rec.agentEnd({ text: 'x', steps: 1, finishReason: 'stop' });
      const id = rec.executionId;

      expect((await store.load(id)).length).toBe(2);
      await store.purge(id);
      expect((await store.load(id)).length).toBe(0);
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        fs.rmSync(dbPath + suffix, { force: true });
      }
    }
  });
});
