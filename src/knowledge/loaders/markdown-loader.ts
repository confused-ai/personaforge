/**
 * Markdown Loader — splits a .md file into per-section documents.
 * Zero deps, uses heading boundaries.
 */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Document } from '../types.js';

export interface MarkdownLoaderOptions { metadata?: Record<string, unknown> }

export async function loadMarkdown(filePath: string, opts: MarkdownLoaderOptions = {}): Promise<Document[]> {
  const raw = await readFile(filePath, 'utf-8');
  return loadMarkdownText(raw, { ...opts, source: filePath });
}

export function loadMarkdownText(text: string, opts: MarkdownLoaderOptions & { source?: string } = {}): Document[] {
  const docs: Document[] = [];
  const lines = text.split('\n');
  let heading = '';
  let body: string[] = [];
  const flush = (): void => {
    const content = (heading ? heading + '\n' : '') + body.join('\n');
    if (content.trim()) {
      docs.push({ id: randomUUID(), content: content.trim(), metadata: { ...opts.metadata, source: opts.source ?? '', heading } });
    }
  };
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) { flush(); heading = line.trim(); body = []; }
    else body.push(line);
  }
  flush();
  return docs;
}
