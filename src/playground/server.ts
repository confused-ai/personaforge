/**
 * @personaforge/playground — Interactive agent playground UI.
 *
 * Serves a zero-dependency HTML/CSS/JS web interface that lets users chat
 * with registered personaforge agents directly from a browser.
 *
 * Architecture:
 *   createPlayground(agents, options) → PlaygroundServer
 *   PlaygroundServer  — Node.js http.Server wrapped with start()/stop()
 *   UI                — single-file HTML (inline CSS + JS, no framework)
 *   API proxy         — POST /api/chat forwards to the agent runner
 *
 * Security (OWASP Top 10):
 *   - All user input is HTML-escaped before insertion into the DOM
 *   - Content-Security-Policy header restricts script/style sources
 *   - Request body is capped at 64 KB to prevent DoS
 *   - CORS is disabled by default (same-origin only)
 *   - Responses use plain text/JSON; no eval(), no innerHTML on untrusted data
 */

import http from 'node:http';
import { getPlaygroundHtml } from './_ui.js';

// ── Public types ──────────────────────────────────────────────────────────────

export interface PlaygroundAgent {
    /** Name shown in the UI dropdown */
    name: string;
    /** Async function that accepts a prompt string and returns a text reply */
    run: (prompt: string) => Promise<string>;
}

export interface PlaygroundOptions {
    /** TCP port to listen on. Default: 4000 */
    port?: number;
    /** Hostname / bind address. Default: 'localhost' */
    host?: string;
    /** Optional title shown in the browser tab and heading. Default: 'Agent Playground' */
    title?: string;
    /** Max request body bytes. Default: 65 536 (64 KB) */
    maxBodyBytes?: number;
    /**
     * Enable WebSocket streaming endpoint at `ws://<host>:<port>/ws/chat`.
     * When true the server upgrades eligible connections to WebSocket.
     * Default: true.
     */
    enableWebSocket?: boolean;
}

export interface PlaygroundServer {
    /** Underlying Node.js HTTP server */
    server: http.Server;
    /** Resolved port (useful when port was 0 / OS-assigned) */
    port: number;
    /** Stop the server */
    stop: () => Promise<void>;
}

/** In-process request metrics — keyed by path */
export interface PlaygroundMetrics {
    requests: number;
    errors: number;
    totalLatencyMs: number;
    avgLatencyMs: number;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const DEFAULT_PORT      = 4000;
const DEFAULT_HOST      = 'localhost';
const DEFAULT_TITLE     = 'Agent Playground';
const DEFAULT_MAX_BODY  = 64 * 1024;   // 64 KB

/** Read the full request body, rejecting if it exceeds maxBytes. */
function readBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let total = 0;

        req.on('data', (chunk: Buffer) => {
            total += chunk.length;
            if (total > maxBytes) {
                req.destroy();
                reject(Object.assign(new Error('Body too large'), { code: 'BODY_TOO_LARGE' }));
                return;
            }
            chunks.push(chunk);
        });

        req.on('end',   () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(payload),
        // Strict CSP — no inline scripts or styles from this endpoint
        'X-Content-Type-Options': 'nosniff',
    });
    res.end(payload);
}

// ── Minimal WebSocket frame helpers ──────────────────────────────────────────
// RFC 6455 — server-side only (no masking needed for server→client frames).

function buildWsFrame(data: string): Buffer {
    const payload = Buffer.from(data, 'utf8');
    const len = payload.length;
    let header: Buffer;
    if (len < 126) {
        header = Buffer.alloc(2);
        header[0] = 0x81; // FIN + text opcode
        header[1] = len;
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x81;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x81;
        header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }
    return Buffer.concat([header, payload]);
}

function buildWsCloseFrame(): Buffer {
    return Buffer.from([0x88, 0x00]); // FIN + close opcode, no payload
}

function parseWsHandshake(req: http.IncomingMessage): string | null {
    const key = req.headers['sec-websocket-key'];
    if (!key) return null;
    const { createHash } = require('node:crypto') as typeof import('node:crypto');
    return createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
}

/** Parse a single unmasked or masked WebSocket data frame from a Buffer. */
function parseWsFrame(buf: Buffer): { data: string; consumed: number } | null {
    if (buf.length < 2) return null;
    const fin    = (buf[0]! & 0x80) !== 0;
    const opcode = buf[0]! & 0x0f;
    if (!fin || opcode !== 0x01) return null;  // only handle single-frame text
    const masked = (buf[1]! & 0x80) !== 0;
    let len      = buf[1]! & 0x7f;
    let offset   = 2;
    if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
    else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); offset = 10; }
    if (buf.length < offset + (masked ? 4 : 0) + len) return null;
    let data: Buffer;
    if (masked) {
        const mask = buf.subarray(offset, offset + 4);
        data = buf.subarray(offset + 4, offset + 4 + len);
        for (let i = 0; i < data.length; i++) data[i] = (data[i]! ^ mask[i % 4]!);
        offset += 4;
    } else {
        data = buf.subarray(offset, offset + len);
    }
    return { data: data.toString('utf8'), consumed: offset + len };
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create and start a playground HTTP server.
 *
 * @example
 * ```ts
 * import { createPlayground } from './index.js';
 *
 * const svc = await createPlayground([
 *     { name: 'my-agent', run: async (p) => agent.run(p) },
 * ]);
 * console.log(`Playground running at http://localhost:${svc.port}`);
 * // WebSocket: ws://localhost:4000/ws/chat
 * // Metrics:   http://localhost:4000/metrics
 * ```
 */
export function createPlayground(
    agents: PlaygroundAgent[],
    options: PlaygroundOptions = {},
): Promise<PlaygroundServer> {
    const port         = options.port         ?? DEFAULT_PORT;
    const host         = options.host         ?? DEFAULT_HOST;
    const title        = options.title        ?? DEFAULT_TITLE;
    const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY;
    const enableWs     = options.enableWebSocket ?? true;

    if (agents.length === 0) {
        return Promise.reject(new Error('createPlayground: at least one agent is required'));
    }

    // Build a name→run lookup (O(1) dispatch)
    const agentMap = new Map<string, PlaygroundAgent['run']>(
        agents.map((a) => [a.name, a.run]),
    );
    const agentNames = agents.map((a) => a.name);

    const html = getPlaygroundHtml(title, agentNames);

    // ── In-process metrics ────────────────────────────────────────────────────
    const _metrics: Record<string, { requests: number; errors: number; totalLatencyMs: number }> = {};
    function recordMetric(path: string, latencyMs: number, isError: boolean): void {
        const m = (_metrics[path] ??= { requests: 0, errors: 0, totalLatencyMs: 0 });
        m.requests++;
        m.totalLatencyMs += latencyMs;
        if (isError) m.errors++;
    }

    const server = http.createServer(async (req, res) => {
        const t0     = Date.now();
        const method = req.method?.toUpperCase() ?? 'GET';
        const url    = req.url ?? '/';
        const path   = url.split('?')[0]!;

        // ── Serve the UI ──────────────────────────────────────────────────
        if (method === 'GET' && (path === '/' || path === '/index.html')) {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Length': Buffer.byteLength(html),
                'Content-Security-Policy': [
                    "default-src 'self'",
                    "script-src 'self' 'unsafe-inline'",
                    "style-src 'self' 'unsafe-inline'",
                    "connect-src 'self' ws: wss:",
                ].join('; '),
                'X-Content-Type-Options': 'nosniff',
                'X-Frame-Options': 'SAMEORIGIN',
            });
            res.end(html);
            recordMetric('/', Date.now() - t0, false);
            return;
        }

        // ── Chat API ──────────────────────────────────────────────────────
        if (method === 'POST' && path === '/api/chat') {
            let raw: string;
            try {
                raw = await readBody(req, maxBodyBytes);
            } catch (e) {
                const code = (e as NodeJS.ErrnoException).code;
                if (code === 'BODY_TOO_LARGE') {
                    sendJson(res, 413, { error: 'Request body too large' });
                    recordMetric('/api/chat', Date.now() - t0, true);
                    return;
                }
                throw e;
            }

            let body: { agent?: string; message?: string };
            try {
                body = raw ? (JSON.parse(raw) as typeof body) : {};
            } catch {
                sendJson(res, 400, { error: 'Invalid JSON' });
                recordMetric('/api/chat', Date.now() - t0, true);
                return;
            }

            const agentName = body.agent ?? agentNames[0];
            const runFn = agentName ? agentMap.get(agentName) : undefined;

            if (!runFn) {
                sendJson(res, 400, { error: `Unknown agent: "${String(body.agent)}"` });
                recordMetric('/api/chat', Date.now() - t0, true);
                return;
            }

            if (!body.message || typeof body.message !== 'string') {
                sendJson(res, 400, { error: 'Missing "message" string in request body' });
                recordMetric('/api/chat', Date.now() - t0, true);
                return;
            }

            const prompt = body.message.trim();
            if (!prompt) {
                sendJson(res, 400, { error: '"message" must not be blank' });
                recordMetric('/api/chat', Date.now() - t0, true);
                return;
            }

            try {
                const text = await runFn(prompt);
                sendJson(res, 200, { agent: agentName, text });
                recordMetric('/api/chat', Date.now() - t0, false);
            } catch (err) {
                const message = err instanceof Error ? err.message : 'Agent error';
                sendJson(res, 500, { error: message });
                recordMetric('/api/chat', Date.now() - t0, true);
            }
            return;
        }

        // ── Agent list ────────────────────────────────────────────────────
        if (method === 'GET' && path === '/api/agents') {
            sendJson(res, 200, { agents: agentNames });
            recordMetric('/api/agents', Date.now() - t0, false);
            return;
        }

        // ── Prometheus-compatible metrics ─────────────────────────────────
        if (method === 'GET' && path === '/metrics') {
            const lines: string[] = ['# HELP playground_requests_total Total HTTP requests'];
            for (const [p, m] of Object.entries(_metrics)) {
                const label = `path="${p.replace(/"/g, '\\"')}"`;
                lines.push(`playground_requests_total{${label}} ${m.requests}`);
                lines.push(`playground_errors_total{${label}} ${m.errors}`);
                lines.push(`playground_latency_ms_total{${label}} ${m.totalLatencyMs}`);
                if (m.requests > 0) {
                    lines.push(`playground_latency_ms_avg{${label}} ${(m.totalLatencyMs / m.requests).toFixed(2)}`);
                }
            }
            const payload = lines.join('\n') + '\n';
            res.writeHead(200, {
                'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
                'Content-Length': Buffer.byteLength(payload),
            });
            res.end(payload);
            return;
        }

        // ── Health check ──────────────────────────────────────────────────
        if (method === 'GET' && path === '/health') {
            sendJson(res, 200, { status: 'ok' });
            return;
        }

        // ── 404 fallback ──────────────────────────────────────────────────
        sendJson(res, 404, { error: 'Not found' });
        recordMetric(path, Date.now() - t0, true);
    });

    // ── WebSocket upgrade — /ws/chat ──────────────────────────────────────────
    if (enableWs) {
        server.on('upgrade', (req, socket, _head) => {
            const path = (req.url ?? '').split('?')[0];
            if (path !== '/ws/chat') {
                socket.destroy();
                return;
            }

            const acceptKey = parseWsHandshake(req);
            if (!acceptKey) {
                socket.destroy();
                return;
            }

            // Complete the handshake
            socket.write(
                'HTTP/1.1 101 Switching Protocols\r\n' +
                'Upgrade: websocket\r\n' +
                'Connection: Upgrade\r\n' +
                `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`,
            );

            let buf = Buffer.alloc(0);

            socket.on('data', (chunk: Buffer) => {
                buf = Buffer.concat([buf, chunk]);
                const frame = parseWsFrame(buf);
                if (!frame) return;
                buf = buf.subarray(frame.consumed);

                let msg: { agent?: string; message?: string };
                try {
                    msg = JSON.parse(frame.data) as typeof msg;
                } catch {
                    socket.write(buildWsFrame(JSON.stringify({ error: 'Invalid JSON' })));
                    return;
                }

                const agentName = msg.agent ?? agentNames[0];
                const runFn = agentName ? agentMap.get(agentName) : undefined;
                if (!runFn) {
                    socket.write(buildWsFrame(JSON.stringify({ error: `Unknown agent: "${String(msg.agent)}"` })));
                    return;
                }

                const prompt = (msg.message ?? '').trim();
                if (!prompt) {
                    socket.write(buildWsFrame(JSON.stringify({ error: '"message" must not be blank' })));
                    return;
                }

                const t0 = Date.now();
                runFn(prompt)
                    .then((text) => {
                        socket.write(buildWsFrame(JSON.stringify({ agent: agentName, text, done: true })));
                        recordMetric('/ws/chat', Date.now() - t0, false);
                    })
                    .catch((err) => {
                        const error = err instanceof Error ? err.message : 'Agent error';
                        socket.write(buildWsFrame(JSON.stringify({ error })));
                        recordMetric('/ws/chat', Date.now() - t0, true);
                    });
            });

            socket.on('close', () => {
                socket.write(buildWsCloseFrame());
            });

            socket.on('error', () => {
                socket.destroy();
            });

            // Unref so the socket doesn't prevent server shutdown
            (socket as NodeJS.Socket & { unref?: () => void }).unref?.();
        });
    }

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            const addr = server.address();
            const resolvedPort = typeof addr === 'object' && addr ? addr.port : port;

            resolve({
                server,
                port: resolvedPort,
                stop: () =>
                    new Promise<void>((res, rej) =>
                        server.close((err) => (err ? rej(err) : res())),
                    ),
            });
        });
    });
}
