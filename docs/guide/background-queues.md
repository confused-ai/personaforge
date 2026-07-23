---
title: Background Queues
description: Dispatch agent hooks and async work to BullMQ, Kafka, RabbitMQ, Redis Pub/Sub, SQS, or in-memory queues with the BackgroundQueue interface and queueHook helper.
outline: [2, 3]
---

# Background Queues

Background queues let agent hooks and long-running work execute outside the main request path — with retries, persistence, and worker-based consumption. The interface is uniform across all backends.

```ts
import {
  InMemoryBackgroundQueue,
  BullMQBackgroundQueue,
  KafkaBackgroundQueue,
  RabbitMQBackgroundQueue,
  RedisPubSubBackgroundQueue,
  SQSBackgroundQueue,
  queueHook,
} from 'personaforge/background';
```

---

## Quick start

```ts
import { createAgent } from 'personaforge';
import { InMemoryBackgroundQueue, queueHook } from 'personaforge/background';

// In-memory queue — no dependencies, good for dev/test
const queue = new InMemoryBackgroundQueue({ concurrency: 5 });

const agent = createAgent({
  name: 'analytics-agent',
  instructions: 'Help users with their questions.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
  hooks: {
    // Dispatch post-run analytics to the queue without blocking the response
    afterRun: queueHook(queue, 'analytics', (result) => ({
      steps:  result.steps,
      tokens: result.usage?.totalTokens,
      runId:  result.runId,
    })),
  },
});

// Register the worker handler (same or separate process)
await queue.consume('analytics', async (task) => {
  await analyticsService.track('agent.run', task.payload);
});

const result = await agent.run('Help me track my order.');
// The afterRun hook fires the task to the queue and returns immediately
```

---

## Queue backends

### `InMemoryBackgroundQueue` (development / testing)

```ts
import { InMemoryBackgroundQueue } from 'personaforge/background';

const queue = new InMemoryBackgroundQueue({ concurrency: 3 });
```

### `BullMQBackgroundQueue` — Redis-backed, durable

```bash
bun add bullmq
```

```ts
import { BullMQBackgroundQueue } from 'personaforge/background';

const queue = new BullMQBackgroundQueue({
  queueName: 'agent-hooks',
  connection: { host: 'localhost', port: 6379 },
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

// Worker (same or separate process)
await queue.consume('afterRun', async (task) => {
  await saveToDb(task.payload);
}, { concurrency: 5 });
```

### `KafkaBackgroundQueue` — high-throughput, ordered, replay

```bash
bun add kafkajs
```

```ts
import { KafkaBackgroundQueue } from 'personaforge/background';

const queue = new KafkaBackgroundQueue({
  brokers: ['kafka:9092'],
  topic: 'agent-hooks',
  clientId: 'my-agent-app',
  groupId: 'agent-workers',
});
```

### `RabbitMQBackgroundQueue` — AMQP, dead-letter exchanges

```bash
bun add amqplib
```

```ts
import { RabbitMQBackgroundQueue } from 'personaforge/background';

const queue = new RabbitMQBackgroundQueue({
  url: process.env.RABBITMQ_URL!,
  queue: 'agent-hooks',
  exchange: 'agent',
  routingKey: 'hook',
});
```

### `RedisPubSubBackgroundQueue` — lightweight fanout

```ts
import { RedisPubSubBackgroundQueue } from 'personaforge/background';

const queue = new RedisPubSubBackgroundQueue({
  redis: process.env.REDIS_URL!,
  channel: 'agent-hooks',
});
```

### `SQSBackgroundQueue` — AWS managed, serverless

```bash
bun add @aws-sdk/client-sqs
```

```ts
import { SQSBackgroundQueue } from 'personaforge/background';

const queue = new SQSBackgroundQueue({
  queueUrl: process.env.SQS_QUEUE_URL!,
  region: 'us-east-1',
});
```

---

## `BackgroundQueue` interface

Implement this to add any backend:

```ts
interface BackgroundQueue {
  readonly name: string;

  enqueue<T>(task: Omit<BackgroundTask<T>, 'id' | 'enqueuedAt'>, options?: EnqueueOptions): Promise<void>;

  consume<T>(
    type: string,
    handler: (task: BackgroundTask<T>) => Promise<void> | void,
    options?: WorkerOptions,
  ): Promise<() => Promise<void>>;

  close(): Promise<void>;
}
```

---

## `queueHook` — hook → queue dispatch

`queueHook` turns any agent lifecycle hook into a fire-and-forget queue dispatch:

```ts
import { queueHook } from 'personaforge/background';

const hooks = {
  afterRun:     queueHook(queue, 'run-complete',   (result) => ({ text: result.text, tokens: result.usage?.totalTokens })),
  afterToolCall: queueHook(queue, 'tool-call-log', (name, result, args) => ({ name, args, result })),
};
```

---

## Enqueue manually

```ts
// Fire a background task directly (without a hook)
await queue.enqueue({
  type: 'send-report',
  payload: {
    userId: 'user-42',
    reportType: 'weekly',
  },
}, {
  delay: 5_000,     // delay 5 seconds (BullMQ, Kafka support this)
  retries: 3,
});
```

---

## Where to go next

- [Scheduler](./scheduler) — time-based recurring execution.
- [Hooks](./hooks) — lifecycle hooks where queue dispatch originates.
- [Production](./production) — circuit breakers and graceful shutdown.
