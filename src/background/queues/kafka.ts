/**
 * KafkaBackgroundQueue — Apache Kafka adapter (via kafkajs).
 *
 * Durable, ordered, replay-capable.  Best for high-throughput audit trails,
 * analytics pipelines, and event-sourced agent histories.
 *
 * Install peer dep:  bun add kafkajs
 *
 * @example
 * ```ts
 * import { KafkaBackgroundQueue } from 'personaforge/background';
 *
 * const queue = new KafkaBackgroundQueue({
 *   brokers: ['kafka:9092'],
 *   topic: 'agent-hooks',
 *   clientId: 'my-agent-app',
 *   groupId: 'agent-workers',
 * });
 *
 * // Worker side
 * await queue.consume('afterRun', async (task) => {
 *   await warehouse.insert(task.payload);
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

export interface KafkaBackgroundQueueOptions {
    brokers: string[];
    /** Kafka topic for all agent-background tasks. Default: 'agent-background' */
    topic?: string;
    clientId?: string;
    groupId?: string;
    /** Partition key strategy: 'type' (default) | 'meta.agentId' | 'meta.sessionId' */
    partitionKey?: 'type' | 'meta.agentId' | 'meta.sessionId';
    /** Extra KafkaJS config passed directly to the Kafka constructor. */
    kafkaOptions?: Record<string, unknown>;
}

export class KafkaBackgroundQueue implements BackgroundQueue {
    readonly name = 'kafka';

    private readonly opts: KafkaBackgroundQueueOptions;

    private kafka?: any;

    private producer?: any;

    private readonly consumers: any[] = [];
    private producerConnected = false;

    constructor(options: KafkaBackgroundQueueOptions) {
        this.opts = options;
    }

    private async getProducer(): Promise<unknown> {
        if (this.producerConnected) return this.producer;

        // @ts-ignore -- kafkajs is an optional peer dep
        const { Kafka } = (await import('kafkajs')) as any;
        this.kafka = new Kafka({
            clientId: this.opts.clientId ?? 'personaforge-bg',
            brokers: this.opts.brokers,
            ...(this.opts.kafkaOptions ?? {}),
        });
        this.producer = this.kafka.producer();
        await this.producer.connect();
        this.producerConnected = true;
        return this.producer;
    }

    private resolvePartitionKey(task: BackgroundTask): string {
        switch (this.opts.partitionKey ?? 'type') {
            case 'meta.agentId':   return task.meta?.agentId ?? task.type;
            case 'meta.sessionId': return task.meta?.sessionId ?? task.type;
            default:               return task.type;
        }
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

        const producer = await this.getProducer() as { send: (opts: unknown) => Promise<void> };
        await producer.send({
            topic: this.opts.topic ?? 'agent-background',
            messages: [{
                key: this.resolvePartitionKey(full as BackgroundTask),
                value: JSON.stringify(full),
                headers: { taskType: full.type },
            }],
        });
    }

    async consume<TPayload = unknown>(
        type: string,
        handler: BackgroundTaskHandler<TPayload>,
        options: WorkerOptions = {},
    ): Promise<() => Promise<void>> {

        // @ts-ignore -- kafkajs is an optional peer dep
        const { Kafka } = (await import('kafkajs')) as any;
        if (!this.kafka) {
            this.kafka = new Kafka({
                clientId: `${this.opts.clientId ?? 'personaforge-bg'}-worker`,
                brokers: this.opts.brokers,
                ...(this.opts.kafkaOptions ?? {}),
            });
        }
        const consumer = this.kafka.consumer({
            groupId: this.opts.groupId ?? 'agent-background-workers',
        });
        this.consumers.push(consumer);
        await consumer.connect();
        await consumer.subscribe({ topic: this.opts.topic ?? 'agent-background', fromBeginning: false });

        const concurrency = options.concurrency ?? 5;
        let active = 0;

        await consumer.run({
            partitionsConsumedConcurrently: concurrency,
            eachMessage: async ({ message }: { message: { value: Buffer | null } }) => {
                if (!message.value) return;
                let task: BackgroundTask<TPayload>;
                try { task = JSON.parse(message.value.toString()) as BackgroundTask<TPayload>; }
                catch { return; }
                if (task.type !== type) return; // this consumer only handles one type

                active++;
                try { await handler(task); }
                catch (err) { console.error(`[KafkaBackgroundQueue] task "${type}" failed:`, err); }
                finally { active--; }
            },
        });

        return async () => { await consumer.disconnect(); };
    }

    async close(): Promise<void> {
        if (this.producerConnected) await this.producer?.disconnect();
        await Promise.all(this.consumers.map((c: { disconnect: () => Promise<void> }) => c.disconnect()));
    }
}
