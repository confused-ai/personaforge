import { describe, it, expect, afterEach } from 'vitest';
import { createControlPlane } from '../src/control-plane/index.js';
import type { ControlPlaneServer } from '../src/control-plane/index.js';

let server: ControlPlaneServer | null = null;
const PORT = 4197;
const base = `http://localhost:${PORT}`;

afterEach(async () => { await server?.stop(); server = null; });

describe('control plane server', () => {
  it('serves dashboard HTML at /', async () => {
    server = createControlPlane({});
    await server.start(PORT);
    const res = await fetch(base + '/');
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Control Plane');
    expect(html).toContain('Sessions');
  });

  it('lists agents', async () => {
    server = createControlPlane({
      agents: [{ name: 'alpha', run: async () => ({ text: 'hi' }) }],
    });
    await server.start(PORT);
    const d = await (await fetch(base + '/api/agents')).json();
    expect(d.agents).toEqual([{ name: 'alpha' }]);
  });

  it('proxies chat to the agent', async () => {
    server = createControlPlane({
      agents: [{ name: 'echo', run: async (p) => ({ text: 'echo:' + p }) }],
    });
    await server.start(PORT);
    const d = await (await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'echo', prompt: 'hey' }),
    })).json();
    expect(d.text).toBe('echo:hey');
  });

  it('lists sessions from store', async () => {
    server = createControlPlane({
      sessionStore: { list: async () => [{ id: 's1', createdAt: 123 }] },
    });
    await server.start(PORT);
    const d = await (await fetch(base + '/api/sessions')).json();
    expect(d.sessions).toEqual([{ id: 's1', createdAt: 123 }]);
  });

  it('handles approval approve/reject', async () => {
    const approved: string[] = [];
    server = createControlPlane({
      approvalStore: {
        listPending: async () => [{ id: 'a1' }],
        approve: async (id) => { approved.push(id); },
        reject: async () => {},
      },
    });
    await server.start(PORT);
    const pending = await (await fetch(base + '/api/approvals')).json();
    expect(pending.pending).toEqual([{ id: 'a1' }]);
    await fetch(base + '/api/approvals/approve?id=a1', { method: 'POST' });
    expect(approved).toEqual(['a1']);
  });

  it('returns 404 for unknown routes', async () => {
    server = createControlPlane({});
    await server.start(PORT);
    const res = await fetch(base + '/api/nope');
    expect(res.status).toBe(404);
  });
});
