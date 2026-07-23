/**
 * Background Queue system for agent hooks.
 *
 * Allows long-running / blocking hook work to be dispatched to an external
 * queue backend instead of executing in the agentic loop.
 *
 * ## Quick start
 *
 * ```ts
 * import { agent } from 'personaforge';
 * import { queueHook, InMemoryBackgroundQueue } from 'personaforge/background';
 *
 * // Default: in-memory worker pool (no extra deps)
 * const queue = new InMemoryBackgroundQueue({ concurrency: 5 });
 *
 * const ai = agent({
 *   model: 'gpt-4o',
 *   instructions: '...',
 *   hooks: {
 *     afterRun: queueHook(queue, 'analytics', (result) => ({
 *       steps: result.steps,
 *       tokens: result.usage?.totalTokens,
 *     })),
 *   },
 * });
 *
 * // Register the worker handler (same or separate process)
 * await queue.consume('analytics', async (task) => {
 *   await analytics.track('agent.run', task.payload);
 * });
 * ```
 *
 * ## Swap to a production backend
 *
 * Just replace `InMemoryBackgroundQueue` with any of:
 * - `BullMQBackgroundQueue`    — Redis-backed, durable, retries, delays  (bun add bullmq)
 * - `KafkaBackgroundQueue`     — High-throughput, ordered, replay        (bun add kafkajs)
 * - `RabbitMQBackgroundQueue`  — AMQP, routing, dead-letter exchanges    (bun add amqplib)
 * - `RedisPubSubBackgroundQueue` — Lightweight fanout                    (bun add ioredis)
 * - `SQSBackgroundQueue`       — AWS managed, serverless                 (bun add @aws-sdk/client-sqs)
 */

// Core interface + types
export type {
    BackgroundQueue,
    BackgroundTask,
    BackgroundTaskHandler,
    EnqueueOptions,
    WorkerOptions,
    QueuedHook,
} from './types.js';

// Default (in-process) queue
export { InMemoryBackgroundQueue } from './queues/memory.js';

// Durable / distributed backends
export { BullMQBackgroundQueue }     from './queues/bullmq.js';
export type { BullMQBackgroundQueueOptions } from './queues/bullmq.js';

export { RedisPubSubBackgroundQueue } from './queues/redis-pubsub.js';
export type { RedisPubSubBackgroundQueueOptions, RedisPublisher, RedisSubscriber } from './queues/redis-pubsub.js';

export { KafkaBackgroundQueue }      from './queues/kafka.js';
export type { KafkaBackgroundQueueOptions } from './queues/kafka.js';

export { RabbitMQBackgroundQueue }   from './queues/rabbitmq.js';
export type { RabbitMQBackgroundQueueOptions } from './queues/rabbitmq.js';

export { SQSBackgroundQueue }        from './queues/sqs.js';
export type { SQSBackgroundQueueOptions } from './queues/sqs.js';

// The hook wrapper
export { queueHook } from './queue-hook.js';
export { generateTaskId } from './util.js';
