/**
 * WebSocket Transport — real-time bidirectional agent streaming.
 *
 * Adds a WebSocket upgrade handler to the existing HTTP server so clients can
 * connect to `ws://host/v1/ws` and receive token-by-token streaming responses
 * without SSE polling.
 *
 * Protocol:
 * - Client → Server: `{ "type": "chat", "message": "...", "agent"?: "...", "sessionId"?: "...", "userId"?: "..." }`
 * - Server → Client: `{ "type": "chunk", "text": "..." }`  (streamed tokens)
 * - Server → Client: `{ "type": "tool_call", "name": "...", "args": {} }`
 * - Server → Client: `{ "type": "tool_result", "name": "...", "result": {} }`
 * - Server → Client: `{ "type": "done", "text": "...", "steps": N, "finishReason": "..." }`
 * - Server → Client: `{ "type": "error", "message": "..." }`
 * - Server → Client: `{ "type": "ping" }` (keepalive every 30s)
 *
 * @example
 * ```ts
 * // Server:
 * const service = createHttpService({ agents: { assistant }, websocket: true });
 *
 * // Client (browser):
 * const ws = new WebSocket('ws://localhost:8787/v1/ws');
 * ws.onopen = () => ws.send(JSON.stringify({ type: 'chat', message: 'Hello!' }));
 * ws.onmessage = (e) => {
 *   const msg = JSON.parse(e.data);
 *   if (msg.type === 'chunk') process.stdout.write(msg.text);
 *   if (msg.type === 'done') console.log('\nDone!', msg.finishReason);
 * };
 * ```
 */

import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import { createHash } from 'node:crypto';
import type { CreateAgentResult } from '../create-agent/types.js';

// ── WebSocket frame parser / builder (no external deps) ───────────────────

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const WS_GUID = WS_MAGIC;

function wsHandshake(req: IncomingMessage, socket: Socket): boolean {
    const key = req.headers['sec-websocket-key'];
    if (!key) return false;

    const acceptKey = createHash('sha1')
        .update(key + WS_GUID)
        .digest('base64');

    const response = [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '',
        '',
    ].join('\r\n');

    socket.write(response);
    return true;
}

function wsEncode(data: string): Buffer {
    const payload = Buffer.from(data, 'utf8');
    const len = payload.byteLength;
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
        // Write as 64-bit big-endian (JS-safe: only 32-bit needed for realistic payloads)
        header.writeUInt32BE(0, 2);
        header.writeUInt32BE(len, 6);
    }

    return Buffer.concat([header, payload]);
}

function wsDecode(buf: Buffer): { text: string; consumed: number } | null {
    if (buf.byteLength < 2) return null;

    const firstByte = buf[0]!;
    const secondByte = buf[1]!;
    const opcode = firstByte & 0x0f;
    const masked = (secondByte & 0x80) !== 0;

    // Handle connection close (opcode 8) and ping (opcode 9)
    if (opcode === 8) return { text: '__close__', consumed: buf.byteLength };
    if (opcode === 9) return { text: '__ping__', consumed: buf.byteLength };
    if (opcode !== 1) return null; // not text frame

    let payloadLen = secondByte & 0x7f;
    let offset = 2;

    if (payloadLen === 126) {
        if (buf.byteLength < 4) return null;
        payloadLen = buf.readUInt16BE(2);
        offset = 4;
    } else if (payloadLen === 127) {
        if (buf.byteLength < 10) return null;
        payloadLen = buf.readUInt32BE(6);
        offset = 10;
    }

    const maskOffset = masked ? offset : -1;
    if (masked) offset += 4;

    if (buf.byteLength < offset + payloadLen) return null;

    const payload = buf.slice(offset, offset + payloadLen);
    if (masked && maskOffset >= 0) {
        const mask = buf.slice(maskOffset, maskOffset + 4);
        for (let i = 0; i < payload.byteLength; i++) {
            payload[i] = payload[i]! ^ mask[i % 4]!;
        }
    }

    return { text: payload.toString('utf8'), consumed: offset + payloadLen };
}

// ── WS connection handler ─────────────────────────────────────────────────

export function attachWebSocketTransport(
    server: Server,
    agents: Record<string, CreateAgentResult>,
): void {
    server.on('upgrade', (req: IncomingMessage, socket: Socket, _head: Buffer) => {
        const url = req.url ?? '';
        if (url !== '/v1/ws' && url !== '/ws') {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
            socket.destroy();
            return;
        }

        if (!wsHandshake(req, socket)) {
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            socket.destroy();
            return;
        }

        socket.setNoDelay(true);

        const send = (obj: Record<string, unknown>): void => {
            if (!socket.writable) return;
            try {
                socket.write(wsEncode(JSON.stringify(obj)));
            } catch {
                /* ignore write errors on closed sockets */
            }
        };

        // Keepalive ping every 30s
        const pingInterval = setInterval(() => send({ type: 'ping' }), 30_000);
        pingInterval.unref?.();

        let buf = Buffer.alloc(0);

        socket.on('data', async (chunk: Buffer) => {
            buf = Buffer.concat([buf, chunk]);

            while (true) {
                const frame = wsDecode(buf);
                if (!frame) break;
                buf = buf.slice(frame.consumed);

                if (frame.text === '__close__') {
                    socket.end();
                    return;
                }
                if (frame.text === '__ping__') {
                    // Send pong (opcode 0xA)
                    const pong = Buffer.from([0x8a, 0x00]);
                    socket.write(pong);
                    continue;
                }

                let msg: {
                    type?: string;
                    message?: string;
                    agent?: string;
                    sessionId?: string;
                    userId?: string;
                };
                try {
                    msg = JSON.parse(frame.text) as typeof msg;
                } catch {
                    send({ type: 'error', message: 'Invalid JSON' });
                    continue;
                }

                if (msg.type !== 'chat') {
                    send({ type: 'error', message: `Unknown message type: ${msg.type ?? 'undefined'}` });
                    continue;
                }

                if (!msg.message || typeof msg.message !== 'string') {
                    send({ type: 'error', message: 'Missing "message" string' });
                    continue;
                }

                const agentName = msg.agent ?? Object.keys(agents)[0];
                const agent = agentName ? agents[agentName] : undefined;
                if (!agent) {
                    send({ type: 'error', message: `Unknown agent: ${agentName ?? 'none'}` });
                    continue;
                }

                const sessionId =
                    msg.sessionId ||
                    (await agent.createSession(msg.userId).catch(() => `ws-${Date.now()}`));

                try {
                    const result = await agent.run(msg.message, {
                        sessionId,
                        userId: msg.userId,
                        onChunk: (text) => send({ type: 'chunk', text }),
                        onToolCall: (name, args) => send({ type: 'tool_call', name, args }),
                        onToolResult: (name, result) => send({ type: 'tool_result', name, result }),
                    });

                    send({
                        type: 'done',
                        agent: agentName,
                        sessionId,
                        text: result.text,
                        steps: result.steps,
                        finishReason: result.finishReason,
                    });
                } catch (err) {
                    send({
                        type: 'error',
                        message: err instanceof Error ? err.message : String(err),
                    });
                }
            }
        });

        socket.on('close', () => {
            clearInterval(pingInterval);
        });

        socket.on('error', () => {
            clearInterval(pingInterval);
        });
    });
}
