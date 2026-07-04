/**
 * BatchingEventStore — keep event recording off the hot path.
 *
 * Wraps any EventStore. Appends are buffered in memory and flushed to the inner
 * store in batches (by size or on a timer), so a slow/remote backend (Postgres,
 * Kafka) does not add latency to every LLM turn. Reads flush first, so callers
 * always see a consistent view. Failures are retried on the next flush and
 * surfaced via onError — never thrown into the caller's run.
 */

import type { EventStore, GraphEvent, ExecutionId, Checkpoint } from './types.js';

export interface BatchingOptions {
  /** Flush once the buffer reaches this many events. Default 100. */
  maxBatch?: number;
  /** Also flush at least this often (ms). Default 1000. 0 disables the timer. */
  flushIntervalMs?: number;
  /** Flush failures are routed here and never thrown. */
  onError?: (err: unknown) => void;
}

export class BatchingEventStore implements EventStore {
  private buffer: GraphEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly maxBatch: number;
  private readonly onError?: (err: unknown) => void;

  constructor(private readonly inner: EventStore, opts: BatchingOptions = {}) {
    this.maxBatch = opts.maxBatch ?? 100;
    this.onError = opts.onError;
    const interval = opts.flushIntervalMs ?? 1000;
    if (interval > 0) {
      this.timer = setInterval(() => {
        void this.flush();
      }, interval);
      // Don't keep the process alive just for the flush timer.
      this.timer.unref?.();
    }
  }

  async append(events: GraphEvent[]): Promise<void> {
    this.buffer.push(...events);
    if (this.buffer.length >= this.maxBatch) await this.flush();
  }

  /** Persist buffered events to the inner store. Safe to call any time. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.inner.append(batch);
    } catch (err) {
      // Put the batch back so a later flush retries; surface the failure.
      this.buffer.unshift(...batch);
      this.onError?.(err);
    }
  }

  async load(executionId: ExecutionId): Promise<GraphEvent[]> {
    await this.flush();
    return this.inner.load(executionId);
  }

  async loadAfter(executionId: ExecutionId, afterSequence: number): Promise<GraphEvent[]> {
    await this.flush();
    return this.inner.loadAfter(executionId, afterSequence);
  }

  async getCheckpoint(executionId: ExecutionId): Promise<Checkpoint | null> {
    await this.flush();
    return this.inner.getCheckpoint(executionId);
  }

  async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    await this.flush();
    return this.inner.saveCheckpoint(checkpoint);
  }

  async purge(executionId: ExecutionId): Promise<void> {
    this.buffer = this.buffer.filter((e) => e.executionId !== executionId);
    if (this.inner.purge) await this.inner.purge(executionId);
  }

  /** Flush any pending events and stop the background timer. Call on shutdown. */
  async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}
