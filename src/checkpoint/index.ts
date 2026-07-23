/**
 * @confused-ai/checkpoint — durable interrupt, resume, and fork.
 *
 * LangGraph-style control flow. Any node can call `ctx.interrupt(payload)`:
 *   - On first pass, interrupt() throws an InterruptSignal that the executor
 *     catches, persists a checkpoint, and returns { interrupted: true }.
 *   - On resume(threadId, value), the executor re-runs the graph; the
 *     interrupted node's interrupt() now *returns* the resume value instead of
 *     throwing, so the node continues past the pause deterministically.
 *
 * Fork-from-checkpoint clones any saved checkpoint into a new thread for
 * time-travel exploration.
 *
 * ```ts
 * const exec = new DurableExecutor({ nodes: [['ask', askNode], ['act', actNode]] });
 * const r1 = await exec.run(input);      // r1.interrupted === true (paused at 'ask')
 * const r2 = await exec.resume(r1.threadId, { approved: true }); // continues
 * const fork = await exec.fork(r1.threadId);
 * ```
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Checkpoint {
  id: string;
  threadId: string;
  /** Node that called interrupt(). */
  node: string;
  /** Data the node passed to interrupt(). */
  interruptPayload: unknown;
  /** Accumulated per-node state up to (not including) the interrupted node. */
  state: Record<string, unknown>;
  /** Ordered execution history for replay/audit. */
  history: Array<{ node: string; output: unknown }>;
  /** The input that was flowing into the interrupted node. */
  pendingInput: unknown;
  createdAt: number;
}

export interface CheckpointStore {
  save(cp: Checkpoint): Promise<void>;
  load(threadId: string): Promise<Checkpoint | null>;
  loadById(checkpointId: string): Promise<Checkpoint | null>;
  list(threadId: string): Promise<Checkpoint[]>;
  delete(threadId: string): Promise<void>;
}

export interface InterruptContext {
  /** Pause execution and wait for resume(). Returns the resume value on replay. */
  interrupt(payload: unknown): unknown;
  /** Accumulated per-node state (read-only snapshot). */
  readonly state: Record<string, unknown>;
}

export type NodeFn = (input: unknown, ctx: InterruptContext) => Promise<unknown> | unknown;

// ── InterruptSignal ───────────────────────────────────────────────────────────

/** Thrown by interrupt() to unwind and checkpoint. */
export class InterruptSignal extends Error {
  constructor(readonly payload: unknown) {
    super('__INTERRUPT__');
    this.name = 'InterruptSignal';
  }
}

// ── In-memory checkpoint store ────────────────────────────────────────────────

export class InMemoryCheckpointStore implements CheckpointStore {
  private readonly data = new Map<string, Checkpoint[]>();

  async save(cp: Checkpoint): Promise<void> {
    const arr = this.data.get(cp.threadId) ?? [];
    arr.push(cp);
    this.data.set(cp.threadId, arr);
  }
  async load(threadId: string): Promise<Checkpoint | null> {
    const arr = this.data.get(threadId);
    return arr && arr.length > 0 ? arr[arr.length - 1]! : null;
  }
  async loadById(checkpointId: string): Promise<Checkpoint | null> {
    for (const arr of this.data.values()) {
      const found = arr.find((cp) => cp.id === checkpointId);
      if (found) return found;
    }
    return null;
  }
  async list(threadId: string): Promise<Checkpoint[]> {
    return this.data.get(threadId) ?? [];
  }
  async delete(threadId: string): Promise<void> {
    this.data.delete(threadId);
  }
}

// ── DurableExecutor ───────────────────────────────────────────────────────────

export interface DurableExecutorConfig {
  /** Ordered [nodeName, nodeFunction] pairs executed in sequence. */
  nodes: Array<[string, NodeFn]>;
  store?: CheckpointStore;
}

export interface RunResult {
  threadId: string;
  output: unknown;
  interrupted: boolean;
  /** Present when interrupted — the payload passed to interrupt(). */
  interruptPayload?: unknown;
}

/**
 * DurableExecutor — sequential node runner with durable interrupt/resume/fork.
 */
export class DurableExecutor {
  private readonly nodes: Array<[string, NodeFn]>;
  private readonly store: CheckpointStore;

  constructor(config: DurableExecutorConfig) {
    this.nodes = config.nodes;
    this.store = config.store ?? new InMemoryCheckpointStore();
  }

  /** Run from the start with a fresh (or provided) thread id. */
  async run(input: unknown, threadId?: string): Promise<RunResult> {
    const tid = threadId ?? crypto.randomUUID();
    return this.execute(tid, 0, input, {}, [], undefined);
  }

  /** Resume a paused thread; `value` becomes the interrupted node's interrupt() return. */
  async resume(threadId: string, value: unknown): Promise<RunResult> {
    const cp = await this.store.load(threadId);
    if (!cp) throw new Error(`[DurableExecutor] No checkpoint for thread ${threadId}`);
    const idx = this.nodes.findIndex(([n]) => n === cp.node);
    if (idx < 0) throw new Error(`[DurableExecutor] Unknown node "${cp.node}"`);
    return this.execute(threadId, idx, cp.pendingInput, { ...cp.state }, [...cp.history], value);
  }

  /** Fork any checkpoint into a new thread for time-travel. */
  async fork(threadId: string, checkpointId?: string): Promise<string> {
    const cp = checkpointId ? await this.store.loadById(checkpointId) : await this.store.load(threadId);
    if (!cp) throw new Error('[DurableExecutor] Checkpoint not found');
    const newThread = crypto.randomUUID();
    await this.store.save({
      ...cp,
      threadId: newThread,
      id: crypto.randomUUID(),
      state: { ...cp.state },
      history: [...cp.history],
      createdAt: Date.now(),
    });
    return newThread;
  }

  listCheckpoints(threadId: string): Promise<Checkpoint[]> {
    return this.store.list(threadId);
  }

  private async execute(
    threadId: string,
    startIdx: number,
    initialInput: unknown,
    state: Record<string, unknown>,
    history: Array<{ node: string; output: unknown }>,
    resumeValue: unknown,
  ): Promise<RunResult> {
    let input = initialInput;

    for (let i = startIdx; i < this.nodes.length; i++) {
      const [name, fn] = this.nodes[i]!;
      // On the resumed node, interrupt() returns resumeValue exactly once.
      const isResumingNode = i === startIdx && resumeValue !== undefined;
      let consumed = false;

      const ctx: InterruptContext = {
        state,
        interrupt: (payload: unknown): unknown => {
          if (isResumingNode && !consumed) {
            consumed = true;
            return resumeValue;
          }
          throw new InterruptSignal(payload);
        },
      };

      let output: unknown;
      try {
        output = await fn(input, ctx);
      } catch (err) {
        if (err instanceof InterruptSignal) {
          const cp: Checkpoint = {
            id: crypto.randomUUID(),
            threadId,
            node: name!,
            interruptPayload: err.payload,
            state: { ...state },
            history: [...history],
            pendingInput: input,
            createdAt: Date.now(),
          };
          await this.store.save(cp);
          return { threadId, output: err.payload, interrupted: true, interruptPayload: err.payload };
        }
        throw err;
      }

      state[name!] = output;
      history.push({ node: name!, output });
      input = output;
    }

    return { threadId, output: input, interrupted: false };
  }
}
