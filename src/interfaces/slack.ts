/**
 * Slack interface adapter.
 *
 * Receives Slack Events API payloads at `POST /slack/events`, verifies the
 * request signature, maps messages to agent runs, and posts replies back via
 * the Web API.
 *
 * Required Slack OAuth scopes: `chat:write`, `app_mentions:read`, `im:history`
 * Required event subscriptions: `message.im`, `app_mention`
 *
 * @example
 * ```ts
 * import { createHttpService, listenService } from 'personaforge/serve';
 * import { SlackInterface } from 'personaforge/interfaces';
 *
 * const svc = createHttpService({
 *   agents: { assistant },
 *   interfaces: [
 *     new SlackInterface({
 *       agent: assistant,
 *       token: process.env.SLACK_BOT_TOKEN!,
 *       signingSecret: process.env.SLACK_SIGNING_SECRET!,
 *     }),
 *   ],
 * });
 * await listenService(svc, 3000);
 * ```
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type http from 'node:http';
import { BaseInterface, type BaseInterfaceOptions } from './base.js';

export interface SlackInterfaceOptions extends BaseInterfaceOptions {
    /** Slack bot token (`xoxb-…`) */
    token: string;
    /** Slack signing secret for request verification */
    signingSecret: string;
    /**
     * When true, resolves opaque Slack user IDs to display names via `users.info`.
     * Costs one extra API call per unique user. Default: false.
     */
    resolveUserIdentity?: boolean;
    /** Path to register Slack events on. Default: `/slack/events` */
    path?: string;
}

type SlackEvent =
    | { type: 'url_verification'; challenge: string }
    | { type: 'event_callback'; event: { type: string; text?: string; user?: string; channel?: string; thread_ts?: string; ts?: string } };

export class SlackInterface extends BaseInterface {
    private readonly token: string;
    private readonly signingSecret: string;
    private readonly resolveUserIdentity: boolean;
    private readonly slackPath: string;
    /** Cache: Slack user ID → display name */
    private readonly _nameCache = new Map<string, string>();

    constructor(options: SlackInterfaceOptions) {
        super(options);
        this.token = options.token;
        this.signingSecret = options.signingSecret;
        this.resolveUserIdentity = options.resolveUserIdentity ?? false;
        this.slackPath = options.path ?? '/slack/events';
    }

    setup(server: http.Server, _pathPrefix?: string): void {
        server.on('request', async (req, res) => {
            if (req.method !== 'POST' || req.url !== this.slackPath) return;
            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
            req.on('end', async () => {
                const rawBody = Buffer.concat(chunks).toString('utf8');

                // Verify Slack signature
                if (!this._verifySignature(req.headers, rawBody)) {
                    res.writeHead(401);
                    res.end(JSON.stringify({ error: 'Invalid signature' }));
                    return;
                }

                let payload: SlackEvent;
                try {
                    payload = JSON.parse(rawBody) as SlackEvent;
                } catch {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Invalid JSON' }));
                    return;
                }

                // URL verification challenge (Slack API registration)
                if (payload.type === 'url_verification') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ challenge: payload.challenge }));
                    return;
                }

                if (payload.type === 'event_callback') {
                    const event = payload.event;
                    // Handle direct messages and app_mention events
                    if ((event.type === 'message' || event.type === 'app_mention') && event.text && event.user && event.channel) {
                        res.writeHead(200);
                        res.end('OK');

                        // Process async to not block Slack's 3-second timeout
                        setImmediate(async () => {
                            try {
                                const userId = this.resolveUserIdentity
                                    ? await this._resolveSlackUser(event.user!)
                                    : event.user!;
                                const sessionId = `slack:${event.channel}:${event.thread_ts ?? event.ts}`;
                                const result = await this.dispatch(event.text!, userId, sessionId);
                                await this._postMessage(event.channel!, result.text, event.thread_ts ?? event.ts);
                            } catch (err) {
                                console.error('[SlackInterface] Agent error:', err);
                            }
                        });
                        return;
                    }
                    res.writeHead(200);
                    res.end('OK');
                    return;
                }

                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Unknown event type' }));
            });
        });
    }

    private _verifySignature(headers: http.IncomingMessage['headers'], rawBody: string): boolean {
        const timestamp = headers['x-slack-request-timestamp'];
        const sig = headers['x-slack-signature'];
        if (typeof timestamp !== 'string' || typeof sig !== 'string') return false;
        // Replay attack guard: reject requests older than 5 minutes
        if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
        const baseString = `v0:${timestamp}:${rawBody}`;
        const computed = `v0=${createHmac('sha256', this.signingSecret).update(baseString).digest('hex')}`;
        const computedBuf = Buffer.from(computed);
        const sigBuf = Buffer.from(sig);
        if (computedBuf.length !== sigBuf.length) return false;
        return timingSafeEqual(computedBuf, sigBuf);
    }

    private async _resolveSlackUser(slackUserId: string): Promise<string> {
        if (this._nameCache.has(slackUserId)) return this._nameCache.get(slackUserId)!;
        try {
            const resp = await fetch(`https://slack.com/api/users.info?user=${slackUserId}`, {
                headers: { Authorization: `Bearer ${this.token}` },
            });
            const data = await resp.json() as { ok: boolean; user?: { name?: string } };
            const name = data.ok ? (data.user?.name ?? slackUserId) : slackUserId;
            this._nameCache.set(slackUserId, name);
            return name;
        } catch {
            return slackUserId;
        }
    }

    private async _postMessage(channel: string, text: string, threadTs?: string): Promise<void> {
        const body: Record<string, unknown> = { channel, text };
        if (threadTs) body['thread_ts'] = threadTs;
        await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${this.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });
    }
}
