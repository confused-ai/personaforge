/**
 * Hermetic coverage for src/interfaces/* (slack/telegram/a2a/ag-ui/base).
 * tests include glob: tests/coverage-remaining-*.test.ts
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { SlackInterface } from '../src/interfaces/slack.js';
import { TelegramInterface } from '../src/interfaces/telegram.js';
import { A2AInterface } from '../src/interfaces/a2a.js';
import { AGUIInterface } from '../src/interfaces/ag-ui.js';
import type { CreateAgentResult } from '../src/create-agent/types.js';

function mockAgent(overrides: Partial<CreateAgentResult> = {}): CreateAgentResult {
    return {
        name: 'test-agent',
        createSession: vi.fn(async () => 'sess-1'),
        run: vi.fn(async (_msg: string, opts?: { onChunk?: (d: string) => void }) => {
            opts?.onChunk?.('hel');
            opts?.onChunk?.('lo');
            return { text: 'hello', steps: [], finishReason: 'stop' };
        }),
        ...overrides,
    } as unknown as CreateAgentResult;
}

function listen(iface: { setup: (s: http.Server) => void }): Promise<{
    server: http.Server;
    port: number;
    close: () => Promise<void>;
}> {
    const server = http.createServer();
    iface.setup(server);
    return new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            if (!addr || typeof addr === 'string') {
                reject(new Error('no port'));
                return;
            }
            resolve({
                server,
                port: addr.port,
                close: () =>
                    new Promise((res, rej) => server.close((e) => (e ? rej(e) : res()))),
            });
        });
    });
}

async function post(
    port: number,
    path: string,
    body: string,
    headers: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port,
                path,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    ...headers,
                },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () =>
                    resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }),
                );
            },
        );
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function get(port: number, path: string): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
        http.get({ hostname: '127.0.0.1', port, path }, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () =>
                resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }),
            );
        }).on('error', reject);
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('SlackInterface', () => {
    const secret = 'signing-secret';

    function sign(body: string, ts = String(Math.floor(Date.now() / 1000))) {
        const base = `v0:${ts}:${body}`;
        const sig = `v0=${createHmac('sha256', secret).update(base).digest('hex')}`;
        return { ts, sig };
    }

    it('url_verification, event_callback, identity resolve, and error paths', async () => {
        const fetchMock = vi.fn(async (url: string) => {
            if (String(url).includes('users.info')) {
                return { json: async () => ({ ok: true, user: { name: 'alice' } }) };
            }
            return { json: async () => ({ ok: true }) };
        });
        vi.stubGlobal('fetch', fetchMock);

        const agent = mockAgent();
        const iface = new SlackInterface({
            agent,
            token: 'xoxb-t',
            signingSecret: secret,
            resolveUserIdentity: true,
        });
        expect(iface.name).toBe('SlackInterface');
        const { port, close } = await listen(iface);
        try {
            const challenge = JSON.stringify({ type: 'url_verification', challenge: 'abc' });
            const s1 = sign(challenge);
            const r1 = await post(port, '/slack/events', challenge, {
                'x-slack-request-timestamp': s1.ts,
                'x-slack-signature': s1.sig,
            });
            expect(r1.status).toBe(200);
            expect(JSON.parse(r1.text).challenge).toBe('abc');

            expect(
                (
                    await post(port, '/slack/events', challenge, {
                        'x-slack-request-timestamp': s1.ts,
                        'x-slack-signature': 'v0=deadbeef',
                    })
                ).status,
            ).toBe(401);

            const oldTs = String(Math.floor(Date.now() / 1000) - 400);
            const oldBody = JSON.stringify({ type: 'url_verification', challenge: 'x' });
            const sOld = sign(oldBody, oldTs);
            expect(
                (
                    await post(port, '/slack/events', oldBody, {
                        'x-slack-request-timestamp': oldTs,
                        'x-slack-signature': sOld.sig,
                    })
                ).status,
            ).toBe(401);

            const badJson = '{';
            const sBad = sign(badJson);
            expect(
                (
                    await post(port, '/slack/events', badJson, {
                        'x-slack-request-timestamp': sBad.ts,
                        'x-slack-signature': sBad.sig,
                    })
                ).status,
            ).toBe(400);

            const evt = JSON.stringify({
                type: 'event_callback',
                event: {
                    type: 'app_mention',
                    text: 'hi',
                    user: 'U1',
                    channel: 'C1',
                    ts: '1.0',
                },
            });
            const sEvt = sign(evt);
            const rEvt = await post(port, '/slack/events', evt, {
                'x-slack-request-timestamp': sEvt.ts,
                'x-slack-signature': sEvt.sig,
            });
            expect(rEvt.status).toBe(200);
            await vi.waitFor(() => expect(agent.run).toHaveBeenCalled());
            expect(fetchMock).toHaveBeenCalled();

            const other = JSON.stringify({
                type: 'event_callback',
                event: { type: 'reaction_added' },
            });
            const sO = sign(other);
            expect(
                (
                    await post(port, '/slack/events', other, {
                        'x-slack-request-timestamp': sO.ts,
                        'x-slack-signature': sO.sig,
                    })
                ).status,
            ).toBe(200);

            const unk = JSON.stringify({ type: 'app_rate_limited' });
            const sU = sign(unk);
            expect(
                (
                    await post(port, '/slack/events', unk, {
                        'x-slack-request-timestamp': sU.ts,
                        'x-slack-signature': sU.sig,
                    })
                ).status,
            ).toBe(400);
        } finally {
            await close();
        }
    });
});

describe('TelegramInterface', () => {
    it('webhook secret, message dispatch, registerWebhook', async () => {
        const fetchMock = vi.fn(async () => ({ json: async () => ({ ok: true }) }));
        vi.stubGlobal('fetch', fetchMock);

        const agent = mockAgent();
        const iface = new TelegramInterface({
            agent,
            token: 'tok',
            secretToken: 'sec',
            path: '/telegram/webhook',
        });
        const { port, close } = await listen(iface);
        try {
            expect(
                (
                    await post(port, '/telegram/webhook', '{}', {
                        'x-telegram-bot-api-secret-token': 'wrong',
                    })
                ).status,
            ).toBe(403);

            expect(
                (
                    await post(port, '/telegram/webhook', '{', {
                        'x-telegram-bot-api-secret-token': 'sec',
                    })
                ).status,
            ).toBe(400);

            const update = JSON.stringify({
                update_id: 1,
                message: {
                    message_id: 9,
                    from: { id: 42, username: 'u' },
                    chat: { id: 99, type: 'private' },
                    text: 'ping',
                },
            });
            const ok = await post(port, '/telegram/webhook', update, {
                'x-telegram-bot-api-secret-token': 'sec',
            });
            expect(ok.status).toBe(200);
            await vi.waitFor(() => expect(agent.run).toHaveBeenCalled());

            await iface.registerWebhook('https://example.com');
            expect(fetchMock).toHaveBeenCalledWith(
                expect.stringContaining('setWebhook'),
                expect.any(Object),
            );

            vi.stubGlobal(
                'fetch',
                vi.fn(async () => ({ json: async () => ({ ok: false, description: 'nope' }) })),
            );
            await expect(iface.registerWebhook('https://example.com')).rejects.toThrow(
                /webhook registration failed/,
            );
        } finally {
            await close();
        }
    });
});

describe('A2AInterface', () => {
    it('agent card + task success/fail paths', async () => {
        const agent = mockAgent();
        const iface = new A2AInterface({
            agent,
            agentCard: { name: 'A', description: 'd', version: '1', capabilities: ['text'] },
        });
        const { port, close } = await listen(iface);
        try {
            const card = await get(port, '/.well-known/agent.json');
            expect(card.status).toBe(200);
            expect(JSON.parse(card.text).name).toBe('A');

            expect((await post(port, '/a2a', '{')).status).toBe(400);

            const noText = JSON.stringify({
                id: 't1',
                message: { role: 'user', parts: [{ type: 'text', text: '' }] },
            });
            expect((await post(port, '/a2a', noText)).status).toBe(400);

            const okBody = JSON.stringify({
                id: 't2',
                message: { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
                metadata: { agent_id: 'peer' },
            });
            const ok = await post(port, '/a2a', okBody);
            expect(ok.status).toBe(200);
            expect(JSON.parse(ok.text).status.state).toBe('completed');

            const failAgent = mockAgent({
                run: vi.fn(async () => {
                    throw new Error('boom');
                }),
            });
            const iface2 = new A2AInterface({
                agent: failAgent,
                agentCard: { name: 'B', description: 'd', version: '1', capabilities: [] },
                path: '/a2a2',
            });
            const s2 = await listen(iface2);
            try {
                const fail = await post(
                    s2.port,
                    '/a2a2',
                    JSON.stringify({
                        id: 't3',
                        message: { role: 'user', parts: [{ type: 'text', text: 'x' }] },
                    }),
                );
                expect(fail.status).toBe(500);
            } finally {
                await s2.close();
            }
        } finally {
            await close();
        }
    });
});

describe('AGUIInterface', () => {
    it('OPTIONS, create run SSE, validation errors', async () => {
        const agent = mockAgent();
        const iface = new AGUIInterface({ agent, cors: 'http://localhost' });
        const { port, close } = await listen(iface);
        try {
            const preflight = await new Promise<{ status: number }>((resolve, reject) => {
                const req = http.request(
                    { hostname: '127.0.0.1', port, path: '/ag-ui/runs', method: 'OPTIONS' },
                    (res) => {
                        res.resume();
                        resolve({ status: res.statusCode ?? 0 });
                    },
                );
                req.on('error', reject);
                req.end();
            });
            expect(preflight.status).toBe(204);

            expect((await post(port, '/ag-ui/runs', '{')).status).toBe(400);
            expect((await post(port, '/ag-ui/runs', JSON.stringify({}))).status).toBe(400);

            const sse = await post(
                port,
                '/ag-ui/runs',
                JSON.stringify({ message: 'hi', user_id: 'u1' }),
            );
            expect(sse.status).toBe(200);
            expect(sse.text).toContain('run.created');
            expect(sse.text).toContain('message.delta');
            expect(sse.text).toContain('run.completed');

            const failAgent = mockAgent({
                run: vi.fn(async () => {
                    throw new Error('fail');
                }),
            });
            const iface2 = new AGUIInterface({ agent: failAgent });
            const s2 = await listen(iface2);
            try {
                const failed = await post(s2.port, '/ag-ui/runs', JSON.stringify({ message: 'x' }));
                expect(failed.text).toContain('run.failed');
            } finally {
                await s2.close();
            }
        } finally {
            await close();
        }
    });
});
