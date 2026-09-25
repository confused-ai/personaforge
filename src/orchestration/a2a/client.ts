/**
 * Full A2A Client — Google Agent-to-Agent Protocol
 *
 * Implements the complete A2A client spec:
 *   POST /  →  tasks/send, tasks/get, tasks/cancel, tasks/resubscribe
 *             tasks/pushNotificationConfig/set|get
 *   GET /.well-known/agent.json  →  agent discovery
 *   tasks/sendSubscribe  →  SSE streaming
 *
 * Reference: https://google.github.io/A2A/specification/
 */

import type {
    A2ATask,
    A2ATaskSendParams,
    A2ATaskGetParams,
    A2ATaskCancelParams,
    A2ATaskPushNotificationSetParams,
    A2ATaskPushNotificationGetParams,
    A2APushNotificationConfig,
    A2AAgentCard,
    A2AStreamEvent,
    A2ATaskStatusUpdateEvent,
    A2ATaskArtifactUpdateEvent,
} from './types.js';

export type { A2AStreamEvent };

// ── JSON-RPC helpers ───────────────────────────────────────────────────────

/** Max buffered undecoded SSE bytes — a peer that never sends `\n` can't OOM us. */
const MAX_SSE_BUFFER_BYTES = 1_048_576;

async function* parseSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            if (buf.length > MAX_SSE_BUFFER_BYTES) {
                throw new Error('A2A SSE stream exceeded 1 MB without a newline; aborting.');
            }
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
                if (line.startsWith('data: ')) yield line.slice(6).trim();
            }
        }
    } finally {
        reader.releaseLock();
    }
}

export interface A2AClientConfig {
    /** Base URL of the remote agent (e.g. https://agent.example.com) */
    url: string;
    /** Extra HTTP headers (e.g. Authorization) */
    headers?: Record<string, string>;
    /** Default request timeout in ms */
    timeoutMs?: number;
}

export class A2AClient {
    private readonly baseUrl: string;
    private readonly headers: Record<string, string>;
    private readonly timeoutMs: number;
    private idCounter = 0;

    constructor(config: A2AClientConfig) {
        this.baseUrl = config.url.replace(/\/$/, '');
        this.headers = { 'content-type': 'application/json', ...config.headers };
        this.timeoutMs = config.timeoutMs ?? 60_000;
    }

    private nextId(): number {
        return ++this.idCounter;
    }

    private async rpc<T>(method: string, params: unknown): Promise<T> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const res = await fetch(this.baseUrl, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId(), method, params }),
                signal: controller.signal,
            });
            if (!res.ok) throw new Error(`A2A HTTP ${res.status}: ${await res.text()}`);
            const body = await res.json() as {
                result?: T;
                error?: { code: number; message: string; data?: unknown };
            };
            if (body.error) throw new Error(`A2A error ${body.error.code}: ${body.error.message}`);
            return body.result as T;
        } finally {
            clearTimeout(timer);
        }
    }

    // ── Discovery ──────────────────────────────────────────────────────────

    /** Fetch the agent's discovery card from /.well-known/agent.json */
    async getAgentCard(): Promise<A2AAgentCard> {
        const res = await fetch(`${this.baseUrl}/.well-known/agent.json`, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) throw new Error(`A2A agent card HTTP ${res.status}`);
        return res.json() as Promise<A2AAgentCard>;
    }

    // ── Task operations ────────────────────────────────────────────────────

    /**
     * Send a task (synchronous).
     * Returns the final Task once the agent completes or enters input-required state.
     */
    async sendTask(params: A2ATaskSendParams): Promise<A2ATask> {
        return this.rpc<A2ATask>('tasks/send', params);
    }

    /** Get a task by ID */
    async getTask(params: A2ATaskGetParams): Promise<A2ATask> {
        return this.rpc<A2ATask>('tasks/get', params);
    }

    /** Cancel a task */
    async cancelTask(params: A2ATaskCancelParams): Promise<A2ATask> {
        return this.rpc<A2ATask>('tasks/cancel', params);
    }

    // ── Streaming ─────────────────────────────────────────────────────────

    /**
     * Send a task and stream status/artifact updates via SSE.
     * Yields `A2AStreamEvent` objects until the agent signals `final: true`.
     *
     * @example
     * ```ts
     * for await (const event of client.sendTaskStream({ id: taskId, message })) {
     *   if (event.type === 'TaskStatusUpdateEvent') {
     *     console.log(event.data.status.state);
     *   }
     * }
     * ```
     */
    async *sendTaskStream(params: A2ATaskSendParams): AsyncGenerator<A2AStreamEvent> {
        const controller = new AbortController();
        const res = await fetch(this.baseUrl, {
            method: 'POST',
            headers: { ...this.headers, accept: 'text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId(), method: 'tasks/sendSubscribe', params }),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`A2A stream HTTP ${res.status}: ${await res.text()}`);
        if (!res.body) throw new Error('A2A stream: no response body');

        for await (const data of parseSse(res.body)) {
            if (!data) continue;
            let msg: { method?: string; params?: unknown };
            try { msg = JSON.parse(data); } catch { continue; }

            if (msg.method === 'tasks/statusUpdate') {
                const event = msg.params as A2ATaskStatusUpdateEvent;
                yield { type: 'TaskStatusUpdateEvent', data: event };
                if (event.final) { controller.abort(); return; }
            } else if (msg.method === 'tasks/artifactUpdate') {
                yield { type: 'TaskArtifactUpdateEvent', data: msg.params as A2ATaskArtifactUpdateEvent };
            }
        }
    }

    /**
     * Resubscribe to a task's SSE stream (e.g. after reconnection).
     */
    async *resubscribeTask(params: { id: string; historyLength?: number }): AsyncGenerator<A2AStreamEvent> {
        const controller = new AbortController();
        const res = await fetch(this.baseUrl, {
            method: 'POST',
            headers: { ...this.headers, accept: 'text/event-stream' },
            body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId(), method: 'tasks/resubscribe', params }),
            signal: controller.signal,
        });
        if (!res.ok) throw new Error(`A2A resubscribe HTTP ${res.status}: ${await res.text()}`);
        if (!res.body) throw new Error('A2A resubscribe: no response body');

        for await (const data of parseSse(res.body)) {
            if (!data) continue;
            let msg: { method?: string; params?: unknown };
            try { msg = JSON.parse(data); } catch { continue; }

            if (msg.method === 'tasks/statusUpdate') {
                const event = msg.params as A2ATaskStatusUpdateEvent;
                yield { type: 'TaskStatusUpdateEvent', data: event };
                if (event.final) { controller.abort(); return; }
            } else if (msg.method === 'tasks/artifactUpdate') {
                yield { type: 'TaskArtifactUpdateEvent', data: msg.params as A2ATaskArtifactUpdateEvent };
            }
        }
    }

    // ── Push notifications ─────────────────────────────────────────────────

    async setPushNotification(params: A2ATaskPushNotificationSetParams): Promise<A2APushNotificationConfig> {
        return this.rpc<A2APushNotificationConfig>('tasks/pushNotificationConfig/set', params);
    }

    async getPushNotification(params: A2ATaskPushNotificationGetParams): Promise<A2APushNotificationConfig> {
        return this.rpc<A2APushNotificationConfig>('tasks/pushNotificationConfig/get', params);
    }
}

export function createA2AClient(config: A2AClientConfig): A2AClient {
    return new A2AClient(config);
}
