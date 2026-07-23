/**
 * Telegram interface adapter.
 *
 * Listens for Telegram updates at `POST /telegram/webhook`, maps them to agent
 * runs, and sends replies via the Bot API.
 *
 * Setup:
 * 1. Create a bot via @BotFather → get `token`.
 * 2. Register the webhook:
 *    ```
 *    curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://your-host/telegram/webhook"
 *    ```
 *
 * @example
 * ```ts
 * import { TelegramInterface } from 'personaforge/interfaces';
 *
 * new TelegramInterface({
 *   agent: assistant,
 *   token: process.env.TELEGRAM_BOT_TOKEN!,
 * });
 * ```
 */

import type http from 'node:http';
import { BaseInterface, type BaseInterfaceOptions } from './base.js';

export interface TelegramInterfaceOptions extends BaseInterfaceOptions {
    /** Telegram bot token from @BotFather */
    token: string;
    /** Path to register the webhook on. Default: `/telegram/webhook` */
    path?: string;
    /** Optional secret token for `X-Telegram-Bot-Api-Secret-Token` header verification. */
    secretToken?: string;
}

interface TelegramUpdate {
    update_id: number;
    message?: {
        message_id: number;
        from?: { id: number; username?: string; first_name?: string };
        chat: { id: number; type: string };
        text?: string;
    };
}

export class TelegramInterface extends BaseInterface {
    private readonly token: string;
    private readonly telegramPath: string;
    private readonly secretToken?: string;

    constructor(options: TelegramInterfaceOptions) {
        super(options);
        this.token = options.token;
        this.telegramPath = options.path ?? '/telegram/webhook';
        this.secretToken = options.secretToken;
    }

    setup(server: http.Server, _pathPrefix?: string): void {
        server.on('request', (req, res) => {
            if (req.method !== 'POST' || req.url !== this.telegramPath) return;

            // Verify optional secret token
            if (this.secretToken) {
                const provided = req.headers['x-telegram-bot-api-secret-token'];
                if (provided !== this.secretToken) {
                    res.writeHead(403);
                    res.end(JSON.stringify({ error: 'Invalid secret token' }));
                    return;
                }
            }

            const chunks: Buffer[] = [];
            req.on('data', (c: Buffer | string) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
            req.on('end', async () => {
                let update: TelegramUpdate;
                try {
                    update = JSON.parse(Buffer.concat(chunks).toString('utf8')) as TelegramUpdate;
                } catch {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Invalid JSON' }));
                    return;
                }

                // Acknowledge immediately (Telegram retries if no 200 within 60s)
                res.writeHead(200);
                res.end('OK');

                const msg = update.message;
                if (!msg?.text || !msg.from) return;

                setImmediate(async () => {
                    try {
                        const userId = String(msg.from!.id);
                        // Use chat ID as session — persists across messages in same chat
                        const sessionId = `telegram:${msg.chat.id}`;
                        const result = await this.dispatch(msg.text!, userId, sessionId);
                        await this._sendMessage(msg.chat.id, result.text, msg.message_id);
                    } catch (err) {
                        console.error('[TelegramInterface] Agent error:', err);
                    }
                });
            });
        });
    }

    private async _sendMessage(chatId: number, text: string, replyToMessageId?: number): Promise<void> {
        const body: Record<string, unknown> = {
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
        };
        if (replyToMessageId) body['reply_to_message_id'] = replyToMessageId;
        await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    /** Register this bot's webhook URL with Telegram (call once on deploy). */
    async registerWebhook(publicUrl: string): Promise<void> {
        const webhookUrl = `${publicUrl}${this.telegramPath}`;
        const body: Record<string, unknown> = { url: webhookUrl };
        if (this.secretToken) body['secret_token'] = this.secretToken;
        const resp = await fetch(`https://api.telegram.org/bot${this.token}/setWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await resp.json() as { ok: boolean; description?: string };
        if (!data.ok) throw new Error(`Telegram webhook registration failed: ${data.description}`);
    }
}
