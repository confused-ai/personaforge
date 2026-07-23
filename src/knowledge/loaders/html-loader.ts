/**
 * HTML Loader — strips tags and extracts text. Zero deps.
 */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Document } from '../types.js';

export interface HtmlLoaderOptions { metadata?: Record<string, unknown> }

export async function loadHtml(filePath: string, opts: HtmlLoaderOptions = {}): Promise<Document[]> {
  const raw = await readFile(filePath, 'utf-8');
  return [loadHtmlText(raw, { ...opts, source: filePath })];
}

export function loadHtmlText(html: string, opts: HtmlLoaderOptions & { source?: string } = {}): Document {
  const text = stripHtml(html);
  return { id: randomUUID(), content: text, metadata: { ...opts.metadata, source: opts.source ?? '' } };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
