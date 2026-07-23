/**
 * @personaforge/streaming — LangGraph-style event stream protocol.
 *
 * Stream modes (can be combined):
 *   values   — full state snapshot after each node finishes
 *   updates  — per-node delta (node name + output)
 *   messages — per-token chunks from the LLM
 *   debug    — internal engine telemetry (tool calls, timing)
 *   custom   — user-emitted events via ctx.emit()
 *
 * Consumer side:
 *   for await (const event of graph.streamEvents(input, { streamMode: ['updates', 'messages'] })) {
 *     if (event.type === 'token') process.stdout.write(event.data);
 *   }
 *
 * Producer side (inside a node or tool):
 *   ctx.emit('my_event', { key: 'value' });
 */

// ── Event types ───────────────────────────────────────────────────────────────

export type StreamMode = 'values' | 'updates' | 'messages' | 'debug' | 'custom';

export type StreamEvent =
  | ValueEvent
  | UpdateEvent
  | TokenEvent
  | ToolCallEvent
  | DebugEvent
  | CustomEvent;

export interface ValueEvent {
  type: 'value';
  /** Full state snapshot after node execution. */
  data: Record<string, unknown>;
  node: string;
  timestamp: number;
}

export interface UpdateEvent {
  type: 'update';
  /** Delta output from this node. */
  data: unknown;
  node: string;
  timestamp: number;
}

export interface TokenEvent {
  type: 'token';
  /** Single token / text chunk from the LLM. */
  data: string;
  node?: string;
  timestamp: number;
}

export interface ToolCallEvent {
  type: 'tool_call';
  data: { name: string; arguments: Record<string, unknown>; result?: unknown };
  node?: string;
  timestamp: number;
}

export interface DebugEvent {
  type: 'debug';
  data: Record<string, unknown>;
  timestamp: number;
}

export interface CustomEvent {
  type: 'custom';
  name: string;
  data: unknown;
  timestamp: number;
}

// ── EventEmitter channel ──────────────────────────────────────────────────────

type Listener = (event: StreamEvent) => void;

/** Lightweight typed event bus for stream events. */
export class StreamEventBus {
  private listeners: Listener[] = [];
  private modes: Set<StreamMode>;
  private queue: StreamEvent[] = [];
  private pending: Array<(v: IteratorResult<StreamEvent>) => void> = [];
  private closed = false;

  constructor(modes: StreamMode[] = ["updates", "messages"]) {
    this.modes = new Set(modes);
  }

  on(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
  }

  emit(event: StreamEvent): void {
    if (this.closed || !this.shouldEmit(event)) return;
    for (const l of this.listeners) l(event);
    const waiter = this.pending.shift();
    if (waiter) waiter({ value: event, done: false });
    else this.queue.push(event);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.pending.length > 0) {
      this.pending.shift()!({ value: undefined as unknown as StreamEvent, done: true });
    }
  }

  events(signal?: AbortSignal): AsyncGenerator<StreamEvent> {
     
    const bus = this;
    const iterator: AsyncGenerator<StreamEvent> = {
      next(): Promise<IteratorResult<StreamEvent>> {
        // Always drain buffered events first, even after close/abort.
        if (bus.queue.length > 0) return Promise.resolve({ value: bus.queue.shift()!, done: false });
        if (bus.closed || signal?.aborted) return Promise.resolve({ value: undefined as unknown as StreamEvent, done: true });
        return new Promise((resolve) => {
          const onAbort = (): void => { resolve({ value: undefined as unknown as StreamEvent, done: true }); };
          signal?.addEventListener("abort", onAbort, { once: true });
          bus.pending.push(resolve);
        });
      },
      return(): Promise<IteratorResult<StreamEvent>> {
        return Promise.resolve({ value: undefined as unknown as StreamEvent, done: true });
      },
      throw(err: unknown): Promise<IteratorResult<StreamEvent>> {
        return Promise.reject(err);
      },
      [Symbol.asyncIterator]() { return this; },
      async [Symbol.asyncDispose]() { /* no-op */ },
    };
    return iterator;
  }

  private shouldEmit(event: StreamEvent): boolean {
    switch (event.type) {
      case "value":     return this.modes.has("values");
      case "update":    return this.modes.has("updates");
      case "token":     return this.modes.has("messages");
      case "tool_call": return this.modes.has("debug");
      case "debug":     return this.modes.has("debug");
      case "custom":    return this.modes.has("custom");
    }
  }
}

// ── Execution context with emit ───────────────────────────────────────────────

/** Context passed to graph nodes and tools — includes emit() for custom events. */
export class StreamContext {
  constructor(
    private readonly bus: StreamEventBus,
    /** The current node name. */
    readonly node: string,
  ) {}

  /** Emit a custom event into the stream. */
  emit(name: string, data: unknown): void {
    this.bus.emit({ type: 'custom', name, data, timestamp: Date.now() });
  }

  /** Emit a token event (usually called by the LLM adapter). */
  token(text: string): void {
    this.bus.emit({ type: 'token', data: text, node: this.node, timestamp: Date.now() });
  }

  /** Emit a tool-call event. */
  toolCall(name: string, args: Record<string, unknown>, result?: unknown): void {
    this.bus.emit({
      type: 'tool_call',
      data: { name, arguments: args, result },
      node: this.node,
      timestamp: Date.now(),
    });
  }

  /** Emit a debug event. */
  debug(data: Record<string, unknown>): void {
    this.bus.emit({ type: 'debug', data, timestamp: Date.now() });
  }

  /** Emit a state value snapshot. */
  value(state: Record<string, unknown>): void {
    this.bus.emit({ type: 'value', data: state, node: this.node, timestamp: Date.now() });
  }

  /** Emit a delta update. */
  update(data: unknown): void {
    this.bus.emit({ type: 'update', data, node: this.node, timestamp: Date.now() });
  }
}

// ── Helper: streamable graph run ──────────────────────────────────────────────

/**
 * Create a streamable wrapper around any async execute function.
 *
 * ```ts
 * const { events, result } = createStreamableRun(async (ctx) => {
 *   ctx.token('Hello');
 *   ctx.token(' world');
 *   return { answer: 'Hello world' };
 * }, { streamMode: ['messages'] });
 *
 * for await (const e of events) console.log(e);
 * const output = await result;
 * ```
 */
export function createStreamableRun<T>(
  execute: (ctx: StreamContext) => Promise<T>,
  opts?: { streamMode?: StreamMode[]; node?: string },
): { events: AsyncGenerator<StreamEvent>; result: Promise<T> } {
  const bus = new StreamEventBus(opts?.streamMode ?? ['updates', 'messages']);
  const ctx = new StreamContext(bus, opts?.node ?? 'main');
  const ac = new AbortController();

  const result = execute(ctx).then((r) => {
    bus.close();
    ac.abort();
    return r;
  }).catch((err) => {
    bus.close();
    ac.abort();
    throw err;
  });

  return { events: bus.events(ac.signal), result };
}
