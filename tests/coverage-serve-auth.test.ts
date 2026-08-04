/**
 * Hermetic coverage for src/serve/auth.ts — HS256/JWKS verification, JWT
 * helpers, auth + role middleware. No network (JWKS via mocked fetch).
 * Callers: vitest only.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    HS256Verifier,
    JwksVerifier,
    verifyJwt,
    signJwt,
    jwtAuth,
    requireRole,
} from '../src/serve/auth.js';

const SECRET = 'test-secret-123';

function token(payload: Record<string, unknown>, secret = SECRET): string {
    return signJwt({ sub: 'u1', tenantId: 't1', roles: ['user', 'admin'], ...payload } as never, secret);
}

describe('serve/auth JWT helpers', () => {
    it('signJwt + verifyJwt round-trips valid token', () => {
        const t = token({});
        const payload = verifyJwt(t, SECRET);
        expect(payload.sub).toBe('u1');
        expect(payload.roles).toContain('admin');
        expect(payload.iat).toBeGreaterThan(0);
        expect(payload.exp).toBeGreaterThan(payload.iat!);
    });

    it('verifyJwt rejects malformed / wrong alg / bad signature / expired', () => {
        expect(() => verifyJwt('not-a-jwt', SECRET)).toThrow(/Malformed/);
        expect(() => verifyJwt('a.b.c', SECRET)).toThrow(/Invalid JWT header/);

        // wrong alg
        const h = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
        const p = Buffer.from(JSON.stringify({ sub: 'u' })).toString('base64url');
        expect(() => verifyJwt(`${h}.${p}.sig`, SECRET)).toThrow(/Unsupported JWT algorithm/);

        // bad signature — tamper a char that carries real signature bits
        // (the final base64 char only holds padding bits and is a no-op mutation)
        const good = token({});
        const sigStart = good.lastIndexOf('.') + 1;
        const tampered = good.slice(0, sigStart) + (good[sigStart] === 'A' ? 'B' : 'A') + good.slice(sigStart + 1);
        expect(() => verifyJwt(tampered, SECRET)).toThrow(/Invalid JWT signature/);

        // expired
        const expired = signJwt({ sub: 'u', tenantId: 't', roles: [] } as never, SECRET, -10);
        expect(() => verifyJwt(expired, SECRET)).toThrow(/JWT expired/);

        // bad payload — sign a token whose payload isn't valid JSON
        const badH = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
        const badP = Buffer.from('not-json').toString('base64url');
        const badSig = require('node:crypto').createHmac('sha256', SECRET).update(`${badH}.${badP}`).digest('base64url');
        expect(() => verifyJwt(`${badH}.${badP}.${badSig}`, SECRET)).toThrow(/Invalid JWT payload/);
    });

    it('HS256Verifier checks nbf and future iat', async () => {
        const v = new HS256Verifier(SECRET);
        const t = token({});
        expect((await v.verify(t)).sub).toBe('u1');

        // nbf in the future — build manually so nbf survives
        const now = Math.floor(Date.now() / 1000);
        const futureNbf = signJwt({ sub: 'u', tenantId: 't', roles: [], nbf: now + 9999 } as never, SECRET);
        await expect(v.verify(futureNbf)).rejects.toThrow(/nbf/);

        // iat in the future — signJwt overwrites iat, so build manually
        const crypto = require('node:crypto');
        const iatH = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
        const iatP = Buffer.from(JSON.stringify({ sub: 'u', tenantId: 't', roles: [], iat: now + 9999 })).toString('base64url');
        const iatSig = crypto.createHmac('sha256', SECRET).update(`${iatH}.${iatP}`).digest('base64url');
        await expect(v.verify(`${iatH}.${iatP}.${iatSig}`)).rejects.toThrow(/issued in the future/);
    });
});

describe('serve/auth middleware', () => {
    function mockRes() {
        return { status: vi.fn().mockReturnThis(), json: vi.fn() };
    }

    it('jwtAuth attaches user on valid Bearer, 401s otherwise', () => {
        const mw = jwtAuth(SECRET);
        const next = vi.fn();
        const req = { headers: { authorization: `Bearer ${token({})}` } };
        mw(req as never, mockRes() as never, next);
        expect(req.user?.sub).toBe('u1');
        expect(next).toHaveBeenCalled();

        // missing header
        const res1 = mockRes();
        const next1 = vi.fn();
        mw({ headers: {} } as never, res1 as never, next1);
        expect(res1.status).toHaveBeenCalledWith(401);
        expect(next1).not.toHaveBeenCalled();

        // invalid token
        const res2 = mockRes();
        mw({ headers: { authorization: 'Bearer bad.token.here' } } as never, res2 as never, vi.fn());
        expect(res2.status).toHaveBeenCalledWith(401);

        // array header
        const res3 = mockRes();
        mw({ headers: { authorization: ['Bearer x'] } } as never, res3 as never, vi.fn());
        expect(res3.status).toHaveBeenCalledWith(401);
    });

    it('requireRole enforces roles', () => {
        const mw = requireRole('admin');
        const next = vi.fn();
        mw({ user: { roles: ['admin'] } } as never, mockRes() as never, next);
        expect(next).toHaveBeenCalled();

        const res = mockRes();
        mw({ user: { roles: ['user'] } } as never, res as never, vi.fn());
        expect(res.status).toHaveBeenCalledWith(403);

        const res2 = mockRes();
        mw({} as never, res2 as never, vi.fn());
        expect(res2.status).toHaveBeenCalledWith(403);
    });
});

describe('serve/auth JWKS verifier', () => {
    it('rejects malformed tokens and none algorithm', async () => {
        const v = new JwksVerifier('https://x/jwks');
        await expect(v.verify('a.b')).rejects.toThrow(/Malformed/);
        const none = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from('{}').toString('base64url')}.sig`;
        await expect(v.verify(none)).rejects.toThrow(/not allowed/);
        const unsupported = `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${Buffer.from('{}').toString('base64url')}.sig`;
        await expect(v.verify(unsupported)).rejects.toThrow(/Unsupported JWKS algorithm/);
    });

    it('fetch failure and no usable keys', async () => {
        const origFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async () => { throw new Error('net down'); }) as never;
        const v = new JwksVerifier('https://x/jwks');
        const h = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url')}.${Buffer.from('{}').toString('base64url')}.sig`;
        await expect(v.verify(h)).rejects.toThrow(/Failed to fetch JWKS/);
        globalThis.fetch = origFetch;
    });

    it('verifies RS256 token with JWKS key (real RSA keypair + mocked fetch)', async () => {
        const crypto = require('node:crypto');
        const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        const jwk = publicKey.export({ format: 'jwk' });
        jwk.kid = 'key-1';
        jwk.use = 'sig';

        const origFetch = globalThis.fetch;
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }));
        globalThis.fetch = fetchMock as never;

        const v = new JwksVerifier('https://x/jwks', { cacheTtlSeconds: 300 });
        // sign a JWT with the private key (RS256)
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'key-1', typ: 'JWT' })).toString('base64url');
        const now = Math.floor(Date.now() / 1000);
        const payload = Buffer.from(JSON.stringify({ sub: 'u', tenantId: 't', roles: ['user'], exp: now + 3600 })).toString('base64url');
        const signer = crypto.createSign('RSA-SHA256');
        signer.update(`${header}.${payload}`);
        signer.end();
        const sig = signer.sign(privateKey).toString('base64url');
        const token = `${header}.${payload}.${sig}`;

        const claims = await v.verify(token);
        expect(claims.sub).toBe('u');
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // cached — second call does not refetch
        await v.verify(token);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // bad signature → rejected
        const bad = `${header}.${payload}.${sig.slice(0, -2)}AA`;
        await expect(v.verify(bad)).rejects.toThrow(/Invalid JWT signature/);

        // expired claims
        const expPayload = Buffer.from(JSON.stringify({ sub: 'u', tenantId: 't', roles: [], exp: now - 100 })).toString('base64url');
        const s2 = crypto.createSign('RSA-SHA256');
        s2.update(`${header}.${expPayload}`);
        s2.end();
        const sig2 = s2.sign(privateKey).toString('base64url');
        await expect(v.verify(`${header}.${expPayload}.${sig2}`)).rejects.toThrow(/JWT expired/);

        // unknown kid → refetch then fail
        const h2 = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'missing' })).toString('base64url');
        const p2 = Buffer.from(JSON.stringify({ sub: 'u', tenantId: 't', roles: [], exp: now + 100 })).toString('base64url');
        const s3 = crypto.createSign('RSA-SHA256');
        s3.update(`${h2}.${p2}`);
        s3.end();
        const sig3 = s3.sign(privateKey).toString('base64url');
        await expect(v.verify(`${h2}.${p2}.${sig3}`)).rejects.toThrow(/No JWKS key matching/);

        globalThis.fetch = origFetch;
    });
});
