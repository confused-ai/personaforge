/**
 * HTTP Auth Middleware
 *
 * Supports four authentication strategies:
 *   - `api-key`   — validates `X-API-Key` or `Authorization: Bearer <key>` header against a
 *                   static key list or a custom async validator.
 *   - `bearer`    — validates `Authorization: Bearer <token>` with a custom async validator
 *                   (JWT verification, database lookup, etc.).
 *   - `basic`     — HTTP Basic auth with a custom async validator.
 *   - `custom`    — Full control: receive the raw IncomingMessage, return AuthResult.
 *
 * Public routes (e.g. /health) bypass auth by default and can be extended via `publicPaths`.
 *
 * Edge cases covered:
 *   - Missing Authorization header → 401 with WWW-Authenticate challenge
 *   - Malformed header format (e.g. "Bearer" with no token) → 401
 *   - Empty api-key / token string → 401 (prevents accidental allow-all)
 *   - Validator throws → surfaced as 500 only if no auth result returned; treated as 401 otherwise
 *   - Timing-safe comparison for static API key lists (prevents timing attacks)
 *   - `publicPaths` checked before any auth logic (exact match + prefix match with trailing `/`)
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';

// ── Types ──────────────────────────────────────────────────────────────────

export interface AuthResult {
    /** Whether the request is authenticated. */
    authenticated: boolean;
    /** Identity extracted from the credential (userId, subject, etc.). */
    identity?: string;
    /** Arbitrary claims/metadata to pass downstream. */
    claims?: Record<string, unknown>;
    /** Rejection reason (only used when authenticated=false). */
    reason?: string;
}

export interface AuthContext {
    identity?: string;
    claims?: Record<string, unknown>;
}

/** Common base for all strategies. */
interface AuthStrategyBase {
    /**
     * Paths that bypass auth entirely.
     * Supports exact match (`/health`) and prefix match (`/public/`).
     * Default: `['/health', '/v1/health']`
     */
    publicPaths?: string[];
    /**
     * Realm for WWW-Authenticate challenge header.
     * Default: `'personaforge'`
     */
    realm?: string;
}

/** Validate a static list of API keys. */
export interface ApiKeyStrategyOptions extends AuthStrategyBase {
    strategy: 'api-key';
    /** Header to read the key from. Default: 'x-api-key' */
    header?: string;
    /** Also accept `Authorization: Bearer <key>`. Default: true */
    acceptBearer?: boolean;
    /** Static set of valid keys. Keys are compared in constant time. */
    keys?: string[];
    /** Async validator; takes precedence over `keys` when provided. */
    validate?: (key: string) => Promise<AuthResult> | AuthResult;
}

/** Bearer token validation (JWT, opaque, etc.) */
export interface BearerStrategyOptions extends AuthStrategyBase {
    strategy: 'bearer';
    validate: (token: string) => Promise<AuthResult> | AuthResult;
}

/** HTTP Basic auth */
export interface BasicStrategyOptions extends AuthStrategyBase {
    strategy: 'basic';
    validate: (username: string, password: string) => Promise<AuthResult> | AuthResult;
}

/** Fully custom auth. */
export interface CustomStrategyOptions extends AuthStrategyBase {
    strategy: 'custom';
    validate: (req: IncomingMessage) => Promise<AuthResult> | AuthResult;
}

export type AuthMiddlewareOptions =
    | ApiKeyStrategyOptions
    | BearerStrategyOptions
    | BasicStrategyOptions
    | CustomStrategyOptions;

// ── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_PUBLIC_PATHS = ['/health', '/v1/health'];

/**
 * Constant-time string comparison to prevent timing attacks.
 * Hashes both strings first so lengths aren't leaked.
 */
function safeEqual(a: string, b: string): boolean {
    const ha = createHash('sha256').update(a).digest();
    const hb = createHash('sha256').update(b).digest();
    return timingSafeEqual(ha, hb);
}

function isPublicPath(path: string, publicPaths: string[]): boolean {
    const stripped = path.split('?')[0] ?? path;
    for (const p of publicPaths) {
        if (stripped === p) return true;
        // Prefix match: '/public/' covers '/public/anything'
        if (p.endsWith('/') && stripped.startsWith(p)) return true;
    }
    return false;
}

function sendUnauthorized(res: ServerResponse, realm: string, reason?: string): void {
    res.setHeader('WWW-Authenticate', `Bearer realm="${realm}"`);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(401);
    res.end(JSON.stringify({ error: 'Unauthorized', reason: reason ?? 'Invalid or missing credentials' }));
}

/** Send 403 Forbidden — exported for use by custom validators. */
export function sendForbidden(res: ServerResponse, reason?: string): void {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.writeHead(403);
    res.end(JSON.stringify({ error: 'Forbidden', reason: reason ?? 'Access denied' }));
}

// ── Strategy implementations ───────────────────────────────────────────────

async function runApiKey(
    req: IncomingMessage,
    opts: ApiKeyStrategyOptions
): Promise<AuthResult> {
    const headerName = (opts.header ?? 'x-api-key').toLowerCase();
    const acceptBearer = opts.acceptBearer !== false;

    let key: string | undefined;

    // Try custom header first
    const customHeader = req.headers[headerName];
    if (typeof customHeader === 'string' && customHeader.trim()) {
        key = customHeader.trim();
    }

    // Fall back to Authorization: Bearer
    if (!key && acceptBearer) {
        const auth = req.headers['authorization'];
        if (typeof auth === 'string') {
            const match = auth.match(/^Bearer\s+(.+)$/i);
            if (match?.[1]?.trim()) {
                key = match[1].trim();
            }
        }
    }

    if (!key) {
        return { authenticated: false, reason: 'Missing API key' };
    }

    if (opts.validate) {
        return opts.validate(key);
    }

    if (opts.keys && opts.keys.length > 0) {
        const valid = opts.keys.some((k) => safeEqual(k, key!));
        if (!valid) return { authenticated: false, reason: 'Invalid API key' };
        // Hash identity from key so we don't expose the raw key in logs
        const identity = createHash('sha256').update(key).digest('hex').slice(0, 12);
        return { authenticated: true, identity };
    }

    // No keys and no validator configured — deny by default
    return { authenticated: false, reason: 'No API keys configured' };
}

async function runBearer(
    req: IncomingMessage,
    opts: BearerStrategyOptions
): Promise<AuthResult> {
    const auth = req.headers['authorization'];
    if (!auth || typeof auth !== 'string') {
        return { authenticated: false, reason: 'Missing Authorization header' };
    }
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]?.trim()) {
        return { authenticated: false, reason: 'Malformed Bearer token' };
    }
    return opts.validate(match[1].trim());
}

async function runBasic(
    req: IncomingMessage,
    opts: BasicStrategyOptions
): Promise<AuthResult> {
    const auth = req.headers['authorization'];
    if (!auth || typeof auth !== 'string') {
        return { authenticated: false, reason: 'Missing Authorization header' };
    }
    const match = auth.match(/^Basic\s+(.+)$/i);
    if (!match?.[1]) {
        return { authenticated: false, reason: 'Malformed Basic auth header' };
    }
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const colonIdx = decoded.indexOf(':');
    if (colonIdx === -1) {
        return { authenticated: false, reason: 'Invalid Basic credentials format (no colon)' };
    }
    const username = decoded.slice(0, colonIdx);
    const password = decoded.slice(colonIdx + 1);
    if (!username || !password) {
        return { authenticated: false, reason: 'Empty username or password' };
    }
    return opts.validate(username, password);
}

// ── Main factory ──────────────────────────────────────────────────────────

/**
 * Create an auth middleware function.
 *
 * Returns a function `(req, res) => Promise<AuthContext | null>`.
 * - Returns `AuthContext` if the request is authenticated.
 * - Returns `null` and has already written the 401/403 response if not.
 * - Returns `AuthContext` (possibly empty) for public paths — caller can proceed.
 *
 * @example
 * ```ts
 * const auth = createAuthMiddleware({
 *   strategy: 'api-key',
 *   keys: ['sk-my-secret-key'],
 * });
 *
 * // In your HTTP handler:
 * const ctx = await auth(req, res);
 * if (!ctx) return; // already sent 401
 * ```
 */
export function createAuthMiddleware(
    options: AuthMiddlewareOptions
): (req: IncomingMessage, res: ServerResponse) => Promise<AuthContext | null> {
    const publicPaths = options.publicPaths ?? DEFAULT_PUBLIC_PATHS;
    const realm = options.realm ?? 'personaforge';

    return async (req: IncomingMessage, res: ServerResponse): Promise<AuthContext | null> => {
        const path = (req.url ?? '/').split('?')[0] ?? '/';

        // Public routes bypass auth
        if (isPublicPath(path, publicPaths)) {
            return {};
        }

        let result: AuthResult;

        try {
            switch (options.strategy) {
                case 'api-key':
                    result = await runApiKey(req, options);
                    break;
                case 'bearer':
                    result = await runBearer(req, options);
                    break;
                case 'basic':
                    result = await runBasic(req, options);
                    break;
                case 'custom':
                    result = await options.validate(req);
                    break;
            }
        } catch (err) {
            // Validator threw — treat as auth failure, not server error
            const reason = err instanceof Error ? err.message : String(err);
            sendUnauthorized(res, realm, reason);
            return null;
        }

        if (!result.authenticated) {
            sendUnauthorized(res, realm, result.reason);
            return null;
        }

        return { identity: result.identity, claims: result.claims };
    };
}

/**
 * Convenience: create a simple static API-key middleware.
 *
 * @example
 * ```ts
 * const auth = apiKeyAuth(['sk-prod-abc123', 'sk-dev-xyz789']);
 * createHttpService({ agents, auth });
 * ```
 */
export function apiKeyAuth(
    keys: string[],
    opts?: Omit<ApiKeyStrategyOptions, 'strategy' | 'keys'>
): ReturnType<typeof createAuthMiddleware> {
    return createAuthMiddleware({ strategy: 'api-key', keys, ...opts });
}

/**
 * Convenience: create a bearer-token middleware with a custom validator.
 *
 * @example
 * ```ts
 * const auth = bearerAuth(async (token) => {
 *   const payload = jwt.verify(token, process.env.JWT_SECRET!);
 *   return { authenticated: true, identity: payload.sub as string };
 * });
 * ```
 */
export function bearerAuth(
    validate: BearerStrategyOptions['validate'],
    opts?: Omit<BearerStrategyOptions, 'strategy' | 'validate'>
): ReturnType<typeof createAuthMiddleware> {
    return createAuthMiddleware({ strategy: 'bearer', validate, ...opts });
}
