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

export class RunRecorder implements EventRecorder {
  private seq = 0;
  readonly executionId: ExecutionId;
  readonly graphId: GraphId;

  constructor(
    private readonly store: EventStore,
    opts: { executionId?: ExecutionId; graphId?: GraphId } = {},
  ) {
    this.executionId = opts.executionId ?? makeExecutionId();
    this.graphId = opts.graphId ?? makeGraphId();
  }

  private emit(type: GraphEventType, data: Record<string, unknown>): Promise<void> {
    const event: GraphEvent = {
      id: uid('e'),
      type,
      executionId: this.executionId,
      graphId: this.graphId,
      timestamp: Date.now(),
      sequence: this.seq++,
      data,
    };
    return this.store.append([event]);
  }

  agentStart(data: { agent: string; prompt: string }): Promise<void> {
    return this.emit(GraphEventType.AGENT_STARTED, { ...data });
  }

  llmResult(data: {
    step: number;
    text: string;
    toolCalls?: readonly { name: string }[];
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
