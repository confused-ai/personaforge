/**
 * @personaforge/tools — built-in HTTP client tool.
 *
 * SRP  — this file owns only the HTTP tool.
 * DIP  — returns the Tool interface; no class inheritance.
 * DS   — uses built-in fetch (zero deps). URL validation is O(1).
 *
 * SSRF protection is enabled by default. The following hosts are always blocked:
 *   - loopback (127.x, ::1, localhost)
 *   - private RFC-1918 ranges (10.x, 172.16-31.x, 192.168.x)
 *   - link-local / cloud metadata (169.254.x — covers AWS/GCP/Azure IMDS)
 *   - .internal / .local hostnames
 *
 * Override with `allowedDomains` / `blockedDomains` options.
 */

import { z } from 'zod';
import { lookup as dnsLookup } from 'node:dns/promises';
import { defineTool } from './types.js';

// ── SSRF block-list (checked on every request) ────────────────────────────
const SSRF_BLOCKED_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,       // AWS/GCP/Azure instance metadata service (IMDS)
  /^100\.64\./,        // Carrier-grade NAT (RFC 6598) — may reach internal services
  // IPv6-mapped IPv4 addresses (e.g. ::ffff:10.0.0.1 bypasses plain IPv4 checks)
  /^::ffff:10\./i,
  /^::ffff:127\./i,
  /^::ffff:169\.254\./i,
  /^::ffff:192\.168\./i,
  /^::ffff:172\.(1[6-9]|2[0-9]|3[01])\./i,
  /\.internal$/i,
  /\.local$/i,
];

/** Check if a hostname matches the static SSRF blocklist (O(1), no I/O). */
function isBlockedByPattern(hostname: string): boolean {
  return SSRF_BLOCKED_PATTERNS.some(p => p.test(hostname));
}

/** Check if a resolved IP address is in a private/loopback/link-local range. */
function isPrivateIp(ip: string): boolean {
  return SSRF_BLOCKED_PATTERNS.some(p => p.test(ip));
}

/**
 * Resolve hostname → IP and verify it is not a private address.
 * Returns an error string if blocked, null if OK.
 * Enforces a 2-second DNS timeout to prevent slow-DNS amplification.
 */
async function checkDns(hostname: string): Promise<string | null> {
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => { reject(new Error('DNS lookup timed out')); }, 2_000),
    );
    const { address } = await Promise.race([dnsLookup(hostname), timeout]);
    if (isPrivateIp(address)) {
      return (
        `SSRF blocked: "${hostname}" resolves to a private/internal IP (${address}). ` +
        'Requests to private networks are not permitted.'
      );
    }
    return null;
  } catch (e) {
    // DNS timeout or resolution failure — block by default (fail-closed).
    const msg = e instanceof Error ? e.message : String(e);
    return `SSRF blocked: DNS resolution for "${hostname}" failed — ${msg}`;
  }
}

/**
 * Full async SSRF check: static pattern first, then DNS resolution.
 * Returns an error string if blocked, null if permitted.
 *
 * Exported so legacy tools (browser, utils/http) reuse this single hardened
 * guard (DNS resolution + IMDS/RFC-1918/CGNAT/IPv6-mapped blocks) instead of a
 * weaker hostname-string-only check.
 */
export async function checkSsrf(hostname: string): Promise<string | null> {
  const h = hostname.toLowerCase();
  if (isBlockedByPattern(h)) {
    return (
      `SSRF blocked: requests to "${h}" are not permitted. ` +
      'This host matches a private/internal network range.'
    );
  }
  // DNS resolution check — catches cases where a public domain name resolves
  // to a private IP (e.g. DNS rebinding, split-horizon DNS, internal aliases).
  return checkDns(h);
}

// ── Schema ─────────────────────────────────────────────────────────────────
const HttpInputSchema = z.object({
  url:     z.string().url(),
  method:  z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
  headers: z.record(z.string(), z.string()).optional(),
  body:    z.string().optional(),
  /** Timeout in ms. Default 30 000. */
  timeout: z.number().int().positive().max(120_000).optional(),
});

// ── Options ────────────────────────────────────────────────────────────────
export interface HttpClientToolOptions {
  /**
   * Explicit domain allowlist.  When set, only hostnames that equal or are a
   * subdomain of a listed domain are permitted.
   * Example: `['api.github.com', 'openai.com']`
   */
  allowedDomains?: string[];
  /**
   * Additional hostnames/patterns to block on top of the built-in SSRF list.
   * Example: `['internal-proxy.corp']`
   */
  blockedDomains?: string[];
  /**
   * Disable the built-in SSRF block-list.
   * **Only set this to `true` in fully-trusted, isolated environments.**
   * @default false
   */
  disableSsrfProtection?: boolean;
}

// ── Factory ────────────────────────────────────────────────────────────────
/**
 * Create an HTTP client tool with configurable SSRF protection.
 *
 * @example
 * // Default — SSRF protection on, any public URL allowed
 * const http = createHttpClientTool();
 *
 * @example
 * // Domain allowlist — only GitHub and OpenAI APIs reachable
 * const http = createHttpClientTool({ allowedDomains: ['api.github.com', 'api.openai.com'] });
 *
 * @example
 * // Block an extra domain on top of built-in SSRF list
 * const http = createHttpClientTool({ blockedDomains: ['corp-proxy.internal.example.com'] });
 */
export function createHttpClientTool(options?: HttpClientToolOptions) {
  const { allowedDomains, blockedDomains = [], disableSsrfProtection = false } = options ?? {};

  async function validateUrl(rawUrl: string): Promise<string | null> {
    let parsed: URL;
    try { parsed = new URL(rawUrl); } catch { return `Invalid URL: ${rawUrl}`; }

    const host = parsed.hostname.toLowerCase();

    // SSRF check (static patterns + DNS resolution)
    if (!disableSsrfProtection) {
      const ssrfErr = await checkSsrf(host);
      if (ssrfErr) return ssrfErr;
    }

    // Extra blocked domains
    if (blockedDomains.some(d => host === d.toLowerCase() || host.endsWith(`.${d.toLowerCase()}`))) {
      return `Blocked: "${host}" is on the blocked-domains list.`;
    }

    // Domain allowlist (if configured)
    if (allowedDomains && allowedDomains.length > 0) {
      const permitted = allowedDomains.some(
        d => host === d.toLowerCase() || host.endsWith(`.${d.toLowerCase()}`)
      );
      if (!permitted) {
        return `"${host}" is not in the allowed-domains list: [${allowedDomains.join(', ')}].`;
      }
    }

    return null;
  }

  return defineTool({
    name:        'http_request',
    description: 'Make an HTTP request to a URL. Returns the response body as text. SSRF protection blocks private/internal addresses by default.',
    parameters:  HttpInputSchema,
    async execute({ url, method, headers, body, timeout = 30_000 }) {
      const err = await validateUrl(url);
      if (err) throw new Error(err);

      const controller = new AbortController();
      const timer = setTimeout(() => { controller.abort(); }, timeout);

      // Follow redirects manually so each redirect target is re-validated for SSRF.
      let currentUrl = url;
      let response!: Response;
      const MAX_REDIRECTS = 10;
      try {
        for (let hops = 0; hops <= MAX_REDIRECTS; hops++) {
          const requestInit: RequestInit = {
            method,
            headers: { 'Content-Type': 'application/json', ...headers },
            signal:  controller.signal,
            redirect: 'manual',
            ...(method !== 'GET' && method !== 'HEAD' && body !== undefined && { body }),
          };

          response = await fetch(currentUrl, requestInit);

          if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            if (!location) break; // no Location header — treat as final response
            const redirectUrl = new URL(location, currentUrl).href;
            // Re-validate the redirect target before following it.
            const redirectErr = await validateUrl(redirectUrl);
            if (redirectErr) throw new Error(`Redirect blocked: ${redirectErr}`);
            currentUrl = redirectUrl;
            // Only re-send GET/HEAD for redirects (RFC 7231 §6.4)
            method = (method === 'POST' && (response.status === 301 || response.status === 302))
              ? 'GET' : method;
            body = method === 'GET' ? undefined : body;
          } else {
            break; // non-redirect status — stop following
          }
        }
      } finally {
        clearTimeout(timer);
      }

      const text = await response.text();
      return {
        status:  response.status,
        ok:      response.ok,
        headers: Object.fromEntries(response.headers.entries()),
        body:    text,
      };
    },
  });
}

/**
 * Pre-built HTTP client with default SSRF protection and no domain restrictions.
 * For production with LLM-controlled agents, prefer `createHttpClientTool({ allowedDomains: [...] })`.
 */
export const httpClient = createHttpClientTool();
