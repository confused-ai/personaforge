import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { InMemoryEventStore, SqliteEventStore } from '../src/graph/event-store.js';
import { RunRecorder, redactSecrets } from '../src/graph/run-recorder.js';
import { GraphEventType } from '../src/graph/types.js';
import { AgentRunner } from '../src/core/runner/agent-runner.js';
import type { EventStore } from '../src/graph/types.js';

describe('RunRecorder — enterprise hardening', () => {
  it('never breaks a run when the store fails; routes errors to onError', async () => {
    const boom: EventStore = {
      append: async () => {
        throw new Error('store down');
      },
      load: async () => [],
      loadAfter: async () => [],
      getCheckpoint: async () => null,
      saveCheckpoint: async () => undefined,
    };
    const errors: unknown[] = [];
    const rec = new RunRecorder(boom, { onError: (e) => errors.push(e) });

    const llm = { generateText: async () => ({ text: 'hi', toolCalls: [], finishReason: 'stop' }) } as any;
    const tools = {
      list: () => [],
      get: () => undefined,
      has: () => false,
      register: () => undefined,
      unregister: () => undefined,
      clear: () => undefined,
    } as any;

    const result = await new AgentRunner({ name: 'bot', instructions: 'x', llm, tools, recorder: rec }).run({
      instructions: 'x',
      prompt: 'go',
    });

    expect(result.text).toBe('hi'); // run completed despite every append throwing
    expect(errors.length).toBeGreaterThan(0); // failures were captured, not swallowed silently
  });

  it('redacts secret-keyed fields before persisting (compliance)', async () => {
    const store = new InMemoryEventStore();
    const rec = new RunRecorder(store, { redact: redactSecrets });

    await rec.agentStart({ agent: 'a', prompt: 'login please' });
    await rec.toolResult({
      step: 1,
      name: 'login',
      args: { username: 'alice', password: 'hunter2', apiKey: 'sk-123' },
      output: { token: 'jwt-abc', ok: true },
    });

    const events = await store.load(rec.executionId);
    const tool = events.find((e) => e.type === GraphEventType.TOOL_CALL);
    const data = tool!.data as any;
    expect(data.args.password).toBe('[REDACTED]');
    expect(data.args.apiKey).toBe('[REDACTED]');
    expect(data.args.username).toBe('alice'); // non-secret preserved
    expect(data.output.token).toBe('[REDACTED]');
    expect(data.output.ok).toBe(true);
  });

  it('stamps a tenant id on every event (multi-tenant isolation)', async () => {
    const store = new InMemoryEventStore();
    const rec = new RunRecorder(store, { tenantId: 'acme' });
    await rec.agentStart({ agent: 'a', prompt: 'p' });
    const events = await store.load(rec.executionId);
    expect((events[0]!.data as any).tenantId).toBe('acme');
  });

  it('SqliteEventStore persists the log across store instances (crash-safety)', async () => {
    const dbPath = path.join(os.tmpdir(), `cai-durability-${process.pid}-${Date.now()}.db`);
    try {
      const store1 = await new SqliteEventStore(dbPath).init();
      const rec = new RunRecorder(store1);
      await rec.agentStart({ agent: 'bot', prompt: 'hi' });
      await rec.agentEnd({ text: 'done', steps: 1, finishReason: 'stop' });
      const id = rec.executionId;

      // Simulate a restart: a brand-new store instance over the same file.
      const store2 = await new SqliteEventStore(dbPath).init();
      const events = await store2.load(id);
      expect(events.length).toBe(2);
      expect(events[0]!.type).toBe(GraphEventType.AGENT_STARTED);
      expect(events[1]!.type).toBe(GraphEventType.AGENT_COMPLETED);
    } finally {
      for (const suffix of ['', '-wal', '-shm']) {
        fs.rmSync(dbPath + suffix, { force: true });
      }
    }
  });
});
