/**
 * Gmail tools — list, read, send, and manage emails via Gmail API.
 * Requires OAuth2 access token with gmail scopes.
 */

import { z } from 'zod';
import { BaseTool } from '../core/base-tool.js';
import { ToolCategory, type ToolContext } from '../core/types.js';

export interface GmailToolConfig {
    /** OAuth2 access token (or GMAIL_ACCESS_TOKEN env var) */
    accessToken?: string;
}

function getToken(config: GmailToolConfig): string {
    const token = config.accessToken ?? process.env['GMAIL_ACCESS_TOKEN'];
    if (!token) throw new Error('GmailTools require GMAIL_ACCESS_TOKEN');
    return token;
}

async function gmailFetch(token: string, method: string, path: string, body?: object): Promise<unknown> {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`Gmail API ${res.status}: ${await res.text()}`);
    if (res.status === 204) return null;
    return res.json();
}

function decodeBase64Url(s: string): string {
    return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function encodeBase64Url(s: string): string {
    return Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Strip CR/LF so header fields cannot smuggle extra headers (header injection). */
function cleanHeader(value: string): string {
    return value.replace(/[\r\n]+/g, ' ').trim();
}

function buildRawEmail(params: { from?: string; to: string; subject: string; body: string; cc?: string; isHtml?: boolean }): string {
    const lines = [
        `To: ${cleanHeader(params.to)}`,
        params.cc ? `Cc: ${cleanHeader(params.cc)}` : null,
        `Subject: ${cleanHeader(params.subject)}`,
        `Content-Type: ${params.isHtml ? 'text/html' : 'text/plain'}; charset=utf-8`,
        '',
        params.body,
    ].filter(Boolean);
    return encodeBase64Url(lines.join('\r\n'));
}

interface GmailMessage {
    id: string;
    threadId: string;
    subject: string;
    from: string;
    to: string;
    date: string;
    snippet: string;
    body?: string;
    labels: string[];
}

function extractHeader(headers: Array<{ name: string; value: string }>, name: string): string {
    return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function extractBody(payload: Record<string, unknown>): string {
    const mimeType = payload['mimeType'] as string;
    const body = payload['body'] as { data?: string } | undefined;
    const parts = payload['parts'] as Array<Record<string, unknown>> | undefined;

    if (mimeType === 'text/plain' && body?.data) return decodeBase64Url(body.data);
    if (mimeType === 'text/html' && body?.data) return decodeBase64Url(body.data);
    if (parts) {
        const plain = parts.find((p) => (p['mimeType'] as string) === 'text/plain');
        if (plain) return extractBody(plain);
        const html = parts.find((p) => (p['mimeType'] as string) === 'text/html');
        if (html) return extractBody(html);
    }
    return '';
}

// ── Schemas ────────────────────────────────────────────────────────────────

const ListMessagesSchema = z.object({
    query: z.string().optional().describe('Gmail search query (e.g. "from:boss@company.com is:unread")'),
    maxResults: z.number().int().min(1).max(500).optional().default(10),
    labelIds: z.array(z.string()).optional().describe('Filter by label IDs (e.g. ["INBOX", "UNREAD"])'),
    includeSpamTrash: z.boolean().optional().default(false),
});

const GetMessageSchema = z.object({
    messageId: z.string().describe('Gmail message ID'),
    includeBody: z.boolean().optional().default(true),
});

const SendEmailSchema = z.object({
    to: z.string().describe('Recipient email address'),
    subject: z.string(),
    body: z.string().describe('Email body (plain text or HTML)'),
    cc: z.string().optional(),
    isHtml: z.boolean().optional().default(false),
    threadId: z.string().optional().describe('Thread ID to reply to an existing thread'),
});

const ModifyLabelsSchema = z.object({
    messageId: z.string(),
    addLabelIds: z.array(z.string()).optional().describe('Label IDs to add (e.g. ["STARRED"])'),
    removeLabelIds: z.array(z.string()).optional().describe('Label IDs to remove (e.g. ["UNREAD"])'),
});

const TrashMessageSchema = z.object({
    messageId: z.string().describe('Message ID to move to trash'),
});

const SearchMessagesSchema = z.object({
    query: z.string().describe('Gmail search query (supports full Gmail syntax)'),
    maxResults: z.number().int().min(1).max(100).optional().default(10),
    includeBody: z.boolean().optional().default(false),
});

// ── Tools ──────────────────────────────────────────────────────────────────

export class GmailListMessagesTool extends BaseTool<typeof ListMessagesSchema, { messages: GmailMessage[]; count: number }> {
    constructor(private config: GmailToolConfig = {}) {
        super({
            id: 'gmail_list_messages',
            name: 'Gmail List Messages',
            description: 'List Gmail messages with optional search query and label filters.',
            category: ToolCategory.API,
            parameters: ListMessagesSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 20000 },
        });
    }

    protected async performExecute(input: z.infer<typeof ListMessagesSchema>, _ctx: ToolContext) {
        const params = new URLSearchParams({ maxResults: String(input.maxResults ?? 10) });
        if (input.query) params.set('q', input.query);
        if (input.labelIds?.length) input.labelIds.forEach((l) => { params.append('labelIds', l); });
        if (input.includeSpamTrash) params.set('includeSpamTrash', 'true');

        const list = await gmailFetch(getToken(this.config), 'GET', `/messages?${params.toString()}`) as {
            messages?: Array<{ id: string; threadId: string }>;
        };

        const ids = (list.messages ?? []).map((m) => m.id);
        const messages = await Promise.all(ids.map(async (id) => {
            const msg = await gmailFetch(getToken(this.config), 'GET', `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`) as Record<string, unknown>;
            const headers = (msg['payload'] as Record<string, unknown>)?.['headers'] as Array<{ name: string; value: string }> ?? [];
            return {
                id: msg['id'] as string,
                threadId: msg['threadId'] as string,
                subject: extractHeader(headers, 'Subject'),
                from: extractHeader(headers, 'From'),
                to: extractHeader(headers, 'To'),
                date: extractHeader(headers, 'Date'),
                snippet: msg['snippet'] as string ?? '',
                labels: msg['labelIds'] as string[] ?? [],
            } satisfies GmailMessage;
        }));

        return { messages, count: messages.length };
    }
}

export class GmailGetMessageTool extends BaseTool<typeof GetMessageSchema, GmailMessage> {
    constructor(private config: GmailToolConfig = {}) {
        super({
            id: 'gmail_get_message',
            name: 'Gmail Get Message',
            description: 'Retrieve the full content of a Gmail message by ID.',
            category: ToolCategory.API,
            parameters: GetMessageSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 15000 },
        });
    }

    protected async performExecute(input: z.infer<typeof GetMessageSchema>, _ctx: ToolContext) {
        const format = input.includeBody ? 'full' : 'metadata';
        const msg = await gmailFetch(getToken(this.config), 'GET', `/messages/${input.messageId}?format=${format}`) as Record<string, unknown>;
        const payload = msg['payload'] as Record<string, unknown>;
        const headers = payload?.['headers'] as Array<{ name: string; value: string }> ?? [];
        const bodyText = input.includeBody ? extractBody(payload) : undefined;
        return {
            id: msg['id'] as string,
            threadId: msg['threadId'] as string,
            subject: extractHeader(headers, 'Subject'),
            from: extractHeader(headers, 'From'),
            to: extractHeader(headers, 'To'),
            date: extractHeader(headers, 'Date'),
            snippet: msg['snippet'] as string ?? '',
            ...(bodyText !== undefined && { body: bodyText }),
            labels: msg['labelIds'] as string[] ?? [],
        };
    }
}

export class GmailSendEmailTool extends BaseTool<typeof SendEmailSchema, { id: string; threadId: string; labelIds: string[] }> {
    constructor(private config: GmailToolConfig = {}) {
        super({
            id: 'gmail_send_email',
            name: 'Gmail Send Email',
            description: 'Send an email via Gmail. Supports plain text, HTML, CC, and thread replies.',
            category: ToolCategory.API,
            parameters: SendEmailSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 15000 },
        });
    }

    protected async performExecute(input: z.infer<typeof SendEmailSchema>, _ctx: ToolContext) {
        const raw = buildRawEmail({ to: input.to, subject: input.subject, body: input.body, ...(input.cc !== undefined && { cc: input.cc }), isHtml: input.isHtml ?? false });
        const body: Record<string, unknown> = { raw };
        if (input['threadId']) body['threadId'] = input['threadId'];
        const msg = await gmailFetch(getToken(this.config), 'POST', '/messages/send', body) as { id: string; threadId: string; labelIds: string[] };
        return { id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds ?? [] };
    }
}

export class GmailModifyLabelsTool extends BaseTool<typeof ModifyLabelsSchema, GmailMessage> {
    constructor(private config: GmailToolConfig = {}) {
        super({
            id: 'gmail_modify_labels',
            name: 'Gmail Modify Labels',
            description: 'Add or remove labels on a Gmail message (e.g. mark as read, star, archive).',
            category: ToolCategory.API,
            parameters: ModifyLabelsSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 10000 },
        });
    }

    protected async performExecute(input: z.infer<typeof ModifyLabelsSchema>, _ctx: ToolContext) {
        const msg = await gmailFetch(getToken(this.config), 'POST', `/messages/${input.messageId}/modify`, {
            addLabelIds: input.addLabelIds ?? [],
            removeLabelIds: input.removeLabelIds ?? [],
        }) as Record<string, unknown>;
        const payload = msg['payload'] as Record<string, unknown> ?? {};
        const headers = payload['headers'] as Array<{ name: string; value: string }> ?? [];
        return {
            id: msg['id'] as string,
            threadId: msg['threadId'] as string,
            subject: extractHeader(headers, 'Subject'),
            from: extractHeader(headers, 'From'),
            to: extractHeader(headers, 'To'),
            date: extractHeader(headers, 'Date'),
            snippet: msg['snippet'] as string ?? '',
            labels: msg['labelIds'] as string[] ?? [],
        };
    }
}

export class GmailTrashMessageTool extends BaseTool<typeof TrashMessageSchema, { success: boolean; id: string }> {
    constructor(private config: GmailToolConfig = {}) {
        super({
            id: 'gmail_trash_message',
            name: 'Gmail Trash Message',
            description: 'Move a Gmail message to the trash.',
            category: ToolCategory.API,
            parameters: TrashMessageSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 10000 },
        });
    }

    protected async performExecute(input: z.infer<typeof TrashMessageSchema>, _ctx: ToolContext) {
        const msg = await gmailFetch(getToken(this.config), 'POST', `/messages/${input.messageId}/trash`) as { id: string };
        return { success: true, id: msg.id };
    }
}

export class GmailSearchMessagesTool extends BaseTool<typeof SearchMessagesSchema, { messages: GmailMessage[]; count: number }> {
    constructor(private config: GmailToolConfig = {}) {
        super({
            id: 'gmail_search_messages',
            name: 'Gmail Search Messages',
            description: 'Search Gmail using Gmail query syntax (from:, to:, subject:, is:unread, has:attachment, etc.).',
            category: ToolCategory.API,
            parameters: SearchMessagesSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 20000 },
        });
    }

    protected async performExecute(input: z.infer<typeof SearchMessagesSchema>, _ctx: ToolContext) {
        const params = new URLSearchParams({ q: input.query, maxResults: String(input.maxResults ?? 10) });
        const list = await gmailFetch(getToken(this.config), 'GET', `/messages?${params.toString()}`) as {
            messages?: Array<{ id: string; threadId: string }>;
        };
        const ids = (list.messages ?? []).map((m) => m.id);
        const format = input.includeBody ? 'full' : 'metadata';
        const messages = await Promise.all(ids.map(async (id) => {
            const msg = await gmailFetch(getToken(this.config), 'GET', `/messages/${id}?format=${format}`) as Record<string, unknown>;
            const payload = msg['payload'] as Record<string, unknown> ?? {};
            const headers = payload['headers'] as Array<{ name: string; value: string }> ?? [];
            const _body = input.includeBody ? extractBody(payload) : undefined;
            return {
                id: msg['id'] as string,
                threadId: msg['threadId'] as string,
                subject: extractHeader(headers, 'Subject'),
                from: extractHeader(headers, 'From'),
                to: extractHeader(headers, 'To'),
                date: extractHeader(headers, 'Date'),
                snippet: msg['snippet'] as string ?? '',
                ...(_body !== undefined && { body: _body }),
                labels: msg['labelIds'] as string[] ?? [],
            } satisfies GmailMessage;
        }));
        return { messages, count: messages.length };
    }
}

export class GmailToolkit {
    readonly tools: BaseTool[];
    constructor(config: GmailToolConfig = {}) {
        this.tools = [
            new GmailListMessagesTool(config),
            new GmailGetMessageTool(config),
            new GmailSendEmailTool(config),
            new GmailModifyLabelsTool(config),
            new GmailTrashMessageTool(config),
            new GmailSearchMessagesTool(config),
        ];
    }
}
