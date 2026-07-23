/**
 * URL Loader
 * ==========
 * Fetches a URL and strips HTML/boilerplate to produce a clean text `Document`.
 * No external deps required — uses the platform's native `fetch`.
 *
 * SSRF Protection: by default only HTTPS URLs to non-private, non-loopback hosts
 * are allowed. Use `allowedHosts` to restrict further.
 *
 * Usage:
 *   const docs = await loadUrl('https://example.com/blog/post-1');
 *   await engine.addDocuments(docs);
 *
 *   // With custom metadata
 *   const docs = await loadUrl('https://...', { metadata: { category: 'research' } });
 */

import { randomUUID } from 'node:crypto';
import type { Document } from '../types.js';

// ── SSRF guard ────────────────────────────────────────────────────────────────

/**
 * Private/reserved IP ranges and hostnames blocked to prevent SSRF attacks.
 * Covers: loopback, RFC-1918 private ranges, link-local, APIPA, metadata IPs.
 */
const BLOCKED_IP_PATTERNS: RegExp[] = [
    /^127\./,                         // loopback
    /^10\./,                          // RFC-1918
    /^172\.(1[6-9]|2\d|3[01])\./,    // RFC-1918
    /^192\.168\./,                    // RFC-1918
    /^169\.254\./,                    // link-local / AWS metadata
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // shared address (RFC 6598)
    /^::1$/,                          // IPv6 loopback
    /^fc00:/i,                        // IPv6 unique local
    /^fe80:/i,                        // IPv6 link-local
    /^fd[0-9a-f]{2}:/i,              // IPv6 unique local
    /^0\./,                           // "this" network
    /^255\./,                         // broadcast
];

const BLOCKED_HOSTNAMES = new Set(['localhost', 'metadata.google.internal', 'metadata', 'computemetadata']);

function isSsrfBlocked(hostname: string): boolean {
    const lower = hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.has(lower)) return true;
    for (const pattern of BLOCKED_IP_PATTERNS) {
        if (pattern.test(lower)) return true;
    }
    return false;
}

export interface UrlLoaderOptions {
    /**
     * Timeout in milliseconds for the HTTP request. Default: 10_000.
     */
    timeoutMs?: number;
    /**
     * User-agent string. Default: 'personaforge-knowledge-loader/1.0'
     */
    userAgent?: string;
    /** Additional metadata to attach to the generated Document */
    metadata?: Record<string, unknown>;
    /**
     * Explicit allowlist of hostnames. When set, only these hostnames are fetched.
     * Example: `['docs.example.com', 'api.example.com']`
     */
    allowedHosts?: string[];
    /**
     * When `true`, HTTP (non-TLS) URLs are allowed in addition to HTTPS.
     * Default: `false` (HTTPS only) for security.
     */
    allowHttp?: boolean;
}

/**
 * Fetch a URL and return a single-element `Document[]`.
 * Text is extracted from the HTML by stripping tags and collapsing whitespace.
 * For plain-text or JSON responses the raw body is used as-is.
 *
 * SSRF protection is applied by default — private IPs, loopback addresses, and
 * cloud metadata endpoints are blocked.
 */
export async function loadUrl(
    url: string,
    options: UrlLoaderOptions = {},
): Promise<Document[]> {
    const timeoutMs = options.timeoutMs ?? 10_000;
    const userAgent = options.userAgent ?? 'personaforge-knowledge-loader/1.0';
    const extraMeta = options.metadata ?? {};

    // ── SSRF validation ───────────────────────────────────────────────────────
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`URL Loader: invalid URL "${url}"`);
    }

    // Protocol check: only https by default
    const allowHttp = options.allowHttp === true;
    if (parsed.protocol !== 'https:' && !(allowHttp && parsed.protocol === 'http:')) {
        throw new Error(
            `URL Loader: only HTTPS URLs are allowed (got "${parsed.protocol}"). ` +
            `Set allowHttp: true to permit HTTP.`,
        );
    }

    // Hostname allowlist check
    if (options.allowedHosts && options.allowedHosts.length > 0) {
        const hostname = parsed.hostname.toLowerCase();
        if (!options.allowedHosts.some((h) => h.toLowerCase() === hostname)) {
            throw new Error(
                `URL Loader: hostname "${parsed.hostname}" is not in the allowedHosts list.`,
            );
        }
    }

    // Private/reserved IP block
    if (isSsrfBlocked(parsed.hostname)) {
        throw new Error(
            `URL Loader: request to "${parsed.hostname}" blocked to prevent SSRF. ` +
            `Only public internet hosts are permitted.`,
        );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, timeoutMs);

    let text: string;
    let contentType = 'text/plain';
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': userAgent, Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.8' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
        contentType = res.headers.get('content-type') ?? 'text/plain';
        text = await res.text();
    } finally {
        clearTimeout(timer);
    }

    const content = contentType.includes('html') ? stripHtml(text) : text.trim();

    if (!content) return [];

    return [
        {
            id:      randomUUID(),
            content,
            metadata: { source: url, contentType, fetchedAt: new Date().toISOString(), ...extraMeta },
        },
    ];
}

// ── HTML stripping ────────────────────────────────────────────────────────────

/**
 * Minimal HTML-to-text: removes scripts/styles, strips tags, decodes common
 * HTML entities, and collapses whitespace. No external deps.
 */
function stripHtml(html: string): string {
    return html
        // Remove <script> and <style> blocks entirely
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        // Strip remaining HTML tags
        .replace(/<[^>]+>/g, ' ')
        // Decode common HTML entities
        .replace(/&amp;/g,  '&')
        .replace(/&lt;/g,   '<')
        .replace(/&gt;/g,   '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g,  "'")
        .replace(/&nbsp;/g, ' ')
        // Collapse whitespace
        .replace(/\s+/g, ' ')
        .trim();
}
