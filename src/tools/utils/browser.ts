/**
 * Browser tool – fetch a URL and return page title, text content, and links
 */

import { z } from 'zod';
import { BaseTool, BaseToolConfig } from '../core/base-tool.js';
import { ToolContext, ToolCategory } from '../core/types.js';

/** Patterns matching private/internal network addresses (SSRF protection) */
const PRIVATE_HOST_PATTERNS = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[01])\./,
    /^192\.168\./,
    /^0\.0\.0\.0$/,
    /^\[::1\]$/,
    /^169\.254\./,
    /\.internal$/i,
    /\.local$/i,
];

function isPrivateHost(hostname: string): boolean {
    return PRIVATE_HOST_PATTERNS.some(p => p.test(hostname));
}

const BrowserToolParameters = z.object({
    url: z.string().url(),
    timeout: z.number().min(1000).max(60000).optional(),
    includeLinks: z.boolean().default(true),
});

interface BrowserPageResult {
    url: string;
    title: string;
    textContent: string;
    links: string[];
    status: number;
}

function extractTitle(html: string): string {
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? stripTags(match[1] ?? '').trim() : '';
}

function stripTags(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}

function extractLinks(html: string, baseUrl: string): string[] {
    const hrefRegex = /<a[^>]+href\s*=\s*["']([^"']+)["']/gi;
    const seen = new Set<string>();
    const links: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = hrefRegex.exec(html)) !== null) {
        const href = (m[1] ?? '').trim();
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
        try {
            const resolved = new URL(href, baseUrl).href;
            if (!seen.has(resolved)) {
                seen.add(resolved);
                links.push(resolved);
            }
        } catch {
            // skip invalid URLs
        }
    }
    return links;
}

/**
 * Browser tool configuration with network safety options
 */
export interface BrowserToolConfig extends Partial<Omit<BaseToolConfig<typeof BrowserToolParameters>, 'parameters'>> {
    /** Allowlist of hostnames. When set, only these hosts can be fetched. */
    allowedHosts?: string[];
    /** Block requests to private/internal network addresses (default: true) */
    blockPrivateNetworks?: boolean;
}

export class BrowserTool extends BaseTool<typeof BrowserToolParameters, BrowserPageResult> {
    private allowedHosts?: string[];
    private blockPrivateNetworks: boolean;

    constructor(config?: BrowserToolConfig) {
        super({
            name: config?.name ?? 'browser_fetch',
            description:
                config?.description ??
                'Fetch a web page and return its title, main text content, and links (for reading and navigating pages)',
            parameters: BrowserToolParameters,
            category: config?.category ?? ToolCategory.WEB,
            permissions: {
                allowNetwork: true,
                maxExecutionTimeMs: 30000,
                ...config?.permissions,
            },
            ...(config?.version !== undefined && { version: config.version }),
            ...(config?.author !== undefined && { author: config.author }),
            ...(config?.tags !== undefined && { tags: config.tags }),
        });
        if (config?.allowedHosts !== undefined) this.allowedHosts = config.allowedHosts;
        this.blockPrivateNetworks = config?.blockPrivateNetworks ?? true;
    }

    private validateUrl(urlStr: string): string | null {
        let parsed: URL;
        try {
            parsed = new URL(urlStr);
        } catch {
            return `Invalid URL: ${urlStr}`;
        }

        if (this.blockPrivateNetworks && isPrivateHost(parsed.hostname)) {
            return `Blocked: ${parsed.hostname} is a private/internal network address`;
        }

        if (this.allowedHosts && this.allowedHosts.length > 0) {
            const allowed = this.allowedHosts.some(h =>
                parsed.hostname === h || parsed.hostname.endsWith(`.${h}`)
            );
            if (!allowed) {
                return `Host '${parsed.hostname}' is not in the allowed hosts list`;
            }
        }

        return null;
    }

    protected async performExecute(
        params: z.infer<typeof BrowserToolParameters>,
        _context: ToolContext
    ): Promise<BrowserPageResult> {
        const { url, timeout, includeLinks } = params;

        const urlError = this.validateUrl(url);
        if (urlError) {
            throw new Error(urlError);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => { controller.abort(); }, timeout ?? 30000);

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    Accept: 'text/html, application/xhtml+xml, */*',
                    'User-Agent':
                        'Mozilla/5.0 (compatible; PersonaForge/1.0; +https://github.com/personaforge)',
                },
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            const html = await response.text();
            const title = extractTitle(html);
            const textContent = stripTags(html);
            const links = includeLinks ? extractLinks(html, url) : [];

            return {
                url,
                title,
                textContent,
                links,
                status: response.status,
            };
        } catch (error) {
            clearTimeout(timeoutId);
            throw error;
        }
    }
}
