/**
 * queueHook() — dispatch an agent lifecycle hook to a BackgroundQueue.
 *
 * Instead of executing hook logic inline (blocking the agentic loop), this
 * wrapper serialises the hook arguments into a BackgroundTask and enqueues it.
 * The hook returns `void` immediately; the real work is done by a consumer
 * (worker) running in the same or a separate process.
 *
 * ### Usage
 *
 * ```ts
 * import { agent } from 'personaforge';
 * import { queueHook, BullMQBackgroundQueue } from 'personaforge/background';
 *
 * const queue = new BullMQBackgroundQueue({
 *   redis: process.env.REDIS_URL!,
 *   queueName: 'agent-hooks',
 * });
 *
 * const ai = agent({
 *   model: 'gpt-4o',
 *   instructions: '...',
 *   hooks: {
 *     // afterRun — fire-and-forget to BullMQ; caller gets result instantly
 *     afterRun: queueHook(queue, 'analytics:afterRun', (result) => ({
 *       steps:         result.steps,
 *       finishReason:  result.finishReason,
 *       totalTokens:   result.usage?.totalTokens,
 *     })),
 *
 *     // afterStep — enqueue per-step telemetry
 *     afterStep: queueHook(queue, 'telemetry:step', (step, messages) => ({
 *       step,
 *       messageCount: messages.length,
 *     })),
 *
 *     // onError — ship errors to your error-tracking service
 *     onError: queueHook(queue, 'errors:capture', (err, step) => ({
 *       message: err.message,
 *       stack:   err.stack,
 *       step,
 *     })),
 *   },
 * });
 *
 * // ── Worker side (same or separate process) ───────────────────────────────
 * await queue.consume('analytics:afterRun', async (task) => {
 *   await analytics.track('agent.run', task.payload);
 * });
 *
 * await queue.consume('errors:capture', async (task) => {
 *   await sentry.captureException(task.payload);
 * }, { concurrency: 20 });
 * ```
 */

import type { BackgroundQueue, EnqueueOptions } from './types.js';

/**
 * Wrap a void-returning lifecycle hook so it dispatches to a `BackgroundQueue`
 * instead of executing inline.
 *
 * @param queue        - The queue backend to dispatch to.
 * @param type         - Task type name used to route to the correct worker handler.
 * @param payloadFn    - Extracts a **serialisable** payload from the hook's arguments.
 *                       Keep this cheap — it runs in the hot path.
 * @param options      - Per-task enqueue options (delay, retries, backendOptions).
 * @param meta         - Optional static metadata merged into every task envelope.
 *
 * @returns A hook function that returns `void` (never blocks the agentic loop).
 */
export function queueHook<TArgs extends unknown[], TPayload = unknown>(
    queue: BackgroundQueue,
    type: string,
    payloadFn: (...args: TArgs) => TPayload,
    options?: EnqueueOptions,
    meta?: {
        agentId?: string;
        runId?: string;
        traceId?: string;
        sessionId?: string;
    },
): (...args: TArgs) => void {
    return (...args: TArgs): void => {
        let payload: TPayload;
        try {
            payload = payloadFn(...args);
        } catch (err) {
            console.error(`[queueHook] payload extractor for "${type}" threw:`, err);
            return;
        }

        void queue.enqueue({ type, payload, ...(meta ? { meta } : {}) }, options).catch((err: unknown) => {
            console.error(`[queueHook] failed to enqueue task "${type}":`, err);
        });
    };
}
