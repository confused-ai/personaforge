/**
 * RedisPubSubBackgroundQueue — Redis Pub/Sub adapter.
 *
 * Lightweight, zero-durability (fire-and-forget to subscribers).
 * Good for real-time fanout, not for reliable task processing.
 * For durable tasks use BullMQBackgroundQueue instead.
 *
 * Install peer dep:  bun add ioredis
 *
 * @example
 * ```ts
 * import Redis from 'ioredis';
 * import { RedisPubSubBackgroundQueue } from 'personaforge/background';
 *
 * const publisher  = new Redis(process.env.REDIS_URL);
 * const subscriber = new Redis(process.env.REDIS_URL);
 *
 * const queue = new RedisPubSubBackgroundQueue({
 *   publisher,
 *   subscriber,
 *   channel: 'agent-hooks',  // optional prefix
 * });
 * ```
 */
import type {
    BackgroundQueue,
    BackgroundTask,
    BackgroundTaskHandler,
    EnqueueOptions,
    WorkerOptions,
} from '../types.js';
import { generateTaskId } from '../util.js';

/** Minimal ioredis-compatible interface (also works with node-redis). */
export interface RedisPublisher {
    publish(channel: string, message: string): Promise<number> | void;
}
export interface RedisSubscriber {
    subscribe(channel: string): Promise<unknown> | void;
    on(event: 'message', listener: (channel: string, message: string) => void): unknown;
    unsubscribe(channel: string): Promise<unknown> | void;
}

export interface RedisPubSubBackgroundQueueOptions {
    publisher: RedisPublisher;
    subscriber: RedisSubscriber;
    /** Channel prefix. Task type is appended: `{channel}:{type}`. Default: 'agent-bg' */
    channel?: string;
}

export class RedisPubSubBackgroundQueue implements BackgroundQueue {
    readonly name = 'redis-pubsub';

    private readonly pub: RedisPublisher;
    private readonly sub: RedisSubscriber;
    private readonly channelPrefix: string;
    private readonly handlers = new Map<string, BackgroundTaskHandler>();

    constructor(options: RedisPubSubBackgroundQueueOptions) {
        this.pub = options.publisher;
        this.sub = options.subscriber;
        this.channelPrefix = options.channel ?? 'agent-bg';

        // Central message router
        this.sub.on('message', (channel: string, message: string) => {
            const type = channel.replace(`${this.channelPrefix}:`, '');
            const handler = this.handlers.get(type);
            if (!handler) return;
            let task: BackgroundTask;
            try { task = JSON.parse(message) as BackgroundTask; } catch { return; }
            void Promise.resolve(handler(task)).catch((err: unknown) => {
                console.error(`[RedisPubSubBackgroundQueue] task "${type}" failed:`, err);
            });
        });
    }

    async enqueue<TPayload = unknown>(
        task: Omit<BackgroundTask<TPayload>, 'id' | 'enqueuedAt'>,
        _options: EnqueueOptions = {},
    ): Promise<void> {
        const full: BackgroundTask<TPayload> = {
            id: generateTaskId(),
            enqueuedAt: Date.now(),
            ...task,
        } as BackgroundTask<TPayload>;
        const channel = `${this.channelPrefix}:${full.type}`;
        await this.pub.publish(channel, JSON.stringify(full));
    }

    async consume<TPayload = unknown>(
        type: string,
        handler: BackgroundTaskHandler<TPayload>,
        _options: WorkerOptions = {},
    ): Promise<() => Promise<void>> {
        const channel = `${this.channelPrefix}:${type}`;
        this.handlers.set(type, handler as BackgroundTaskHandler);
        await this.sub.subscribe(channel);

        return async () => {
            this.handlers.delete(type);
            await this.sub.unsubscribe(channel);
        };
    }

    async close(): Promise<void> {
        // caller owns the Redis clients; we just clear our state
        this.handlers.clear();
    }
}
