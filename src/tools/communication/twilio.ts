/**
 * Twilio tools — send SMS messages and initiate phone calls.
 * Requires: npm install twilio
 * Credentials: https://console.twilio.com
 */

import { z } from 'zod';
import { BaseTool } from '../core/base-tool.js';
import { ToolCategory, type ToolContext } from '../core/types.js';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

export interface TwilioToolConfig {
    accountSid?: string;
    authToken?: string;
    /** Default "from" phone number (Twilio number) */
    fromNumber?: string;
}

interface TwilioClient {
    messages: {
        create(params: object): Promise<{ sid: string; status: string; to: string; body: string }>;
    };
    calls: {
        create(params: object): Promise<{ sid: string; status: string; to: string }>;
    };
}

function getClient(config: TwilioToolConfig): { client: TwilioClient; from: string } {
    const accountSid = config.accountSid ?? process.env['TWILIO_ACCOUNT_SID'];
    const authToken = config.authToken ?? process.env['TWILIO_AUTH_TOKEN'];
    const from = config.fromNumber ?? process.env['TWILIO_FROM_NUMBER'] ?? '';
    if (!accountSid) throw new Error('TwilioTools require TWILIO_ACCOUNT_SID');
    if (!authToken) throw new Error('TwilioTools require TWILIO_AUTH_TOKEN');
    const twilio = _require('twilio') as (sid: string, token: string) => TwilioClient;
    return { client: twilio(accountSid, authToken), from };
}

// ── Schemas ────────────────────────────────────────────────────────────────

const SendSmsSchema = z.object({
    to: z.string().describe('Recipient phone number in E.164 format (e.g. +14155552671)'),
    body: z.string().max(1600).describe('SMS message body (max 1600 chars)'),
    from: z.string().optional().describe('Twilio phone number to send from (overrides config)'),
});

const MakeCallSchema = z.object({
    to: z.string().describe('Recipient phone number in E.164 format'),
    twiml: z.string().describe('TwiML instructions for the call (e.g. "<Response><Say>Hello</Say></Response>")'),
    from: z.string().optional().describe('Twilio phone number to call from (overrides config)'),
});

// ── Tools ──────────────────────────────────────────────────────────────────

export class TwilioSendSmsTool extends BaseTool<typeof SendSmsSchema, { sid: string; status: string; to: string }> {
    constructor(private config: TwilioToolConfig = {}) {
        super({
            id: 'twilio_send_sms',
            name: 'Twilio Send SMS',
            description: 'Send an SMS message via Twilio to any phone number.',
            category: ToolCategory.API,
            parameters: SendSmsSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 15000 },
        });
    }

    protected async performExecute(input: z.infer<typeof SendSmsSchema>, _ctx: ToolContext) {
        const { client, from } = getClient(this.config);
        const result = await client.messages.create({
            to: input.to,
            from: input.from ?? from,
            body: input.body,
        });
        return { sid: result.sid, status: result.status, to: result.to };
    }
}

export class TwilioMakeCallTool extends BaseTool<typeof MakeCallSchema, { sid: string; status: string; to: string }> {
    constructor(private config: TwilioToolConfig = {}) {
        super({
            id: 'twilio_make_call',
            name: 'Twilio Make Call',
            description: 'Initiate a phone call via Twilio with TwiML instructions.',
            category: ToolCategory.API,
            parameters: MakeCallSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 15000 },
        });
    }

    protected async performExecute(input: z.infer<typeof MakeCallSchema>, _ctx: ToolContext) {
        const { client, from } = getClient(this.config);
        const result = await client.calls.create({
            to: input.to,
            from: input.from ?? from,
            twiml: input.twiml,
        });
        return { sid: result.sid, status: result.status, to: result.to };
    }
}

export class TwilioToolkit {
    readonly tools: BaseTool[];
    constructor(config: TwilioToolConfig = {}) {
        this.tools = [new TwilioSendSmsTool(config), new TwilioMakeCallTool(config)];
    }
}
