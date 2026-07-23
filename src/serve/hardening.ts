/**
 * HTTP security hardening middleware.
 *
 * Zero external dependencies — uses only standard HTTP headers so the
 * middleware works with any Express-compatible router (Express 4/5,
 * Connect, Polka, etc.).
 *
 * @module
 */

interface Req {
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  header?: (name: string) => string | undefined;
}
interface Res {
  status(code: number): Res;
  json(body: unknown): unknown;
  setHeader(name: string, value: string): void;
  end(): void;
}
type Next = (err?: unknown) => void;
export type Middleware = (req: Req, res: Res, next: Next) => void;

// ── Security Headers ───────────────────────────────────────────────────────

/**
 * Sets a hardened set of security response headers (helmet-equivalent):
 *
 * - `Content-Security-Policy` — restrictive default-src
 * - `X-Content-Type-Options: nosniff`
 * - `X-Frame-Options: DENY`
 * - `X-XSS-Protection: 0` (disabled in favour of CSP)
 * - `Referrer-Policy: strict-origin-when-cross-origin`
 * - `Permissions-Policy` — disables sensitive browser APIs
 * - Removes `X-Powered-By`
 *
 * @example
 * ```ts
 * app.use(securityHeaders());
 * ```
 */
export function securityHeaders(): Middleware {
  return (_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'",
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()',
    );
    // Override Express default to avoid advertising implementation details
    res.setHeader('X-Powered-By', 'personaforge');
    next();
  };
}

// ── CORS ───────────────────────────────────────────────────────────────────

export interface CorsOptions {
  /** Allowed origins. Use `'*'` for open APIs, or an allowlist for production. */
  origin: string | string[] | RegExp;
  /** Allowed HTTP methods (default: GET, POST, PUT, PATCH, DELETE, OPTIONS). */
  methods?: string[];
  /** Allowed request headers (default: Content-Type, Authorization). */
  allowedHeaders?: string[];
  /** Whether to allow credentials (default: false). */
  credentials?: boolean;
  /** Max age in seconds for preflight cache (default: 86400). */
  maxAge?: number;
}

/**
 * CORS middleware with an explicit origin allowlist.
 *
 * @example
 * ```ts
 * // Development: open
 * app.use(cors({ origin: '*' }));
 *
 * // Production: explicit allowlist
 * app.use(cors({ origin: ['https://app.example.com', 'https://admin.example.com'] }));
 * ```
 */
export function cors(opts: CorsOptions): Middleware {
  const methods = (opts.methods ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']).join(', ');
  const allowedHeaders = (opts.allowedHeaders ?? ['Content-Type', 'Authorization']).join(', ');

  return (req, res, next) => {
    const origin = Array.isArray(req.headers['origin'])
      ? (req.headers['origin'][0] ?? '')
      : (req.headers['origin']) ?? '';

    const allowed = isOriginAllowed(origin, opts.origin);
    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin || '*');
      if (opts.credentials) res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    // Vary: Origin is required when the response differs by origin (allowlist mode).
    // Without it CDNs will cache a response for origin A and serve it for origin B.
    if (opts.origin !== '*') {
      res.setHeader('Vary', 'Origin');
    }

    // Preflight
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', methods);
      res.setHeader('Access-Control-Allow-Headers', allowedHeaders);
      res.setHeader('Access-Control-Max-Age', String(opts.maxAge ?? 86_400));
      res.status(204).end();
      return;
    }

    next();
  };
}

function isOriginAllowed(origin: string, allowed: string | string[] | RegExp): boolean {
  if (allowed === '*') return true;
  if (typeof allowed === 'string') return origin === allowed;
  if (Array.isArray(allowed)) return allowed.includes(origin);
  if (allowed instanceof RegExp) return allowed.test(origin);
  return false;
}

// ── Body Size Limit ────────────────────────────────────────────────────────

/**
 * Rejects requests whose `Content-Length` header exceeds `maxBytes`.
 *
 * Note: this only checks the header — pair with your parser's `limit` option
 * for defence in depth.
 *
 * @example
 * ```ts
 * app.use(bodyLimit(1_048_576)); // 1 MB
 * ```
 */
export function bodyLimit(maxBytes: number): Middleware {
  return (req, res, next) => {
    const raw = req.headers['content-length'];
    const len = typeof raw === 'string' ? parseInt(raw, 10) : NaN;
    if (!isNaN(len) && len > maxBytes) {
      res
        .status(413)
        .json({ error: 'PAYLOAD_TOO_LARGE', maxBytes, received: len });
      return;
    }
    next();
  };
}
