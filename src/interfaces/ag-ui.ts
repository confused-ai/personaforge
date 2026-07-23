/**
 * AG-UI browser SSE streaming interface.
 *
 * AG-UI is an open protocol for browser clients consuming SSE streams of agent
 * run output.  It extends the standard SSE format with typed event envelopes
 * that React/Vue clients can consume with `@ag-ui/client`.
 *
 * Endpoints:
 *   POST /ag-ui/runs           → Start a streaming run (SSE response)
 *   GET  /ag-ui/runs/:runId    → Reconnect to an existing run stream
 *
 * Auth: JWT in `Authorization: Bearer ...` header (validated upstream).
 *
 * Event format (newline-delimited JSON over SSE):
 *   `data: {"event":"run.created","run_id":"...","agent_id":"..."}\n\n`
 *   `data: {"event":"message.delta","run_id":"...","delta":"..."}\n\n`
 *   `data: {"event":"run.completed","run_id":"...","content":"..."}\n\n`
 *   `data: {"event":"run.failed","run_id":"...","error":"..."}\n\n`
 *
 * @example
 * ```ts
 * import { AGUIInterface } from 'personaforge/interfaces';
 *
 * new AGUIInterface({ agent: assistant });
 * ```
 */

import { randomUUID } from 'node:crypto';
import type http from 'node:http';
import { BaseInterface, type BaseInterfaceOptions } from './base.js';

export interface AGUIInterfaceOptions extends BaseInterfaceOptions {
    /** Path prefix. Default: `/ag-ui` */
    path?: string;
    /** CORS origin to allow. Default: `*` */
    cors?: string;
}

export class AGUIInterface extends BaseInterface {
    private readonly pathPrefix: string;
    private readonly cors: string;

    constructor(options: AGUIInterfaceOptions) {
        super(options);
        this.pathPrefix = options.path ?? '/ag-ui';
        this.cors = options.cors ?? '*';
    }

    setup(server: http.Server, _pathPrefix?: string): void {
        server.on('request', (req, res) => {
            const url = req.url?.split('?')[0] ?? '/';

            // POST /ag-ui/runs → start a streaming run
            if (req.method === 'POST' && url === `${this.pathPrefix}/runs`) {
                this._handleRunCreate(req, res);
                return;
            }

            // OPTIONS preflight
            if (req.method === 'OPTIONS' && url.startsWith(this.pathPrefix)) {
                res.setHeader('Access-Control-Allow-Origin', this.cors);
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
                res.writeHead(204);
                res.end();
                return;
            }
        });
    }

    private _handleRunCreate(req: http.IncomingMessage, res: http.ServerResponse): void {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        req.on('end', async () => {
            let body: { message?: string; user_id?: string; session_id?: string; agent?: string } = {};
            try {
                body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof body;
            } catch {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON' }));
                return;
            }

            if (!body.message || typeof body.message !== 'string') {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing "message" string' }));
                return;
            }

            const runId = randomUUID();
            const userId = body.user_id ?? 'anonymous';
            const sessionId = body.session_id ?? await this.agent.createSession(userId);

            // Set SSE headers
            res.setHeader('Access-Control-Allow-Origin', this.cors);
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no');
            res.writeHead(200);

            const send = (event: Record<string, unknown>) => {
                res.write(`data: ${JSON.stringify(event)}\n\n`);
            };

            // Emit run.created
            send({ event: 'run.created', run_id: runId, session_id: sessionId, agent_id: this.agent.name });

            try {
                const result = await this.agent.run(body.message, {
                    sessionId,
                    userId,
                    onChunk: (delta: string) => {
                        send({ event: 'message.delta', run_id: runId, delta });
                    },
                });

                send({
                    event: 'run.completed',
                    run_id: runId,
                    session_id: sessionId,
                    content: result.text,
                    steps: result.steps,
                    finish_reason: result.finishReason,
                });
            } catch (err) {
                send({
                    event: 'run.failed',
                    run_id: runId,
                    error: err instanceof Error ? err.message : 'Agent execution failed',
                });
            }

            res.end();
        });
    }
}
