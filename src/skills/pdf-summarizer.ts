/**
 * PDF Summariser Skill
 *
 * Provides a `read_pdf` tool that loads a PDF from a local path and returns
 * the extracted text, enabling the agent to summarise, analyse, or answer
 * questions about document contents.
 *
 * Requires `pdf-parse` as an optional peer dependency:
 *   bun add pdf-parse
 *   bun add -d @types/pdf-parse
 *
 * Usage:
 * ```ts
 * import { pdfSummarizerSkill } from './index.js';
 * import { agent } from 'personaforge';
 *
 * const bot = agent({
 *   name: 'DocumentAnalyst',
 *   skills: [pdfSummarizerSkill],
 * });
 * const result = await bot.run('Summarise /tmp/report.pdf in three bullets.');
 * ```
 */

import type { Skill, Tool } from '../contracts/index.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// ── read_pdf tool ─────────────────────────────────────────────────────────────

const readPdfTool: Tool = {
  name: 'read_pdf',
  description:
    'Extract the text content of a local PDF file. ' +
    'Provide an absolute or relative path to the PDF. ' +
    'Returns the raw extracted text (up to maxChars characters).',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or workspace-relative path to the PDF file.',
      },
      maxChars: {
        type: 'number',
        description: 'Maximum characters to return. Default: 8000.',
      },
    },
    required: ['path'],
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const filePath = input['path'] as string;
    const maxChars = (input['maxChars'] as number | undefined) ?? 8000;

    if (!existsSync(filePath)) {
      throw new Error(`read_pdf: file not found at "${filePath}".`);
    }

    // Dynamic import — pdf-parse is an optional peer dependency.
    let pdfParse: ((buffer: Buffer) => Promise<{ text: string }>) | null = null;
    try {

      const mod = await import('pdf-parse' as string) as any;
      pdfParse = mod.default ?? mod;
    } catch {
      throw new Error(
        'read_pdf: pdf-parse is not installed. Run: bun add pdf-parse',
      );
    }

    const buffer = await readFile(filePath);
    // pdfParse is always set at this point — the catch above re-throws if import fails.

    const { text } = await pdfParse!(buffer);
    return text.slice(0, maxChars);
  },
};

// ── Skill definition ──────────────────────────────────────────────────────────

export const pdfSummarizerSkill: Skill = {
  id: 'pdf-summarizer',
  name: 'PDF Summariser',
  description:
    'Read and summarise PDF documents from the local filesystem.',
  instructions:
    'You can read PDF files using the read_pdf tool. When a user asks you to ' +
    'summarise, analyse, or answer questions about a PDF, call read_pdf with ' +
    'the file path first, then respond based on the extracted text.',
  tools: [readPdfTool],
  metadata: {
    version: '1.0.0',
    category: 'documents',
    tags: ['pdf', 'documents', 'summarisation'],
  },
};
