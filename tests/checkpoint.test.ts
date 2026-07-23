import { describe, it, expect } from 'vitest';
import {
  DurableExecutor,
  InMemoryCheckpointStore,
  InterruptSignal,
} from '../src/checkpoint/index.js';
import type { NodeFn } from '../src/checkpoint/index.js';

describe('DurableExecutor', () => {
  it('runs sequential nodes end-to-end', async () => {
    const exec = new DurableExecutor({
      nodes: [
        ['double', ((n: number) => n * 2) as NodeFn],
        ['inc', ((n: number) => n + 1) as NodeFn],
      ],
    });
    const r = await exec.run(5);
    expect(r.interrupted).toBe(false);
    expect(r.output).toBe(11); // 5*2+1
  });

  it('interrupts, resumes, and continues past the pause', async () => {
    const store = new InMemoryCheckpointStore();
    const askNode: NodeFn = (input, ctx) => {
      const approval = ctx.interrupt({ question: 'approve?', input }) as { ok: boolean } | unknown;
      return { input, approval };
    };
    const finishNode: NodeFn = (data) => ({ ...(data as object), done: true });

    const exec = new DurableExecutor({
      nodes: [['ask', askNode], ['finish', finishNode]],
      store,
    });

    const r1 = await exec.run('req-123');
    expect(r1.interrupted).toBe(true);
    expect((r1.interruptPayload as { question: string }).question).toBe('approve?');

    const r2 = await exec.resume(r1.threadId, { ok: true });
    expect(r2.interrupted).toBe(false);
    expect(r2.output).toEqual({ input: 'req-123', approval: { ok: true }, done: true });
  });

  it('checkpoints are persisted and listable', async () => {
    const store = new InMemoryCheckpointStore();
    const pauseNode: NodeFn = (_input, ctx) => { ctx.interrupt('pause'); return null; };
    const exec = new DurableExecutor({ nodes: [['p', pauseNode]], store });
    const r1 = await exec.run('x');
    const cps = await exec.listCheckpoints(r1.threadId);
    expect(cps.length).toBe(1);
    expect(cps[0]!.node).toBe('p');
    expect(cps[0]!.interruptPayload).toBe('pause');
  });

  it('fork clones a checkpoint into a new thread', async () => {
    const store = new InMemoryCheckpointStore();
    const askNode: NodeFn = (input, ctx) => { const v = ctx.interrupt('ask'); return { input, v }; };
    const exec = new DurableExecutor({ nodes: [['ask', askNode]], store });
    const r1 = await exec.run('req');
    const forked = await exec.fork(r1.threadId);
    expect(forked).not.toBe(r1.threadId);
    const cps = await exec.listCheckpoints(forked);
    expect(cps.length).toBe(1);
    // Resume the fork independently with a different value.
    const forkResumed = await exec.resume(forked, 'branch-A');
    expect(forkResumed.output).toEqual({ input: 'req', v: 'branch-A' });
    // Original thread can still be resumed with a different value.
    const origResumed = await exec.resume(r1.threadId, 'branch-B');
    expect(origResumed.output).toEqual({ input: 'req', v: 'branch-B' });
  });

  it('propagates non-interrupt errors', async () => {
    const bad: NodeFn = () => { throw new Error('nope'); };
    const exec = new DurableExecutor({ nodes: [['bad', bad]] });
    await expect(exec.run(1)).rejects.toThrow('nope');
  });

  it('InterruptSignal is exported', () => {
    expect(new InterruptSignal('x').payload).toBe('x');
  });
});
