/**
 * Hermetic coverage for src/skills — pdf-summarizer, web-research, code-reviewer.
 * Callers: bunx vitest run tests/coverage-*.test.ts. No production imports.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    pdfSummarizerSkill,
    webResearchSkill,
    codeReviewerSkill,
} from '../src/skills/index.js';

describe('skills metadata', () => {
    it('exports skill ids and tools', () => {
        expect(pdfSummarizerSkill.id).toBe('pdf-summarizer');
        expect(pdfSummarizerSkill.tools?.[0]?.name).toBe('read_pdf');
        expect(webResearchSkill.id).toBe('web-research');
        expect(webResearchSkill.tools?.[0]?.name).toBe('fetch_page');
        expect(codeReviewerSkill.id).toBe('code-reviewer');
        expect(codeReviewerSkill.tools?.[0]?.name).toBe('read_source_file');
        expect(pdfSummarizerSkill.metadata?.category).toBe('documents');
        expect(webResearchSkill.metadata?.category).toBe('research');
        expect(codeReviewerSkill.metadata?.category).toBe('development');
    });
});

describe('skills/web-research', () => {
    const tool = webResearchSkill.tools![0]!;

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('rejects non-https URLs', async () => {
        await expect(tool.execute({ url: 'http://example.com' })).rejects.toThrow(/HTTPS/);
    });

    it('strips HTML/script/style and truncates', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({
                ok: true,
                status: 200,
                text: async () =>
                    '<html><style>.a{}</style><script>alert(1)</script><p>Hello   world</p></html>',
            })),
        );
        const text = await tool.execute({ url: 'https://example.com/ok', maxChars: 5 });
        expect(text.length).toBeLessThanOrEqual(5);
        expect(text).not.toMatch(/<|>|script|style/i);
    });

    it('throws on non-ok HTTP and defaults maxChars to 4000', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                if (String(url).includes('bad')) {
                    return { ok: false, status: 503, text: async () => '' };
                }
                return { ok: true, status: 200, text: async () => `<p>${'z'.repeat(5000)}</p>` };
            }),
        );
        await expect(tool.execute({ url: 'https://example.com/bad' })).rejects.toThrow(/HTTP 503/);
        const text = await tool.execute({ url: 'https://example.com/ok' });
        expect(text.length).toBe(4000);
    });
});

describe('skills/code-reviewer', () => {
    const tool = codeReviewerSkill.tools![0]!;
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'pf-code-'));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it('rejects unsupported extensions', async () => {
        await expect(tool.execute({ path: join(dir, 'bin.png') })).rejects.toThrow(/not supported/);
    });

    it('throws when file missing', async () => {
        await expect(tool.execute({ path: join(dir, 'missing.ts') })).rejects.toThrow(/file not found/);
    });

    it('reads full file and line ranges with numbers', async () => {
        const path = join(dir, 'sample.ts');
        writeFileSync(path, 'line1\nline2\nline3\nline4');
        const all = await tool.execute({ path });
        expect(all).toContain('1: line1');
        expect(all).toContain('4: line4');

        const slice = await tool.execute({ path, startLine: 2, endLine: 3 });
        expect(slice).toBe('2: line2\n3: line3');

        const fromStart = await tool.execute({ path, startLine: 0 });
        expect(fromStart).toContain('1: line1');
    });
});

describe('skills/pdf-summarizer', () => {
    const tool = pdfSummarizerSkill.tools![0]!;
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'pf-pdf-'));
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
        vi.doUnmock('pdf-parse');
        vi.resetModules();
        vi.restoreAllMocks();
    });

    it('throws when file missing', async () => {
        await expect(tool.execute({ path: join(dir, 'missing.pdf') })).rejects.toThrow(/file not found/);
    });

    it('throws actionable error when pdf-parse is not installed', async () => {
        // pdf-parse is an optional peer — absent in this workspace.
        const path = join(dir, 'doc.pdf');
        writeFileSync(path, Buffer.from('%PDF-fake'));
        await expect(tool.execute({ path })).rejects.toThrow(/pdf-parse is not installed/);
    });

    it('extracts text via mocked pdf-parse and respects maxChars', async () => {
        const path = join(dir, 'doc.pdf');
        writeFileSync(path, Buffer.from('%PDF-fake'));

        vi.doMock('pdf-parse', () => ({
            default: async () => ({ text: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' }),
        }));
        vi.resetModules();
        const { pdfSummarizerSkill: fresh } = await import('../src/skills/pdf-summarizer.js');
        const freshTool = fresh.tools![0]!;
        const out = await freshTool.execute({ path, maxChars: 5 });
        expect(out).toBe('ABCDE');

        const full = await freshTool.execute({ path });
        expect(full.length).toBeLessThanOrEqual(8000);
        expect(full.startsWith('ABC')).toBe(true);
    });
});
