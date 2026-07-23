/**
 * RabbitMQBackgroundQueue — RabbitMQ / AMQP adapter (via amqplib).
 *
 * Durable work queues, dead-letter exchanges, per-task TTL & priorities.
 * Good for task delegation across microservices.
 *
 * Install peer dep:  bun add amqplib && bun add -d @types/amqplib
 *
 * @example
 * ```ts
 * import { RabbitMQBackgroundQueue } from 'personaforge/background';
 *
 * const queue = new RabbitMQBackgroundQueue({
 *   url: 'amqp://localhost',
 *   queue: 'agent-hooks',
 *   durable: true,
 * });
 *
 * // Worker side
 * await queue.consume('afterRun', async (task) => {
 *   await crm.syncConversation(task.payload);
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

export interface RabbitMQBackgroundQueueOptions {
    /** AMQP connection URL. */
    url: string;
    /** Queue name shared by all task types. Default: 'agent-background' */
    queue?: string;
    /** Whether the queue survives broker restarts. Default: true */
    durable?: boolean;
    /** Dead-letter exchange for failed tasks. */
    deadLetterExchange?: string;
    /** Extra amqplib socket options. */
    socketOptions?: Record<string, unknown>;
}

export class RabbitMQBackgroundQueue implements BackgroundQueue {
    readonly name = 'rabbitmq';

    private readonly opts: RabbitMQBackgroundQueueOptions;

    private connection?: any;

    private channels: any[] = [];

    constructor(options: RabbitMQBackgroundQueueOptions) {
        this.opts = options;
    }

    private async getChannel(): Promise<unknown> {

        // @ts-ignore -- amqplib is an optional peer dep
        const amqplib = (await import('amqplib')) as any;
        if (!this.connection) {
            this.connection = await amqplib.connect(this.opts.url, this.opts.socketOptions);
        }
        const ch = await this.connection.createChannel();
        this.channels.push(ch);
        const queueName = this.opts.queue ?? 'agent-background';
        const queueArgs: Record<string, unknown> = {};
        if (this.opts.deadLetterExchange) {
            queueArgs['x-dead-letter-exchange'] = this.opts.deadLetterExchange;
        }
        await ch.assertQueue(queueName, {
            durable: this.opts.durable ?? true,
            arguments: Object.keys(queueArgs).length > 0 ? queueArgs : undefined,
        });
        return ch;
    }

    async enqueue<TPayload = unknown>(
        task: Omit<BackgroundTask<TPayload>, 'id' | 'enqueuedAt'>,
        options: EnqueueOptions = {},
    ): Promise<void> {
        const full: BackgroundTask<TPayload> = {
            id: generateTaskId(),
            enqueuedAt: Date.now(),
            ...task,
        } as BackgroundTask<TPayload>;

        const ch = await this.getChannel() as {
            sendToQueue(queue: string, content: Buffer, opts: Record<string, unknown>): boolean;
        };
        const msgOpts: Record<string, unknown> = {
            persistent: true,
            contentType: 'application/json',
            headers: { taskType: full.type },
            ...(options.delay !== undefined ? { expiration: String(options.delay) } : {}),
            ...(options.retries !== undefined ? { headers: { taskType: full.type, retries: options.retries } } : {}),
            ...(options.backendOptions ?? {}),
        };
        ch.sendToQueue(
            this.opts.queue ?? 'agent-background',
            Buffer.from(JSON.stringify(full)),
            msgOpts,
        );
    }

    async consume<TPayload = unknown>(
        type: string,
        handler: BackgroundTaskHandler<TPayload>,
        options: WorkerOptions = {},
    ): Promise<() => Promise<void>> {
        const ch = await this.getChannel() as {
            prefetch(n: number): void;
            consume(
                queue: string,
                fn: (msg: { content: Buffer; properties: Record<string, unknown> } | null) => void,
            ): Promise<{ consumerTag: string }>;
            ack(msg: unknown): void;
            nack(msg: unknown, requeue?: boolean): void;
            cancel(tag: string): Promise<void>;
        };
        const queueName = this.opts.queue ?? 'agent-background';
        ch.prefetch(options.concurrency ?? 5);

        const { consumerTag } = await ch.consume(queueName, async (msg) => {
            if (!msg) return;
            let task: BackgroundTask<TPayload>;
            try { task = JSON.parse(msg.content.toString()) as BackgroundTask<TPayload>; }
            catch { ch.ack(msg); return; }

            if (task.type !== type) { ch.ack(msg); return; }

            try {
                await handler(task);
                ch.ack(msg);
            } catch (err) {
                console.error(`[RabbitMQBackgroundQueue] task "${type}" failed:`, err);
                ch.nack(msg, false); // dead-letter or requeue based on exchange config
            }
        });

        return async () => { await ch.cancel(consumerTag); };
    }

    async close(): Promise<void> {
        await Promise.all(this.channels.map((ch: { close?: () => Promise<void> }) => ch.close?.()));
        await this.connection?.close();
    }
}
