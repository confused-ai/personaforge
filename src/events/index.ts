/**
 * @personaforge/events — first-class typed event bus + core event vocabulary.
 *
 * Everything an agent or workflow does can be observed as a typed event.
 * `eventBus()` returns a typed pub/sub bus wired to the core vocabulary below;
 * `createAgentEventBus` is the generic (any `EventMap`) primitive.
 *
 * ```ts
 * import { eventBus, AGENT_EVENT } from 'personaforge/events';
 *
 * const bus = eventBus({ replayBufferSize: 100 });
 * bus.on(AGENT_EVENT.runFinished, (e) => console.log('done', e.agentId, e.result));
 *
 * const agent = createAgent({
 *   name: 'worker',
 *   hooks: {
 *     afterRun: async (result) => {
 *       await bus.emit(AGENT_EVENT.runFinished, { agentId: 'worker', sessionId: '?', result });
 *     },
 *   },
 * });
 * ```
 */

import { createAgentEventBus, AgentEventBusTimeoutError } from '../orchestration/event-bus.js';
import type {
    EventMap,
    EventHandler,
    WildcardHandler,
    EventSubscription,
    AgentEventBus,
    AgentEventBusMetrics,
    AgentEventBusOptions,
} from '../orchestration/event-bus.js';

// ── Core event vocabulary ──────────────────────────────────────────────────

/** Canonical event names — use these to avoid typos across the framework. */
export const AGENT_EVENT = {
    agentStarted: 'agent:started',
    agentOutput: 'agent:output',
    agentFinished: 'agent:finished',
    toolCalled: 'tool:called',
    toolResult: 'tool:result',
    llmDelta: 'llm:delta',
    stepFinished: 'step:finished',
    runFinished: 'run:finished',
    workflowSuspended: 'workflow:suspended',
    workflowCompleted: 'workflow:completed',
    error: 'error',
} as const;

/** Payloads for the core event vocabulary. */
export interface CoreEventMap extends EventMap {
    'agent:started': { agentId?: string; sessionId?: string; prompt?: unknown };
    'agent:output': { agentId?: string; sessionId?: string; text?: string };
    'agent:finished': {
        agentId?: string;
        sessionId?: string;
        steps: number;
        tokensUsed?: number;
        costUsd?: number;
    };
    'tool:called': { agentId?: string; sessionId?: string; name: string; input: unknown };
    'tool:result': {
        agentId?: string;
        sessionId?: string;
        name: string;
        success: boolean;
        output?: unknown;
        durationMs?: number;
    };
    'llm:delta': { agentId?: string; sessionId?: string; delta: string };
    'step:finished': { agentId?: string; sessionId?: string; step: number };
    'run:finished': { agentId?: string; sessionId?: string; result?: unknown };
    'workflow:suspended': { workflowId?: string; awaiting: string; token?: string; message?: string };
    'workflow:completed': { workflowId?: string; results?: Record<string, unknown> };
    'error': { agentId?: string; message: string; error?: unknown };
}

/**
 * Create a typed event bus pre-wired to the {@link CoreEventMap} vocabulary.
 * Thin convenience over {@link createAgentEventBus}.
 */
export function eventBus(options?: AgentEventBusOptions): AgentEventBus<CoreEventMap> {
    return createAgentEventBus<CoreEventMap>(options);
}

// ── Re-export the generic primitive + types ─────────────────────────────────

export { createAgentEventBus, AgentEventBusTimeoutError };
export type {
    EventMap,
    EventHandler,
    WildcardHandler,
    EventSubscription,
    AgentEventBus,
    AgentEventBusMetrics,
    AgentEventBusOptions,
};
