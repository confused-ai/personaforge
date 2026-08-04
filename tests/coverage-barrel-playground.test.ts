/**
 * Coverage for src/playground.ts (barrel) — interactive playground server.
 * Spins up on an OS-assigned port bound to 'localhost', exercises the HTTP
 * endpoints, then stops.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createPlayground } from '../src/playground.js';
import type { PlaygroundServer } from '../src/playground.js';

let server: PlaygroundServer | undefined;

afterEach(async () => {
    if (server) {
        await server.stop();
        server = undefined;
    }
});

const HOST = 'localhost';

function post(port: number, path: string, body: unknown): Promise<{ status: number; json: any }> {
    return new Promise((resolve, reject) => {
        const req = require('node:http').request(
            { host: HOST, port, path, method: 'POST', headers: { 'Content-Type': 'application/json' } },
            (res: any) => {
                let data = '';
                res.on('data', (c: string) => (data += c));
                res.on('end', () => resolve({ status: res.statusCode, json: data ? JSON.parse(data) : undefined }));
            },
        );
        req.on('error', reject);
        req.end(JSON.stringify(body));
    });
}

function getJson(port: number, path: string): Promise<{ status: number; json: any }> {
    return new Promise((resolve, reject) => {
        const req = require('node:http').request(
            { host: HOST, port, path, method: 'GET' },
            (res: any) => {
                let d = '';
                res.on('data', (c: string) => (d += c));
                res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(d) }));
            },
        );
        req.on('error', reject);
        req.end();
    });
}

describe('playground barrel', () => {
    it('createPlayground serves chat + metrics + health and stops', async () => {
        const started = await createPlayground(
            [{ name: 'assistant', run: async (prompt: string) => `echo:${prompt}` }],
            { port: 0, host: HOST, enableWebSocket: false },
        );
        // createPlayground resolves once the server is listening.
        server = started;
        const port = server.port;
        expect(port).toBeGreaterThan(0);
        expect(typeof server.stop).toBe('function');

        const chat = await post(port, '/api/chat', { agent: 'assistant', message: 'hi' });
        expect(chat.status).toBe(200);
        expect(chat.json.text).toBe('echo:hi');

        const agentsRes = await getJson(port, '/api/agents');
        expect(agentsRes.json.agents).toContain('assistant');

        const healthStatus = await new Promise<number>((resolve, reject) => {
            const req = require('node:http').request(
                { host: HOST, port, path: '/health', method: 'GET' },
                (res: any) => { res.resume(); resolve(res.statusCode); },
            );
            req.on('error', reject);
            req.end();
        });
        expect(healthStatus).toBe(200);
    });

    it('createPlayground rejects with no agents', async () => {
        await expect(createPlayground([], { port: 0 })).rejects.toThrow(/at least one agent/);
    });
});
