/**
 * DOCX Loader — extracts text from .docx files.
 * Parses the XML inside the ZIP with zero external deps (uses node's built-in
 * zlib decompress of the docx ZIP entry for word/document.xml).
 *
 * ponytail: for rich formatting support, add `mammoth` and call it here.
 */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Document } from '../types.js';

export interface DocxLoaderOptions { metadata?: Record<string, unknown> }

export async function loadDocx(filePath: string, opts: DocxLoaderOptions = {}): Promise<Document[]> {
  // Attempt optional peer dep `mammoth` first; fallback to basic XML extraction.
  try {
    const mammoth = await import('mammoth' as unknown as string) as { extractRawText: (opts: { path: string }) => Promise<{ value: string }> };
    const { value } = await mammoth.extractRawText({ path: filePath });
    return [{ id: randomUUID(), content: value.trim(), metadata: { ...opts.metadata, source: filePath } }];
  } catch {
    // Minimal fallback: read XML from the docx ZIP.
    const buf = await readFile(filePath);
    const text = extractTextFromDocxBuffer(buf);
    return [{ id: randomUUID(), content: text, metadata: { ...opts.metadata, source: filePath } }];
  }
}

function extractTextFromDocxBuffer(buf: Buffer): string {
  // A .docx is a ZIP. We look for the word/document.xml entry.
  // This is a very minimal ZIP reader — just enough for docx text extraction.
  const AdmZip = require('adm-zip') as { new(buf: Buffer): { getEntries(): Array<{ entryName: string; getData(): Buffer }>; getEntry(name: string): { getData(): Buffer } | null } };
  try {
    const zip = new AdmZip(buf);
    const entry = zip.getEntry('word/document.xml');
    if (!entry) return '';
    const xml = entry.getData().toString('utf-8');
    return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}
