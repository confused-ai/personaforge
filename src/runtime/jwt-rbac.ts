/**
 * JWT RBAC — role-based access control for the HTTP runtime.
 *
 * Adds JWT verification, claim extraction, and per-agent role enforcement
 * on top of the existing auth middleware.
 *
 * @example
 * ```ts
 * import { createHttpService } from 'personaforge/runtime';
 * import { jwtAuth } from 'personaforge/runtime';
 *
 * createHttpService({
 *   agents: [{ name: 'support', agent: supportAgent }],
 *   auth: jwtAuth({
 *     secret: process.env.JWT_SECRET!,
 *     claimsToContext: ['userId', 'tenantId', 'role'],
 *     rbac: {
 *       support: ['role:support', 'role:admin'],
 *       billing: ['role:admin'],
 *     },
 *   }),
 * });
 * ```
 */

import { timingSafeEqual, createHmac, createVerify } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AuthMiddlewareOptions } from './auth.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface JwtAuthOptions {
    /**
     * HMAC-SHA256 secret for HS256 tokens.
     * For RS256 / ES256, pass `publicKey` instead (PEM string).
     */
    secret?: string;
    /** PEM-encoded public key for RS256/ES256 verification. */
    publicKey?: string;
    /**
     * Algorithm to use with `publicKey`. Default: 'RS256'.
     * Supported: RS256, RS384, RS512, ES256, ES384, ES512.
     */
    algorithm?: 'RS256' | 'ES256' | 'RS384' | 'ES384' | 'RS512' | 'ES512';
    /**
     * JWT claims to extract and attach to the request context.
     * These become available in agent hooks via `runOptions.userId` etc.
     */
    claimsToContext?: string[];
    /**
     * Per-agent RBAC: map agent name → allowed role strings.
     * Role strings are matched against the `role` claim (string or string[]).
     * If omitted, any authenticated user can access all agents.
     *
     * @example
     * rbac: {
     *   billing: ['role:admin'],
     *   support: ['role:support', 'role:admin'],
     * }
     */
    rbac?: Record<string, string[]>;
    /**
     * Paths that bypass JWT auth entirely.
     * Default: `['/health', '/v1/health', '/openapi.json', '/v1/openapi.json']`
     */
    publicPaths?: string[];
    /** JWT `iss` claim validation. */
    issuer?: string;
    /** JWT `aud` claim validation. */
    audience?: string;
}

export interface JwtPayload {
    sub?: string;
    iss?: string;
    aud?: string | string[];
    exp?: number;
    iat?: number;
    role?: string | string[];
    userId?: string;
    tenantId?: string;
    [key: string]: unknown;
}

// ── JWT verification (HS256, RS256, ES256 — no external deps) ──────────────

function base64UrlDecode(input: string): string {
    const pad = input.length % 4;
    const padded = pad ? input + '='.repeat(4 - pad) : input;
    return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function base64UrlEncode(buf: Buffer): string {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Verify an HS256 JWT. Returns the payload or throws. */
export function verifyJwtHs256(token: string, secret: string): JwtPayload {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT format');
    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

    // Algorithm-confusion hardening: require an explicit HS256 alg in the header.
    // Reject 'none' and any asymmetric alg so an attacker cannot smuggle an
    // RS256/ES256 token (or unsigned token) into the HMAC verification path.
    const header = JSON.parse(base64UrlDecode(headerB64)) as { alg?: string };
    if (!header.alg) {
        throw new Error('JWT header missing required "alg"');
    }
    if (header.alg !== 'HS256') {
        throw new Error(`JWT algorithm mismatch: expected HS256, got ${header.alg}`);
    }

    // Verify signature
    const expectedBuf = Buffer.from(
        base64UrlEncode(
            createHmac('sha256', secret).update(`${headerB64}.${payloadB64}`).digest()
        ).replace(/-/g, '+').replace(/_/g, '/') + '==',
        'base64'
    );
    const sigBuf = Buffer.from(
        (signatureB64 + '==').replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
    );

    if (expectedBuf.length !== sigBuf.length || !timingSafeEqual(expectedBuf, sigBuf)) {
        throw new Error('JWT signature verification failed');
    }

    const payload = JSON.parse(base64UrlDecode(payloadB64)) as JwtPayload;

    // Expiry check
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        throw new Error('JWT has expired');
    }

    return payload;
}

/**
 * Verify an RS256 or ES256 JWT using a PEM public key.
 * Uses Node.js built-in `crypto.createVerify` — zero external dependencies.
 */
export function verifyJwtAsymmetric(
    token: string,
    publicKeyPem: string,
    algorithm: 'RS256' | 'ES256' | 'RS384' | 'ES384' | 'RS512' | 'ES512' = 'RS256'
): JwtPayload {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT format');
    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

    const header = JSON.parse(base64UrlDecode(headerB64)) as { alg?: string };
    // Algorithm-confusion hardening: require an explicit alg, reject 'none',
    // and require an exact match with the configured algorithm. An absent or
    // mismatched alg must never fall through to verification.
    if (!header.alg) {
        throw new Error('JWT header missing required "alg"');
    }
    if (header.alg.toLowerCase() === 'none') {
        throw new Error('JWT "alg: none" is not permitted');
    }
    if (header.alg !== algorithm) {
        throw new Error(`JWT algorithm mismatch: expected ${algorithm}, got ${header.alg}`);
    }
    // Reject tokens whose alg family does not match the key type expected here
    // (this function only verifies asymmetric RS*/ES* keys).
    if (!/^(RS|ES)/.test(header.alg)) {
        throw new Error(`JWT algorithm "${header.alg}" not valid for asymmetric key verification`);
    }

    // Map JWT algorithm to Node crypto algorithm name
    const cryptoAlg = algorithm.startsWith('ES') ? 'SHA' + algorithm.slice(2) : 'SHA' + algorithm.slice(2);

    const verifier = createVerify(cryptoAlg);
    verifier.update(`${headerB64}.${payloadB64}`);

    // Decode base64url signature to DER
    const pad = signatureB64.length % 4;
    const sigBase64 = (pad ? signatureB64 + '='.repeat(4 - pad) : signatureB64)
        .replace(/-/g, '+')
        .replace(/_/g, '/');

    const verified = verifier.verify(publicKeyPem, sigBase64, 'base64');
    if (!verified) {
        throw new Error('JWT signature verification failed');
    }

    const payload = JSON.parse(base64UrlDecode(payloadB64)) as JwtPayload;

    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        throw new Error('JWT has expired');
    }

    return payload;
}

// ── RBAC helper ────────────────────────────────────────────────────────────

/** Check if the JWT payload has one of the required roles. */
export function hasRole(payload: JwtPayload, requiredRoles: string[]): boolean {
    const payloadRoles = Array.isArray(payload.role)
        ? payload.role
        : payload.role
            ? [payload.role]
            : [];
    return requiredRoles.some((r) => payloadRoles.includes(r));
}

// ── jwtAuth factory ────────────────────────────────────────────────────────

/**
 * Build an `AuthMiddlewareOptions` config for JWT-based authentication with
 * optional RBAC. Pass the result directly to `createHttpService({ auth: ... })`.
 *
 * Claims listed in `claimsToContext` are extracted from the JWT and attached
 * to the request `authContext`, making `userId` and `tenantId` available in
 * `runOptions` when the agent runs.
 */
export function jwtAuth(opts: JwtAuthOptions): AuthMiddlewareOptions {
    const publicPaths = opts.publicPaths ?? [
        '/health', '/v1/health', '/openapi.json', '/v1/openapi.json',
    ];

    return {
        strategy: 'custom',
        publicPaths,
        validate: async (req: IncomingMessage) => {
            const authHeader = req.headers['authorization'] as string | undefined;
            if (!authHeader?.startsWith('Bearer ')) {
                return { authenticated: false, reason: 'Missing or invalid Authorization header' };
            }
            const token = authHeader.slice(7).trim();
            if (!token) {
                return { authenticated: false, reason: 'Empty bearer token' };
            }

            let payload: JwtPayload;
            try {
                if (opts.publicKey) {
                    // RS256 / ES256 asymmetric verification
                    const alg = (opts as { algorithm?: 'RS256' | 'ES256' | 'RS384' | 'ES384' | 'RS512' | 'ES512' }).algorithm ?? 'RS256';
                    payload = verifyJwtAsymmetric(token, opts.publicKey, alg);
                } else if (opts.secret) {
                    payload = verifyJwtHs256(token, opts.secret);
                } else {
                    return { authenticated: false, reason: 'No JWT secret or publicKey configured' };
                }
            } catch (err) {
                return {
                    authenticated: false,
                    reason: err instanceof Error ? err.message : 'JWT verification failed',
                };
            }

            // Issuer / audience validation
            if (opts.issuer && payload.iss !== opts.issuer) {
                return { authenticated: false, reason: 'JWT issuer mismatch' };
            }
            if (opts.audience) {
                const aud = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
                if (!aud.includes(opts.audience)) {
                    return { authenticated: false, reason: 'JWT audience mismatch' };
                }
            }

            // RBAC: check agent-level role requirements
            if (opts.rbac) {
                // Extract agent name from URL: /v1/chat, /chat with body.agent, or path /agents/:name/chat
                // We do a best-effort parse here; the server enforces at request level too
                const url = req.url ?? '';
                const agentFromPath = url.match(/\/agents\/([^/]+)\//)?.[1];
                if (agentFromPath && opts.rbac[agentFromPath]) {
                    const requiredRoles = opts.rbac[agentFromPath]!;
                    if (!hasRole(payload, requiredRoles)) {
                        return {
                            authenticated: false,
                            reason: `Insufficient role for agent '${agentFromPath}'. Required: ${requiredRoles.join(' | ')}`,
                        };
                    }
                }
            }

            // Extract claims to context
            const claims: Record<string, unknown> = {};
            if (opts.claimsToContext) {
                for (const claim of opts.claimsToContext) {
                    if (payload[claim] !== undefined) {
                        claims[claim] = payload[claim];
                    }
                }
            }
            // Always include standard fields
            const identity = payload.sub ?? payload.userId ?? 'unknown';
            claims['jwtPayload'] = payload;

            return { authenticated: true, identity, claims };
        },
    } as unknown as AuthMiddlewareOptions;
}
