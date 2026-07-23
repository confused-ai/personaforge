/**
 * A2A (Agent-to-Agent) protocol interface.
 *
 * Implements Google's open A2A specification so agents built with this framework
 * can accept requests from other A2A-compatible agents over a standard HTTP+JSON
 * protocol.
 *
 * Spec: https://google.github.io/A2A/
 *
 * Endpoints registered:
 *   GET  /.well-known/agent.json      → Agent Card (capabilities manifest)
 *   POST /a2a                         → Process a task from another agent
 *
 * Auth: Inbound JWTs validated by the standard `auth` middleware on the server.
 *
 * @example
 * ```ts
 * import { A2AInterface } from 'personaforge/interfaces';
 *
 * new A2AInterface({
 *   agent: assistant,
 *   agentCard: {
 *     name: 'Assistant',
 *     description: 'General-purpose assistant',
 *     version: '1.0.0',
 *     capabilities: ['text', 'tools'],
 *   },
 * });
 * ```
 */

import type http from 'node:http';
import { BaseInterface, type BaseInterfaceOptions } from './base.js';

export interface A2AAgentCard {
    name: string;
    description: string;
    version: string;
    capabilities: string[];
    /** URL where this agent is reachable. Filled in at startup if omitted. */
    url?: string;
}

export interface A2AInterfaceOptions extends BaseInterfaceOptions {
    /** Metadata about this agent exposed to other agents. */
    agentCard: A2AAgentCard;
    /** Path for the A2A task endpoint. Default: `/a2a` */
    path?: string;
}

interface A2ATask {
    id: string;
    message: {
        role: 'user';
        parts: Array<{ type: 'text'; text: string }>;
    };
    sessionId?: string;
    metadata?: Record<string, unknown>;
}

interface A2AResponse {
    id: string;
    status: { state: 'completed' | 'failed' };
    artifacts?: Array<{
        parts: Array<{ type: 'text'; text: string }>;
    }>;
    error?: { code: number; message: string };
}

export class A2AInterface extends BaseInterface {
    private readonly agentCard: A2AAgentCard;
    private readonly a2aPath: string;

    constructor(options: A2AInterfaceOptions) {
        super(options);
        this.agentCard = options.agentCard;
        this.a2aPath = options.path ?? '/a2a';
    }

    setup(server: http.Server, _pathPrefix?: string): void {
        server.on('request', (req, res) => {
            const url = req.url?.split('?')[0] ?? '/';

            // Agent Card discovery endpoint
            if (req.method === 'GET' && url === '/.well-known/agent.json') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(this._buildAgentCard()));
                return;
            }

            // A2A task endpoint
            if (req.method === 'POST' && url === this.a2aPath) {
                const chunks: Buffer[] = [];
                req.on('data', (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
                req.on('end', async () => {
                    let task: A2ATask;
                    try {
                        task = JSON.parse(Buffer.concat(chunks).toString('utf8')) as A2ATask;
                    } catch {
                        const errResp: A2AResponse = {
                            id: 'unknown',
                            status: { state: 'failed' },
                            error: { code: 400, message: 'Invalid JSON' },
                        };
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(errResp));
                        return;
                    }

                    const textPart = task.message.parts.find(p => p.type === 'text');
                    if (!textPart?.text) {
                        const errResp: A2AResponse = {
                            id: task.id,
                            status: { state: 'failed' },
                            error: { code: 400, message: 'Missing text part in message' },
                        };
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(errResp));
                        return;
                    }

                    try {
                        // Use task ID as stable user ID for agent-to-agent calls
                        const callerAgentId = (task.metadata?.['agent_id'] as string | undefined) ?? `a2a-caller`;
                        const result = await this.dispatch(textPart.text, callerAgentId, task.sessionId);
                        const response: A2AResponse = {
                            id: task.id,
                            status: { state: 'completed' },
                            artifacts: [{
                                parts: [{ type: 'text', text: result.text }],
                            }],
                        };
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(response));
                    } catch (err) {
                        const response: A2AResponse = {
                            id: task.id,
                            status: { state: 'failed' },
                            error: {
                                code: 500,
                                message: err instanceof Error ? err.message : 'Agent execution failed',
                            },
                        };
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(response));
                    }
                });
                return;
            }
        });
    }

    private _buildAgentCard(): A2AAgentCard {
        return { ...this.agentCard };
    }
}
