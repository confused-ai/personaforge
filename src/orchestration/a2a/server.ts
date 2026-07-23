/**
 * A2A HTTP Server — expose a framework agent as a Google A2A-compliant endpoint.
 *
 * Implements:
 *   GET  /.well-known/agent.json  — agent card (discovery)
 *   POST /                        — JSON-RPC 2.0 for tasks/send, tasks/get,
 *                                   tasks/cancel, tasks/sendSubscribe (SSE),
 *                                   tasks/resubscribe (SSE),
 *                                   tasks/pushNotificationConfig/set|get
 *
 * Usage:
 * ```ts
 * import { A2AServer, createA2AServer } from 'personaforge/orchestration';
 *
 * const server = createA2AServer({
 *   agentCard: {
 *     name: 'Research Agent',
 *     url: 'https://agent.example.com',
 *     version: '1.0.0',
 *     capabilities: { streaming: true, pushNotifications: true },
 *     skills: [{ id: 'research', name: 'Web Research' }],
 *   },
 *   handler: async (message, { taskId, emit }) => {
 *     // ... process message, optionally emit streaming updates
 *     return agentMessage('Done!');
 *   },
 *   port: 3200,
 * });
 *
 * await server.start();
 * ```
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type {
    A2ATask,
    A2AMessage,
    A2ATaskStatus,
    A2AAgentCard,
    A2APushNotificationConfig,
    A2ATaskSendParams,
    A2ATaskGetParams,
    A2ATaskCancelParams,
    A2ATaskPushNotificationSetParams,
    A2ATaskPushNotificationGetParams,
} from './types.js';
import type { McpAuthConfig } from '../../tools/index.js';
import { newId } from '../../contracts/index.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface A2ATaskContext {
    taskId: string;
    sessionId?: string;
    history: A2AMessage[];
    /** Emit a streaming update (only available in sendSubscribe mode) */
    emit: (status: A2ATaskStatus, final?: boolean) => void;
    /** Emit a streaming artifact chunk */
    emitArtifact: (parts: A2AMessage['parts'], opts?: { name?: string; append?: boolean; index?: number }) => void;
}

export type A2ATaskHandler = (
    message: A2AMessage,
    ctx: A2ATaskContext,
) => Promise<A2AMessage> | A2AMessage;

export interface A2AServerOptions {
    agentCard: A2AAgentCard;
    handler: A2ATaskHandler;
    port?: number;
    host?: string;
    /** CORS origin — '*' for open, array for allow-list, false to disable */
    cors?: '*' | string[] | false;
    /** Optional bearer / api-key auth */
    auth?: McpAuthConfig;
    /** Max request body bytes (default: 1 MB) */
    maxBodyBytes?: number;
    logger?: {
        info?(msg: string, ctx?: unknown): void;
        error?(msg: string, ctx?: unknown): void;
    };
}

// ── In-memory task store ───────────────────────────────────────────────────

interface StoredTask {
    task: A2ATask;
    pushConfig?: A2APushNotificationConfig;
    /** SSE response, if a streaming request is live */
    sseRes?: ServerResponse;
    artifactIndex: number;
}

// ── JSON-RPC helpers ───────────────────────────────────────────────────────

function ok(id: unknown, result: unknown): string {
    return JSON.stringify({ jsonrpc: '2.0', id, result });
}
function err(id: unknown, code: number, message: string, data?: unknown): string {
    const e: Record<string, unknown> = { code, message };
    if (data !== undefined) e['data'] = data;
    return JSON.stringify({ jsonrpc: '2.0', id, error: e });
}

function genId(): string {
    return newId('a2a');
}

function timingSafe(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

function corsHeader(cors: A2AServerOptions['cors'], req: IncomingMessage): string | undefined {
    if (!cors) return undefined;
    if (cors === '*') return '*';
    const origin = req.headers['origin'] ?? '';
    return cors.includes(origin) ? origin : undefined;
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string | null> {
    return new Promise(resolve => {
        const chunks: Buffer[] = [];
        let total = 0;
        req.on('data', (c: Buffer) => {
            total += c.length;
            if (total > maxBytes) { req.destroy(); resolve(null); }
            else chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString()));
        req.on('error', () => resolve(null));
    });
}

// ── A2AServer ─────────────────────────────────────────────────────────────

export class A2AServer {
    private readonly opts: Required<Pick<A2AServerOptions, 'port' | 'host' | 'maxBodyBytes'>> & A2AServerOptions;
    private readonly tasks = new Map<string, StoredTask>();
    private httpServer?: Server;

    constructor(opts: A2AServerOptions) {
        this.opts = {
            port: 3200,
            host: '127.0.0.1',
            maxBodyBytes: 1_048_576,
            cors: '*',
            ...opts,
        };
    }

    async start(): Promise<void> {
        if (this.httpServer) return;
        return new Promise((resolve, reject) => {
            const srv = createServer((req, res) => {
                void this.handle(req, res).catch(e => {
                    this.opts.logger?.error?.('A2AServer error', e);
                    if (!res.headersSent) res.writeHead(500).end();
                });
            });
            srv.on('error', reject);
            srv.listen(this.opts.port, this.opts.host, () => {
                this.opts.logger?.info?.(`A2AServer listening on http://${this.opts.host}:${this.opts.port}`);
                this.httpServer = srv;
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.httpServer) { resolve(); return; }
            this.httpServer.close(e => e ? reject(e) : resolve());
            this.httpServer = undefined;
        });
    }

    private auth(req: IncomingMessage): boolean {
        const a = this.opts.auth;
        if (!a || a.type === 'none') return true;
        if (a.type === 'bearer') {
            const h = String(req.headers['authorization'] ?? '');
            return timingSafe(h.startsWith('Bearer ') ? h.slice(7) : '', a.token);
        }
        if (a.type === 'api-key') {
            const key = (a.header ?? 'x-api-key').toLowerCase();
            return timingSafe(String(req.headers[key] ?? ''), a.key);
        }
        return false;
    }

    private send(res: ServerResponse, status: number, body: string, cors?: string, contentType = 'application/json'): void {
        res.writeHead(status, {
            'content-type': contentType,
            'content-length': Buffer.byteLength(body),
            ...(cors ? { 'access-control-allow-origin': cors } : {}),
        });
        res.end(body);
    }

    private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const cors = corsHeader(this.opts.cors, req);

        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                ...(cors ? { 'access-control-allow-origin': cors } : {}),
                'access-control-allow-methods': 'GET, POST, OPTIONS',
                'access-control-allow-headers': 'content-type, authorization, x-api-key',
            });
            res.end();
            return;
        }

        // ── Agent card discovery ─────────────────────────────────────────
        if (req.method === 'GET' && req.url === '/.well-known/agent.json') {
            this.send(res, 200, JSON.stringify(this.opts.agentCard), cors);
            return;
        }

        // ── JSON-RPC endpoint ────────────────────────────────────────────
        if (req.method !== 'POST') {
            res.writeHead(405).end();
            return;
        }

        if (!this.auth(req)) {
            this.send(res, 401, err(null, -32600, 'Unauthorized'), cors);
            return;
        }

        const raw = await readBody(req, this.opts.maxBodyBytes ?? 1_048_576);
        if (raw === null) { res.writeHead(413).end(); return; }

        let msg: { jsonrpc?: string; id?: unknown; method?: string; params?: unknown };
        try { msg = JSON.parse(raw); } catch {
            this.send(res, 400, err(null, -32700, 'Parse error'), cors);
            return;
        }

        if (msg.jsonrpc !== '2.0') {
            this.send(res, 400, err(msg.id ?? null, -32600, 'Invalid Request'), cors);
            return;
        }

        const id = msg.id ?? null;
        const method = msg.method ?? '';
        const params = (msg.params ?? {}) as Record<string, unknown>;

        try {
            const result = await this.dispatch(method, params, id, req, res, cors);
            if (result !== null) {
                this.send(res, 200, ok(id, result), cors);
            }
            // null means we took over the response (SSE)
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            const code = (e as { code?: number }).code ?? -32603;
            if (!res.headersSent) {
                this.send(res, 200, err(id, code, message), cors);
            }
        }
    }

    private async dispatch(
        method: string,
        params: Record<string, unknown>,
        id: unknown,
        _req: IncomingMessage,
        res: ServerResponse,
        cors: string | undefined,
    ): Promise<unknown> {
        switch (method) {
            case 'tasks/send':         return this.handleSend(params as unknown as A2ATaskSendParams, false);
            case 'tasks/sendSubscribe': return this.handleSendSubscribe(params as unknown as A2ATaskSendParams, id, res, cors);
            case 'tasks/get':          return this.handleGet(params as unknown as A2ATaskGetParams);
            case 'tasks/cancel':       return this.handleCancel(params as unknown as A2ATaskCancelParams);
            case 'tasks/resubscribe':  return this.handleResubscribe(params as { id: string }, id, res, cors);
            case 'tasks/pushNotificationConfig/set': return this.handleSetPush(params as unknown as A2ATaskPushNotificationSetParams);
            case 'tasks/pushNotificationConfig/get': return this.handleGetPush(params as unknown as A2ATaskPushNotificationGetParams);
            default: throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
        }
    }

    // ── tasks/send (sync) ──────────────────────────────────────────────────

    private async handleSend(params: A2ATaskSendParams, _streaming: boolean): Promise<A2ATask> {
        const taskId = params.id ?? genId();
        const stored = this.getOrCreateTask(taskId, params);
        stored.task.status = { state: 'working', timestamp: new Date().toISOString() };

        try {
            const ctx = this.buildContext(stored, null);
            const reply = await this.opts.handler(params.message, ctx);
            stored.task.history = [...(stored.task.history ?? []), params.message, reply];
            stored.task.status = { state: 'completed', message: reply, timestamp: new Date().toISOString() };
        } catch (e) {
            stored.task.status = {
                state: 'failed',
                message: { role: 'agent', parts: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] },
                timestamp: new Date().toISOString(),
            };
        }
        return stored.task;
    }

    // ── tasks/sendSubscribe (SSE streaming) ─────────────────────────────────

    private async handleSendSubscribe(
        params: A2ATaskSendParams,
        _id: unknown,
        res: ServerResponse,
        cors: string | undefined,
    ): Promise<null> {
        const taskId = params.id ?? genId();
        const stored = this.getOrCreateTask(taskId, params);
        stored.sseRes = res;

        res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
            ...(cors ? { 'access-control-allow-origin': cors } : {}),
        });

        const sendEvent = (eventMethod: string, eventParams: unknown) => {
            const line = JSON.stringify({ jsonrpc: '2.0', method: eventMethod, params: eventParams });
            res.write(`data: ${line}\n\n`);
        };

        // Emit working status
        sendEvent('tasks/statusUpdate', { id: taskId, status: { state: 'working', timestamp: new Date().toISOString() }, final: false });
        stored.task.status = { state: 'working', timestamp: new Date().toISOString() };

        const ctx = this.buildContext(stored, (status, final = false) => {
            sendEvent('tasks/statusUpdate', { id: taskId, status, final });
        });

        try {
            const reply = await this.opts.handler(params.message, ctx);
            stored.task.history = [...(stored.task.history ?? []), params.message, reply];
            stored.task.status = { state: 'completed', message: reply, timestamp: new Date().toISOString() };
            sendEvent('tasks/statusUpdate', { id: taskId, status: stored.task.status, final: true });
        } catch (e) {
            stored.task.status = {
                state: 'failed',
                message: { role: 'agent', parts: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }] },
                timestamp: new Date().toISOString(),
            };
            sendEvent('tasks/statusUpdate', { id: taskId, status: stored.task.status, final: true });
        } finally {
            stored.sseRes = undefined;
            res.end();
        }
        return null; // response already handled
    }

    // ── tasks/get ─────────────────────────────────────────────────────────

    private handleGet(params: A2ATaskGetParams): A2ATask {
        const stored = this.tasks.get(params.id);
        if (!stored) throw Object.assign(new Error(`Task not found: ${params.id}`), { code: -32001 });
        const task = { ...stored.task };
        if (params.historyLength !== undefined && task.history) {
            task.history = task.history.slice(-params.historyLength);
        }
        return task;
    }

    // ── tasks/cancel ──────────────────────────────────────────────────────

    private handleCancel(params: A2ATaskCancelParams): A2ATask {
        const stored = this.tasks.get(params.id);
        if (!stored) throw Object.assign(new Error(`Task not found: ${params.id}`), { code: -32001 });
        const state = stored.task.status.state;
        if (state === 'completed' || state === 'failed' || state === 'canceled') {
            throw Object.assign(new Error('Task is not cancelable'), { code: -32002 });
        }
        stored.task.status = { state: 'canceled', timestamp: new Date().toISOString() };
        if (stored.sseRes && !stored.sseRes.headersSent) {
            const line = JSON.stringify({ jsonrpc: '2.0', method: 'tasks/statusUpdate', params: { id: params.id, status: stored.task.status, final: true } });
            stored.sseRes.write(`data: ${line}\n\n`);
            stored.sseRes.end();
        }
        return stored.task;
    }

    // ── tasks/resubscribe ─────────────────────────────────────────────────

    private handleResubscribe(
        params: { id: string },
        _id: unknown,
        res: ServerResponse,
        cors: string | undefined,
    ): null {
        const stored = this.tasks.get(params.id);
        if (!stored) throw Object.assign(new Error(`Task not found: ${params.id}`), { code: -32001 });

        res.writeHead(200, {
            'content-type': 'text/event-stream',
            'cache-control': 'no-cache',
            connection: 'keep-alive',
            ...(cors ? { 'access-control-allow-origin': cors } : {}),
        });

        // Send current status immediately
        const line = JSON.stringify({
            jsonrpc: '2.0',
            method: 'tasks/statusUpdate',
            params: {
                id: params.id,
                status: stored.task.status,
                final: ['completed', 'failed', 'canceled'].includes(stored.task.status.state),
            },
        });
        res.write(`data: ${line}\n\n`);
        res.end();
        return null;
    }

    // ── Push notification config ───────────────────────────────────────────

    private handleSetPush(params: A2ATaskPushNotificationSetParams): A2APushNotificationConfig {
        const stored = this.tasks.get(params.id);
        if (!stored) throw Object.assign(new Error(`Task not found: ${params.id}`), { code: -32001 });
        stored.pushConfig = params.pushNotificationConfig;
        return params.pushNotificationConfig;
    }

    private handleGetPush(params: A2ATaskPushNotificationGetParams): A2APushNotificationConfig {
        const stored = this.tasks.get(params.id);
        if (!stored) throw Object.assign(new Error(`Task not found: ${params.id}`), { code: -32001 });
        if (!stored.pushConfig) throw Object.assign(new Error('No push config set'), { code: -32003 });
        return stored.pushConfig;
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    private getOrCreateTask(taskId: string, params: A2ATaskSendParams): StoredTask {
        let stored = this.tasks.get(taskId);
        if (!stored) {
            stored = {
                task: {
                    id: taskId,
                    sessionId: params.sessionId,
                    status: { state: 'submitted', timestamp: new Date().toISOString() },
                    history: [],
                    artifacts: [],
                    metadata: params.metadata,
                },
                artifactIndex: 0,
            };
            this.tasks.set(taskId, stored);
        }
        return stored;
    }

    private buildContext(stored: StoredTask, emitFn: ((s: A2ATaskStatus, final?: boolean) => void) | null): {
        taskId: string;
        sessionId?: string;
        history: A2AMessage[];
        emit: (status: A2ATaskStatus, final?: boolean) => void;
        emitArtifact: (parts: A2AMessage['parts'], opts?: { name?: string; append?: boolean; index?: number }) => void;
    } {
        return {
            taskId: stored.task.id,
            sessionId: stored.task.sessionId,
            history: stored.task.history ?? [],
            emit: (status, final = false) => {
                stored.task.status = status;
                if (emitFn) emitFn(status, final);
            },
            emitArtifact: (parts, opts) => {
                const artifact = {
                    parts,
                    index: opts?.index ?? stored.artifactIndex++,
                    name: opts?.name,
                    append: opts?.append ?? false,
                };
                stored.task.artifacts = [...(stored.task.artifacts ?? []), artifact];
                if (stored.sseRes) {
                    const line = JSON.stringify({
                        jsonrpc: '2.0',
                        method: 'tasks/artifactUpdate',
                        params: { id: stored.task.id, artifact },
                    });
                    stored.sseRes.write(`data: ${line}\n\n`);
                }
            },
        };
    }
}

export function createA2AServer(opts: A2AServerOptions): A2AServer {
    return new A2AServer(opts);
}
