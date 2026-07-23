/**
 * JSON / JSONL Loader — each object becomes a Document.
 */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Document } from '../types.js';

export interface JsonLoaderOptions {
  /** Field to use as content. If omitted, the full object is stringified. */
  contentField?: string;
  metadata?: Record<string, unknown>;
}

export async function loadJson(filePath: string, opts: JsonLoaderOptions = {}): Promise<Document[]> {
  const raw = await readFile(filePath, 'utf-8');
  const data: unknown[] = filePath.endsWith('.jsonl')
    ? raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as unknown)
    : (() => { const p = JSON.parse(raw) as unknown; return Array.isArray(p) ? p : [p]; })();
  return data.map((item) => {
    const obj = item as Record<string, unknown>;
    const content = opts.contentField && typeof obj[opts.contentField] === 'string'
      ? obj[opts.contentField] as string
      : JSON.stringify(obj);
    return { id: randomUUID(), content, metadata: { ...opts.metadata, source: filePath } };
  });
}
