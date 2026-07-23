/**
 * Sitemap Loader — fetches a sitemap.xml and loads each URL's text.
 */
import { randomUUID } from 'node:crypto';
import type { Document } from '../types.js';

export interface SitemapLoaderOptions {
  /** Max pages to fetch. Default 50. */
  maxPages?: number;
  metadata?: Record<string, unknown>;
}

export async function loadSitemap(sitemapUrl: string, opts: SitemapLoaderOptions = {}): Promise<Document[]> {
  const maxPages = opts.maxPages ?? 50;
  const res = await fetch(sitemapUrl);
  if (!res.ok) throw new Error(`[loadSitemap] HTTP ${String(res.status)} for ${sitemapUrl}`);
  const xml = await res.text();
  const urls = Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g), (m) => m[1]!).slice(0, maxPages);
  const docs: Document[] = [];
  for (const url of urls) {
    try {
      const page = await fetch(url);
      if (!page.ok) continue;
      const html = await page.text();
      const text = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text) docs.push({ id: randomUUID(), content: text, metadata: { ...opts.metadata, source: url } });
    } catch { /* skip */ }
  }
  return docs;
}
