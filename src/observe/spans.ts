/**
 * Canonical span names for the personaforge observability layer.
 *
 * Use these constants everywhere a span name is needed so that dashboards,
 * alerts, and trace correlation queries never break when we rename a module.
 *
 * @example
 * ```ts
 * import { SpanName } from './spans.js';
 * withSpan(SpanName.AGENT_RUN, async (span) => { ... });
 * ```
 */

export const SpanName = {
  // ── Agent lifecycle ────────────────────────────────────────────────────
  AGENT_RUN:           'agent.run',
  AGENT_RESUME:        'agent.resume',
  AGENT_STREAM:        'agent.stream',

  // ── LLM ───────────────────────────────────────────────────────────────
  LLM_GENERATE:        'llm.generate',
  LLM_STREAM:          'llm.stream',
  EMBEDDING_GENERATE:  'embedding.generate',

  // ── Tools ─────────────────────────────────────────────────────────────
  TOOL_EXECUTE:        'tool.execute',
  TOOL_APPROVE:        'tool.approve',

  // ── Memory ────────────────────────────────────────────────────────────
  MEMORY_STORE:        'memory.store',
  MEMORY_RETRIEVE:     'memory.retrieve',
  MEMORY_GET:          'memory.get',
  MEMORY_DELETE:       'memory.delete',

  // ── Session ───────────────────────────────────────────────────────────
  SESSION_GET:         'session.get',
  SESSION_CREATE:      'session.create',
  SESSION_UPDATE:      'session.update',
  SESSION_DELETE:      'session.delete',
  SESSION_APPEND:      'session.appendMessage',

  // ── Vector / Knowledge ────────────────────────────────────────────────
  VECTOR_UPSERT:       'vector.upsert',
  VECTOR_SEARCH:       'vector.search',
  VECTOR_DELETE:       'vector.delete',
  KNOWLEDGE_INDEX:     'knowledge.index',
  KNOWLEDGE_SEARCH:    'knowledge.search',

  // ── Graph ─────────────────────────────────────────────────────────────
  GRAPH_NODE:          'graph.node.execute',
  GRAPH_RUN:           'graph.run',
  GRAPH_RESUME:        'graph.resume',

  // ── Orchestration ─────────────────────────────────────────────────────
  ORCHESTRATION_ROUTE: 'orchestration.route',
  SWARM_STAGE:         'swarm.stage',

  // ── Background / Queue ────────────────────────────────────────────────
  QUEUE_ENQUEUE:       'queue.enqueue',
  QUEUE_PROCESS:       'queue.process',

  // ── Guardrails ────────────────────────────────────────────────────────
  GUARDRAIL_CHECK:     'guardrail.check',
} as const;

export type SpanName = typeof SpanName[keyof typeof SpanName];
