/**
 * SQSBackgroundQueue — AWS SQS adapter (via @aws-sdk/client-sqs).
 *
 * Managed, serverless, high-availability queue.  Works great for Lambda-based
 * workers and ECS task processing.
 *
 * Install peer dep:  bun add @aws-sdk/client-sqs
 *
 * @example
 * ```ts
 * import { SQSBackgroundQueue } from 'personaforge/background';
 *
 * const queue = new SQSBackgroundQueue({
 *   queueUrl: process.env.SQS_QUEUE_URL!,
 *   region: 'us-east-1',
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

export interface SQSBackgroundQueueOptions {
    queueUrl: string;
    region?: string;
    /** Max messages fetched per poll (1–10). Default: 10 */
    maxMessages?: number;
    /** Long-poll wait time in seconds (0–20). Default: 20 */
    waitTimeSeconds?: number;
    /** Visibility timeout in seconds. Default: 30 */
    visibilityTimeout?: number;
    /** Extra SQS client config (credentials, endpoint override, etc.). */
    sqsOptions?: Record<string, unknown>;
}

export class SQSBackgroundQueue implements BackgroundQueue {
    readonly name = 'sqs';

    private readonly opts: SQSBackgroundQueueOptions;

    private client?: any;
    private stopPolling: (() => void) | undefined;

    constructor(options: SQSBackgroundQueueOptions) {
        this.opts = options;
    }

    private async getClient(): Promise<unknown> {
        if (this.client) return this.client;

        // @ts-ignore -- @aws-sdk/client-sqs is an optional peer dep
        const { SQSClient } = (await import('@aws-sdk/client-sqs')) as any;
        this.client = new SQSClient({
            region: this.opts.region ?? 'us-east-1',
            ...(this.opts.sqsOptions ?? {}),
        });
        return this.client;
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


        // @ts-ignore -- @aws-sdk/client-sqs is an optional peer dep
        const { SendMessageCommand } = (await import('@aws-sdk/client-sqs')) as any;
        const client = await this.getClient() as { send: (cmd: unknown) => Promise<void> };
        await client.send(new SendMessageCommand({
            QueueUrl: this.opts.queueUrl,
            MessageBody: JSON.stringify(full),
            ...(options.delay !== undefined ? { DelaySeconds: Math.ceil(options.delay / 1000) } : {}),
            MessageAttributes: {
                TaskType: { DataType: 'String', StringValue: full.type },
            },
            ...(options.backendOptions ?? {}),
        }));
    }

    async consume<TPayload = unknown>(
        type: string,
        handler: BackgroundTaskHandler<TPayload>,
        options: WorkerOptions = {},
    ): Promise<() => Promise<void>> {
        const concurrency = options.concurrency ?? 5;

        // @ts-ignore -- @aws-sdk/client-sqs is an optional peer dep
        const { ReceiveMessageCommand, DeleteMessageCommand } = (await import('@aws-sdk/client-sqs')) as any;
        const client = await this.getClient() as {
            send: (cmd: unknown) => Promise<{ Messages?: Array<{ Body: string; ReceiptHandle: string }> }>;
        };

        let running = true;
        this.stopPolling = () => { running = false; };

        const poll = async (): Promise<void> => {
            while (running) {
                const resp = await client.send(new ReceiveMessageCommand({
                    QueueUrl: this.opts.queueUrl,
                    MaxNumberOfMessages: Math.min(concurrency, this.opts.maxMessages ?? 10),
                    WaitTimeSeconds: this.opts.waitTimeSeconds ?? 20,
                    VisibilityTimeout: this.opts.visibilityTimeout ?? 30,
                    MessageAttributeNames: ['TaskType'],
                })).catch(() => ({ Messages: [] }));

                const messages = resp.Messages ?? [];
                await Promise.all(messages.map(async (msg) => {
                    let task: BackgroundTask<TPayload>;
                    try { task = JSON.parse(msg.Body) as BackgroundTask<TPayload>; }
                    catch {
                        await client.send(new DeleteMessageCommand({ QueueUrl: this.opts.queueUrl, ReceiptHandle: msg.ReceiptHandle }));
                        return;
                    }
                    if (task.type !== type) return; // another consumer handles this
                    try {
                        await handler(task);
                        await client.send(new DeleteMessageCommand({ QueueUrl: this.opts.queueUrl, ReceiptHandle: msg.ReceiptHandle }));
                    } catch (err) {
                        console.error(`[SQSBackgroundQueue] task "${type}" failed:`, err);
                        // message becomes visible again after visibilityTimeout
                    }
                }));
            }
        };

        void poll().catch((err) => console.error('[SQSBackgroundQueue] polling error:', err));

        return async () => { this.stopPolling?.(); };
    }

    async close(): Promise<void> {
        this.stopPolling?.();
    }
}
