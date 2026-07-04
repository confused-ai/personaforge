/**
 * RunRecorder — bridges the core agent runner to the durable event log.
 *
 * Implements the core-side `EventRecorder` seam by constructing `GraphEvent`s
 * with monotonic sequence numbers and appending them to any `EventStore`.
 * This is what makes an ordinary `agent.run()` produce the same append-only,
 * replayable log that the graph engine produces — one substrate for both.
 */

import {
  type EventStore,
  type GraphEvent,
  type ExecutionId,
  type GraphId,
  GraphEventType,
  uid,
  graphId as makeGraphId,
  executionId as makeExecutionId,
} from './types.js';
import type { EventRecorder } from '../core/runner/types.js';

export interface RunRecorderOptions {
  executionId?: ExecutionId;
  graphId?: GraphId;
  /** Strip secrets/PII from event data before it is persisted (e.g. `redactSecrets`). */
  redact?: (data: Record<string, unknown>) => Record<string, unknown>;
  /** Multi-tenant isolation stamp, added to every event's `data.tenantId`. */
  tenantId?: string;
  /** Recording failures are routed here and never thrown — recording must not break the run. */
  onError?: (err: unknown) => void;
}

export class RunRecorder implements EventRecorder {
  private seq = 0;
  private _executionId: ExecutionId;
  private readonly pinned: boolean;
  readonly graphId: GraphId;
  private readonly redact?: (data: Record<string, unknown>) => Record<string, unknown>;
  private readonly tenantId?: string;
  private readonly onError?: (err: unknown) => void;

  constructor(
    private readonly store: EventStore,
    opts: RunRecorderOptions = {},
  ) {
    this._executionId = opts.executionId ?? makeExecutionId();
    this.pinned = opts.executionId != null;
    this.graphId = opts.graphId ?? makeGraphId();
    this.redact = opts.redact;
    this.tenantId = opts.tenantId;
    this.onError = opts.onError;
  }

  /** Execution id of the current (or most recent) run. */
  get executionId(): ExecutionId {
    return this._executionId;
  }

  private async emit(type: GraphEventType, data: Record<string, unknown>): Promise<void> {
    // Recording must never break the agent run: redact, stamp tenant, persist,
    // and swallow any store failure (routed to onError).
    try {
      const redacted = this.redact ? this.redact(data) : data;
      const payload = this.tenantId ? { ...redacted, tenantId: this.tenantId } : redacted;
      const event: GraphEvent = {
        id: uid('e'),
        type,
        executionId: this._executionId,
        graphId: this.graphId,
        timestamp: Date.now(),
        sequence: this.seq++,
        data: payload,
      };
      await this.store.append([event]);
    } catch (err) {
      this.onError?.(err);
    }
  }

  agentStart(data: { agent: string; prompt: string }): Promise<void> {
    // Mint a fresh execution per run so one recorder can be reused across
    // sequential runs (each run() = one execution in the log).
    // ponytail: single-flight — concurrent runs on one recorder interleave;
    // use one recorder per run when running agents in parallel.
    if (!this.pinned) {
      this._executionId = makeExecutionId();
      this.seq = 0;
    }
    return this.emit(GraphEventType.AGENT_STARTED, { ...data });
  }

  llmResult(data: {
    step: number;
    text: string;
    toolCalls?: readonly { name: string }[];
    finishReason?: string;
    usage?: unknown;
  }): Promise<void> {
    return this.emit(GraphEventType.LLM_CALL, { ...data });
  }

  toolResult(data: {
    step: number;
    name: string;
    args: unknown;
    output: unknown;
    error?: boolean;
  }): Promise<void> {
    return this.emit(GraphEventType.TOOL_CALL, { ...data });
  }

  agentEnd(data: { text: string; steps: number; finishReason: string }): Promise<void> {
    return this.emit(GraphEventType.AGENT_COMPLETED, { ...data });
  }
}

// ── Redaction (compliance: strip secrets/PII before persisting the log) ───────

const SECRET_KEY =
  /^(pass(word|wd)?|secret|token|api[_-]?key|authorization|auth|credential|private[_-]?key|access[_-]?key|ssn|email)$/i;

/**
 * Recursively replace the values of secret-looking keys with `'[REDACTED]'`.
 * Key-based: catches structured fields (tool args, headers, payloads). It does
 * NOT scan free-text for embedded secrets — pair with a pattern redactor if a
 * prompt may contain inline credentials.
 */
export function redactSecrets(data: Record<string, unknown>): Record<string, unknown> {
  return deepRedact(data) as Record<string, unknown>;
}

function deepRedact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepRedact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '[REDACTED]' : deepRedact(v);
    }
    return out;
  }
  return value;
}
