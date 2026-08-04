/**
 * Hermetic coverage: Discord, Email (SMTP/SendGrid), Gmail, Resend, Slack,
 * Telegram, Twilio, Webex, WhatsApp, Zoom communication tools.
 *
 * fetch-based tools stub globalThis.fetch; SDK-backed tools (nodemailer,
 * @sendgrid/mail, twilio) are stubbed by intercepting Module._load so the
 * lazy `require()` inside the source returns fakes. No real services touched.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import Module from 'node:module';

import {
    DiscordSendMessageTool,
    DiscordGetMessagesTool,
    DiscordCreateChannelTool,
    DiscordDeleteMessageTool,
    DiscordListMembersTool,
    DiscordToolkit,
} from '../src/tools/communication/discord.js';
import {
    SmtpEmailTool,
    SendGridEmailTool,
    EmailToolkit,
} from '../src/tools/communication/email.js';
import {
    GmailListMessagesTool,
    GmailGetMessageTool,
    GmailSendEmailTool,
    GmailModifyLabelsTool,
    GmailTrashMessageTool,
    GmailSearchMessagesTool,
    GmailToolkit,
} from '../src/tools/communication/gmail.js';
import {
    ResendSendEmailTool,
    ResendGetEmailTool,
    ResendToolkit,
} from '../src/tools/communication/resend.js';
import {
    SlackSendMessageTool,
    SlackListChannelsTool,
    SlackGetChannelHistoryTool,
    SlackToolkit,
} from '../src/tools/communication/slack.js';
import { TelegramTool, TelegramToolkit } from '../src/tools/communication/telegram.js';
import {
    TwilioSendSmsTool,
    TwilioMakeCallTool,
    TwilioToolkit,
} from '../src/tools/communication/twilio.js';
import {
    WebexSendMessageTool,
    WebexListRoomsTool,
    WebexGetMessagesTool,
    WebexCreateRoomTool,
    WebexToolkit,
} from '../src/tools/communication/webex.js';
import {
    WhatsAppSendTextTool,
    WhatsAppSendTemplateTool,
    WhatsAppSendImageTool,
    WhatsAppToolkit,
} from '../src/tools/communication/whatsapp.js';
import {
    ZoomCreateMeetingTool,
    ZoomGetMeetingTool,
    ZoomListMeetingsTool,
    ZoomDeleteMeetingTool,
    ZoomToolkit,
} from '../src/tools/communication/zoom.js';
import type { ToolContext } from '../src/tools/core/types.js';

function ctx(over: Partial<ToolContext> = {}): ToolContext {
    return {
        toolId: 'tool_test',
        agentId: 'agent_test',
        sessionId: 'sess_test',
        permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 30_000 },
        ...over,
    };
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
    });
}

// Direct access to protected performExecute: bypasses zod input validation so we
// can pass `undefined` for `.default(...)`-decorated fields and reach the
// right-hand sides of `?? default` (dead through execute() after defaults apply).
interface Performable {
    performExecute(input: unknown, context: ToolContext): Promise<unknown>;
}
function perform(tool: object, input: unknown): Promise<unknown> {
    return (tool as unknown as Performable).performExecute(input, ctx());
}

// ── SDK stubs for lazy `require()` inside src (never touch real services) ──
const fakeNodemailer = {
    createTransport: vi.fn(() => ({
        sendMail: vi.fn(async () => ({ messageId: 'nm-1', accepted: ['a@b.com'] })),
    })),
};
const fakeSendGrid = {
    setApiKey: vi.fn(),
    send: vi.fn(async () => undefined),
};
const fakeTwilio = vi.fn(() => ({
    messages: {
        create: vi.fn(async (p: { to: string; body?: string }) => ({
            sid: 'SM1', status: 'queued', to: String(p.to), body: String(p.body ?? ''),
        })),
    },
    calls: {
        create: vi.fn(async (p: { to: string }) => ({
            sid: 'CA1', status: 'ringing', to: String(p.to),
        })),
    },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Mod = Module as unknown as { _load: (...args: any[]) => unknown };
const originalModuleLoad = Mod._load;
// Install once for this file: vitest isolates test files, so this never leaks.
Mod._load = function (this: unknown, request: string, parent: object, isMain: boolean) {
    if (request === 'nodemailer') return fakeNodemailer;
    if (request === '@sendgrid/mail') return fakeSendGrid;
    if (request === 'twilio') return fakeTwilio;
    return originalModuleLoad.call(this, request, parent, isMain);
};

describe('Discord tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });
    const cfg = { botToken: 'btok' };

    it('requires a bot token', async () => {
        const prev = process.env['DISCORD_BOT_TOKEN'];
        delete process.env['DISCORD_BOT_TOKEN'];
        const r = await new DiscordSendMessageTool({}).execute({ channelId: 'c', content: 'hi' }, ctx());
        expect(r.success).toBe(false);
        expect(r.error?.message).toMatch(/DISCORD_BOT_TOKEN/);
        if (prev !== undefined) process.env['DISCORD_BOT_TOKEN'] = prev;
    });

    it('success paths, env token, 204 and defaulted-field branches', async () => {
        const prev = process.env['DISCORD_BOT_TOKEN'];
        process.env['DISCORD_BOT_TOKEN'] = 'envtok';
        globalThis.fetch = vi.fn(async (url, init) => {
            const u = String(url);
            const method = (init?.method ?? 'GET').toUpperCase();
            if (method === 'DELETE') return new Response(null, { status: 204 });
            if (u.includes('/messages?')) {
                return json([{ id: 'm1', content: 'hello', author: { username: 'alice' }, timestamp: 'ts' }]);
            }
            if (u.includes('/members')) {
                return json([{ user: { id: 'u1', username: 'bob' }, roles: ['admin'] }]);
            }
            return json({ id: 'msg1', channel_id: 'ch1', content: 'hi', name: 'general', type: 0 });
        }) as typeof fetch;

        const sent = await new DiscordSendMessageTool({}).execute({ channelId: 'ch1', content: 'hi', tts: true }, ctx());
        expect(sent.success).toBe(true);
        expect(sent.data).toMatchObject({ id: 'msg1', channelId: 'ch1', content: 'hi' });

        const got = await new DiscordGetMessagesTool(cfg).execute({ channelId: 'ch1', limit: 5, before: 'b1' }, ctx());
        expect(got.data?.messages[0]).toMatchObject({ id: 'm1', author: 'alice' });
        expect(await new DiscordGetMessagesTool(cfg).execute({ channelId: 'ch1' }, ctx())).toMatchObject({ success: true });

        const created = await new DiscordCreateChannelTool(cfg).execute({
            guildId: 'g1', name: 'general', topic: 'chat', type: 2,
        }, ctx());
        expect(created.data).toMatchObject({ name: 'general' });

        const del = await new DiscordDeleteMessageTool(cfg).execute({ channelId: 'ch1', messageId: 'm1' }, ctx());
        expect(del.data).toEqual({ success: true });

        const members = await new DiscordListMembersTool(cfg).execute({ guildId: 'g1', limit: 3 }, ctx());
        expect(members.data?.members[0]).toMatchObject({ id: 'u1', username: 'bob', roles: ['admin'] });

        // direct performExecute: undefined defaulted fields hit `?? default` right sides
        expect(await perform(new DiscordSendMessageTool(cfg), { channelId: 'c', content: 'x', tts: undefined })).toMatchObject({ id: 'msg1' });
        expect(await perform(new DiscordGetMessagesTool(cfg), { channelId: 'c', limit: undefined })).toMatchObject({ messages: expect.any(Array) });
        expect(await perform(new DiscordCreateChannelTool(cfg), { guildId: 'g', name: 'n', type: undefined })).toMatchObject({ name: 'general' });
        expect(await perform(new DiscordListMembersTool(cfg), { guildId: 'g', limit: undefined })).toMatchObject({ members: expect.any(Array) });

        if (prev !== undefined) process.env['DISCORD_BOT_TOKEN'] = prev;
    });

    it('toolkit + API error path', async () => {
        expect(new DiscordToolkit(cfg).tools).toHaveLength(5);
        expect(new DiscordToolkit().tools).toHaveLength(5);

        globalThis.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as typeof fetch;
        const err = await new DiscordSendMessageTool(cfg).execute({ channelId: 'c', content: 'x' }, ctx());
        expect(err.success).toBe(false);
        expect(err.error?.message).toMatch(/Discord API 500/);
    });
});

describe('Email tools (SMTP / SendGrid)', () => {
    it('SMTP success + branch coverage', async () => {
        const r = await new SmtpEmailTool({ host: 'smtp.x', user: 'u', pass: 'p' }).execute(
            { to: 'a@b.com', subject: 's', body: 'plain', isHtml: false }, ctx(),
        );
        expect(r.success).toBe(true);
        expect(r.data).toMatchObject({ messageId: 'nm-1', accepted: ['a@b.com'], success: true });

        const r2 = await new SmtpEmailTool({ host: 'smtp.x', port: 587, secure: true, user: 'u', pass: 'p', from: 'cfg@x.com' }).execute(
            { to: ['a@b.com', 'c@d.com'], cc: 'cc@x.com', bcc: ['b@x.com'], subject: 's', body: '<b>hi</b>', isHtml: true }, ctx(),
        );
        expect(r2.success).toBe(true);

        const r3 = await new SmtpEmailTool({ host: 'smtp.x', port: 587, user: 'u', pass: 'p' }).execute(
            { to: 'a@b.com', from: 'in@x.com', cc: ['c1@x.com', 'c2@x.com'], bcc: 'b@x.com', subject: 's', body: 'b' }, ctx(),
        );
        expect(r3.success).toBe(true);
    });

    it('SMTP transport error is graceful', async () => {
        fakeNodemailer.createTransport.mockReturnValueOnce({
            sendMail: vi.fn(async () => {
                throw new Error('smtp down');
            }),
        });
        const bad = await new SmtpEmailTool({ host: 'h', user: 'u', pass: 'p' }).execute(
            { to: 'a@b.com', subject: 's', body: 'b' }, ctx(),
        );
        expect(bad.success).toBe(false);
        expect(bad.error?.message).toMatch(/smtp down/);
    });

    it('SendGrid success + key/from branches', async () => {
        const r = await new SendGridEmailTool({ apiKey: 'k', from: 'f@x.com' }).execute(
            { to: 'a@b.com', subject: 's', body: 'b', isHtml: false }, ctx(),
        );
        expect(r.success).toBe(true);
        expect(r.data?.accepted).toEqual(['a@b.com']);
        expect(r.data?.messageId).toMatch(/^sg-/);

        const r2 = await new SendGridEmailTool({ apiKey: 'k', from: 'f@x.com' }).execute(
            { to: ['a@b.com', 'c@d.com'], from: 'in@x.com', cc: 'cc@x', bcc: 'b@x', subject: 's', body: 'b', isHtml: true }, ctx(),
        );
        expect(r2.data?.accepted).toEqual(['a@b.com', 'c@d.com']);
        expect(fakeSendGrid.setApiKey).toHaveBeenCalledWith('k');
        expect(fakeSendGrid.send).toHaveBeenCalled();

        const prev = process.env['SENDGRID_API_KEY'];
        delete process.env['SENDGRID_API_KEY'];
        const noKey = await new SendGridEmailTool({ from: 'f@x.com' }).execute({ to: 'a@b.com', subject: 's', body: 'b' }, ctx());
        expect(noKey.success).toBe(false);
        expect(noKey.error?.message).toMatch(/SENDGRID_API_KEY/);
        if (prev !== undefined) process.env['SENDGRID_API_KEY'] = prev;

        process.env['SENDGRID_API_KEY'] = 'envk';
        const envKey = await new SendGridEmailTool({ from: 'f@x.com' }).execute({ to: 'a@b.com', subject: 's', body: 'b' }, ctx());
        expect(envKey.success).toBe(true);
        delete process.env['SENDGRID_API_KEY'];

        fakeSendGrid.send.mockRejectedValueOnce(new Error('sg down'));
        const bad = await new SendGridEmailTool({ apiKey: 'k', from: 'f@x.com' }).execute(
            { to: 'a@b.com', subject: 's', body: 'b' }, ctx(),
        );
        expect(bad.success).toBe(false);
        expect(bad.error?.message).toMatch(/sg down/);
    });

    it('EmailToolkit selects smtp vs sendgrid', () => {
        expect(new EmailToolkit({ type: 'smtp', host: 'h', user: 'u', pass: 'p' }).tools).toHaveLength(1);
        expect(new EmailToolkit({ type: 'sendgrid', from: 'f@x.com', apiKey: 'k' }).tools).toHaveLength(1);
    });
});

describe('Gmail tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });
    const cfg = { accessToken: 'gtok' };
    const b64 = (s: string) => Buffer.from(s).toString('base64');

    it('requires token', async () => {
        const prev = process.env['GMAIL_ACCESS_TOKEN'];
        delete process.env['GMAIL_ACCESS_TOKEN'];
        const r = await new GmailListMessagesTool({}).execute({}, ctx());
        expect(r.success).toBe(false);
        expect(r.error?.message).toMatch(/GMAIL_ACCESS_TOKEN/);
        if (prev !== undefined) process.env['GMAIL_ACCESS_TOKEN'] = prev;
    });

    it('list messages with query/labels/spam + metadata detail', async () => {
        globalThis.fetch = vi.fn(async (url) => {
            if (String(url).includes('format=metadata')) {
                return json({
                    id: 'm1', threadId: 'th1', snippet: 'sn', labelIds: ['INBOX'],
                    payload: {
                        headers: [
                            { name: 'Subject', value: 'Hi' },
                            { name: 'from', value: 's@x' },
                            { name: 'To', value: 'a@x' },
                            { name: 'Date', value: 'd' },
                        ],
                    },
                });
            }
            return json({ messages: [{ id: 'm1', threadId: 'th1' }] });
        }) as typeof fetch;

        const r = await new GmailListMessagesTool(cfg).execute({
            query: 'from:s@x', maxResults: 5, labelIds: ['INBOX', 'UNREAD'], includeSpamTrash: true,
        }, ctx());
        expect(r.data?.count).toBe(1);
        expect(r.data?.messages[0]).toMatchObject({ id: 'm1', subject: 'Hi', from: 's@x' });
    });

    it('list messages with no options + empty list', async () => {
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        const r = await new GmailListMessagesTool(cfg).execute({}, ctx());
        expect(r.data?.count).toBe(0);
        // direct performExecute -> undefined maxResults hits `?? 10` right side
        expect(await perform(new GmailListMessagesTool(cfg), {})).toMatchObject({ messages: [], count: 0 });
    });

    it('list messages detail without payload/snippet/labelIds', async () => {
        globalThis.fetch = vi.fn(async (url) => {
            if (String(url).includes('format=metadata')) {
                return json({ id: 'm1', threadId: 'th1' });
            }
            return json({ messages: [{ id: 'm1', threadId: 'th1' }] });
        }) as typeof fetch;
        const r = await new GmailListMessagesTool(cfg).execute({}, ctx());
        expect(r.data?.messages[0]).toMatchObject({ id: 'm1', subject: '', from: '', to: '', date: '', snippet: '', labels: [] });
    });

    it('get message includeBody true/false', async () => {
        globalThis.fetch = vi.fn(async () => json({
            id: 'm1', threadId: 'th1', snippet: 'sn', labelIds: ['INBOX'],
            payload: {
                mimeType: 'text/plain',
                headers: [{ name: 'Subject', value: 'Hi' }],
                body: { data: b64('hello') },
            },
        })) as typeof fetch;
        const full = await new GmailGetMessageTool(cfg).execute({ messageId: 'm1', includeBody: true }, ctx());
        expect(full.data?.body).toBe('hello');
        expect(full.data?.subject).toBe('Hi');

        globalThis.fetch = vi.fn(async () => json({ id: 'm1', threadId: 'th1' })) as typeof fetch;
        const meta = await new GmailGetMessageTool(cfg).execute({ messageId: 'm1', includeBody: false }, ctx());
        expect(meta.success).toBe(true);
        expect(meta.data).not.toHaveProperty('body');
    });

    it('send email with/without optional fields', async () => {
        globalThis.fetch = vi.fn(async () => json({ id: 'sent1', threadId: 'th1', labelIds: ['SENT'] })) as typeof fetch;
        const a = await new GmailSendEmailTool(cfg).execute({
            to: 'a@b.com', subject: 's', body: 'b', cc: 'cc@x', isHtml: false, threadId: 'th1',
        }, ctx());
        expect(a.data).toMatchObject({ id: 'sent1', threadId: 'th1', labelIds: ['SENT'] });

        const b = await new GmailSendEmailTool(cfg).execute({ to: 'a@b.com', subject: 's', body: 'b', isHtml: true }, ctx());
        expect(b.success).toBe(true);

        globalThis.fetch = vi.fn(async () => json({ id: 'sent2', threadId: 't2' })) as typeof fetch;
        const c = await new GmailSendEmailTool(cfg).execute({ to: 'a@b.com', subject: 's', body: 'b' }, ctx());
        expect(c.data?.labelIds).toEqual([]);

        // explicit cc-undefined via direct performExecute covers the `&&` skip path
        expect(await perform(new GmailSendEmailTool(cfg), { to: 'a@b.com', subject: 's', body: 'b', cc: undefined })).toMatchObject({ id: 'sent2' });
    });

    it('modify labels (with/without payload)', async () => {
        globalThis.fetch = vi.fn(async () => json({
            id: 'm1', threadId: 't', payload: { headers: [{ name: 'Subject', value: 'Hi' }] },
        })) as typeof fetch;
        const a = await new GmailModifyLabelsTool(cfg).execute({
            messageId: 'm1', addLabelIds: ['STARRED'], removeLabelIds: ['UNREAD'],
        }, ctx());
        expect(a.data?.id).toBe('m1');

        globalThis.fetch = vi.fn(async () => json({ id: 'm1', threadId: 't' })) as typeof fetch;
        const b = await new GmailModifyLabelsTool(cfg).execute({ messageId: 'm1' }, ctx());
        expect(b.success).toBe(true);
    });

    it('trash message + 204 path', async () => {
        globalThis.fetch = vi.fn(async () => json({ id: 'm1' })) as typeof fetch;
        const a = await new GmailTrashMessageTool(cfg).execute({ messageId: 'm1' }, ctx());
        expect(a.data).toEqual({ success: true, id: 'm1' });

        globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch;
        const b = await new GmailTrashMessageTool(cfg).execute({ messageId: 'm1' }, ctx());
        expect(b.success).toBe(false);
    });

    it('search messages with full body exercises extractBody branches', async () => {
        globalThis.fetch = vi.fn(async (url) => {
            const u = String(url);
            const m = u.match(/\/messages\/([^/?]+)\?format=full/);
            if (m) {
                const id = m[1];
                const payloads: Record<string, unknown> = {
                    p1: { mimeType: 'text/plain', body: { data: b64('plain') } },
                    h1: { mimeType: 'text/html', body: { data: b64('html') } },
                    pd: { mimeType: 'text/plain' },
                    hd: { mimeType: 'text/html' },
                    pp: {
                        mimeType: 'multipart/mixed',
                        parts: [{ mimeType: 'text/plain', body: { data: b64('part-plain') } }],
                    },
                    ph: {
                        mimeType: 'multipart/mixed',
                        parts: [{ mimeType: 'text/html', body: { data: b64('part-html') } }],
                    },
                    pn: {
                        mimeType: 'multipart/mixed',
                        parts: [{ mimeType: 'text/calendar', body: { data: b64('x') } }],
                    },
                    none: { mimeType: 'application/json' },
                };
                return json({ id, threadId: `t-${id}`, payload: payloads[id] ?? { mimeType: 'text/plain', body: { data: b64('x') } } });
            }
            const ids = ['p1', 'h1', 'pd', 'hd', 'pp', 'ph', 'pn', 'none'];
            return json({ messages: ids.map((id) => ({ id, threadId: `t-${id}` })) });
        }) as typeof fetch;

        const r = await new GmailSearchMessagesTool(cfg).execute({ query: 'q', includeBody: true }, ctx());
        expect(r.data?.count).toBe(8);
    });

    it('search messages metadata (no body) + error path', async () => {
        globalThis.fetch = vi.fn(async (url) => {
            const u = String(url);
            if (u.includes('format=metadata')) {
                return json({
                    id: 'm1', threadId: 'th1',
                    payload: {
                        headers: [
                            { name: 'From', value: 's@x' },
                            { name: 'To', value: 'a@x' },
                            { name: 'Date', value: 'd' },
                        ],
                    },
                });
            }
            return json({ messages: [{ id: 'm1', threadId: 'th1' }] });
        }) as typeof fetch;
        const r = await new GmailSearchMessagesTool(cfg).execute({ query: 'q', includeBody: false }, ctx());
        expect(r.data?.count).toBe(1);

        // empty list -> `(list.messages ?? [])` right side; maxResults Undefined via direct perform
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        const empty = await new GmailSearchMessagesTool(cfg).execute({ query: 'q' }, ctx());
        expect(empty.data?.count).toBe(0);
        expect(await perform(new GmailSearchMessagesTool(cfg), { query: 'q' })).toMatchObject({ messages: [], count: 0 });

        // detail message without payload -> `?? {}` right side
        globalThis.fetch = vi.fn(async (url) => {
            if (String(url).includes('format=metadata')) {
                return json({ id: 'm1' });
            }
            return json({ messages: [{ id: 'm1' }] });
        }) as typeof fetch;
        const noPayload = await new GmailSearchMessagesTool(cfg).execute({ query: 'q', includeBody: true }, ctx());
        expect(noPayload.data?.count).toBe(1);

        globalThis.fetch = vi.fn(async () => new Response('x', { status: 500 })) as typeof fetch;
        const bad = await new GmailSearchMessagesTool(cfg).execute({ query: 'q' }, ctx());
        expect(bad.success).toBe(false);
        expect(bad.error?.message).toMatch(/Gmail API 500/);
    });

    it('toolkit exposes 6 tools', () => {
        expect(new GmailToolkit(cfg).tools).toHaveLength(6);
        expect(new GmailToolkit().tools).toHaveLength(6);
    });
});

describe('Resend tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('send email success branches', async () => {
        globalThis.fetch = vi.fn(async (url, init) => {
            if (String(url).endsWith('/emails') && init?.method === 'POST') {
                return json({ id: 're_1', from: 'cfg@x.com', to: ['a@b.com'], createdAt: 'now' });
            }
            return json({ id: 're_1', status: 'delivered' });
        }) as typeof fetch;

        const a = await new ResendSendEmailTool({ apiKey: 'k', from: 'cfg@x.com' }).execute({
            to: 'a@b.com', subject: 's', html: '<b>h</b>', text: 't',
            cc: 'c@x.com', bcc: 'b@x.com', replyTo: 'r@x.com', tags: [{ name: 'campaign', value: 'v1' }],
        }, ctx());
        expect(a.data).toMatchObject({ id: 're_1', from: 'cfg@x.com' });

        const b = await new ResendSendEmailTool({ apiKey: 'k' }).execute({
            to: ['a@b.com', 'c@d.com'], from: 'in@x.com', subject: 's', text: 't',
        }, ctx());
        expect(b.success).toBe(true);

        // cc/bcc as arrays -> Array.isArray left branch
        const d = await new ResendSendEmailTool({ apiKey: 'k', from: 'cfg@x.com' }).execute({
            to: ['a@b.com'], subject: 's', text: 't', cc: ['c1@x.com', 'c2@x.com'], bcc: ['b1@x.com'],
        }, ctx());
        expect(d.success).toBe(true);

        const prev = process.env['RESEND_FROM_EMAIL'];
        process.env['RESEND_FROM_EMAIL'] = 'env@x.com';
        const c = await new ResendSendEmailTool({ apiKey: 'k' }).execute({ to: 'a@b.com', subject: 's', text: 't' }, ctx());
        expect(c.success).toBe(true);
        if (prev !== undefined) process.env['RESEND_FROM_EMAIL'] = prev;
        else delete process.env['RESEND_FROM_EMAIL'];
    });

    it('missing from / missing key paths', async () => {
        const prevFrom = process.env['RESEND_FROM_EMAIL'];
        const prevKey = process.env['RESEND_API_KEY'];
        delete process.env['RESEND_FROM_EMAIL'];
        delete process.env['RESEND_API_KEY'];
        const noFrom = await new ResendSendEmailTool({ apiKey: 'k' }).execute({ to: 'a@b.com', subject: 's', text: 't' }, ctx());
        expect(noFrom.success).toBe(false);
        expect(noFrom.error?.message).toMatch(/requires a from address/);

        const noKey = await new ResendSendEmailTool({ from: 'f@x.com' }).execute({ to: 'a@b.com', subject: 's', text: 't' }, ctx());
        expect(noKey.success).toBe(false);
        expect(noKey.error?.message).toMatch(/RESEND_API_KEY/);
        if (prevFrom !== undefined) process.env['RESEND_FROM_EMAIL'] = prevFrom;
        if (prevKey !== undefined) process.env['RESEND_API_KEY'] = prevKey;
    });

    it('env key + get email + error + toolkit', async () => {
        globalThis.fetch = vi.fn(async (url, init) => {
            if (String(url).endsWith('/emails') && init?.method === 'POST') {
                return json({ id: 're_2', from: 'f@x.com', to: ['a@b.com'], createdAt: 'now' });
            }
            return json({ id: 're_1', status: 'delivered' });
        }) as typeof fetch;

        const prev = process.env['RESEND_API_KEY'];
        process.env['RESEND_API_KEY'] = 'envk';
        const envKey = await new ResendSendEmailTool({ from: 'f@x.com' }).execute({ to: 'a@b.com', subject: 's', text: 't' }, ctx());
        expect(envKey.success).toBe(true);
        if (prev !== undefined) process.env['RESEND_API_KEY'] = prev;
        else delete process.env['RESEND_API_KEY'];

        const kit = new ResendToolkit({ apiKey: 'k', from: 'f@x.com' });
        expect(kit.getTools()).toHaveLength(2);
        const got = await kit.getEmail.execute({ emailId: 're_1' }, ctx());
        expect(got.data).toMatchObject({ id: 're_1' });

        globalThis.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as typeof fetch;
        const badSend = await new ResendSendEmailTool({ apiKey: 'k', from: 'f@x.com' }).execute(
            { to: 'a@b.com', subject: 's', text: 't' }, ctx(),
        );
        expect(badSend.success).toBe(false);
        expect(badSend.error?.message).toMatch(/Resend API 500/);

        const badGet = await new ResendGetEmailTool({ apiKey: 'k' }).execute({ emailId: 'x' }, ctx());
        expect(badGet.success).toBe(false);
    });
});

describe('Slack tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('constructors require a token', () => {
        const prev = process.env['SLACK_TOKEN'];
        delete process.env['SLACK_TOKEN'];
        expect(() => new SlackSendMessageTool({})).toThrow(/Slack token is required/);
        expect(() => new SlackListChannelsTool({})).toThrow(/Slack token is required/);
        expect(() => new SlackGetChannelHistoryTool({})).toThrow(/Slack token is required/);
        if (prev !== undefined) process.env['SLACK_TOKEN'] = prev;
    });

    it('send message success/error/catch branches', async () => {
        const tool = new SlackSendMessageTool({ token: 'tok', name: 'send', description: 'd', category: 'api' as never });

        globalThis.fetch = vi.fn(async () => json({ ok: true, channel: 'C1', ts: '123', message: {} })) as typeof fetch;
        const ok = await tool.execute({ channel: 'C1', text: 'hi', thread_ts: '123' }, ctx());
        expect(ok.success).toBe(true);
        expect(ok.data?.data).toMatchObject({ channel: 'C1', ts: '123' });

        const okNoThread = await tool.execute({ channel: 'C1', text: 'hi' }, ctx());
        expect(okNoThread.success).toBe(true);

        globalThis.fetch = vi.fn(async () => json({ ok: false, error: 'channel_not_found' })) as typeof fetch;
        const apiErr = await tool.execute({ channel: 'C1', text: 'hi' }, ctx());
        expect(apiErr.data?.success).toBe(false);
        expect(apiErr.data?.error).toBe('channel_not_found');

        globalThis.fetch = vi.fn(async () => json({ ok: false })) as typeof fetch;
        const apiErrDefault = await tool.execute({ channel: 'C1', text: 'hi' }, ctx());
        expect(apiErrDefault.data?.error).toBe('Unknown Slack API error');

        globalThis.fetch = vi.fn(async () => {
            throw new Error('network down');
        }) as typeof fetch;
        const netErr = await tool.execute({ channel: 'C1', text: 'hi' }, ctx());
        expect(netErr.data?.error).toBe('network down');

        globalThis.fetch = vi.fn(async () => {
            throw 'raw';
        }) as typeof fetch;
        const rawErr = await tool.execute({ channel: 'C1', text: 'hi' }, ctx());
        expect(rawErr.data?.error).toBe('Unknown error occurred');
    });

    it('list channels ok/empty/error', async () => {
        const tool = new SlackListChannelsTool({ token: 'tok' });

        globalThis.fetch = vi.fn(async () => json({ ok: true, channels: [{ id: 'C1', name: 'general' }] })) as typeof fetch;
        const ok = await tool.execute({ limit: 10 }, ctx());
        expect(ok.data?.data).toEqual([{ id: 'C1', name: 'general' }]);

        globalThis.fetch = vi.fn(async () => json({ ok: true })) as typeof fetch;
        const empty = await tool.execute({}, ctx());
        expect(empty.data?.data).toEqual([]);

        globalThis.fetch = vi.fn(async () => json({ ok: false })) as typeof fetch;
        const err = await tool.execute({}, ctx());
        expect(err.data?.success).toBe(false);

        globalThis.fetch = vi.fn(async () => {
            throw new Error('net');
        }) as typeof fetch;
        const fail = await tool.execute({}, ctx());
        expect(fail.data?.success).toBe(false);

        globalThis.fetch = vi.fn(async () => {
            throw 'raw';
        }) as typeof fetch;
        const rawErr = await tool.execute({}, ctx());
        expect(rawErr.data?.error).toBe('Unknown error occurred');
    });

    it('channel history message mapping + error', async () => {
        const tool = new SlackGetChannelHistoryTool({ token: 'tok' });

        globalThis.fetch = vi.fn(async () => json({
            ok: true,
            messages: [
                { text: 'a', user: 'u1', ts: '1', subtype: 'bot_message', attachments: [{ title: 'x' }] },
                { text: 'b', ts: '2' },
                { text: 'c', bot_id: 'B', ts: '3' },
            ],
        })) as typeof fetch;
        const ok = await tool.execute({ channel: 'C1', limit: 10 }, ctx());
        expect(ok.data?.data[0]).toMatchObject({ text: 'a', user: 'u1', subtype: 'bot_message' });
        expect(ok.data?.data[1]).toMatchObject({ user: 'unknown', subtype: 'normal' });
        expect(ok.data?.data[2]?.user).toBe('bot');

        globalThis.fetch = vi.fn(async () => json({ ok: true })) as typeof fetch;
        const empty = await tool.execute({ channel: 'C1' }, ctx());
        expect(empty.data?.data).toEqual([]);

        globalThis.fetch = vi.fn(async () => json({ ok: false, error: 'no_channel' })) as typeof fetch;
        const err = await tool.execute({ channel: 'C1' }, ctx());
        expect(err.data?.error).toBe('no_channel');

        globalThis.fetch = vi.fn(async () => json({ ok: false })) as typeof fetch;
        const errNoDetail = await tool.execute({ channel: 'C1' }, ctx());
        expect(errNoDetail.data?.error).toBe('Unknown Slack API error');

        globalThis.fetch = vi.fn(async () => {
            throw new Error('net');
        }) as typeof fetch;
        const fail = await tool.execute({ channel: 'C1' }, ctx());
        expect(fail.data?.success).toBe(false);

        globalThis.fetch = vi.fn(async () => {
            throw 'raw';
        }) as typeof fetch;
        const rawErr = await tool.execute({ channel: 'C1' }, ctx());
        expect(rawErr.data?.error).toBe('Unknown error occurred');
    });

    it('toolkit create variants', () => {
        const prev = process.env['SLACK_TOKEN'];
        process.env['SLACK_TOKEN'] = 'envtok';
        // no options -> env token (covers options?. short-circuits)
        expect(SlackToolkit.create()).toHaveLength(3);
        expect(SlackToolkit.create({})).toHaveLength(3);
        expect(SlackToolkit.create({ token: 't' }).every((t) => t.name.length > 0)).toBe(true);
        expect(SlackToolkit.create({ enableSendMessage: false })).toHaveLength(2);
        expect(SlackToolkit.create({ enableListChannels: false })).toHaveLength(2);
        expect(SlackToolkit.create({ enableGetHistory: false })).toHaveLength(2);
        if (prev !== undefined) process.env['SLACK_TOKEN'] = prev;
        else delete process.env['SLACK_TOKEN'];
    });
});

describe('Telegram tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('constructor requires a token', () => {
        const prev = process.env['TELEGRAM_TOKEN'];
        delete process.env['TELEGRAM_TOKEN'];
        expect(() => new TelegramTool({})).toThrow(/Telegram token is required/);
        if (prev !== undefined) process.env['TELEGRAM_TOKEN'] = prev;
    });

    it('chat id missing / ok / error / catch branches', async () => {
        const tool = new TelegramTool({ token: 'tok', chatId: 'default_chat' });

        // default chat id used
        globalThis.fetch = vi.fn(async () => json({ ok: true, result: { message_id: 1 } })) as typeof fetch;
        const ok = await tool.execute({ message: 'hi' }, ctx());
        expect(ok.data?.success).toBe(true);
        expect(ok.data?.response).toEqual({ message_id: 1 });

        // chat_id override + parse_mode
        const override = await tool.execute({ message: 'hi', chat_id: 'alt', parse_mode: 'HTML' }, ctx());
        expect(override.data?.success).toBe(true);

        // missing chat entirely
        const prevChat = process.env['TELEGRAM_CHAT_ID'];
        delete process.env['TELEGRAM_CHAT_ID'];
        const noChat = await new TelegramTool({ token: 'tok' }).execute({ message: 'hi' }, ctx());
        expect(noChat.data?.success).toBe(false);
        if (prevChat !== undefined) process.env['TELEGRAM_CHAT_ID'] = prevChat;

        // API error with description
        globalThis.fetch = vi.fn(async () => json({ ok: false, description: 'bad chat' })) as typeof fetch;
        const apiErr = await tool.execute({ message: 'x', chat_id: 'c' }, ctx());
        expect(apiErr.data?.success).toBe(false);
        expect(apiErr.data?.error).toBe('bad chat');

        // API error without description
        globalThis.fetch = vi.fn(async () => json({ ok: false })) as typeof fetch;
        const apiErrDefault = await tool.execute({ message: 'x', chat_id: 'c' }, ctx());
        expect(apiErrDefault.data?.error).toBe('Unknown error from Telegram API');

        // network Error
        globalThis.fetch = vi.fn(async () => {
            throw new Error('network down');
        }) as typeof fetch;
        const netErr = await tool.execute({ message: 'x', chat_id: 'c' }, ctx());
        expect(netErr.data?.success).toBe(false);
        expect(netErr.data?.error).toBe('network down');

        // non-Error throw
        globalThis.fetch = vi.fn(async () => {
            throw 'raw';
        }) as typeof fetch;
        const rawErr = await tool.execute({ message: 'x', chat_id: 'c' }, ctx());
        expect(rawErr.data?.error).toBe('Unknown error occurred');
    });

    it('token from env + custom config names', async () => {
        const prevToken = process.env['TELEGRAM_TOKEN'];
        const prevChat = process.env['TELEGRAM_CHAT_ID'];
        process.env['TELEGRAM_TOKEN'] = 'envtok';
        process.env['TELEGRAM_CHAT_ID'] = 'envchat';

        globalThis.fetch = vi.fn(async () => json({ ok: true, result: {} })) as typeof fetch;
        const tool = new TelegramTool();
        expect(tool.name).toBe('telegram_send_message');
        expect((await tool.execute({ message: 'hi' }, ctx())).data?.success).toBe(true);

        const named = new TelegramTool({ name: 'tg', description: 'd', category: 'api' as never, token: 'tok2' });
        expect(named.name).toBe('tg');

        if (prevToken !== undefined) process.env['TELEGRAM_TOKEN'] = prevToken;
        else delete process.env['TELEGRAM_TOKEN'];
        if (prevChat !== undefined) process.env['TELEGRAM_CHAT_ID'] = prevChat;
        else delete process.env['TELEGRAM_CHAT_ID'];
    });

    it('toolkit create variants', () => {
        const prevToken = process.env['TELEGRAM_TOKEN'];
        const prevChat = process.env['TELEGRAM_CHAT_ID'];
        process.env['TELEGRAM_TOKEN'] = 'envtok';
        process.env['TELEGRAM_CHAT_ID'] = 'envchat';

        expect(TelegramToolkit.create({ token: 't', chatId: 'c' })).toHaveLength(1);
        expect(TelegramToolkit.create({})).toHaveLength(1);

        if (prevToken !== undefined) process.env['TELEGRAM_TOKEN'] = prevToken;
        else delete process.env['TELEGRAM_TOKEN'];
        if (prevChat !== undefined) process.env['TELEGRAM_CHAT_ID'] = prevChat;
        else delete process.env['TELEGRAM_CHAT_ID'];
    });
});

describe('Twilio tools', () => {
    it('requires account sid and auth token', async () => {
        const sid = process.env['TWILIO_ACCOUNT_SID'];
        const tok = process.env['TWILIO_AUTH_TOKEN'];
        delete process.env['TWILIO_ACCOUNT_SID'];
        delete process.env['TWILIO_AUTH_TOKEN'];
        const noSid = await new TwilioSendSmsTool({}).execute({ to: '+1', body: 'hi' }, ctx());
        expect(noSid.success).toBe(false);
        expect(noSid.error?.message).toMatch(/TWILIO_ACCOUNT_SID/);
        if (sid !== undefined) process.env['TWILIO_ACCOUNT_SID'] = sid;

        process.env['TWILIO_ACCOUNT_SID'] = 'ACx';
        const noTok = await new TwilioMakeCallTool({}).execute({ to: '+1', twiml: '<Response/>' }, ctx());
        expect(noTok.success).toBe(false);
        expect(noTok.error?.message).toMatch(/TWILIO_AUTH_TOKEN/);
        if (tok !== undefined) process.env['TWILIO_AUTH_TOKEN'] = tok;
        else delete process.env['TWILIO_ACCOUNT_SID'];
    });

    it('send sms + make call success branches', async () => {
        const cfg = { accountSid: 'ACx', authToken: 'tok', fromNumber: '+1555' };

        expect((await new TwilioSendSmsTool(cfg).execute({ to: '+1999', body: 'hi' }, ctx())).data).toMatchObject({ sid: 'SM1', status: 'queued', to: '+1999' });
        // input.from override
        const withFrom = await new TwilioSendSmsTool({ accountSid: 'ACx', authToken: 'tok' }).execute(
            { to: '+1999', body: 'hi', from: '+1777' }, ctx(),
        );
        expect(withFrom.data?.to).toBe('+1999');

        expect((await new TwilioMakeCallTool(cfg).execute({ to: '+1999', twiml: '<Response/>' }, ctx())).data).toMatchObject({ sid: 'CA1', status: 'ringing', to: '+1999' });
        const callFrom = await new TwilioMakeCallTool({ accountSid: 'ACx', authToken: 'tok' }).execute(
            { to: '+1999', twiml: '<Response/>', from: '+1666' }, ctx(),
        );
        expect(callFrom.data?.sid).toBe('CA1');

        // env from number fallback
        const prevFrom = process.env['TWILIO_FROM_NUMBER'];
        process.env['TWILIO_FROM_NUMBER'] = '+1444';
        const envFrom = await new TwilioSendSmsTool({ accountSid: 'ACx', authToken: 'tok' }).execute({ to: '+1999', body: 'hi' }, ctx());
        expect(envFrom.data?.to).toBe('+1999');
        if (prevFrom !== undefined) process.env['TWILIO_FROM_NUMBER'] = prevFrom;
        else delete process.env['TWILIO_FROM_NUMBER'];

        expect(new TwilioToolkit(cfg).tools).toHaveLength(2);
        expect(new TwilioToolkit().tools).toHaveLength(2);
    });

    it('sdk throws are graceful', async () => {
        const throwing = {
            messages: { create: vi.fn(async () => { throw new Error('twilio boom'); }) },
            calls: { create: vi.fn(async () => { throw new Error('call boom'); }) },
        };
        fakeTwilio.mockReturnValueOnce(throwing).mockReturnValueOnce(throwing);
        const sms = await new TwilioSendSmsTool({ accountSid: 'ACx', authToken: 'tok' }).execute({ to: '+1', body: 'hi' }, ctx());
        expect(sms.success).toBe(false);
        expect(sms.error?.message).toMatch(/twilio boom/);

        const call = await new TwilioMakeCallTool({ accountSid: 'ACx', authToken: 'tok' }).execute({ to: '+1', twiml: '<Response/>' }, ctx());
        expect(call.success).toBe(false);
        expect(call.error?.message).toMatch(/call boom/);
    });
});

describe('Webex tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });
    const cfg = { accessToken: 'wtok' };

    it('requires an access token', async () => {
        const prev = process.env['WEBEX_ACCESS_TOKEN'];
        delete process.env['WEBEX_ACCESS_TOKEN'];
        const r = await new WebexSendMessageTool({}).execute({ roomId: 'r1', text: 'hi' }, ctx());
        expect(r.success).toBe(false);
        expect(r.error?.message).toMatch(/WEBEX_ACCESS_TOKEN/);
        if (prev !== undefined) process.env['WEBEX_ACCESS_TOKEN'] = prev;
    });

    it('send message (roomId / toPersonEmail) + missing-target error', async () => {
        globalThis.fetch = vi.fn(async () => json({ id: 'msg1' })) as typeof fetch;
        const room = await new WebexSendMessageTool(cfg).execute({ roomId: 'r1', text: 'hi', markdown: '# hi' }, ctx());
        expect(room.success).toBe(true);

        const person = await new WebexSendMessageTool(cfg).execute({ toPersonEmail: 'p@x.com', text: 'hi' }, ctx());
        expect(person.success).toBe(true);

        const noTarget = await new WebexSendMessageTool(cfg).execute({ text: 'hi' }, ctx());
        expect(noTarget.success).toBe(false);
        expect(noTarget.error?.message).toMatch(/roomId or toPersonEmail/);
    });

    it('list rooms / get messages / create room + 204 + error', async () => {
        globalThis.fetch = vi.fn(async (url) => {
            if (String(url).includes('/rooms') && String(url).includes('?')) {
                return json({ items: [{ id: 'r1', title: 'T' }] });
            }
            return json({ items: [{ id: 'm1', text: 'hi' }] });
        }) as typeof fetch;
        const rooms = await new WebexListRoomsTool(cfg).execute({ type: 'direct', max: 10 }, ctx());
        expect(rooms.success).toBe(true);
        expect(await new WebexListRoomsTool(cfg).execute({}, ctx())).toMatchObject({ success: true });

        const msgs = await new WebexGetMessagesTool(cfg).execute({
            roomId: 'r1', max: 5, before: '2024-01-01', mentionedPeople: 'p1',
        }, ctx());
        expect(msgs.data?.items[0]).toMatchObject({ id: 'm1' });
        expect(await new WebexGetMessagesTool(cfg).execute({ roomId: 'r1' }, ctx())).toMatchObject({ success: true });

        globalThis.fetch = vi.fn(async () => json({ id: 'room1', title: 'New', isLocked: true })) as typeof fetch;
        const created = await new WebexCreateRoomTool(cfg).execute({ title: 'New', isLocked: true }, ctx());
        expect(created.data?.id).toBe('room1');

        // 204 -> webexRequest returns { success: true }
        globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch;
        expect((await new WebexListRoomsTool(cfg).execute({}, ctx())).data).toEqual({ success: true });

        // !ok -> throw
        globalThis.fetch = vi.fn(async () => new Response('nope', { status: 403 })) as typeof fetch;
        const err = await new WebexSendMessageTool(cfg).execute({ roomId: 'r1', text: 'hi' }, ctx());
        expect(err.success).toBe(false);
        expect(err.error?.message).toMatch(/Webex API 403/);

        expect(new WebexToolkit(cfg).getTools()).toHaveLength(4);
        expect(new WebexToolkit().getTools()).toHaveLength(4);
    });
});

describe('WhatsApp tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });
    const cfg = { accessToken: 'wt', phoneNumberId: 'ph' };

    it('requires token and phone number id', async () => {
        const prevTok = process.env['WHATSAPP_TOKEN'];
        const prevPh = process.env['WHATSAPP_PHONE_NUMBER_ID'];
        delete process.env['WHATSAPP_TOKEN'];
        delete process.env['WHATSAPP_PHONE_NUMBER_ID'];
        const noTok = await new WhatsAppSendTextTool({}).execute({ to: '+1', message: 'hi' }, ctx());
        expect(noTok.success).toBe(false);
        expect(noTok.error?.message).toMatch(/WHATSAPP_TOKEN/);
        if (prevTok !== undefined) process.env['WHATSAPP_TOKEN'] = prevTok;

        process.env['WHATSAPP_TOKEN'] = 'wt';
        const noPh = await new WhatsAppSendTextTool({}).execute({ to: '+1', message: 'hi' }, ctx());
        expect(noPh.success).toBe(false);
        expect(noPh.error?.message).toMatch(/WHATSAPP_PHONE_NUMBER_ID/);
        if (prevPh !== undefined) process.env['WHATSAPP_PHONE_NUMBER_ID'] = prevPh;
        else delete process.env['WHATSAPP_TOKEN'];
    });

    it('send text / template / image + optional branches', async () => {
        globalThis.fetch = vi.fn(async () => json({ messages: [{ id: 'wamid' }] })) as typeof fetch;

        expect((await new WhatsAppSendTextTool(cfg).execute({ to: '+1', message: 'hi', previewUrl: true }, ctx())).success).toBe(true);
        expect((await new WhatsAppSendTextTool(cfg).execute({ to: '+1', message: 'hi' }, ctx())).success).toBe(true);

        const tmpl = await new WhatsAppSendTemplateTool(cfg).execute({
            to: '+1', templateName: 'welcome', languageCode: 'en_US',
            components: [{ type: 'body', parameters: [{ type: 'text', text: 'x' }] }],
        }, ctx());
        expect(tmpl.success).toBe(true);
        expect((await new WhatsAppSendTemplateTool(cfg).execute({ to: '+1', templateName: 'welcome' }, ctx())).success).toBe(true);

        const img = await new WhatsAppSendImageTool(cfg).execute({
            to: '+1', imageUrl: 'https://x.com/i.png', caption: 'cap',
        }, ctx());
        expect(img.success).toBe(true);
        expect((await new WhatsAppSendImageTool(cfg).execute({ to: '+1', imageUrl: 'https://x.com/i.png' }, ctx())).success).toBe(true);

        // direct performExecute on defaulted fields
        expect(await perform(new WhatsAppSendTextTool(cfg), { to: '+1', message: 'hi', previewUrl: undefined })).toMatchObject({ messages: expect.any(Array) });
        expect(await perform(new WhatsAppSendTemplateTool(cfg), { to: '+1', templateName: 'welcome', languageCode: undefined, components: undefined })).toMatchObject({ messages: expect.any(Array) });
        expect(await perform(new WhatsAppSendImageTool(cfg), { to: '+1', imageUrl: 'https://x.com/i.png', caption: undefined })).toMatchObject({ messages: expect.any(Array) });

        expect(new WhatsAppToolkit(cfg).getTools()).toHaveLength(3);
        expect(new WhatsAppToolkit().getTools()).toHaveLength(3);
    });

    it('API error path', async () => {
        globalThis.fetch = vi.fn(async () => new Response('nope', { status: 400 })) as typeof fetch;
        const err = await new WhatsAppSendTextTool(cfg).execute({ to: '+1', message: 'hi' }, ctx());
        expect(err.success).toBe(false);
        expect(err.error?.message).toMatch(/WhatsApp API 400/);
    });
});

describe('Zoom tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });
    const cfg = { accessToken: 'ztok' };

    it('token resolution: direct / env / oauth / missing', async () => {
        globalThis.fetch = vi.fn(async (url) => {
            if (String(url).includes('zoom.us/oauth/token')) return json({ access_token: 'oa' });
            return json({ id: 123, topic: 'T' });
        }) as typeof fetch;

        const direct = await new ZoomCreateMeetingTool(cfg).execute({ topic: 'T' }, ctx());
        expect(direct.success).toBe(true);

        const prev = process.env['ZOOM_ACCESS_TOKEN'];
        process.env['ZOOM_ACCESS_TOKEN'] = 'envztok';
        const envTok = await new ZoomGetMeetingTool({}).execute({ meetingId: '123' }, ctx());
        expect(envTok.success).toBe(true);
        if (prev !== undefined) process.env['ZOOM_ACCESS_TOKEN'] = prev;
        else delete process.env['ZOOM_ACCESS_TOKEN'];

        const oauth = await new ZoomListMeetingsTool({
            accountId: 'acc', clientId: 'cid', clientSecret: 'sec',
        }).execute({}, ctx());
        expect(oauth.success).toBe(true);

        // missing credentials
        const badEnvVars: Array<keyof NodeJS.ProcessEnv> = [
            'ZOOM_ACCESS_TOKEN', 'ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET',
        ];
        const saved = new Map<string, string>();
        for (const k of badEnvVars) {
            saved.set(k, process.env[k] ?? '');
            delete process.env[k];
        }
        const missing = await new ZoomCreateMeetingTool({}).execute({ topic: 'T' }, ctx());
        expect(missing.success).toBe(false);
        expect(missing.error?.message).toMatch(/ZoomTools require/);

        // partial credentials -> still missing
        const partial1 = await new ZoomCreateMeetingTool({ accountId: 'a' }).execute({ topic: 'T' }, ctx());
        expect(partial1.success).toBe(false);
        const partial2 = await new ZoomCreateMeetingTool({ accountId: 'a', clientId: 'c' }).execute({ topic: 'T' }, ctx());
        expect(partial2.success).toBe(false);
        for (const [k, v] of saved) {
            if (v) process.env[k] = v;
        }
    });

    it('oauth failure path', async () => {
        globalThis.fetch = vi.fn(async () => new Response('nope', { status: 401 })) as typeof fetch;
        const err = await new ZoomCreateMeetingTool({
            accountId: 'acc', clientId: 'cid', clientSecret: 'sec',
        }).execute({ topic: 'T' }, ctx());
        expect(err.success).toBe(false);
        expect(err.error?.message).toMatch(/Zoom OAuth 401/);
    });

    it('zoom API error path', async () => {
        globalThis.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as typeof fetch;
        const err = await new ZoomGetMeetingTool(cfg).execute({ meetingId: '123' }, ctx());
        expect(err.success).toBe(false);
        expect(err.error?.message).toMatch(/Zoom API 500/);
    });

    it('create/get/list/delete success + defaulted-field branches', async () => {
        globalThis.fetch = vi.fn(async (url, init) => {
            const u = String(url);
            const method = (init?.method ?? 'GET').toUpperCase();
            if (method === 'DELETE') return new Response(null, { status: 204 });
            if (u.includes('/users/me/meetings?') || u.includes('/users/me/meetings')) {
                return json({ id: 999, join_url: 'https://zoom.us/j/999' });
            }
            return json({ id: '123', topic: 'T', status: 'waiting' });
        }) as typeof fetch;

        const withStart = await new ZoomCreateMeetingTool(cfg).execute({
            topic: 'T', startTime: '2024-01-01T10:00:00', duration: 30, timezone: 'UTC',
            agenda: 'a', password: 'pw', hostVideo: false, participantVideo: true,
            waitingRoom: false, muteUponEntry: false,
        }, ctx());
        expect(withStart.data).toMatchObject({ id: 999 });

        const instant = await new ZoomCreateMeetingTool(cfg).execute({ topic: 'T' }, ctx());
        expect(instant.success).toBe(true);

        const got = await new ZoomGetMeetingTool(cfg).execute({ meetingId: '123' }, ctx());
        expect(got.data).toMatchObject({ id: '123' });

        const listed = await new ZoomListMeetingsTool(cfg).execute({ type: 'live', pageSize: 5 }, ctx());
        expect(listed.data).toMatchObject({ id: 999 });
        expect(await new ZoomListMeetingsTool(cfg).execute({}, ctx())).toMatchObject({ success: true });

        const del = await new ZoomDeleteMeetingTool(cfg).execute({ meetingId: '123' }, ctx());
        expect(del.data).toEqual({ success: true });

        // direct performExecute on defaulted fields
        expect(await perform(new ZoomCreateMeetingTool(cfg), {
            topic: 'T', duration: undefined, timezone: undefined, hostVideo: undefined,
            participantVideo: undefined, waitingRoom: undefined, muteUponEntry: undefined,
        })).toMatchObject({ id: 999 });
        expect(await perform(new ZoomListMeetingsTool(cfg), { type: undefined, pageSize: undefined })).toMatchObject({ id: 999 });
        expect(await perform(new ZoomGetMeetingTool(cfg), { meetingId: 456 })).toMatchObject({ id: '123' });

        expect(new ZoomToolkit(cfg).getTools()).toHaveLength(4);
        expect(new ZoomToolkit().getTools()).toHaveLength(4);
    });
});
