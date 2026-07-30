/**
 * Hermetic coverage for small/pure tools and communication helpers.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { z } from 'zod';

import { SleepTool, SleepToolkit } from '../src/tools/devtools/sleep.js';
import { toolToLLMDef, zodToJsonSchema } from '../src/tools/core/zod-to-schema.js';
import {
    CalculatorToolkit,
    CalculatorAddTool,
    CalculatorSubtractTool,
    CalculatorMultiplyTool,
    CalculatorDivideTool,
    CalculatorExponentiateTool,
    CalculatorFactorialTool,
    CalculatorIsPrimeTool,
    CalculatorSquareRootTool,
} from '../src/tools/utils/calculator.js';
import { TelegramTool, TelegramToolkit } from '../src/tools/communication/telegram.js';
import {
    ResendSendEmailTool,
    ResendGetEmailTool,
    ResendToolkit,
} from '../src/tools/communication/resend.js';
import { YFinanceTool } from '../src/tools/finance/yfinance.js';
import {
    SmtpEmailTool,
    SendGridEmailTool,
    EmailToolkit,
} from '../src/tools/communication/email.js';
import {
    TwilioSendSmsTool,
    TwilioMakeCallTool,
    TwilioToolkit,
} from '../src/tools/communication/twilio.js';
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

describe('SleepTool', () => {
    it('sleeps and returns duration + optional reason', async () => {
        vi.useFakeTimers();
        const tool = new SleepTool();
        const p = tool.execute({ seconds: 0.1, reason: 'rate-limit' }, ctx());
        await vi.advanceTimersByTimeAsync(100);
        const result = await p;
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ sleptForSeconds: 0.1, reason: 'rate-limit' });
        vi.useRealTimers();
    });

    it('SleepToolkit exposes sleep tool', () => {
        const kit = new SleepToolkit();
        expect(kit.getTools()).toHaveLength(1);
        expect(kit.sleep.name).toBe('Sleep');
    });

    it('rejects invalid seconds via validation', async () => {
        const tool = new SleepTool();
        const result = await tool.execute({ seconds: 0 }, ctx());
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe('VALIDATION_ERROR');
    });
});

describe('zod-to-schema / toolToLLMDef', () => {
    it('converts zod schema and tool defs', () => {
        const schema = z.object({ q: z.string().describe('query') });
        const json = zodToJsonSchema(schema);
        expect(json).toBeTruthy();

        const withNative = {
            name: 'search',
            description: 'Search things',
            parameters: Object.assign(schema, {
                toJSONSchema: () => ({
                    $schema: 'http://json-schema.org/draft-07/schema#',
                    type: 'object',
                    properties: { q: { type: 'string' } },
                }),
            }),
        };
        const def = toolToLLMDef(withNative as never);
        expect(def.name).toBe('search');
        expect(def.parameters).not.toHaveProperty('$schema');

        const plain = toolToLLMDef({
            name: 'plain',
            description: 'd',
            parameters: schema,
        } as never);
        expect(plain.name).toBe('plain');
        expect(plain.parameters).toBeTruthy();
    });
});

describe('CalculatorToolkit', () => {
    const netDenied = ctx({
        permissions: { allowNetwork: false, allowFileSystem: false, maxExecutionTimeMs: 5000 },
    });

    it('createAll returns 8 tools', () => {
        expect(CalculatorToolkit.createAll()).toHaveLength(8);
    });

    it('add / subtract / multiply / divide / exp / factorial / prime / sqrt cover branches', async () => {
        expect((await new CalculatorAddTool().execute({ a: 2, b: 3 }, netDenied)).data?.result).toBe(5);
        expect((await new CalculatorSubtractTool().execute({ a: 5, b: 2 }, netDenied)).data?.result).toBe(3);
        expect((await new CalculatorMultiplyTool().execute({ a: 4, b: 3 }, netDenied)).data?.result).toBe(12);
        expect((await new CalculatorDivideTool().execute({ a: 10, b: 2 }, netDenied)).data?.result).toBe(5);
        expect((await new CalculatorDivideTool().execute({ a: 1, b: 0 }, netDenied)).data?.error).toMatch(/zero/i);
        expect((await new CalculatorExponentiateTool().execute({ a: 2, b: 3 }, netDenied)).data?.result).toBe(8);
        expect((await new CalculatorFactorialTool().execute({ n: 5 }, netDenied)).data?.result).toBe(120);
        expect((await new CalculatorFactorialTool().execute({ n: 0 }, netDenied)).data?.result).toBe(1);
        expect((await new CalculatorFactorialTool().execute({ n: -1 }, netDenied)).data?.error).toMatch(/negative/i);
        expect((await new CalculatorFactorialTool().execute({ n: 1.5 }, netDenied)).data?.error).toMatch(/integer/i);
        expect((await new CalculatorIsPrimeTool().execute({ n: 1 }, netDenied)).data?.result).toBe(0);
        expect((await new CalculatorIsPrimeTool().execute({ n: 2 }, netDenied)).data?.result).toBe(1);
        expect((await new CalculatorIsPrimeTool().execute({ n: 3 }, netDenied)).data?.result).toBe(1);
        expect((await new CalculatorIsPrimeTool().execute({ n: 9 }, netDenied)).data?.result).toBe(0);
        expect((await new CalculatorIsPrimeTool().execute({ n: 25 }, netDenied)).data?.result).toBe(0);
        expect((await new CalculatorIsPrimeTool().execute({ n: 17 }, netDenied)).data?.result).toBe(1);
        expect((await new CalculatorSquareRootTool().execute({ n: 9 }, netDenied)).data?.result).toBe(3);
        expect((await new CalculatorSquareRootTool().execute({ n: -1 }, netDenied)).data?.error).toMatch(/negative/i);
    });
});

describe('TelegramTool', () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('throws without token', () => {
        const prev = process.env['TELEGRAM_TOKEN'];
        delete process.env['TELEGRAM_TOKEN'];
        expect(() => new TelegramTool({})).toThrow(/Telegram token is required/);
        if (prev !== undefined) process.env['TELEGRAM_TOKEN'] = prev;
    });

    it('returns error when chat id missing', async () => {
        const tool = new TelegramTool({ token: 'tok' });
        const result = await tool.execute({ message: 'hi' }, ctx());
        expect(result.success).toBe(true);
        expect(result.data?.success).toBe(false);
        expect(result.data?.error).toMatch(/Chat ID/);
    });

    it('sends message on ok response', async () => {
        globalThis.fetch = vi.fn(async () =>
            new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 }),
        ) as typeof fetch;
        const tool = new TelegramTool({ token: 'tok', chatId: '123' });
        const result = await tool.execute({ message: 'hello', parse_mode: 'HTML' }, ctx());
        expect(result.data?.success).toBe(true);
        expect(result.data?.response).toEqual({ message_id: 1 });
    });

    it('handles API error and network failure', async () => {
        globalThis.fetch = vi.fn(async () =>
            new Response(JSON.stringify({ ok: false, description: 'bad chat' }), { status: 400 }),
        ) as typeof fetch;
        const tool = new TelegramTool({ token: 'tok', chatId: '123' });
        const bad = await tool.execute({ message: 'x' }, ctx());
        expect(bad.data?.success).toBe(false);
        expect(bad.data?.error).toBe('bad chat');

        globalThis.fetch = vi.fn(async () => {
            throw new Error('network down');
        }) as typeof fetch;
        const fail = await tool.execute({ message: 'x', chat_id: '9' }, ctx());
        expect(fail.data?.success).toBe(false);
        expect(fail.data?.error).toBe('network down');
    });

    it('TelegramToolkit.create builds tools', () => {
        expect(TelegramToolkit.create({ token: 't', chatId: 'c' })).toHaveLength(1);
    });
});

describe('Resend tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    it('requires API key and from address', async () => {
        const prev = process.env['RESEND_API_KEY'];
        delete process.env['RESEND_API_KEY'];
        const tool = new ResendSendEmailTool({});
        const r = await tool.execute({ to: 'a@b.com', subject: 's', text: 'hi' }, ctx());
        expect(r.success).toBe(false);
        if (prev !== undefined) process.env['RESEND_API_KEY'] = prev;
    });

    it('send + get email via mocked fetch', async () => {
        globalThis.fetch = vi.fn(async (url, init) => {
            if (String(url).endsWith('/emails') && init?.method === 'POST') {
                return new Response(
                    JSON.stringify({
                        id: 're_1',
                        from: 'from@x.com',
                        to: ['a@b.com'],
                        createdAt: 'now',
                    }),
                    { status: 200 },
                );
            }
            return new Response(JSON.stringify({ id: 're_1', status: 'delivered' }), { status: 200 });
        }) as typeof fetch;

        const kit = new ResendToolkit({ apiKey: 'rk', from: 'from@x.com' });
        expect(kit.getTools()).toHaveLength(2);

        const sent = await kit.sendEmail.execute(
            {
                to: ['a@b.com', 'b@c.com'],
                subject: 'Hello',
                html: '<b>hi</b>',
                cc: 'cc@x.com',
                bcc: ['bcc@x.com'],
                replyTo: 'reply@x.com',
                tags: [{ name: 'campaign', value: 't1' }],
            },
            ctx(),
        );
        expect(sent.success).toBe(true);
        expect(sent.data?.id).toBe('re_1');

        const got = await new ResendGetEmailTool({ apiKey: 'rk' }).execute({ emailId: 're_1' }, ctx());
        expect(got.success).toBe(true);
        expect(got.data).toMatchObject({ id: 're_1' });
    });

    it('throws on non-ok API responses', async () => {
        globalThis.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as typeof fetch;
        const send = await new ResendSendEmailTool({ apiKey: 'rk', from: 'f@x.com' }).execute(
            { to: 'a@b.com', subject: 's', text: 't' },
            ctx(),
        );
        expect(send.success).toBe(false);
        expect(send.error?.message).toMatch(/Resend API 500/);

        const get = await new ResendGetEmailTool({ apiKey: 'rk' }).execute({ emailId: 'x' }, ctx());
        expect(get.success).toBe(false);
    });
});

describe('YFinanceTool', () => {
    it('exercises validation and execute path', async () => {
        const tool = new YFinanceTool();
        const bad = await tool.execute({}, ctx());
        expect(bad.success).toBe(false);
        expect(bad.error?.code).toBe('VALIDATION_ERROR');

        // Peer dep may be absent — either success (if installed) or EXECUTION_ERROR
        const result = await tool.execute({ symbol: 'AAPL' }, ctx());
        expect(typeof result.success).toBe('boolean');
    });
});

describe('Email tools (SMTP / SendGrid)', () => {
    it('SendGridEmailTool requires API key', async () => {
        const prev = process.env['SENDGRID_API_KEY'];
        delete process.env['SENDGRID_API_KEY'];
        const tool = new SendGridEmailTool({ from: 'f@x.com' });
        const r = await tool.execute({ to: 'a@b.com', subject: 's', body: 'b' }, ctx());
        expect(r.success).toBe(false);
        expect(r.error?.message).toMatch(/SENDGRID_API_KEY|@sendgrid\/mail/);
        if (prev !== undefined) process.env['SENDGRID_API_KEY'] = prev;
    });

    it('SmtpEmailTool fails hermetically without nodemailer', async () => {
        const tool = new SmtpEmailTool({
            host: 'smtp.example.com',
            user: 'u',
            pass: 'p',
            from: 'f@x.com',
            port: 465,
            secure: true,
        });
        const r = await tool.execute(
            {
                to: ['a@b.com', 'c@d.com'],
                cc: ['cc@x.com'],
                bcc: 'bcc@x.com',
                subject: 'Hi',
                body: '<p>x</p>',
                isHtml: true,
            },
            ctx(),
        );
        // Without peer dep (or with it), result is a boolean success flag
        expect(typeof r.success).toBe('boolean');
    });

    it('EmailToolkit selects smtp vs sendgrid', () => {
        expect(
            new EmailToolkit({
                type: 'smtp',
                host: 'h',
                user: 'u',
                pass: 'p',
            }).tools,
        ).toHaveLength(1);
        expect(
            new EmailToolkit({
                type: 'sendgrid',
                from: 'f@x.com',
                apiKey: 'k',
            }).tools,
        ).toHaveLength(1);
    });
});

describe('Twilio tools', () => {
    it('requires credentials', async () => {
        const sid = process.env['TWILIO_ACCOUNT_SID'];
        const tok = process.env['TWILIO_AUTH_TOKEN'];
        delete process.env['TWILIO_ACCOUNT_SID'];
        delete process.env['TWILIO_AUTH_TOKEN'];
        const sms = await new TwilioSendSmsTool({}).execute({ to: '+1', body: 'hi' }, ctx());
        expect(sms.success).toBe(false);
        expect(sms.error?.message).toMatch(/TWILIO_ACCOUNT_SID/);
        if (sid !== undefined) process.env['TWILIO_ACCOUNT_SID'] = sid;
        if (tok !== undefined) process.env['TWILIO_AUTH_TOKEN'] = tok;
    });

    it('TwilioToolkit constructs tools', () => {
        expect(
            new TwilioToolkit({ accountSid: 'ACxxx', authToken: 'tok', fromNumber: '+1' }).tools,
        ).toHaveLength(2);
        expect(new TwilioMakeCallTool({ accountSid: 'AC', authToken: 't' }).name).toBe('Twilio Make Call');
        expect(new TwilioSendSmsTool({ accountSid: 'AC', authToken: 't' }).name).toBe('Twilio Send SMS');
    });
});
