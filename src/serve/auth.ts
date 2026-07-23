/**
 * JWT authentication + RBAC middleware for the HTTP runtime.
 *
 * Zero external dependencies — HS256 verification is implemented using
 * Node.js `node:crypto` HMAC with `timingSafeEqual` to prevent timing attacks.
 *
 * @module
 */

import { createHmac, timingSafeEqual, createVerify, createPublicKey, type KeyObject } from 'node:crypto';
import { PersonaForgeError, ERROR_CODES } from '../contracts/index.js';

// ── JWT types ──────────────────────────────────────────────────────────────

export interface JwtPayload {
  /** Subject (userId) */
  sub: string;
  tenantId: string;
  roles: string[];
  /** Issued-at (epoch seconds) */
  iat: number;
  /** Expiry (epoch seconds) */
  exp: number;
  /** Not-before (epoch seconds) — optional standard JWT claim */
  nbf?: number;
  [key: string]: unknown;
}

/**
 * JwtVerifier — pluggable interface for different JWT verification strategies.
 * Allows swapping between HS256 (zero-dependency), JWKS (RS256/EC), etc.
 */
export interface JwtVerifier {
  /**
   * Verify a JWT token and return its decoded payload.
   * @throws {PersonaForgeError} with code `UNAUTHORIZED` on any verification failure
   */
  verify(token: string): Promise<JwtPayload>;
}

/**
 * HS256Verifier — production-grade HS256 JWT verification.
 *
 * Features:
 * - Timing-safe signature verification
 * - Clock tolerance for distributed systems (default 60s)
 * - Validation of `nbf` (not before) and `iat` (issued at) claims
 * - Zero external dependencies
 *
 * @example
 * ```ts
 * const verifier = new HS256Verifier(process.env.JWT_SECRET!, { clockToleranceSecs: 60 });
 * const payload = await verifier.verify(token);
 * ```
 */
export class HS256Verifier implements JwtVerifier {
  constructor(
    private readonly secret: string,
    private readonly options: { clockToleranceSecs?: number } = {},
  ) {}

  verify(token: string): Promise<JwtPayload> {
    const clockTolerance = this.options.clockToleranceSecs ?? 60;
    const payload = verifyJwt(token, this.secret);
    const now = Date.now() / 1000;

    // Check not-before (nbf)
    if (
      typeof payload.nbf === 'number' &&
      now < payload.nbf - clockTolerance
    ) {
      return Promise.reject(new PersonaForgeError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: `JWT not yet valid (nbf: ${payload.nbf}, now: ${now}, tolerance: ${clockTolerance}s)`,
      }));
    }

    // Check issued-at (iat) floor — token shouldn't be from the future
    if (
      typeof payload.iat === 'number' &&
      payload.iat > now + clockTolerance
    ) {
      return Promise.reject(new PersonaForgeError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: `JWT issued in the future (iat: ${payload.iat}, now: ${now})`,
      }));
    }

    return Promise.resolve(payload);
  }
}

/** A single JSON Web Key (RSA or EC) as returned by a JWKS endpoint. */
interface Jwk {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
  [key: string]: unknown;
}

/** Allowlisted asymmetric JWT algorithms → Node `createVerify` digest names. */
const JWKS_ALG_TO_DIGEST: Record<string, string> = {
  RS256: 'RSA-SHA256',
  RS384: 'RSA-SHA384',
  RS512: 'RSA-SHA512',
  PS256: 'RSA-SHA256',
  PS384: 'RSA-SHA384',
  PS512: 'RSA-SHA512',
  ES256: 'SHA256',
  ES384: 'SHA384',
  ES512: 'SHA512',
};

/**
 * JwksVerifier — RS256/EC JWT verification with remote JWKS key fetching.
 *
 * - Fetches the JWKS document from the configured URI.
 * - Matches the signing key by the token's `kid` header.
 * - Caches keys for `cacheTtlSeconds` (default 300s) and refetches on a `kid` miss.
 * - Verifies RS/PS/ES signatures with `node:crypto`. The `none` algorithm and any
 *   non-allowlisted algorithm are rejected.
 *
 * @example
 * ```ts
 * const verifier = new JwksVerifier('https://auth.example.com/.well-known/jwks.json');
 * const payload = await verifier.verify(token);
 * ```
 */
export class JwksVerifier implements JwtVerifier {
  private readonly _jwksUri: string;
  private readonly _cacheTtlSeconds: number;
  private readonly _clockToleranceSecs: number;
  private _keyCache = new Map<string, KeyObject>();
  private _cacheExpiresAt = 0;
  private _inflight: Promise<void> | null = null;

  constructor(
    jwksUri: string,
    options: { cacheTtlSeconds?: number; clockToleranceSecs?: number } = {},
  ) {
    this._jwksUri = jwksUri;
    this._cacheTtlSeconds = options.cacheTtlSeconds ?? 300;
    this._clockToleranceSecs = options.clockToleranceSecs ?? 60;
  }

  async verify(token: string): Promise<JwtPayload> {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new PersonaForgeError({ code: ERROR_CODES.UNAUTHORIZED, message: 'Malformed JWT' });
    }
    const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

    // Parse + validate header
    let header: { alg?: string; kid?: string };
    try {
      header = JSON.parse(base64UrlDecode(headerB64).toString('utf8')) as { alg?: string; kid?: string };
    } catch {
      throw new PersonaForgeError({ code: ERROR_CODES.UNAUTHORIZED, message: 'Invalid JWT header' });
    }

    const alg = header.alg;
    if (!alg || alg === 'none') {
      throw new PersonaForgeError({ code: ERROR_CODES.UNAUTHORIZED, message: 'JWT algorithm "none" is not allowed' });
    }
    const digest = JWKS_ALG_TO_DIGEST[alg];
    if (!digest) {
      throw new PersonaForgeError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: `Unsupported JWKS algorithm: ${alg}`,
      });
    }

    // Resolve the signing key by kid (refetch on miss / expiry).
    const key = await this.resolveKey(header.kid);

    // Verify signature.
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = base64UrlDecode(sigB64);
    const verifier = createVerify(digest);
    verifier.update(signingInput);
    verifier.end();

    let ok: boolean;
    try {
      // ES signatures from JWS are raw r||s; Node accepts that via dsaEncoding 'ieee-p1363'.
      if (alg.startsWith('ES')) {
        ok = verifier.verify({ key, dsaEncoding: 'ieee-p1363' }, signature);
      } else if (alg.startsWith('PS')) {
        ok = verifier.verify(
          { key, padding: 6 /* RSA_PKCS1_PSS_PADDING */, saltLength: -1 /* RSA_PSS_SALTLEN_DIGEST */ },
          signature,
        );
      } else {
        ok = verifier.verify(key, signature);
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      throw new PersonaForgeError({ code: ERROR_CODES.UNAUTHORIZED, message: 'Invalid JWT signature' });
    }

    // Decode + validate claims.
    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new PersonaForgeError({ code: ERROR_CODES.UNAUTHORIZED, message: 'Invalid JWT payload' });
    }

    const now = Date.now() / 1000;
    if (typeof claims['exp'] === 'number' && now > (claims['exp'] as number) + this._clockToleranceSecs) {
      throw new PersonaForgeError({ code: ERROR_CODES.UNAUTHORIZED, message: 'JWT expired' });
    }
    if (typeof claims['nbf'] === 'number' && now < (claims['nbf'] as number) - this._clockToleranceSecs) {
      throw new PersonaForgeError({ code: ERROR_CODES.UNAUTHORIZED, message: 'JWT not yet valid' });
    }

    return claims as unknown as JwtPayload;
  }

  /** Return the cached key for `kid`, refetching the JWKS on a miss or TTL expiry. */
  private async resolveKey(kid?: string): Promise<KeyObject> {
    const fresh = Date.now() < this._cacheExpiresAt;
    if (fresh) {
      const cached = this.lookupKey(kid);
      if (cached) return cached;
    }
    await this.refreshKeys();
    const key = this.lookupKey(kid);
    if (!key) {
      throw new PersonaForgeError({
        code: ERROR_CODES.UNAUTHORIZED,
        message: kid ? `No JWKS key matching kid '${kid}'` : 'No JWKS keys available',
      });
    }
    return key;
  }

  private lookupKey(kid?: string): KeyObject | undefined {
    if (kid) return this._keyCache.get(kid);
    // No kid in token — only safe to use a single-key JWKS.
    if (this._keyCache.size === 1) return this._keyCache.values().next().value;
    return undefined;
  }

  /** Fetch and cache the JWKS. De-dupes concurrent refreshes. */
  private async refreshKeys(): Promise<void> {
    if (this._inflight) return this._inflight;
    this._inflight = (async () => {
      let res: Response;
      try {
        res = await fetch(this._jwksUri);
      } catch (e) {
        throw new PersonaForgeError({
          code: ERROR_CODES.UNAUTHORIZED,
          message: `Failed to fetch JWKS: ${e instanceof Error ? e.message : String(e)}`,
        });
      }
      if (!res.ok) {
        throw new PersonaForgeError({
          code: ERROR_CODES.UNAUTHORIZED,
          message: `JWKS endpoint returned ${res.status}`,
        });
      }
      const body = (await res.json()) as { keys?: Jwk[] };
      const keys = Array.isArray(body.keys) ? body.keys : [];
      const next = new Map<string, KeyObject>();
      let anonymous = 0;
      for (const jwk of keys) {
        if (jwk.use && jwk.use !== 'sig') continue;
        let keyObject: KeyObject;
        try {
          // Node accepts JWK directly via createPublicKey({ key, format: 'jwk' }).
          keyObject = createPublicKey({ key: jwk as Record<string, unknown>, format: 'jwk' });
        } catch {
          continue;
        }
        const id = jwk.kid ?? `__anon_${anonymous++}`;
        next.set(id, keyObject);
      }
      if (next.size === 0) {
        throw new PersonaForgeError({
          code: ERROR_CODES.UNAUTHORIZED,
          message: 'JWKS document contained no usable signing keys',
        });
      }
      this._keyCache = next;
      this._cacheExpiresAt = Date.now() + this._cacheTtlSeconds * 1000;
    })().finally(() => {
      this._inflight = null;
    });
    return this._inflight;
  }
}

// ── Low-level JWT helpers ──────────────────────────────────────────────────

function base64UrlDecode(str: string): Buffer {
  // Re-pad and convert URL-safe chars back to standard base64
  const padded = str + '=='.slice(0, (4 - (str.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Verify an HS256 JWT and return its decoded payload.
 *
 * @throws {PersonaForgeError} with code `UNAUTHORIZED` on any failure
 */
export function verifyJwt(token: string, secret: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new PersonaForgeError({ code: ERROR_CODES.UNAUTHORIZED, message: 'Malformed JWT' });
  }

  const [header, payload, sig] = parts as [string, string, string];

  // Verify header declares HS256
  let headerObj: Record<string, unknown>;
  try {
    headerObj = JSON.parse(base64UrlDecode(header).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new PersonaForgeError({ code: ERROR_CODES.UNAUTHORIZED, message: 'Invalid JWT header' });
  }
  if (headerObj['alg'] !== 'HS256') {
    throw new PersonaForgeError({
      code: ERROR_CODES.UNAUTHORIZED,
      message: `Unsupported JWT algorithm: ${String(headerObj['alg'])}`,
    });
  }

  // Timing-safe signature check
  const expected = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest();
  const actual = base64UrlDecode(sig);
  const safeLen = Math.max(expected.length, actual.length);
  // Pad to same length before timingSafeEqual (it requires equal-length buffers)
  const ePadded = Buffer.concat([expected, Buffer.alloc(safeLen - expected.length)]);
  const aPadded = Buffer.concat([actual, Buffer.alloc(safeLen - actual.length)]);

  if (expected.length !== actual.length || !timingSafeEqual(ePadded, aPadded)) {
    throw new PersonaForgeError({ code: ERROR_CODES.UNAUTHORIZED, message: 'Invalid JWT signature' });
  }

  // Decode claims
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(base64UrlDecode(payload).toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new PersonaForgeError({ code: ERROR_CODES.UNAUTHORIZED, message: 'Invalid JWT payload' });
  }

  // Expiry check
  if (typeof claims['exp'] === 'number' && Date.now() / 1000 > claims['exp']) {
    throw new PersonaForgeError({ code: ERROR_CODES.UNAUTHORIZED, message: 'JWT expired' });
  }

  return claims as unknown as JwtPayload;
}

// ── Express-compatible middleware types ───────────────────────────────────

export interface AuthenticatedReq {
  headers: Record<string, string | string[] | undefined>;
  user?: JwtPayload;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): unknown;
}
type Next = (err?: unknown) => void;
export type AuthMiddleware = (req: AuthenticatedReq, res: Res, next: Next) => void;

// ── Middleware factories ───────────────────────────────────────────────────

/**
 * Express-compatible JWT Bearer authentication middleware.
 *
 * On success, attaches the decoded payload to `req.user`.
 * On failure, responds with `401 UNAUTHORIZED`.
 *
 * @example
 * ```ts
 * app.use(jwtAuth(process.env.JWT_SECRET!));
 * app.post('/v1/chat', (req, res) => {
 *   console.log(req.user?.sub); // userId
 * });
 * ```
 */
export function jwtAuth(secret: string): AuthMiddleware {
  return (req, res, next) => {
    const auth = Array.isArray(req.headers['authorization'])
      ? req.headers['authorization'][0]
      : req.headers['authorization'];

    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Bearer token required' });
      return;
    }

    try {
      req.user = verifyJwt(auth.slice(7), secret);
      next();
    } catch (e) {
      const msg = e instanceof PersonaForgeError ? e.message : 'Invalid token';
      res.status(401).json({ error: 'UNAUTHORIZED', message: msg });
    }
  };
}

/**
 * Express-compatible role-guard middleware.
 *
 * Must be used **after** `jwtAuth()`. Responds with `403 FORBIDDEN` when
 * the authenticated user does not have the required role.
 *
 * @example
 * ```ts
 * app.delete('/v1/agents/:id',
 *   jwtAuth(secret),
 *   requireRole('admin'),
 *   deleteAgentHandler,
 * );
 * ```
 */
export function requireRole(role: string): AuthMiddleware {
  return (req, res, next) => {
    if (!req.user?.roles.includes(role)) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: `Role '${role}' required`,
        required: role,
      });
      return;
    }
    next();
  };
}

/**
 * Utility: sign a minimal HS256 JWT (useful in tests and CLI tooling).
 *
 * @example
 * ```ts
 * const token = signJwt({ sub: 'u1', tenantId: 't1', roles: ['user'] }, secret, 3600);
 * ```
 */
export function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp'>,
  secret: string,
  expiresInSeconds = 3600,
): string {
  const now = Math.floor(Date.now() / 1000);
  // TS struggles to narrow Omit<JwtPayload,…> spread with index-sig; assertion is safe here
  const claims = { ...payload, iat: now, exp: now + expiresInSeconds } as JwtPayload;

  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const body = Buffer.from(JSON.stringify(claims))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const sig = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  return `${header}.${body}.${sig}`;
}
