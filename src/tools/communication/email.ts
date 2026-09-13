/**
 * Email tools — send email via SMTP (nodemailer) or SendGrid.
 * Requires peer dependencies:
 *   SMTP:     npm install nodemailer
 *   SendGrid: npm install @sendgrid/mail
 */

import { z } from 'zod';
import { BaseTool } from '../core/base-tool.js';
import { ToolCategory, type ToolContext } from '../core/types.js';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

// ── Shared schema ──────────────────────────────────────────────────────────

const EmailSchema = z.object({
    to: z.union([z.string(), z.array(z.string())]).describe('Recipient email address(es)'),
    subject: z.string().describe('Email subject'),
    body: z.string().describe('Email body (plain text or HTML)'),
    from: z.string().optional().describe('Sender address (overrides default)'),
    cc: z.union([z.string(), z.array(z.string())]).optional().describe('CC recipients'),
    bcc: z.union([z.string(), z.array(z.string())]).optional().describe('BCC recipients'),
    isHtml: z.boolean().optional().default(false).describe('Treat body as HTML'),
});

type EmailResult = { messageId: string; accepted: string[]; success: boolean };

// ── SMTP ──────────────────────────────────────────────────────────────────

export interface SmtpEmailConfig {
    host: string;
    port?: number;
    secure?: boolean;
    user: string;
    pass: string;
    from?: string;
}

export class SmtpEmailTool extends BaseTool<typeof EmailSchema, EmailResult> {
    constructor(private config: SmtpEmailConfig) {
        super({
            id: 'smtp_send_email',
            name: 'Send Email (SMTP)',
            description: 'Send an email via SMTP using nodemailer. Supports plain text and HTML.',
            category: ToolCategory.API,
            parameters: EmailSchema,
        });
    }
    protected async performExecute(input: z.infer<typeof EmailSchema>, _ctx: ToolContext): Promise<EmailResult> {
        const nodemailer = _require('nodemailer') as {
            createTransport(o: object): { sendMail(o: object): Promise<{ messageId: string; accepted: string[] }> };
        };
        const transporter = nodemailer.createTransport({
            host: this.config.host,
            port: this.config.port ?? 587,
            secure: this.config.secure ?? false,
            auth: { user: this.config.user, pass: this.config.pass },
        });
        const result = await transporter.sendMail({
            from: input.from ?? this.config.from ?? this.config.user,
            to: Array.isArray(input.to) ? input.to.join(', ') : input.to,
            cc: input.cc ? (Array.isArray(input.cc) ? input.cc.join(', ') : input.cc) : undefined,
            bcc: input.bcc ? (Array.isArray(input.bcc) ? input.bcc.join(', ') : input.bcc) : undefined,
            subject: input.subject,
            [input.isHtml ? 'html' : 'text']: input.body,
        });
        return { messageId: result.messageId, accepted: result.accepted, success: true };
    }
}

// ── SendGrid ───────────────────────────────────────────────────────────────

export interface SendGridEmailConfig {
    apiKey?: string;
    from: string;
}

export class SendGridEmailTool extends BaseTool<typeof EmailSchema, EmailResult> {
    constructor(private config: SendGridEmailConfig) {
        super({
            id: 'sendgrid_send_email',
            name: 'Send Email (SendGrid)',
            description: 'Send an email via SendGrid. Supports plain text and HTML.',
            category: ToolCategory.API,
            parameters: EmailSchema,
        });
    }
    protected async performExecute(input: z.infer<typeof EmailSchema>, _ctx: ToolContext): Promise<EmailResult> {
        const sgMail = _require('@sendgrid/mail') as {
            setApiKey(k: string): void;
            send(m: object): Promise<unknown>;
        };
        const apiKey = this.config.apiKey ?? process.env['SENDGRID_API_KEY'];
        if (!apiKey) throw new Error('SendGrid requires SENDGRID_API_KEY');
        sgMail.setApiKey(apiKey);
        await sgMail.send({
            from: input.from ?? this.config.from,
            to: input.to,
            cc: input.cc,
            bcc: input.bcc,
            subject: input.subject,
            [input.isHtml ? 'html' : 'text']: input.body,
        });
        const to = Array.isArray(input.to) ? input.to : [input.to];
        return { messageId: `sg-${Date.now()}`, accepted: to, success: true };
    }
}

// ── Toolkit ────────────────────────────────────────────────────────────────

export class EmailToolkit {
    readonly tools: BaseTool[];
    constructor(config: ({ type: 'smtp' } & SmtpEmailConfig) | ({ type: 'sendgrid' } & SendGridEmailConfig)) {
        this.tools = config.type === 'smtp'
            ? [new SmtpEmailTool(config)]
            : [new SendGridEmailTool(config)];
    }
}
