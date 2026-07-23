/**
 * @personaforge/contracts — Branded ID types and UUID factory.
 *
 * Replaces all `Date.now() + Math.random()` patterns across the codebase with
 * crypto.randomUUID() for better distribution and security in distributed systems.
 *
 * Branded types prevent accidental ID swapping at compile time:
 * ```ts
 * const agentId: AgentId = asAgentId('agent-123');
 * const sessionId: SessionId = asSessionId('session-456');
 * // Type error: cannot assign SessionId to AgentId
 * ```
 *
 * @module
 */

/**
 * Brand type utility — creates a distinct type without runtime overhead.
 * Example: `type UserId = Brand<string, 'UserId'>` is distinct from `type SessionId = Brand<string, 'SessionId'>`.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };

// ── Branded ID types ──────────────────────────────────────────────────────────

export type AgentId = Brand<string, 'AgentId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type RunId = Brand<string, 'RunId'>;
export type MemoryId = Brand<string, 'MemoryId'>;
export type ArtifactId = Brand<string, 'ArtifactId'>;
export type ToolCallId = Brand<string, 'ToolCallId'>;
export type TraceId = Brand<string, 'TraceId'>;
export type TaskId = Brand<string, 'TaskId'>;
export type WorkflowId = Brand<string, 'WorkflowId'>;
export type ExecutionId = Brand<string, 'ExecutionId'>;
export type ScheduleId = Brand<string, 'ScheduleId'>;

// ── ID Factory ────────────────────────────────────────────────────────────────

/**
 * Generate a globally unique ID using crypto.randomUUID().
 *
 * @param prefix Optional human-readable prefix for debugging (e.g. 'sess', 'run', 'mem')
 * @returns UUID v4 string, optionally prefixed
 *
 * @example
 * ```ts
 * const sessionId: SessionId = asSessionId(newId('sess'));
 * const runId: RunId = asRunId(newId('run'));
 * const memoryId: MemoryId = asMemoryId(newId('mem'));
 * ```
 */
export function newId(prefix?: string): string {
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

// ── Unsafe cast functions (for tests and migrations) ─────────────────────────
// Never use these in production code paths — use newId() instead.

export const asAgentId = (s: string): AgentId => s as AgentId;
export const asSessionId = (s: string): SessionId => s as SessionId;
export const asRunId = (s: string): RunId => s as RunId;
export const asMemoryId = (s: string): MemoryId => s as MemoryId;
export const asArtifactId = (s: string): ArtifactId => s as ArtifactId;
export const asToolCallId = (s: string): ToolCallId => s as ToolCallId;
export const asTraceId = (s: string): TraceId => s as TraceId;
export const asTaskId = (s: string): TaskId => s as TaskId;
export const asWorkflowId = (s: string): WorkflowId => s as WorkflowId;
export const asExecutionId = (s: string): ExecutionId => s as ExecutionId;
export const asScheduleId = (s: string): ScheduleId => s as ScheduleId;
