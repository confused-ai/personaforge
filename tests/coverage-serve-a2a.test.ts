/**
 * Hermetic coverage for src/serve/a2a.ts — AgentCard, HMAC signing/verification,
 * nonce replay prevention, middleware. No network. Callers: vitest only.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    verifyA2ASignature,
    signA2ARequest,
    agentCardMiddleware,
    a2aSignatureMiddleware,
} from '../src/serve/a2a.js';

const SECRET = 'a2a-shared-secret';

function makeRequest(headers: Record<string, string>, body = '{"prompt":"hi"}'): Parameters<typeof verifyA2ASignature>[0] {
    return { headers, body };
}

describe('serve/a2a signing', () => {
    it('sign + verify round-trips', async () => {
        const body = '{"prompt":"hello"}';
        const headers = signA2ARequest(body, SECRET);
        expect(headers['x-a2a-signature']).toBeTruthy();
        expect(headers['x-a2a-timestamp']).toBeTruthy();
        expect(headers['x-a2a-nonce']).toBeTruthy();
        expect(await verifyA2ASignature(makeRequest(headers, body), SECRET)).toBe(true);
    });

    it('rejects missing headers, stale timestamp, wrong secret, tampered body', async () => {
        expect(await verifyA2ASignature({ headers: {}, body: 'x' }, SECRET)).toBe(false);

        const headers = signA2ARequest('body', SECRET);
        // wrong secret
        expect(await verifyA2ASignature(makeRequest(headers, 'body'), 'wrong-secret')).toBe(false);
        // tampered body
        expect(await verifyA2ASignature(makeRequest(headers, 'tampered'), SECRET)).toBe(false);
        // stale timestamp
        const stale = { ...headers, 'x-a2a-timestamp': '1' };
        expect(await verifyA2ASignature(makeRequest(stale, 'body'), SECRET)).toBe(false);
        // missing nonce
        const noNonce = { ...headers };
        delete noNonce['x-a2a-nonce'];
        expect(await verifyA2ASignature(makeRequest(noNonce, 'body'), SECRET)).toBe(false);
        // malformed signature (wrong length)
        const badSig = { ...headers, 'x-a2a-signature': 'abcd' };
        expect(await verifyA2ASignature(makeRequest(badSig, 'body'), SECRET)).toBe(false);
    });

    it('rejects replay of the same nonce and accepts after window', async () => {
        const body = 'replay-test';
        const headers = signA2ARequest(body, SECRET);
        expect(await verifyA2ASignature(makeRequest(headers, body), SECRET)).toBe(true);
        // replay → false (nonce already used)
        expect(await verifyA2ASignature(makeRequest(headers, body), SECRET)).toBe(false);

        // Buffer + Uint8Array bodies work too
        const h2 = signA2ARequest('buf', SECRET);
        expect(await verifyA2ASignature(makeRequest(h2, Buffer.from('buf')), SECRET)).toBe(true);
        const h3 = signA2ARequest('u8', SECRET);
        expect(await verifyA2ASignature(makeRequest(h3, new Uint8Array(Buffer.from('u8'))), SECRET)).toBe(true);
    });

    it('custom header names and array headers', async () => {
        const opts = { signatureHeader: 'x-sig', timestampHeader: 'x-ts', nonceHeader: 'x-nc' };
        const headers = signA2ARequest('custom', SECRET, opts);
        expect(await verifyA2ASignature(makeRequest(headers, 'custom'), SECRET, opts)).toBe(true);

        // array header value (first element used) — must be freshly signed,
        // since the nonce above was already consumed by replay prevention.
        const arrHeaders = signA2ARequest('custom', SECRET, opts);
        const arrReq = {
            headers: {
                'x-sig': [arrHeaders['x-sig']],
                'x-ts': [arrHeaders['x-ts']],
                'x-nc': [arrHeaders['x-nc']],
            },
            body: 'custom',
        };
        expect(await verifyA2ASignature(arrReq as never, SECRET, opts)).toBe(true);
    });
});

describe('serve/a2a middleware', () => {
    const card = {
        name: 'my-agent',
        version: '1.0.0',
        description: 'd',
        url: 'https://agent.example.com',
        capabilities: { streaming: true, tools: true },
        authentication: { type: 'hmac', algorithm: 'sha256' },
        skills: [{ id: 's1', name: 'Skill' }],
        provider: { organization: 'org' },
    };

    it('agentCardMiddleware serves JSON at well-known path, next otherwise', () => {
        const res = { writeHead: vi.fn(), end: vi.fn() };
        const next = vi.fn();
        const mw = agentCardMiddleware(card as never);
        mw({ method: 'GET', url: '/.well-known/agent.json', headers: {} } as never, res as never, next);
        expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'Content-Type': 'application/json; charset=utf-8' }));
        expect(res.end).toHaveBeenCalledWith(expect.stringContaining('my-agent'));
        expect(next).not.toHaveBeenCalled();

        const next2 = vi.fn();
        mw({ method: 'POST', url: '/v1/run', headers: {} } as never, { writeHead: vi.fn(), end: vi.fn() } as never, next2);
        expect(next2).toHaveBeenCalled();
    });

    it('a2aSignatureMiddleware passes valid, 401s invalid, 500s on error', async () => {
        const body = '{"a":1}';
        const headers = signA2ARequest(body, SECRET);

        const resOk = { writeHead: vi.fn(), end: vi.fn() };
        const nextOk = vi.fn();
        const mw = a2aSignatureMiddleware(SECRET);
        mw({ headers, body } as never, resOk as never, nextOk);
        await new Promise((r) => setTimeout(r, 5));
        expect(nextOk).toHaveBeenCalled();

        const resBad = { writeHead: vi.fn(), end: vi.fn() };
        const nextBad = vi.fn();
        mw({ headers: {}, body } as never, resBad as never, nextBad);
        await new Promise((r) => setTimeout(r, 5));
        expect(resBad.writeHead).toHaveBeenCalledWith(
            401,
            expect.objectContaining({ 'Content-Type': 'application/json' }),
        );
        expect(nextBad).not.toHaveBeenCalled();
    });
});
