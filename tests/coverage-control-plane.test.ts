/**
 * Hermetic coverage for src/control-plane — HTTP API server + dashboard loader.
 * Starts the server on an ephemeral port and exercises every route.
 * No network beyond localhost. Callers: vitest only.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createControlPlane } from '../src/control-plane/index.js';
import { loadDashboardHtml } from '../src/control-plane/dashboard.js';
import type { ControlPlaneServer } from '../src/control-plane/index.js';

describe('control-plane dashboard loader', () => {
    it('loads HTML (fs or inline fallback) and caches', () => {
        const first = loadDashboardHtml();
        expect(typeof first).toBe('string');
        expect(first.length).toBeGreaterThan(100);
        const second = loadDashboardHtml();
        expect(second).toBe(first); // cached
    });
});

describe('control-plane HTTP API', () => {
    let cp: ControlPlaneServer;
    let base: string;

    const stores = {
        sessionStore: {
            list: async () => [{ id: 's1', createdAt: 123, metadata: { x: 1 } }],
            load: async (id: string) => ({ id, messages: [] }),
        },
        evalStore: { list: async () => [{ id: 'e1' }] },
        traceStore: { list: async () => [{ id: 't1', name: 'run', startTime: 1, endTime: 2 }] },
        approvalStore: {
            listPending: async () => [{ id: 'a1', prompt: 'x' }],
            approve: async () => {},
            reject: async () => {},
        },
        knowledgeStore: { listDocuments: async () => [{ id: 'k1', content: 'doc' }] },
    };

    beforeAll(async () => {
        cp = createControlPlane({
            agents: [
                {
                    name: 'agent1',
                    run: async (prompt) => ({ text: `echo:${prompt}` }),
                    streamEvents: async function* (prompt) {
                        yield { type: 'token', data: prompt };
                    },
                },
                {
                    name: 'agent2',
                    run: async () => ({ text: 'no-stream' }),
                },
            ],
            system: { name: 'sys', agents: ['agent1'] },
            ...stores,
        });
        // Start on an ephemeral port, then discover it via the server's address.
        // createControlPlane doesn't expose the port, so start on a fixed one.
        await cp.start(0);
        // Use a raw http request to the server we can reach — start on fixed port instead.
        await cp.stop();
        await cp.start(4199);
        base = 'http://127.0.0.1:4199';
    });

    afterAll(async () => {
        await cp.stop();
    });

    async function get(path: string): Promise<{ status: number; json: unknown }> {
        const res = await fetch(`${base}${path}`);
        return { status: res.status, json: await res.json() };
    }

    it('serves /api/agents', async () => {
        const { status, json } = await get('/api/agents');
        expect(status).toBe(200);
        expect(json).toMatchObject({ agents: [{ name: 'agent1' }, { name: 'agent2' }] });
    });

    it('serves /api/sessions + detail', async () => {
        const list = await get('/api/sessions');
        expect((list.json as { sessions: unknown[] }).sessions).toHaveLength(1);
        const detail = await get('/api/sessions/detail?id=s1');
        expect(detail.json).toMatchObject({ session: { id: 's1' } });
        const missing = await get('/api/sessions/detail'); // no id → 404
        expect(missing.status).toBe(404);
    });

    it('serves /api/evals, /api/traces, /api/knowledge', async () => {
        expect((await get('/api/evals')).json).toMatchObject({ evals: [{ id: 'e1' }] });
        expect((await get('/api/traces')).json).toMatchObject({ traces: [{ id: 't1' }] });
        expect((await get('/api/knowledge')).json).toMatchObject({ documents: [{ id: 'k1' }] });
    });

    it('serves /api/approvals + approve/reject', async () => {
        expect((await get('/api/approvals')).json).toMatchObject({ pending: [{ id: 'a1' }] });
        const app = await fetch(`${base}/api/approvals/approve?id=a1`, { method: 'POST' });
        expect(app.status).toBe(200);
        const rej = await fetch(`${base}/api/approvals/reject?id=a1`, { method: 'POST' });
        expect(rej.status).toBe(200);
    });

    it('serves /api/system', async () => {
        const { json } = await get('/api/system');
        expect(json).toMatchObject({ system: { name: 'sys' } });
    });

    it('serves /api/chat with agent run + 400 missing', async () => {
        const ok = await fetch(`${base}/api/chat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ agent: 'agent1', prompt: 'hi' }),
        });
        expect(ok.status).toBe(200);
        expect(await ok.json()).toEqual({ text: 'echo:hi' });

        const bad = await fetch(`${base}/api/chat`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        });
        expect(bad.status).toBe(400);
        expect(await bad.json()).toMatchObject({ error: 'agent or prompt missing' });
    });

    it('serves /api/chat/stream with streamEvents and non-stream fallback', async () => {
        const withStream = await fetch(`${base}/api/chat/stream`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ agent: 'agent1', prompt: 'p' }),
        });
        expect(withStream.status).toBe(200);
        const body1 = await withStream.text();
        expect(body1).toContain('data: {"type":"token"');

        const noStream = await fetch(`${base}/api/chat/stream`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ agent: 'agent2', prompt: 'p' }),
        });
        const body2 = await noStream.text();
        expect(body2).toContain('data: {"type":"token"');
        expect(body2).toContain('data: {"type":"done"');
    });

    it('serves dashboard HTML at / and /index.html', async () => {
        const root = await fetch(`${base}/`);
        expect(root.status).toBe(200);
        expect((await root.text())).toContain('<!DOCTYPE html>');
        const idx = await fetch(`${base}/index.html`);
        expect(idx.status).toBe(200);
    });

    it('returns 404 for unknown routes', async () => {
        const { status } = await get('/api/nope');
        expect(status).toBe(404);
    });
});
