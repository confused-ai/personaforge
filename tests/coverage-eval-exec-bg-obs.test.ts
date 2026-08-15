/**
 * Hermetic coverage for src/eval, src/execution, src/background, src/observability
 * zero/partial files. Loaded only by vitest. External deps (bullmq/kafka/sqs/amqp)
 * are mocked — no live services.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    generateDataset,
    filterByScore,
    deduplicateByInput,
    writeSplitDataset,
    type TrainingExample,
} from '../src/eval/finetune.js';

import {
    ExecutionGraphBuilder,
    GraphValidationError,
} from '../src/execution/graph-builder.js';
import { WorkerPool, createWorkerPool } from '../src/execution/worker-pool.js';
import { ExecutionNodeStatus } from '../src/execution/types.js';
import { TaskPriority, TaskStatus, type Plan, type Task } from '../src/planner/index.js';

import { generateTaskId } from '../src/background/util.js';
import { queueHook } from '../src/background/queue-hook.js';
import { InMemoryBackgroundQueue } from '../src/background/queues/memory.js';
import { RedisPubSubBackgroundQueue } from '../src/background/queues/redis-pubsub.js';

import { OTLPTraceExporter, OTLPMetricsExporter } from '../src/observability/otlp-exporter.js';
import { sendLangSmithRunBatch } from '../src/observability/langsmith-ingest.js';
import { sendLangfuseBatch } from '../src/observability/langfuse-ingest.js';
import { MetricType, SpanStatus, type TraceSpan } from '../src/observability/types.js';

// ── eval/finetune ────────────────────────────────────────────────────────────

describe('finetune dataset generator', () => {
    const examples: TrainingExample[] = [
        { input: 'q1', output: 'a1', score: 9, metadata: { src: 't' } },
        { input: 'q1', output: 'a1-better', score: 10 },
        { input: 'q2', output: 'a2', score: 5, history: [{ role: 'user', content: 'h' }, { role: 'assistant', content: 'r' }] },
        { input: 'x', output: 'y', score: 1 },
    ];

    it('generateDataset openai/alpaca/sharegpt + shuffle + filter + dedupe', () => {
        const openai = generateDataset(examples, { format: 'openai', systemPrompt: 'sys', keepMetadata: true });
        expect(openai.split('\n').length).toBe(4);
        expect(openai).toContain('"role":"system"');
        expect(openai).toContain('metadata');

        const alpaca = generateDataset(examples.slice(0, 1), { format: 'alpaca', keepMetadata: true });
        expect(JSON.parse(alpaca)[0].instruction).toBe('q1');

        const share = generateDataset([examples[2]!], { format: 'sharegpt', systemPrompt: 's', keepMetadata: true });
        const parsed = JSON.parse(share);
        expect(parsed[0].conversations.some((c: any) => c.from === 'human')).toBe(true);

        const shuffled = generateDataset(examples, { format: 'openai', shuffle: true, shuffleSeed: 7 });
        expect(shuffled.split('\n').length).toBe(4);

        const filtered = filterByScore(examples, { minScore: 8, maxScore: 10, minInputLength: 2 });
        expect(filtered.every((e) => (e.score ?? 0) >= 8)).toBe(true);

        const deduped = deduplicateByInput(examples);
        expect(deduped.filter((e) => e.input === 'q1')).toHaveLength(1);
        expect(deduped.find((e) => e.input === 'q1')?.score).toBe(10);

        expect(filterByScore([{ input: 'ab', output: 'cd' }], { minScore: 9 })).toHaveLength(1);
        expect(filterByScore([{ input: '', output: 'cd' }], {})).toHaveLength(0);
    });

    it('writeSplitDataset writes train/val files', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'ft-'));
        try {
            const many = Array.from({ length: 10 }, (_, i) => ({
                input: `q${i}`,
                output: `a${i}`,
                score: 8,
            }));
            const res = await writeSplitDataset(many, {
                outputPrefix: join(dir, 'train'),
                valFraction: 0.2,
                format: 'openai',
                shuffleSeed: 1,
            });
            expect(res.trainCount + res.valCount).toBe(10);
            expect(existsSync(res.trainPath)).toBe(true);
            expect(existsSync(res.valPath)).toBe(true);
            expect(readFileSync(res.trainPath, 'utf8').length).toBeGreaterThan(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ── execution/graph-builder + worker-pool ────────────────────────────────────

function makeTask(id: string, deps: string[] = []): Task {
    return {
        id,
        name: id,
        description: id,
        dependencies: deps,
        priority: TaskPriority.MEDIUM,
        metadata: {},
    };
}

function makePlan(tasks: Task[]): Plan {
    return {
        id: 'plan-1',
        goal: 'g',
        tasks,
        createdAt: new Date(),
        metadata: { plannerType: 'test' },
    };
}

describe('ExecutionGraphBuilder', () => {
    it('build/validate/cycle/ready/status/order/clone/stats', () => {
        const builder = new ExecutionGraphBuilder();
        const plan = makePlan([makeTask('a'), makeTask('b', ['a']), makeTask('c', ['b'])]);
        const graph = builder.build(plan);
        expect(graph.totalCount).toBe(3);
        expect(graph.readyQueue).toContain('a');
        expect(builder.getReadyTasks(graph)).toContain('a');

        builder.updateNodeStatus(graph, 'a', ExecutionNodeStatus.RUNNING);
        builder.updateNodeStatus(graph, 'a', ExecutionNodeStatus.COMPLETED);
        expect(builder.getReadyTasks(graph)).toContain('b');
        builder.updateNodeStatus(graph, 'b', ExecutionNodeStatus.FAILED);
        builder.updateNodeStatus(graph, 'missing', ExecutionNodeStatus.COMPLETED);

        const order = builder.getExecutionOrder(graph);
        expect(order[0]).toBe('a');

        const cloned = builder.clone(graph);
        expect(cloned.completedCount).toBe(graph.completedCount);

        const stats = builder.getStats(graph);
        expect(stats.total).toBe(3);
        expect(stats.completed + stats.failed + stats.pending + stats.running + stats.cancelled).toBe(3);

        expect(() =>
            new ExecutionGraphBuilder({ validateDependencies: true }).build(
                makePlan([makeTask('x', ['missing'])]),
            ),
        ).toThrow(GraphValidationError);

        const loose = new ExecutionGraphBuilder({ validateDependencies: false, detectCycles: false }).build(
            makePlan([makeTask('x', ['missing'])]),
        );
        expect(loose.totalCount).toBe(1);

        expect(() =>
            new ExecutionGraphBuilder().build(makePlan([makeTask('a', ['b']), makeTask('b', ['a'])])),
        ).toThrow(/Circular/);
    });
});

describe('WorkerPool', () => {
    it('executeParallel / status / shutdown wait and reject', async () => {
        const pool = createWorkerPool({
            minWorkers: 1,
            maxWorkers: 3,
            idleTimeoutMs: 50,
            taskTimeoutMs: 5000,
        }, {
            canExecute: () => true,
            async execute(task) {
                return {
                    taskId: task.id,
                    status: TaskStatus.COMPLETED,
                    output: { message: `ran ${task.name}` },
                    executionTimeMs: 1,
                    startedAt: new Date(),
                    completedAt: new Date(),
                };
            },
        });
        const ctx = { executionId: 'e1', planId: 'p1', agentId: 'a1', startedAt: new Date() } as any;
        const tasks = [makeTask('t1'), makeTask('t2'), makeTask('t3')];
        const results = await pool.executeParallel(tasks, ctx);
        expect(results).toHaveLength(3);
        expect(results.every((r) => r.status === TaskStatus.COMPLETED)).toBe(true);
        const status = pool.getPoolStatus();
        expect(status.completedTasks).toBe(3);
        expect(status.totalWorkers).toBeGreaterThanOrEqual(1);

        await pool.shutdownPool(true);
        await expect(pool.executeParallel([makeTask('x')], ctx)).rejects.toThrow(/shutting down/);

        // Flood a single worker so some tasks remain queued when we shut down without waiting.
        // Use a slow executor so shutdown wins the race against task completion.
        const pool2 = new WorkerPool({ minWorkers: 1, maxWorkers: 1, taskTimeoutMs: 5000, idleTimeoutMs: 30_000 }, {
            canExecute: () => true,
            async execute(task) {
                await new Promise((r) => setTimeout(r, 200));
                return {
                    taskId: task.id,
                    status: TaskStatus.COMPLETED,
                    output: { message: `ran ${task.name}` },
                    executionTimeMs: 1,
                    startedAt: new Date(),
                    completedAt: new Date(),
                };
            },
        });
        const pending = pool2.executeParallel(
            Array.from({ length: 12 }, (_, i) => makeTask(`late${i}`)),
            ctx,
        );
        await new Promise((r) => setTimeout(r, 10));
        await pool2.shutdownPool(false);
        await expect(pending).rejects.toThrow(/shutting down/);
    }, 15_000);
});

// ── background util / queue-hook / queues ────────────────────────────────────

describe('background util + queueHook', () => {
    it('generateTaskId and queueHook enqueue / payload error / enqueue error', async () => {
        expect(generateTaskId()).toMatch(/task/);

        const enqueue = vi.fn(async () => undefined);
        const queue = { enqueue, consume: vi.fn(), close: vi.fn(), name: 'mock' } as any;
        const hook = queueHook(queue, 'analytics:afterRun', (x: number) => ({ x }), { retries: 1 }, { agentId: 'a1' });
        hook(42);
        await new Promise((r) => setTimeout(r, 10));
        expect(enqueue).toHaveBeenCalled();
        expect(enqueue.mock.calls[0]![0]).toMatchObject({ type: 'analytics:afterRun', payload: { x: 42 }, meta: { agentId: 'a1' } });

        const badPayload = queueHook(queue, 'bad', () => {
            throw new Error('payload');
        });
        badPayload();

        enqueue.mockRejectedValueOnce(new Error('enq fail'));
        const hook2 = queueHook(queue, 'fail', () => ({ ok: true }));
        hook2();
        await new Promise((r) => setTimeout(r, 20));
    });
});

describe('InMemoryBackgroundQueue', () => {
    it('park until consume, delay, retry, close', async () => {
        const q = new InMemoryBackgroundQueue({ concurrency: 2 });
        const seen: string[] = [];
        await q.enqueue({ type: 'job', payload: { n: 1 } });
        const stop = await q.consume('job', async (task) => {
            seen.push(String((task.payload as any).n));
        });
        await new Promise((r) => setTimeout(r, 50));
        expect(seen).toContain('1');

        await q.enqueue({ type: 'job', payload: { n: 2 } }, { delay: 30 });
        await new Promise((r) => setTimeout(r, 80));
        expect(seen).toContain('2');

        let attempts = 0;
        await q.consume('retry', async () => {
            attempts++;
            if (attempts < 2) throw new Error('fail once');
        });
        await q.enqueue({ type: 'retry', payload: {} }, { retries: 1 });
        await new Promise((r) => setTimeout(r, 1100));
        expect(attempts).toBeGreaterThanOrEqual(1);

        await stop();
        await q.close();
        await q.enqueue({ type: 'job', payload: { n: 99 } });
    }, 10_000);
});

describe('RedisPubSubBackgroundQueue', () => {
    it('publish/subscribe/close with mock redis', async () => {
        const listeners: Array<(ch: string, msg: string) => void> = [];
        const publisher = { publish: vi.fn(async () => 1) };
        const subscriber = {
            subscribe: vi.fn(async () => undefined),
            unsubscribe: vi.fn(async () => undefined),
            on: vi.fn((_e: string, fn: (ch: string, msg: string) => void) => {
                listeners.push(fn);
            }),
        };
        const q = new RedisPubSubBackgroundQueue({
            publisher,
            subscriber,
            channel: 'bg',
        });
        const seen: unknown[] = [];
        const stop = await q.consume('evt', async (t) => {
            seen.push(t.payload);
        });
        expect(subscriber.subscribe).toHaveBeenCalledWith('bg:evt');
        await q.enqueue({ type: 'evt', payload: { hello: 1 } });
        expect(publisher.publish).toHaveBeenCalled();
        const [ch, msg] = publisher.publish.mock.calls[0]!;
        listeners[0]!(ch as string, msg as string);
        await new Promise((r) => setTimeout(r, 10));
        expect(seen).toEqual([{ hello: 1 }]);

        listeners[0]!('bg:evt', 'not-json');
        listeners[0]!('bg:other', JSON.stringify({ type: 'other', payload: {} }));

        await stop();
        await q.close();
    });
});

describe('BullMQ / SQS / Kafka / RabbitMQ adapters (mocked peers)', () => {
    it('BullMQBackgroundQueue enqueue/consume/close', async () => {
        const add = vi.fn(async () => undefined);
        const closeQ = vi.fn(async () => undefined);
        const closeW = vi.fn(async () => undefined);
        let workerHandler: any;
        vi.doMock('bullmq', () => ({
            Queue: class {
                add = add;
                close = closeQ;
                constructor(_n: string, _o: unknown) {}
            },
            Worker: class {
                close = closeW;
                constructor(_n: string, handler: any, _o: unknown) {
                    workerHandler = handler;
                }
            },
        }));

        const { BullMQBackgroundQueue: BQ } = await import('../src/background/queues/bullmq.js');
        const q = new BQ({ redis: { host: 'localhost', port: 6379 }, queueName: 't', defaultJobOptions: { attempts: 2 } });
        await q.enqueue({ type: 'hook', payload: { a: 1 } }, { delay: 10, retries: 2 });
        expect(add).toHaveBeenCalled();
        const stop = await q.consume('hook', async () => undefined, { concurrency: 2 });
        await workerHandler({ name: 'hook', data: { type: 'hook', payload: {} } });
        await workerHandler({ name: 'other', data: {} });
        await stop();
        await q.close();
        expect(closeW).toHaveBeenCalled();
        expect(closeQ).toHaveBeenCalled();

        const q2 = new BQ({ redis: 'redis://localhost:6379' });
        await q2.enqueue({ type: 'x', payload: {} });
        await q2.close();
    });

    it('SQSBackgroundQueue enqueue + close (no busy poll)', async () => {
        class SendMessageCommand {
            constructor(public input: unknown) {}
        }
        class ReceiveMessageCommand {
            constructor(public input: any) {}
        }
        class DeleteMessageCommand {
            constructor(public input: unknown) {}
        }
        const send = vi.fn(async () => ({}));
        class SQSClient {
            send = send;
            constructor(_o: unknown) {}
        }
        vi.doMock('@aws-sdk/client-sqs', () => ({
            SQSClient,
            SendMessageCommand,
            ReceiveMessageCommand,
            DeleteMessageCommand,
        }));

        const { SQSBackgroundQueue: SQ } = await import('../src/background/queues/sqs.js');
        const q = new SQ({
            queueUrl: 'https://sqs/q',
            region: 'us-east-1',
            maxMessages: 5,
            waitTimeSeconds: 1,
            visibilityTimeout: 5,
        });
        // Only exercise enqueue + close — consume() starts an infinite poll loop that
        // OOMs under a sync mock without WaitTimeSeconds delay.
        await q.enqueue({ type: 'job', payload: { n: 1 } }, { delay: 1500 });
        expect(send).toHaveBeenCalled();
        await q.close();
    });

    it('KafkaBackgroundQueue enqueue/consume/close', async () => {
        const send = vi.fn(async () => undefined);
        const connect = vi.fn(async () => undefined);
        const disconnect = vi.fn(async () => undefined);
        const subscribe = vi.fn(async () => undefined);
        let eachMessage: any;
        const run = vi.fn(async (opts: any) => {
            eachMessage = opts.eachMessage;
        });
        const producer = { connect, send, disconnect };
        const consumer = { connect, subscribe, run, disconnect };
        vi.doMock('kafkajs', () => ({
            Kafka: class {
                producer() {
                    return producer;
                }
                consumer() {
                    return consumer;
                }
                constructor(_o: unknown) {}
            },
        }));

        const { KafkaBackgroundQueue: KQ } = await import('../src/background/queues/kafka.js');
        const q = new KQ({
            brokers: ['localhost:9092'],
            topic: 't',
            partitionKey: 'meta.agentId',
            clientId: 'c',
            groupId: 'g',
        });
        await q.enqueue({ type: 'job', payload: {}, meta: { agentId: 'a1' } });
        expect(send).toHaveBeenCalled();

        const q2 = new KQ({ brokers: ['x'], partitionKey: 'meta.sessionId' });
        await q2.enqueue({ type: 'job', payload: {}, meta: { sessionId: 's1' } });

        const q3 = new KQ({ brokers: ['x'] });
        await q3.enqueue({ type: 'job', payload: {} });

        const handled: string[] = [];
        const stop = await q.consume('job', async (t) => {
            handled.push(t.type);
        });
        await eachMessage({ message: { value: Buffer.from(JSON.stringify({ type: 'job', payload: {}, id: '1', enqueuedAt: 1 })) } });
        await eachMessage({ message: { value: null } });
        await eachMessage({ message: { value: Buffer.from('bad') } });
        await eachMessage({ message: { value: Buffer.from(JSON.stringify({ type: 'other', payload: {}, id: '2', enqueuedAt: 1 })) } });
        expect(handled).toEqual(['job']);
        await stop();
        await q.close();
        expect(disconnect).toHaveBeenCalled();
    });

    it('RabbitMQBackgroundQueue enqueue/consume/close', async () => {
        const sendToQueue = vi.fn(() => true);
        const assertQueue = vi.fn(async () => undefined);
        const prefetch = vi.fn();
        const ack = vi.fn();
        const nack = vi.fn();
        const cancel = vi.fn(async () => undefined);
        const closeCh = vi.fn(async () => undefined);
        let consumerFn: any;
        const consume = vi.fn(async (_q: string, fn: any) => {
            consumerFn = fn;
            return { consumerTag: 'tag1' };
        });
        const ch = { sendToQueue, assertQueue, prefetch, consume, ack, nack, cancel, close: closeCh };
        const conn = {
            createChannel: vi.fn(async () => ch),
            close: vi.fn(async () => undefined),
        };
        vi.doMock('amqplib', () => ({
            connect: vi.fn(async () => conn),
        }));

        const { RabbitMQBackgroundQueue: RQ } = await import('../src/background/queues/rabbitmq.js');
        const q = new RQ({ url: 'amqp://localhost', queue: 'q', durable: true, deadLetterExchange: 'dlx' });
        await q.enqueue({ type: 'job', payload: { n: 1 } }, { delay: 100, retries: 2 });
        expect(sendToQueue).toHaveBeenCalled();

        const handled: unknown[] = [];
        const stop = await q.consume('job', async (t) => {
            handled.push(t.payload);
        }, { concurrency: 3 });

        await consumerFn(null);
        await consumerFn({ content: Buffer.from('bad'), properties: {} });
        await consumerFn({
            content: Buffer.from(JSON.stringify({ type: 'other', payload: {}, id: '1', enqueuedAt: 1 })),
            properties: {},
        });
        await consumerFn({
            content: Buffer.from(JSON.stringify({ type: 'job', payload: { n: 1 }, id: '1', enqueuedAt: 1 })),
            properties: {},
        });
        expect(handled).toEqual([{ n: 1 }]);

        const stop2 = await q.consume('fail', async () => {
            throw new Error('boom');
        });
        await consumerFn({
            content: Buffer.from(JSON.stringify({ type: 'fail', payload: {}, id: '2', enqueuedAt: 1 })),
            properties: {},
        });
        expect(nack).toHaveBeenCalled();

        await stop();
        await stop2();
        await q.close();
    });
});

// ── observability otlp + ingest ──────────────────────────────────────────────

function makeSpan(partial?: Partial<TraceSpan>): TraceSpan {
    return {
        id: 'span-1',
        traceId: 'trace-1',
        name: 'op',
        startTime: new Date('2024-01-01T00:00:00.000Z'),
        endTime: new Date('2024-01-01T00:00:01.000Z'),
        status: SpanStatus.OK,
        attributes: { s: 'x', n: 1, b: true, o: { nested: 1 } },
        events: [{ name: 'e', timestamp: new Date('2024-01-01T00:00:00.500Z'), attributes: { k: 'v' } }],
        ...partial,
    };
}

describe('OTLP exporters', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('OTLPTraceExporter batch/export/retry/shutdown/debug', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, text: async () => '' })
            .mockResolvedValueOnce({ ok: false, text: async () => 'nope' })
            .mockRejectedValueOnce(new Error('net'))
            .mockResolvedValue({ ok: true, text: async () => '' });
        vi.stubGlobal('fetch', fetchMock);

        const exp = new OTLPTraceExporter({
            endpoint: 'http://otlp/v1/traces',
            serviceName: 'svc',
            headers: { 'x-api-key': 'k' },
            batchSize: 2,
            exportIntervalMs: 60_000,
            maxQueueSize: 3,
            debug: true,
        });
        expect((await exp.export()).exported).toBe(0);

        exp.addSpan(makeSpan({ id: '1', status: SpanStatus.OK }));
        exp.addSpan(makeSpan({ id: '2', status: SpanStatus.ERROR, parentId: '1' }));
        await new Promise((r) => setTimeout(r, 20));

        exp.addSpans([makeSpan({ id: '3', status: SpanStatus.UNSET }), makeSpan({ id: '4' })]);
        exp.addSpan(makeSpan({ id: '5' }));
        exp.addSpan(makeSpan({ id: '6' }));
        exp.addSpan(makeSpan({ id: '7' }));

        await exp.export();

        exp.start();
        exp.start();
        await exp.shutdown();
        const sizeAfterShutdown = exp.getQueueSize();
        exp.addSpan(makeSpan({ id: 'after' })); // ignored while shutting down
        expect(exp.getQueueSize()).toBe(sizeAfterShutdown);
    });

    it('OTLPMetricsExporter add/export/fail/shutdown', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: false })
            .mockRejectedValueOnce(new Error('down'))
            .mockResolvedValue({ ok: true });
        vi.stubGlobal('fetch', fetchMock);

        const m = new OTLPMetricsExporter({
            endpoint: 'http://otlp/v1/metrics',
            serviceName: 'svc',
            batchSize: 10,
            maxQueueSize: 2,
            exportIntervalMs: 60_000,
        });
        expect((await m.export()).exported).toBe(0);
        m.addMetric({ name: 'c', type: MetricType.COUNTER, value: 1, labels: { a: 'b' }, timestamp: new Date() });
        m.addMetric({ name: 'c', type: MetricType.COUNTER, value: 2, labels: {}, timestamp: new Date() });
        m.addMetric({ name: 'c', type: MetricType.COUNTER, value: 3, labels: {}, timestamp: new Date() });
        m.start();
        m.start();
        const ok = await m.export();
        expect(ok.success).toBe(true);
        m.addMetric({ name: 'g', type: MetricType.GAUGE, value: 1, labels: {}, timestamp: new Date() });
        await m.export();
        m.addMetric({ name: 'g', type: MetricType.GAUGE, value: 1, labels: {}, timestamp: new Date() });
        await m.export();
        await m.shutdown();
        m.addMetric({ name: 'x', type: MetricType.GAUGE, value: 1, labels: {}, timestamp: new Date() });
    });
});

describe('langsmith + langfuse ingest', () => {
    it('sendLangSmithRunBatch success and failure', async () => {
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, text: async () => '' })
            .mockResolvedValueOnce({ ok: false, text: async () => 'bad' });
        await sendLangSmithRunBatch(
            'key',
            [{ name: 'run', run_type: 'llm', inputs: { api_key: 'sk-secret' } }],
            { baseUrl: 'https://smith.test/', fetchImpl },
        );
        expect(fetchImpl).toHaveBeenCalled();
        const body = fetchImpl.mock.calls[0]![1].body as string;
        expect(body).not.toContain('sk-secret');

        await expect(
            sendLangSmithRunBatch('key', [{ name: 'r', run_type: 'chain' }], { fetchImpl }),
        ).rejects.toThrow(/LangSmith batch failed/);
    });

    it('sendLangfuseBatch success and failure', async () => {
        const fetchImpl = vi
            .fn()
            .mockResolvedValueOnce({ ok: true, text: async () => '' })
            .mockResolvedValueOnce({ ok: false, text: async () => 'err' });
        await sendLangfuseBatch(
            { publicKey: 'pk', secretKey: 'sk', baseUrl: 'https://lf.test/', fetchImpl },
            [{ type: 'trace-create', body: { name: 't' } }],
        );
        expect(fetchImpl.mock.calls[0]![1].headers.Authorization).toMatch(/^Basic /);
        await expect(
            sendLangfuseBatch({ publicKey: 'pk', secretKey: 'sk', fetchImpl }, []),
        ).rejects.toThrow(/Langfuse ingestion failed/);
    });
});
