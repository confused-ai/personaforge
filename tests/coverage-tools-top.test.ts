/**
 * Hermetic coverage: tools/utils (browser, calculator, file, http, safe-path,
 * shell-entry, shell) and top-level tools (shell, browser, http-client,
 * file-system, compose).
 *
 * child_process + node:dns/promises are mocked; fetch is stubbed per-test;
 * filesystem operations run against real, but throwaway, temp directories.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

// ── Hoisted mock state ──────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
    execFileMock: vi.fn(),
    dnsLookupMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({ execFile: h.execFileMock }));
vi.mock('child_process', () => ({ execFile: h.execFileMock }));
vi.mock('node:dns/promises', () => ({ lookup: h.dnsLookupMock }));

// Wrap node:fs (used by src/tools/file-system.ts) so readdir order can be forced
// deterministically for the list-sort comparator.
vi.mock('node:fs', async () => {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    const promises = { ...actual.promises } as Record<string, unknown>;
    const readdir = vi.fn((...args: unknown[]) =>
        (actual.promises as unknown as Record<string, (...a: unknown[]) => unknown>)['readdir'](...args),
    );
    promises['readdir'] = readdir;
    return { ...actual, promises };
});

// Wrap fs/promises so we can force a NON-Error rejection (covers the
// `error instanceof Error ? ... : String(error)` branches in utils/file).
vi.mock('node:fs/promises', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    const wrap = (name: string) => {
        const fn = vi.fn((...args: unknown[]) =>
            (actual as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args),
        );
        return fn;
    };
    const readFile = wrap('readFile');
    const stat = wrap('stat');
    const readdir = wrap('readdir');
    return { ...(actual as Record<string, unknown>), readFile, stat, readdir };
});

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { BrowserTool } from '../src/tools/utils/browser.js';
import {
    CalculatorAddTool,
    CalculatorSubtractTool,
    CalculatorMultiplyTool,
    CalculatorDivideTool,
    CalculatorExponentiateTool,
    CalculatorFactorialTool,
    CalculatorIsPrimeTool,
    CalculatorSquareRootTool,
    CalculatorToolkit,
} from '../src/tools/utils/calculator.js';
import {
    WriteFileTool,
    ReadFileTool,
    ReadFileChunkTool,
    UpdateFileChunkTool,
    DeleteFileTool,
    ListFilesTool,
    SearchFilesTool,
} from '../src/tools/utils/file.js';
import { HttpClientTool } from '../src/tools/utils/http.js';
import { resolveWithin, sandboxRoot } from '../src/tools/utils/safe-path.js';
import { ShellTool, ShellToolkit } from '../src/tools/utils/shell.js';
import '../src/tools/utils/shell-entry.js';
import { createShellTool, shell } from '../src/tools/shell.js';
import { browserTool } from '../src/tools/browser.js';
import { createHttpClientTool, httpClient, checkSsrf } from '../src/tools/http-client.js';
import { createFileSystemTool } from '../src/tools/file-system.js';
import {
    composeTool,
    parallelTools,
    fallbackTool,
    retryTool,
    timeoutTool,
    mapTool,
    filterTool,
} from '../src/tools/compose.js';
import type { ToolContext as ToolsToolContext } from '../src/tools/core/types.js';
import { ToolCategory } from '../src/tools/core/types.js';

// ── Shared helpers ──────────────────────────────────────────────────────────
let TMP = '';
const originalFetch = globalThis.fetch;

function ctx(over: Partial<ToolsToolContext> = {}): ToolsToolContext {
    return {
        toolId: 't',
        agentId: 'a',
        sessionId: 's',
        permissions: { allowNetwork: true, allowFileSystem: true, maxExecutionTimeMs: 30_000 },
        ...over,
    };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });
}

beforeEach(async () => {
    h.execFileMock.mockReset();
    h.dnsLookupMock.mockReset();
    h.dnsLookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'pf-cov-tools-'));
});
afterEach(async () => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    await fs.rm(TMP, { recursive: true, force: true });
});

// ══════════════════════════════════════════════════════════════════════════
// utils/calculator.ts
// ══════════════════════════════════════════════════════════════════════════
describe('utils/calculator', () => {
    it('arithmetic + division by zero + exponentiation', async () => {
        const c = ctx();
        expect((await new CalculatorAddTool().execute({ a: 2, b: 3 }, c)).data).toMatchObject({ operation: 'addition', result: 5 });
        expect((await new CalculatorSubtractTool().execute({ a: 5, b: 2 }, c)).data).toMatchObject({ operation: 'subtraction', result: 3 });
        expect((await new CalculatorMultiplyTool().execute({ a: 3, b: 4 }, c)).data).toMatchObject({ operation: 'multiplication', result: 12 });
        expect((await new CalculatorDivideTool().execute({ a: 10, b: 2 }, c)).data).toMatchObject({ operation: 'division', result: 5 });
        expect((await new CalculatorDivideTool().execute({ a: 1, b: 0 }, c)).data).toMatchObject({ error: 'Division by zero is undefined' });
        expect((await new CalculatorExponentiateTool().execute({ a: 2, b: 8 }, c)).data).toMatchObject({ operation: 'exponentiation', result: 256 });
    });

    it('factorial / prime / square root edge cases', async () => {
        const c = ctx();
        expect((await new CalculatorFactorialTool().execute({ n: 5 }, c)).data).toMatchObject({ result: 120 });
        expect((await new CalculatorFactorialTool().execute({ n: 1 }, c)).data).toMatchObject({ result: 1 });
        expect((await new CalculatorFactorialTool().execute({ n: -1 }, c)).data?.error).toMatch(/negative/);
        expect((await new CalculatorFactorialTool().execute({ n: 2.5 }, c)).data?.error).toMatch(/integers/);

        const prime = new CalculatorIsPrimeTool();
        expect((await prime.execute({ n: 1 }, c)).data).toMatchObject({ result: 0 });
        expect((await prime.execute({ n: 2 }, c)).data).toMatchObject({ result: 1 });
        expect((await prime.execute({ n: 3 }, c)).data).toMatchObject({ result: 1 });
        expect((await prime.execute({ n: 4 }, c)).data).toMatchObject({ result: 0 });
        expect((await prime.execute({ n: 9 }, c)).data).toMatchObject({ result: 0 });
        expect((await prime.execute({ n: 25 }, c)).data).toMatchObject({ result: 0 }); // i divides at 5
        expect((await prime.execute({ n: 49 }, c)).data).toMatchObject({ result: 0 }); // i+2=7 divides
        expect((await prime.execute({ n: 47 }, c)).data).toMatchObject({ result: 1 }); // walks then exits

        expect((await new CalculatorSquareRootTool().execute({ n: 16 }, c)).data).toMatchObject({ operation: 'square_root', result: 4 });
        expect((await new CalculatorSquareRootTool().execute({ n: -4 }, c)).data?.error).toMatch(/negative/);

        expect(CalculatorToolkit.createAll()).toHaveLength(8);
    });
});

// ══════════════════════════════════════════════════════════════════════════
// utils/browser.ts
// ══════════════════════════════════════════════════════════════════════════
describe('utils/browser', () => {
    it('constructor variants + validation branches', async () => {
        const full = new BrowserTool({
            name: 'b2', description: 'd2', category: ToolCategory.UTILITY, version: '2', author: 'me', tags: ['x'],
            allowedHosts: ['ok.example'], blockPrivateNetworks: false, permissions: { maxExecutionTimeMs: 5000 },
        });
        expect(full.name).toBe('b2');
        const def = new BrowserTool();
        expect(def.name).toBe('browser_fetch');
        expect((def as any).blockPrivateNetworks).toBe(true);
        expect((def as any).allowedHosts).toBeUndefined();

        // invalid url (raw, bypasses schema)
        await expect((def as any).performExecute({ url: 'not-a-url', timeout: 1000, includeLinks: false }, ctx())).rejects.toThrow(/Invalid URL/);

        // private host blocked (blockPrivateNetworks default true)
        globalThis.fetch = vi.fn(async () => new Response('<html></html>')) as typeof fetch;
        await expect((def as any).performExecute({ url: 'http://127.0.0.1/x', includeLinks: true }, ctx())).rejects.toThrow(/private/i);

        // allowed hosts restriction
        const restricted = new BrowserTool({ allowedHosts: ['ok.example'] });
        globalThis.fetch = vi.fn(async () => new Response('<html></html>')) as typeof fetch;
        await expect((restricted as any).performExecute({ url: 'http://evil.example/x', includeLinks: true }, ctx())).rejects.toThrow(/not in the allowed hosts/);
        globalThis.fetch = vi.fn(async () => new Response('<html></html>')) as typeof fetch;
        await expect((restricted as any).performExecute({ url: 'http://sub.ok.example/x', includeLinks: true }, ctx())).resolves.toMatchObject({ status: 200 });

        // blockPrivateNetworks false → localhost allowed (fetch mocked)
        const open = new BrowserTool({ blockPrivateNetworks: false });
        globalThis.fetch = vi.fn(async () => new Response('<html></html>')) as typeof fetch;
        const r = await (open as any).performExecute({ url: 'http://localhost/x', timeout: 1000, includeLinks: false }, ctx());
        expect(r.status).toBe(200);
    });

    it('successful fetch: title/strip/links include/exclude', async () => {
        const html = [
            '<html><head><title>  My <b>Page</b> &amp; &nbsp;  </title></head>',
            '<body><script>alert(1)</script><style>.a{}</style>',
            '<p>Hello world</p>',
            '<a href="">empty</a>',
            '<a href="http://example.com/1">one</a>',
            '<a href="http://example.com/1">dup</a>',
            '<a href="#frag">frag</a>',
            '<a href="javascript:void(0)">js</a>',
            '<a href="http://[">bad</a>',
            '<a href="/rel">rel</a>',
            '</body></html>',
        ].join('');
        globalThis.fetch = vi.fn(async () => new Response(html)) as typeof fetch;
        const tool = new BrowserTool();
        const res = await tool.execute({ url: 'http://example.com/' }, ctx());
        expect(res.success).toBe(true);
        const data = res.data!;
        expect(data.title).toContain('My Page');
        expect(data.title).not.toContain('<b>');
        expect(data.textContent).toContain('Hello world');
        expect(data.textContent).not.toContain('<script>');
        expect(data.links).toContain('http://example.com/1');
        expect(data.links).toContain('http://example.com/rel');
        expect(data.links.filter((l) => l === 'http://example.com/1')).toHaveLength(1);
        expect(data.status).toBe(200);

        // includeLinks false
        globalThis.fetch = vi.fn(async () => new Response(html)) as typeof fetch;
        const noLinks = await tool.execute({ url: 'http://example.com/', includeLinks: false }, ctx());
        expect(noLinks.data!.links).toEqual([]);

        // no <title> tag → extractTitle empty fallback
        globalThis.fetch = vi.fn(async () => new Response('<html><body>bare</body></html>')) as typeof fetch;
        const noTitle = await tool.execute({ url: 'http://example.com/', includeLinks: false }, ctx());
        expect(noTitle.data!.title).toBe('');

        // fetch rejects → BaseTool returns a failure result
        globalThis.fetch = vi.fn(async () => { throw new Error('boom'); }) as typeof fetch;
        const failed = await tool.execute({ url: 'http://example.com/', includeLinks: false }, ctx());
        expect(failed.success).toBe(false);
        expect(failed.error?.message).toBe('boom');
    });

    it('aborts on timeout (fake timers)', async () => {
        vi.useFakeTimers();
        try {
            const tool = new BrowserTool();
            globalThis.fetch = vi.fn((_url, init) => new Promise((_res, reject) => {
                (init as RequestInit).signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            })) as typeof fetch;
            const promise = (tool as any).performExecute({ url: 'http://example.com/', timeout: 1000, includeLinks: true }, ctx());
            const assertion = expect(promise).rejects.toThrow('Aborted');
            await vi.advanceTimersByTimeAsync(1100);
            await assertion;
        } finally {
            vi.useRealTimers();
        }
    });
});

// ══════════════════════════════════════════════════════════════════════════
// utils/http.ts
// ══════════════════════════════════════════════════════════════════════════
describe('utils/http', () => {
    it('constructor variants', () => {
        const full = new HttpClientTool({
            name: 'h2', description: 'd', category: ToolCategory.UTILITY, version: '2', author: 'a', tags: ['t'],
            allowedHosts: ['ok.example'], blockPrivateNetworks: false, permissions: { maxExecutionTimeMs: 6000 },
        });
        expect(full.name).toBe('h2');
        const def = new HttpClientTool();
        expect((def as any).blockPrivateNetworks).toBe(true);
        expect((def as any).allowedHosts).toBeUndefined();
    });

    it('validation errors: invalid url / private host / allowlist / DNS-private', async () => {
        const def = new HttpClientTool();
        await expect((def as any).performExecute({ url: 'not-a-url' }, ctx())).rejects.toThrow(/Invalid URL/);
        await expect((def as any).performExecute({ url: 'http://10.0.0.1/x' }, ctx())).rejects.toThrow(/SSRF/i);
        await expect((def as any).performExecute({ url: 'http://localhost/x' }, ctx())).rejects.toThrow(/SSRF/i);
        h.dnsLookupMock.mockResolvedValue({ address: '10.99.99.99', family: 4 });
        await expect((def as any).performExecute({ url: 'http://example.com/x' }, ctx())).rejects.toThrow(/SSRF blocked/);
        h.dnsLookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });

        const restricted = new HttpClientTool({ allowedHosts: ['ok.example'] });
        await expect((restricted as any).performExecute({ url: 'http://evil.example/x' }, ctx())).rejects.toThrow(/not in the allowed hosts/);
        globalThis.fetch = vi.fn(async () => json({}));
        const ok = await (restricted as any).performExecute({ url: 'http://sub.ok.example/x', method: 'GET' }, ctx());
        expect(ok.status).toBe(200);
    });

    it('executes requests: body string/object, methods, headers, response shape', async () => {
        const captures: Array<{ url: unknown; init: RequestInit }> = [];
        const fetchMock = vi.fn(async (url, init) => {
            captures.push({ url, init: init as RequestInit });
            return new Response('resp-body', { status: 201, statusText: 'Created', headers: { 'x-srv': '1' } });
        }) as typeof fetch;
        globalThis.fetch = fetchMock;
        const tool = new HttpClientTool();

        const r1 = await tool.execute({
            url: 'http://example.com/a', method: 'POST', headers: { 'x-c': 'v' }, body: { k: 1 }, timeout: 5000,
        }, ctx());
        expect(r1.data!.status).toBe(201);
        expect(r1.data!.statusText).toBe('Created');
        expect(r1.data!.headers['x-srv']).toBe('1');
        expect(r1.data!.body).toBe('resp-body');
        const call1 = captures[0]!;
        expect((call1.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
        expect(String(call1.init.body)).toBe('{"k":1}');

        const r2 = await tool.execute({ url: 'http://example.com/b', method: 'PUT', body: 'raw', headers: { 'x-1': 'a' } }, ctx());
        expect(r2.success).toBe(true);
        expect(String(captures[1]!.init.body)).toBe('raw');

        // GET with body → body dropped
        fetchMock.mockImplementation(async (url, init) => {
            captures.push({ url, init: init as RequestInit });
            return json({ ok: 1 });
        });
        await tool.execute({ url: 'http://example.com/c', method: 'GET', body: 'x', headers: { 'Accept': 'text/html' } }, ctx());
        expect(captures[2]!.init.body).toBeUndefined();
        expect((captures[2]!.init.method as string).toUpperCase()).toBe('GET');
    });

    it('fetch rejection becomes a failure result', async () => {
        const tool = new HttpClientTool();
        globalThis.fetch = vi.fn(async () => { throw new Error('netdown'); }) as typeof fetch;
        const r = await tool.execute({ url: 'http://example.com/x' }, ctx());
        expect(r.success).toBe(false);
        expect(r.error?.message).toBe('netdown');
    });

    it('blockPrivateNetworks false allows private hosts + abort fires timeout', async () => {
        const open = new HttpClientTool({ blockPrivateNetworks: false });
        globalThis.fetch = vi.fn(async () => json({ ok: 1 })) as typeof fetch;
        const r = await (open as any).performExecute({ url: 'http://127.0.0.1/x' }, ctx());
        expect(r.status).toBe(200);

        vi.useFakeTimers();
        try {
            globalThis.fetch = vi.fn((_url, init) => new Promise((_res, reject) => {
                (init as RequestInit).signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            })) as typeof fetch;
            const tool = new HttpClientTool();
            const promise = (tool as any).performExecute({ url: 'http://example.com/x', timeout: 1000 }, ctx());
            const assertion = expect(promise).rejects.toThrow('Aborted');
            await vi.advanceTimersByTimeAsync(1100);
            await assertion;
        } finally {
            vi.useRealTimers();
        }
    });
});

// ══════════════════════════════════════════════════════════════════════════
// utils/safe-path.ts
// ══════════════════════════════════════════════════════════════════════════
describe('utils/safe-path', () => {
    it('resolveWithin: ok, missing base, writes into nonexistent parents', async () => {
        const base = path.join(TMP, 'root');
        await fs.mkdir(base, { recursive: true });
        await fs.mkdir(path.join(base, 'nested'), { recursive: true });

        const r1 = await resolveWithin(base, 'a.txt');
        expect(path.resolve(r1)).toBe(path.join(await fs.realpath(base), 'a.txt'));

        // symlink-parent realpath path: nested exists, file does not
        const r2 = await resolveWithin(base, 'nested/new.ts');
        expect(r2).toBe(path.join(await fs.realpath(base), 'nested', 'new.ts'));

        // nonexistent base directory → realpath(base) fails → resolved fallback
        const missingBase = path.join(TMP, 'does-not-exist');
        const r3 = await resolveWithin(missingBase, 'x.txt');
        expect(r3).toBe(path.resolve(missingBase, 'x.txt'));

        // sandboxRoot helpers
        expect(sandboxRoot(missingBase)).toBe(path.resolve(missingBase));
    });

    it('rejects traversal + absolute siblings', async () => {
        const base = path.join(TMP, 'root2');
        await fs.mkdir(base, { recursive: true });
        await expect(resolveWithin(base, '../escape.txt')).rejects.toThrow(/outside the sandbox root/);
        await expect(resolveWithin(base, '..')).rejects.toThrow(/outside the sandbox root/);
        await expect(resolveWithin(base, '/etc/passwd')).rejects.toThrow(/outside the sandbox root/);
        await expect(resolveWithin(base, 'nested/../../escape.txt')).rejects.toThrow(/outside the sandbox root/);
    });

    it('rejects symlink escapes (direct + via parent dir)', async () => {
        const base = path.join(TMP, 'root3');
        const outside = path.join(TMP, 'outside');
        await fs.mkdir(base, { recursive: true });
        await fs.mkdir(outside, { recursive: true });
        await fs.writeFile(path.join(outside, 'secret.txt'), 's');
        await fs.symlink(outside, path.join(base, 'link'));

        await expect(resolveWithin(base, 'link')).rejects.toThrow(/symlink/);
        await expect(resolveWithin(base, 'link/secret.txt')).rejects.toThrow(/symlink/);
    });

    it('sandboxRoot honors CONFUSED_AI_FS_ROOT (env branch)', async () => {
        const prev = process.env['CONFUSED_AI_FS_ROOT'];
        process.env['CONFUSED_AI_FS_ROOT'] = path.join(TMP, 'env-root');
        try {
            expect(sandboxRoot()).toBe(path.resolve(path.join(TMP, 'env-root')));
        } finally {
            if (prev === undefined) delete process.env['CONFUSED_AI_FS_ROOT'];
            else process.env['CONFUSED_AI_FS_ROOT'] = prev;
        }
        expect(sandboxRoot(undefined)).toBe(path.resolve(process.cwd()));
    });
});

// ══════════════════════════════════════════════════════════════════════════
// utils/file.ts
// ══════════════════════════════════════════════════════════════════════════
describe('utils/file', () => {
    it('write: new file, nested dir, overwrite guard', async () => {
        const base = path.join(TMP, 'fs');
        await fs.mkdir(base, { recursive: true });
        const w = new WriteFileTool({ baseDir: base });
        expect(await (w as any).performExecute({ fileName: 'f.txt', contents: 'abc', overwrite: true, encoding: 'utf-8' }, ctx())).toBe('f.txt');

        const nested = new WriteFileTool({ baseDir: base });
        expect(await (nested as any).performExecute({ fileName: 'sub/inner.txt', contents: 'hi', overwrite: true, encoding: 'utf-8' }, ctx())).toBe('sub/inner.txt');

        const w2 = new WriteFileTool({ baseDir: base });
        const r = await w2.execute({ fileName: 'f.txt', contents: 'xyz', overwrite: false }, ctx());
        expect(r.data).toBe('File f.txt already exists');
        // schema default overwrite=true overwrites
        const w3 = new WriteFileTool({ baseDir: base });
        await w3.execute({ fileName: 'f.txt', contents: 'new' }, ctx());
        expect(await fs.readFile(path.join(base, 'f.txt'), 'utf-8')).toBe('new');
    });

    it('read: success + missing file error', async () => {
        const base = path.join(TMP, 'fs2');
        await fs.mkdir(base, { recursive: true });
        await fs.writeFile(path.join(base, 'a.txt'), 'hello');
        const r = new ReadFileTool({ baseDir: base });
        expect(await (r as any).performExecute({ fileName: 'a.txt', encoding: 'utf-8' }, ctx())).toBe('hello');
        await expect((r as any).performExecute({ fileName: 'missing.txt', encoding: 'utf-8' }, ctx())).rejects.toThrow('Error reading file:');
    });

    it('read chunk: slices, endLine clamp, empty range, missing', async () => {
        const base = path.join(TMP, 'fs3');
        await fs.mkdir(base, { recursive: true });
        await fs.writeFile(path.join(base, 'lines.txt'), ['l0', 'l1', 'l2', 'l3'].join('\n'));
        const r = new ReadFileChunkTool({ baseDir: base });
        expect(await (r as any).performExecute({ fileName: 'lines.txt', startLine: 1, endLine: 2, encoding: 'utf-8' }, ctx())).toBe('l1\nl2');
        expect(await (r as any).performExecute({ fileName: 'lines.txt', startLine: 0, endLine: 99, encoding: 'utf-8' }, ctx())).toBe(['l0', 'l1', 'l2', 'l3'].join('\n'));
        expect(await (r as any).performExecute({ fileName: 'lines.txt', startLine: 10, endLine: 11, encoding: 'utf-8' }, ctx())).toBe('');
        await expect((r as any).performExecute({ fileName: 'nope.txt', startLine: 0, endLine: 1, encoding: 'utf-8' }, ctx())).rejects.toThrow('Error reading file chunk:');
    });

    it('update chunk: replace + missing file error', async () => {
        const base = path.join(TMP, 'fs4');
        await fs.mkdir(base, { recursive: true });
        await fs.writeFile(path.join(base, 'u.txt'), ['a', 'b', 'c'].join('\n'));
        const u = new UpdateFileChunkTool({ baseDir: base });
        expect(await (u as any).performExecute({ fileName: 'u.txt', startLine: 1, endLine: 1, chunk: 'B', encoding: 'utf-8' }, ctx())).toBe('u.txt');
        expect(await fs.readFile(path.join(base, 'u.txt'), 'utf-8')).toBe(['a', 'B', 'c'].join('\n'));
        await expect((u as any).performExecute({ fileName: 'nope.txt', startLine: 0, endLine: 0, chunk: 'x', encoding: 'utf-8' }, ctx())).rejects.toThrow('Error updating file chunk:');
    });

    it('delete: file, directory, missing error', async () => {
        const base = path.join(TMP, 'fs5');
        await fs.mkdir(base, { recursive: true });
        await fs.mkdir(path.join(base, 'adir'), { recursive: true });
        await fs.writeFile(path.join(base, 'd.txt'), 'x');
        const d = new DeleteFileTool({ baseDir: base });
        expect(await (d as any).performExecute({ fileName: 'd.txt' }, ctx())).toBe('');
        expect(await (d as any).performExecute({ fileName: 'adir' }, ctx())).toBe('');
        await expect((d as any).performExecute({ fileName: 'ghost.txt' }, ctx())).rejects.toThrow('Error deleting file:');
    });

    it('list: relative paths, raw-undefined directory fallback, error default', async () => {
        const base = path.join(await fs.realpath(TMP), 'fs6');
        await fs.mkdir(path.join(base, 'sub'), { recursive: true });
        await fs.writeFile(path.join(base, 'one.txt'), '');
        await fs.writeFile(path.join(base, 'sub', 'two.txt'), '');
        const l = new ListFilesTool({ baseDir: base });
        const out = await (l as any).performExecute({ directory: '.' }, ctx());
        const names = JSON.parse(out);
        expect(names).toContain('one.txt');
        expect(names).toContain('sub');

        // raw-undefined directory → ?? '.'
        const out2 = await (l as any).performExecute({ directory: undefined }, ctx());
        expect(JSON.parse(out2)).toContain('one.txt');

        // listing a file → readdir error → '{}'
        const out3 = await (l as any).performExecute({ directory: 'one.txt' }, ctx());
        expect(out3).toBe('{}');
    });

    it('search: empty pattern, matches by name + relative path, recursion, error', async () => {
        const base = path.join(TMP, 'fs7');
        await fs.mkdir(path.join(base, 'sub'), { recursive: true });
        await fs.writeFile(path.join(base, 'data.txt'), '');
        await fs.writeFile(path.join(base, 'sub', 'nested.log'), '');
        await fs.writeFile(path.join(base, 'sub', 'x.js'), '');

        const s = new SearchFilesTool({ baseDir: base });
        expect(await (s as any).performExecute({ pattern: '' }, ctx())).toBe('Error: Pattern cannot be empty');
        expect(await (s as any).performExecute({ pattern: '   ' }, ctx())).toBe('Error: Pattern cannot be empty');

        const byName = await (s as any).performExecute({ pattern: '*.txt' }, ctx());
        expect(JSON.parse(byName).files).toContain('data.txt');

        const byRel = await (s as any).performExecute({ pattern: 'sub/x.js' }, ctx());
        expect(JSON.parse(byRel).files).toContain(path.join('sub', 'x.js'));

        const wildcard = await (s as any).performExecute({ pattern: 'sub/*.log' }, ctx());
        expect(JSON.parse(wildcard).files).toContain(path.join('sub', 'nested.log'));

        const noMatch = await (s as any).performExecute({ pattern: 'zzz*' }, ctx());
        expect(JSON.parse(noMatch).matches_found).toBe(0);

        // walk error → error string
        const bad = new SearchFilesTool({ baseDir: path.join(TMP, 'no-such-dir') });
        const err = await (bad as any).performExecute({ pattern: '*' }, ctx());
        expect(err).toMatch(/Error searching files with pattern/);

        // '?' wildcard match
        const q = new SearchFilesTool({ baseDir: base });
        const qout = await (q as any).performExecute({ pattern: 'dat?.tx?' }, ctx());
        expect(JSON.parse(qout).matches_found).toBeGreaterThan(0);
    });

    it('constructors default baseDir to cwd (?? process.cwd())', () => {
        expect((new WriteFileTool() as any).baseDir).toBe(process.cwd());
        expect((new ReadFileTool() as any).baseDir).toBe(process.cwd());
        expect((new ReadFileChunkTool() as any).baseDir).toBe(process.cwd());
        expect((new UpdateFileChunkTool() as any).baseDir).toBe(process.cwd());
        expect((new DeleteFileTool() as any).baseDir).toBe(process.cwd());
        expect((new ListFilesTool() as any).baseDir).toBe(process.cwd());
        expect((new SearchFilesTool() as any).baseDir).toBe(process.cwd());
    });

    it('non-Error fs rejections flow through String(error)', async () => {
        const base = path.join(TMP, 'fserr');
        await fs.mkdir(base, { recursive: true });

        const r = new ReadFileTool({ baseDir: base });
        (fs.readFile as any).mockRejectedValueOnce('boom-string');
        await expect((r as any).performExecute({ fileName: 'x.txt', encoding: 'utf-8' }, ctx())).rejects.toThrow('Error reading file: boom-string');

        const c = new ReadFileChunkTool({ baseDir: base });
        (fs.readFile as any).mockRejectedValueOnce('chunk-string');
        await expect((c as any).performExecute({ fileName: 'x.txt', startLine: 0, endLine: 1, encoding: 'utf-8' }, ctx())).rejects.toThrow('Error reading file chunk: chunk-string');

        const u = new UpdateFileChunkTool({ baseDir: base });
        (fs.readFile as any).mockRejectedValueOnce('upd-string');
        await expect((u as any).performExecute({ fileName: 'x.txt', startLine: 0, endLine: 1, chunk: 'x', encoding: 'utf-8' }, ctx())).rejects.toThrow('Error updating file chunk: upd-string');

        const d = new DeleteFileTool({ baseDir: base });
        (fs.stat as any).mockRejectedValueOnce('del-string');
        await expect((d as any).performExecute({ fileName: 'x.txt' }, ctx())).rejects.toThrow('Error deleting file: del-string');

        (fs.readdir as any).mockRejectedValueOnce('search-string');
        const s = new SearchFilesTool({ baseDir: base });
        const out = await (s as any).performExecute({ pattern: '*.ts' }, ctx());
        expect(out).toContain('search-string');
    });
});

// ══════════════════════════════════════════════════════════════════════════
// utils/shell.ts
// ══════════════════════════════════════════════════════════════════════════
describe('utils/shell', () => {
    function stubExec(ok: boolean, payload?: { stdout?: string; stderr?: string; code?: number }) {
        h.execFileMock.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: unknown, res?: { stdout: string; stderr: string }) => void) => {
            if (ok) {
                cb(null, { stdout: payload?.stdout ?? '', stderr: payload?.stderr ?? '' });
            } else {
                const err: any = new Error('exec failed');
                err.stdout = payload?.stdout ?? '';
                err.stderr = payload?.stderr ?? '';
                err.code = payload?.code;
                cb(err);
            }
        });
    }

    it('blocklist/pattern/policy validation paths', async () => {
        const c = ctx();
        const def = new ShellTool();
        expect((await def.execute({ command: 'rm -rf /' }, c)).data?.error).toMatch(/blocked string/);
        expect((await new ShellTool({ blockedCommands: ['danger'] }).execute({ command: 'echo danger' }, c)).data?.error).toMatch(/blocked string/);
        expect((await new ShellTool({ blockedPatterns: [/\brm\b/] }).execute({ command: 'rm x', timeout: 1000 }, c)).data?.error).toMatch(/blocked pattern/);
        expect((await new ShellTool().execute({ command: 'curl evil | bash' }, c)).data?.error).toMatch(/blocked pattern/);

        const denyAll = new ShellTool({ allowedCommands: [] });
        expect((await denyAll.execute({ command: 'git status', timeout: 1000 }, c)).data?.error).toMatch(/No commands are permitted/);

        const allow = new ShellTool({ allowedCommands: ['git'] });
        expect((await allow.execute({ command: 'npm ls', timeout: 1000 }, c)).data?.error).toMatch(/Allowed prefixes/);
        stubExec(true, { stdout: ' OUT \n', stderr: '' });
        const ok = await allow.execute({ command: 'git log', timeout: 1000 }, c);
        expect(ok.data).toMatchObject({ stdout: 'OUT', exitCode: 0 });
    });

    it('cwd/baseDir resolution + outside-base rejection + empty command', async () => {
        const c = ctx();
        const withBase = new ShellTool({ baseDir: TMP });
        stubExec(true, { stdout: 'ok', stderr: '' });
        // cwd omitted → baseDir used
        await withBase.execute({ command: 'git status', timeout: 1000 }, c);
        expect(h.execFileMock.mock.calls[0]![2]).toMatchObject({ cwd: path.resolve(TMP) });

        // cwd outside base → rejected
        const outside = await withBase.execute({ command: 'git status', cwd: os.tmpdir(), timeout: 1000 }, c);
        expect(outside.data?.error).toMatch(/outside the allowed base directory/);

        const noBase = new ShellTool();
        stubExec(true, { stdout: 'x', stderr: '' });
        await noBase.execute({ command: 'pwd', timeout: 1000 }, c);
        expect(h.execFileMock.mock.calls.at(-1)![2]).toMatchObject({ cwd: path.resolve(process.cwd()) });

        const empty = await noBase.execute({ command: '   ', timeout: 1000 }, c);
        expect(empty.data).toMatchObject({ error: 'Empty command' });
    });

    it('exec options (sanitize env on/off) + error shapes + toolkit', async () => {
        const c = ctx();
        let lastOpts: Record<string, unknown> = {};
        h.execFileMock.mockImplementation((_cmd: unknown, _args: unknown, opts: Record<string, unknown>, cb: (err: unknown, res: { stdout: string; stderr: string }) => void) => {
            lastOpts = opts;
            cb(null, { stdout: 's', stderr: '' });
        });
        const sanitized = new ShellTool();
        await sanitized.execute({ command: 'echo hi', timeout: 1000 }, c);
        expect(lastOpts['env']).toMatchObject({ PATH: process.env['PATH'] });
        const raw = new ShellTool({ sanitizeEnv: false });
        await raw.execute({ command: 'echo hi', timeout: 1000 }, c);
        expect(lastOpts['env']).toBeUndefined();
        expect(lastOpts['maxBuffer']).toBe(1024 * 1024);

        // error with stdout/stderr/code
        h.execFileMock.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: unknown) => void) => {
            const err: any = new Error('boom');
            err.stdout = 'outpart'; err.stderr = 'errpart'; err.code = 7;
            cb(err);
        });
        const errRes = await sanitized.execute({ command: 'false', timeout: 1000 }, c);
        expect(errRes.data).toMatchObject({ stdout: 'outpart', stderr: 'errpart', exitCode: 7 });

        // plain error (no stdout/stderr) → generic error + exitCode 1
        h.execFileMock.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: unknown) => void) => {
            cb(new Error('ENOENT-ish'));
        });
        const plain = await sanitized.execute({ command: 'nope', timeout: 1000 }, c);
        expect(plain.data).toMatchObject({ error: 'ENOENT-ish', exitCode: 1 });

        // execFile error WITH stdout/stderr props but undefined values → `|| ''` / `?? 1`
        h.execFileMock.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: unknown) => void) => {
            const err: any = new Error('sparse');
            err.stdout = undefined;
            err.stderr = undefined;
            err.code = undefined;
            cb(err);
        });
        const sparse = await sanitized.execute({ command: 'false', timeout: 1000 }, c);
        expect(sparse.data).toMatchObject({ stdout: '', stderr: '', exitCode: 1 });

        // non-Error thrown by execFile → 'Unknown error occurred'
        h.execFileMock.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: unknown) => void) => {
            cb('not-an-error');
        });
        const nonErr = await sanitized.execute({ command: 'false', timeout: 1000 }, c);
        expect(nonErr.data).toMatchObject({ error: 'Unknown error occurred', exitCode: 1 });

        expect(ShellToolkit.create({ allowedCommands: ['git'] })).toHaveLength(1);
        expect(ShellToolkit.create()).toHaveLength(1);
    });
});

// ══════════════════════════════════════════════════════════════════════════
// src/tools/shell.ts
// ══════════════════════════════════════════════════════════════════════════
describe('tools/shell (createShellTool)', () => {
    function stubExec(ok: boolean, payload?: { stdout?: string; stderr?: string; code?: number }) {
        h.execFileMock.mockReset();
        h.execFileMock.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: unknown, res?: { stdout: string; stderr: string }) => void) => {
            if (ok) {
                cb(null, { stdout: payload?.stdout ?? '', stderr: payload?.stderr ?? '' });
            } else {
                const err: any = new Error('boom');
                err.stdout = payload?.stdout ?? 'o';
                err.stderr = payload?.stderr ?? 'e';
                err.code = payload?.code;
                cb(err);
            }
        });
    }

    it('deny-all default + explicit empty allowlist', async () => {
        const t0 = createShellTool();
        const r0 = await t0.execute({ command: 'git' });
        expect(r0).toMatchObject({ success: false, exitCode: 1 });
        expect((r0 as { stderr: string }).stderr).toContain('no commands are permitted');

        const t1 = createShellTool({ allowedCommands: [] });
        const r1 = await t1.execute({ command: 'git' });
        expect(r1.success).toBe(false);
    });

    it('allowlist match/non-match + args/cwd + success', async () => {
        stubExec(true, { stdout: '  done  ', stderr: '' });
        let call: { cmd: unknown; args: unknown; opts: Record<string, unknown> } | undefined;
        h.execFileMock.mockImplementation((cmd: unknown, args: unknown, opts: Record<string, unknown>, cb: (err: unknown, res: { stdout: string; stderr: string }) => void) => {
            call = { cmd, args, opts };
            cb(null, { stdout: '  done  ', stderr: '' });
        });
        const t = createShellTool({ allowedCommands: ['git', 'npm'] });
        const ok = await t.execute({ command: 'git', args: ['-v'], cwd: TMP });
        expect(ok).toMatchObject({ success: true, stdout: 'done', exitCode: 0 });
        expect(call!.cmd).toBe('git');
        expect(call!.args).toEqual(['-v']);
        expect(call!.opts).toMatchObject({ cwd: TMP, timeout: 30000, maxBuffer: 10 * 1024 * 1024 });

        const bad = await t.execute({ command: 'node', args: [] });
        expect(bad.success).toBe(false);
        expect((bad as { stderr: string }).stderr).toContain('not in the allowed list');

        // cwd undefined → process.cwd()
        stubExec(true);
        await t.execute({ command: 'git' });
        expect(h.execFileMock.mock.calls.at(-1)![2]).toMatchObject({ cwd: process.cwd() });
    });

    it('unrestricted (null) + error mapping + prebuilt shell', async () => {
        // unrestricted + non-Error
        h.execFileMock.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: unknown) => void) => {
            cb(new Error('fail hard'));
        });
        const t = createShellTool({ allowedCommands: null });
        const r = await t.execute({ command: 'git' });
        expect(r).toMatchObject({ success: false, exitCode: 1 });
        expect((r as { stderr: string }).stderr).toBe('fail hard');

        // error with stdout/stderr/code
        h.execFileMock.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: unknown) => void) => {
            const err: any = new Error('x');
            err.stdout = 'so'; err.stderr = 'se'; err.code = 3;
            cb(err);
        });
        const r2 = await t.execute({ command: 'git' });
        expect(r2).toMatchObject({ success: false, stdout: 'so', stderr: 'se', exitCode: 3 });

        // prebuilt unrestricted singleton
        h.execFileMock.mockImplementation((_cmd: unknown, _args: unknown, _opts: unknown, cb: (err: unknown, res?: { stdout: string; stderr: string }) => void) => {
            cb(null, { stdout: 'data', stderr: '' });
        });
        const r3 = await shell.execute({ command: 'git' });
        expect(r3).toMatchObject({ success: true, stdout: 'data', exitCode: 0 });
    });
});

// ══════════════════════════════════════════════════════════════════════════
// src/tools/browser.ts
// ══════════════════════════════════════════════════════════════════════════
describe('tools/browser (browserTool)', () => {
    it('ssrf pattern + ssrf dns + success', async () => {
        await expect(browserTool.execute({ url: 'http://localhost/x' })).rejects.toThrow(/SSRF blocked/);

        h.dnsLookupMock.mockResolvedValue({ address: '10.1.2.3', family: 4 });
        await expect(browserTool.execute({ url: 'http://public.example/x' })).rejects.toThrow(/SSRF blocked/);

        h.dnsLookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });
        const html = [
            '<html><head><title> T &amp; Co </title></head><body>hi',
            '<script>var x=1</script>',
            '<a href="http://example.com/a">a</a><a href="http://example.com/a">dup</a><a href="#x">f</a><a href="javascript:void(0)">j</a>',
            '<a href="http://[">bad</a>',
            '</body></html>',
        ].join('');
        globalThis.fetch = vi.fn(async () => new Response(html)) as typeof fetch;
        const r = await browserTool.execute({ url: 'http://example.com/', includeLinks: true });
        expect(r).toMatchObject({ title: 'T & Co', status: 200, ok: true });
        expect((r as { textContent: string }).textContent).toContain('hi');
        expect((r as { textContent: string }).textContent).not.toContain('<script>');
        expect((r as { links: string[] }).links).toContain('http://example.com/a');

        globalThis.fetch = vi.fn(async () => new Response(html)) as typeof fetch;
        const noLinks = await browserTool.execute({ url: 'http://example.com/' });
        expect((noLinks as { links: string[] }).links).toHaveLength(1); // default includeLinks=true

        globalThis.fetch = vi.fn(async () => new Response(html)) as typeof fetch;
        const withNoLinks = await browserTool.execute({ url: 'http://example.com/', includeLinks: false });
        expect((withNoLinks as { links: string[] }).links).toEqual([]);

        globalThis.fetch = vi.fn(async () => new Response('<html><body>bare</body></html>')) as typeof fetch;
        const noTitle = await browserTool.execute({ url: 'http://example.com/' });
        expect((noTitle as { title: string }).title).toBe('');

        globalThis.fetch = vi.fn(async () => { throw new Error('down'); }) as typeof fetch;
        await expect(browserTool.execute({ url: 'http://example.com/' })).rejects.toThrow('down');
    });

    it('abort on timeout (fake timers)', async () => {
        vi.useFakeTimers();
        try {
            globalThis.fetch = vi.fn((_url, init) => new Promise((_res, reject) => {
                (init as RequestInit).signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            })) as typeof fetch;
            const promise = browserTool.execute({ url: 'http://example.com/', timeout: 1000 });
            const assertion = expect(promise).rejects.toThrow('Aborted');
            await vi.advanceTimersByTimeAsync(1100);
            await assertion;
        } finally {
            vi.useRealTimers();
        }
    });
});

// ══════════════════════════════════════════════════════════════════════════
// src/tools/http-client.ts
// ══════════════════════════════════════════════════════════════════════════
describe('tools/http-client', () => {
    it('checkSsrf pattern + dns resolution paths', async () => {
        expect(await checkSsrf('localhost')).toMatch(/SSRF blocked/);
        expect(await checkSsrf('::ffff:10.0.0.1')).toMatch(/SSRF blocked/);
        expect(await checkSsrf('foo.internal')).toMatch(/SSRF blocked/);
        h.dnsLookupMock.mockResolvedValue({ address: '10.5.5.5', family: 4 });
        expect(await checkSsrf('public.example')).toMatch(/resolves to a private/);
        h.dnsLookupMock.mockRejectedValue(new Error('ENOTFOUND'));
        expect(await checkSsrf('public.example')).toMatch(/DNS resolution for "public.example" failed/);
        // non-Error rejection → String(e) path
        h.dnsLookupMock.mockRejectedValueOnce('dns-boom');
        expect(await checkSsrf('public.example')).toMatch(/failed/);
        h.dnsLookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });
        expect(await checkSsrf('public.example')).toBeNull();
    });

    it('DNS timeout branch (fake timers)', async () => {
        vi.useFakeTimers();
        try {
            let pending: ((v: { address: string; family: number }) => void) | undefined;
            h.dnsLookupMock.mockImplementation(() => new Promise((resolve) => { pending = resolve; }));
            const p = checkSsrf('slow.example');
            await vi.advanceTimersByTimeAsync(2100);
            expect(await p).toMatch(/DNS lookup timed out/);
            pending?.({ address: '1.2.3.4', family: 4 });
        } finally {
            vi.useRealTimers();
        }
    });

    it('execute: success, methods, body, headers, response shape', async () => {
        const seen: Array<{ url: unknown; init: RequestInit }> = [];
        globalThis.fetch = vi.fn(async (url, init) => {
            seen.push({ url, init: init as RequestInit });
            return new Response('body', {
                status: 200,
                headers: { 'content-type': 'text/plain', 'x-a': 'b' },
            });
        }) as typeof fetch;
        const t = createHttpClientTool();
        const r = await t.execute({ url: 'http://example.com/x', method: 'PUT', headers: { 'x-h': '1' }, body: 'raw' });
        expect(r).toMatchObject({ status: 200, ok: true, body: 'body' });
        expect((r as { headers: Record<string, string> }).headers['x-a']).toBe('b');
        const call = seen[0]!;
        expect((call.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
        expect((call.init.headers as Record<string, string>)['x-h']).toBe('1');
        expect(String(call.init.body)).toBe('raw');
        expect((call.init.method as string).toUpperCase()).toBe('PUT');
        expect((call.init as any).redirect).toBe('manual');

        // HEAD, DELETE with body undefined
        await t.execute({ url: 'http://example.com/x', method: 'HEAD' });
        await t.execute({ url: 'http://example.com/x', method: 'DELETE' });
        expect(seen[1]!.init.body).toBeUndefined();
        expect(seen[2]!.init.body).toBeUndefined();
    });

    it('execute: validation + ssrf + blocked/allowed domains', async () => {
        const t = createHttpClientTool();
        await expect(t.execute({ url: 'not-a-url' })).rejects.toThrow(/Invalid URL/);
        await expect(t.execute({ url: 'http://10.0.0.1/x' })).rejects.toThrow(/SSRF blocked/);

        const blocked = createHttpClientTool({ blockedDomains: ['blocked.example'] });
        await expect(blocked.execute({ url: 'http://api.blocked.example/x' })).rejects.toThrow(/Blocked: "api.blocked.example"/);
        await expect(blocked.execute({ url: 'http://blocked.example/x' })).rejects.toThrow(/Blocked/);

        const allowed = createHttpClientTool({ allowedDomains: ['ok.example'] });
        h.dnsLookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });
        await expect(allowed.execute({ url: 'http://nope.example/x' })).rejects.toThrow(/not in the allowed-domains list/);
        globalThis.fetch = vi.fn(async () => json({}));
        const ok = await allowed.execute({ url: 'http://sub.ok.example/x' });
        expect(ok.ok).toBe(true);

        // disableSsrfProtection skips SSRF but blockedDomains still applies
        const dis = createHttpClientTool({ disableSsrfProtection: true, blockedDomains: ['evil.example'] });
        globalThis.fetch = vi.fn(async () => json({}));
        await dis.execute({ url: 'http://localhost:9000/x' });
        await expect(dis.execute({ url: 'http://evil.example/x' })).rejects.toThrow(/Blocked/);
    });

    it('redirects: follow + method rewrite + no-location break + blocked + exceeded', async () => {
        globalThis.fetch = vi.fn(async (url, init) => {
            const u = String(url);
            const method = String((init as RequestInit).method ?? 'GET').toUpperCase();
            if (u === 'http://example.com/start' && method === 'POST') {
                return new Response(null, { status: 302, headers: { location: 'http://example.com/final' } });
            }
            if (u === 'http://example.com/final') {
                return new Response('final-body', { status: 200 });
            }
            return new Response('other', { status: 200 });
        }) as typeof fetch;
        const t = createHttpClientTool();
        const r = await t.execute({ url: 'http://example.com/start', method: 'POST', body: 'x' });
        expect(r.body).toBe('final-body');
        const calls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
        expect(String(calls[1]![1].method).toUpperCase()).toBe('GET');
        expect(calls[1]![1].body).toBeUndefined();

        // 3xx with no Location → final response
        globalThis.fetch = vi.fn(async () => new Response('noLoc', { status: 301 })) as typeof fetch;
        const r2 = await t.execute({ url: 'http://example.com/a' });
        expect(r2.body).toBe('noLoc');

        // 307 keeps POST method + body (else branch of `method === 'GET' ? ...`)
        globalThis.fetch = vi.fn(async (url, init) => {
            const u = String(url);
            const method = String((init as RequestInit).method ?? 'GET').toUpperCase();
            if (u === 'http://example.com/p' && method === 'POST') {
                return new Response(null, { status: 307, headers: { location: 'http://example.com/p2' } });
            }
            return new Response('final-307', { status: 200 });
        }) as typeof fetch;
        const r307 = await t.execute({ url: 'http://example.com/p', method: 'POST', body: 'keep' });
        expect(r307.body).toBe('final-307');
        const c307 = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
        expect(String((c307[1]![1] as RequestInit).method).toUpperCase()).toBe('POST');
        expect((c307[1]![1] as RequestInit).body).toBe('keep');

        // blocked redirect target
        let hop = 0;
        globalThis.fetch = vi.fn(async () => {
            hop++;
            if (hop === 1) return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/evil' } });
            return new Response('final', { status: 200 });
        }) as typeof fetch;
        await expect(t.execute({ url: 'http://example.com/a' })).rejects.toThrow('Redirect blocked:');

        // redirect chain exceeding 10 hops terminates via loop condition
        globalThis.fetch = vi.fn(async (_url, init) => {
            return new Response(null, { status: 302, headers: { location: 'http://example.com/next' + String((init as any)?.__n ?? 0) } });
        }) as typeof fetch;
        const rEx = await t.execute({ url: 'http://example.com/0' });
        expect(rEx.status).toBe(302);
        const fetchCalls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
        expect(fetchCalls).toBe(11);
    });

    it('fetch throws + timer cleared + default timeout + httpClient singleton', async () => {
        h.dnsLookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });
        globalThis.fetch = vi.fn(async () => { throw new Error('x'); }) as typeof fetch;
        await expect(httpClient.execute({ url: 'http://example.com/a' })).rejects.toThrow('x');

        globalThis.fetch = vi.fn(async () => new Response('ok-single', { status: 200 })) as typeof fetch;
        const r = await httpClient.execute({ url: 'http://example.com/b' });
        expect(r.body).toBe('ok-single');
    });

    it('abort on timeout fires the setTimeout callback', async () => {
        vi.useFakeTimers();
        try {
            h.dnsLookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });
            globalThis.fetch = vi.fn((_url, init) => new Promise((_res, reject) => {
                (init as RequestInit).signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            })) as typeof fetch;
            const t = createHttpClientTool();
            const promise = t.execute({ url: 'http://example.com/x', timeout: 1000 });
            const assertion = expect(promise).rejects.toThrow('Aborted');
            await vi.advanceTimersByTimeAsync(1100);
            await assertion;
        } finally {
            vi.useRealTimers();
        }
    });
});

// ══════════════════════════════════════════════════════════════════════════
// src/tools/file-system.ts
// ══════════════════════════════════════════════════════════════════════════
describe('tools/file-system', () => {
    it('read/write/append/delete/list/exists within sandbox', async () => {
        const root = path.join(TMP, 'fsroot');
        const tool = createFileSystemTool({ root });

        const written = await tool.execute({ operation: 'write', filePath: 'dir/a.txt', content: 'hello' });
        expect(written).toMatchObject({ written: true });
        expect((written as { bytes: number }).bytes).toBe(5);

        const read = await tool.execute({ operation: 'read', filePath: 'dir/a.txt' });
        expect(read).toMatchObject({ content: 'hello' });

        const appended = await tool.execute({ operation: 'append', filePath: 'dir/a.txt', content: '!' });
        expect(appended).toMatchObject({ appended: true });

        const listed = await tool.execute({ operation: 'list', dirPath: 'dir' });
        expect(listed).toEqual([{ name: 'a.txt', type: 'file' }]);

        // list top-level: dirs first, alphabetical (files too)
        await tool.execute({ operation: 'write', filePath: 'b.txt', content: 'x' });
        await tool.execute({ operation: 'write', filePath: 'c.txt', content: 'y' });
        await tool.execute({ operation: 'write', filePath: 'd2/nested.txt', content: 'z' });
        const top = await tool.execute({ operation: 'list', dirPath: '.' });
        const names = (top as Array<{ name: string; type: string }>);
        expect(names[0]).toEqual({ name: 'd2', type: 'directory' });
        expect(names[1]).toEqual({ name: 'dir', type: 'directory' });
        expect(names[2]).toEqual({ name: 'b.txt', type: 'file' });
        expect(names[3]).toEqual({ name: 'c.txt', type: 'file' });

        const existsT = await tool.execute({ operation: 'exists', filePath: 'dir/a.txt' });
        expect(existsT).toEqual({ exists: true });
        const existsF = await tool.execute({ operation: 'exists', filePath: 'missing' });
        expect(existsF).toEqual({ exists: false });

        const del = await tool.execute({ operation: 'delete', filePath: 'b.txt' });
        expect(del).toEqual({ deleted: true });
    });

    it('list sort comparator: file-before-dir ordering (+1 branch)', async () => {
        const orderedRoot = path.join(TMP, 'fsordered');
        await fs.mkdir(path.join(orderedRoot, 'zdir'), { recursive: true });
        await fs.writeFile(path.join(orderedRoot, 'afile.txt'), 'x');
        // force readdir to return [dir, file] so the comparator sees (file, dir)
        const nodeFs = await import('node:fs');
        (nodeFs.promises.readdir as any).mockReturnValueOnce([
            { name: 'zdir', isDirectory: () => true },
            { name: 'afile.txt', isDirectory: () => false },
        ]);
        const tool = createFileSystemTool({ root: orderedRoot });
        const listed = await tool.execute({ operation: 'list', dirPath: '.' });
        expect(listed).toEqual([
            { name: 'zdir', type: 'directory' },
            { name: 'afile.txt', type: 'file' },
        ]);
    });

    it('traversal is rejected via resolveWithin', async () => {
        const root = path.join(TMP, 'fsroot2');
        const tool = createFileSystemTool({ root });
        await expect(tool.execute({ operation: 'read', filePath: '../outside' })).rejects.toThrow(/outside the sandbox root/);
        await expect(tool.execute({ operation: 'write', filePath: 'sub/../../x', content: 'y' })).rejects.toThrow(/outside the sandbox root/);
        await expect(tool.execute({ operation: 'delete', filePath: '/etc/passwd' })).rejects.toThrow(/outside the sandbox root/);
        await expect(tool.execute({ operation: 'exists', filePath: '..' })).rejects.toThrow(/outside the sandbox root/);
    });

    it('default singleton uses CONFUSED_AI_FS_ROOT when set', async () => {
        const root = path.join(TMP, 'singleton-root');
        const prev = process.env['CONFUSED_AI_FS_ROOT'];
        process.env['CONFUSED_AI_FS_ROOT'] = root;
        try {
            const mod = await import('../src/tools/file-system.js');
            const r = await mod.fileSystem.execute({ operation: 'write', filePath: 'x.txt', content: 'c' });
            expect(r).toMatchObject({ written: true });
            const read = await mod.fileSystem.execute({ operation: 'read', filePath: 'x.txt' });
            expect(read).toMatchObject({ content: 'c' });
        } finally {
            if (prev === undefined) delete process.env['CONFUSED_AI_FS_ROOT'];
            else process.env['CONFUSED_AI_FS_ROOT'] = prev;
        }
    });
});

// ══════════════════════════════════════════════════════════════════════════
// src/tools/compose.ts
// ══════════════════════════════════════════════════════════════════════════
interface FixtureTool {
    id: string;
    name: string;
    description: string;
    parameters: unknown;
    permissions: { allowNetwork: boolean; allowFileSystem: boolean; maxExecutionTimeMs: number };
    category: ToolCategory;
    version: string;
    validate(p: unknown): boolean;
    execute(p: any, c?: any): Promise<{
        success: boolean;
        data?: unknown;
        error?: { code: string; message: string };
        executionTimeMs: number;
        metadata: { startTime: Date; endTime: Date; retries: number };
    }>;
}

function fx(over: Partial<FixtureTool> & { name: string }): FixtureTool {
    return {
        id: `fx-${over.name}`,
        name: over.name,
        description: `d-${over.name}`,
        parameters: {},
        permissions: { allowNetwork: false, allowFileSystem: false, maxExecutionTimeMs: 30_000 },
        category: ToolCategory.UTILITY,
        version: '1.0.0',
        validate: () => true,
        execute: async () => ({ success: true, data: 'val', executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }),
        ...over,
    };
}

const opts = { id: 'c', name: 'c', description: 'c' };

describe('tools/compose', () => {
    it('composeTool: success chain + failure propagation + metadata/perms', async () => {
        const first = fx({
            name: 'first',
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 100 },
            execute: async () => ({ success: true, data: 'A', executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }),
        });
        const second = fx({
            name: 'second',
            permissions: { allowNetwork: false, allowFileSystem: true, maxExecutionTimeMs: 200 },
            execute: async (p: any) => ({ success: true, data: `B(${p.input})`, executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }),
        });
        const composed = composeTool(first as any, second as any, opts);
        const r = await (composed as any).execute({}, ctx());
        expect(r).toMatchObject({ success: true, data: 'B(A)' });
        expect(composed.permissions).toMatchObject({ allowNetwork: true, allowFileSystem: true, maxExecutionTimeMs: 200 });
        expect(composed.category).toBe(ToolCategory.CUSTOM);
        expect((composed as any).version).toBe('1.0.0');
        expect((composed as any).validate({})).toBe(true);
        expect(composed.id).toBe('c');

        const failing = fx({ name: 'fail', execute: async () => ({ success: false, error: { code: 'E', message: 'no' }, executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }) });
        const c2 = composeTool(failing as any, second as any, { ...opts, category: ToolCategory.WEB });
        const r2 = await (c2 as any).execute({}, ctx());
        expect(r2.success).toBe(false);
        expect(r2.metadata.startTime).toBeInstanceOf(Date);
        expect(c2.category).toBe(ToolCategory.WEB);
    });

    it('parallelTools: empty throws, fail-fast, fail-safe, all ok', async () => {
        expect(() => parallelTools([], opts as any)).toThrow('at least one tool required');

        const ok1 = fx({ name: 'p1', execute: async () => ({ success: true, data: 1, executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }) });
        const ok2 = fx({ name: 'p2', execute: async () => ({ success: true, data: 2, executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }) });
        const bad3 = fx({ name: 'p3', execute: async () => ({ success: false, error: { code: 'F', message: 'f3' }, executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }) });
        const badNoMsg: any = fx({ name: 'p4', execute: async () => ({ success: false, error: { code: 'F' }, executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }) });

        const allOk = parallelTools([ok1 as any, ok2 as any], opts as any);
        const rAll = await (allOk as any).execute({}, ctx());
        expect(rAll).toMatchObject({ success: true, data: [1, 2] });

        const ff = parallelTools([ok1 as any, bad3 as any], opts as any);
        const rFf = await (ff as any).execute({}, ctx());
        expect(rFf.success).toBe(false);
        expect(rFf.error?.code).toBe('PARALLEL_TOOL_FAILURE');
        expect(rFf.error?.message).toContain('f3');

        // failing result without error.message → 'unknown' fallback
        const ffNoMsg = parallelTools([ok1 as any, badNoMsg as any], opts as any);
        const rNoMsg = await (ffNoMsg as any).execute({}, ctx());
        expect(rNoMsg.error?.message).toBe('unknown');

        const safe = parallelTools([ok1 as any, bad3 as any, ok2 as any], { ...opts, failFast: false, permissions: { allowNetwork: true } });
        const rSafe = await (safe as any).execute({}, ctx());
        expect(rSafe).toMatchObject({ success: true, data: [1, 2] });
        expect(safe.permissions).toMatchObject({ allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 30_000 });
        expect((safe as any).validate({})).toBe(true);
    });

    it('fallbackTool: default predicate, custom predicate, merged perms', async () => {
        const primary = fx({ name: 'prim', execute: async () => ({ success: false, error: { code: 'X', message: 'p-fail' }, executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }) });
        const secondary = fx({ name: 'sec', execute: async () => ({ success: true, data: 'S', executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }) });

        const fb = fallbackTool(primary as any, secondary as any, opts);
        const r = await (fb as any).execute({}, ctx());
        expect(r).toMatchObject({ success: true, data: 'S' });
        expect((fb as any).validate({})).toBe(true);

        const okPrimary = fx({ name: 'okp', execute: async () => ({ success: true, data: 'P', executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }) });
        const r2 = await (fallbackTool(okPrimary as any, secondary as any, opts) as any).execute({}, ctx());
        expect(r2).toMatchObject({ success: true, data: 'P' });

        // custom predicate: fall back even on success
        const r3 = await (fallbackTool(okPrimary as any, secondary as any, { ...opts, shouldFallback: () => true }) as any).execute({}, ctx());
        expect(r3).toMatchObject({ data: 'S' });

        // custom predicate false on failure → returns failure
        const r4 = await (fallbackTool(primary as any, secondary as any, { ...opts, shouldFallback: () => false }) as any).execute({}, ctx());
        expect(r4.success).toBe(false);

        // default options object
        const dflt = fallbackTool(primary as any, secondary as any);
        expect(dflt.id).toBe('');

        const withPerms = fallbackTool(primary as any, secondary as any, { ...opts, permissions: { allowNetwork: true } });
        expect(withPerms.permissions).toMatchObject({ allowNetwork: true });
    });

    it('retryTool: immediate success, retry-then-success, exhaust, custom predicate', async () => {
        const immediate = fx({ name: 'imm', execute: async () => ({ success: true, data: 'ok', executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }) });
        const r0 = await (retryTool(immediate as any, { maxAttempts: 3, backoffMs: 1 }) as any).execute({}, ctx());
        expect(r0).toMatchObject({ success: true, data: 'ok' });

        let calls = 0;
        const flaky = fx({
            name: 'flaky',
            execute: async () => {
                calls++;
                if (calls < 3) {
                    return { success: false, error: { code: 'X', message: 'retry me' }, executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } };
                }
                return { success: true, data: 'recovered', executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } };
            },
        });
        const r1 = await (retryTool(flaky as any, { maxAttempts: 3, backoffMs: 1 }) as any).execute({}, ctx());
        expect(r1).toMatchObject({ success: true, data: 'recovered' });
        expect(calls).toBe(3);

        calls = 0;
        const alwaysBad = fx({
            name: 'bad',
            execute: async () => { calls++; return { success: false, error: { code: 'X', message: 'nope' }, executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }; },
        });
        const r2 = await (retryTool(alwaysBad as any, { maxAttempts: 3, backoffMs: 1 }) as any).execute({}, ctx());
        expect(r2.success).toBe(false);
        expect(calls).toBe(3);
        expect((retryTool(alwaysBad as any, {}) as any).id).toContain(':retry');

        // custom predicate only retries on attempt 1
        calls = 0;
        const custom = retryTool(alwaysBad as any, {
            maxAttempts: 3,
            backoffMs: 1,
            shouldRetry: (_r, attempt) => attempt === 1,
        });
        const r3 = await (custom as any).execute({}, ctx());
        expect(calls).toBe(2);
    });

    it('timeoutTool: completes normally + times out', async () => {
        const fast = fx({ name: 'fast', execute: async () => ({ success: true, data: 'f', executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }) });
        const wt = timeoutTool(fast as any, 50);
        const r = await (wt as any).execute({}, ctx());
        expect(r).toMatchObject({ success: true, data: 'f' });
        expect(wt.id).toBe('fx-fast:timeout(50)');
        expect(wt.permissions.maxExecutionTimeMs).toBe(50);

        const slow = fx({ name: 'slow', execute: async () => new Promise(() => { /* never */ }) as any });
        const st = timeoutTool(slow as any, 10);
        const rSlow = await (st as any).execute({}, ctx());
        expect(rSlow.success).toBe(false);
        expect(rSlow.error).toMatchObject({ code: 'TOOL_TIMEOUT' });
        expect(rSlow.error?.message).toContain('timed out');

        // tool rejects with a NON-Error before the deadline → String(err)
        const stringBomb: any = fx({ name: 'sb', execute: async () => { throw 'raw-explosion'; } });
        const st2 = timeoutTool(stringBomb as any, 100);
        const rStr = await (st2 as any).execute({}, ctx());
        expect(rStr).toMatchObject({ success: false, error: { code: 'TOOL_TIMEOUT', message: 'raw-explosion' } });
    });

    it('mapTool: success, mapper error, tool failure passthrough', async () => {
        const inner = fx({ name: 'm', execute: async () => ({ success: true, data: 5, executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }) });
        const mapped = mapTool(inner as any, (n: number) => n * 2, { id: 'mm', description: 'dd' });
        const r = await (mapped as any).execute({}, ctx());
        expect(r).toMatchObject({ success: true, data: 10 });
        expect(mapped.id).toBe('mm');
        expect(mapped.description).toBe('dd');

        const defaultMapped = mapTool(inner as any, (n: number) => n + 1);
        expect(defaultMapped.id).toBe('fx-m:mapped');

        const throwing = mapTool(inner as any, () => { throw new Error('mapfail'); });
        const rErr = await (throwing as any).execute({}, ctx());
        expect(rErr.success).toBe(false);
        expect(rErr.error?.code).toBe('MAP_ERROR');
        expect(rErr.error?.message).toBe('mapfail');

        // mapper throws a non-Error → String(err)
        const throwingStr = mapTool(inner as any, () => { throw 'map-str'; });
        const rStr = await (throwingStr as any).execute({}, ctx());
        expect(rStr).toMatchObject({ success: false, error: { code: 'MAP_ERROR', message: 'map-str' } });

        const failing = fx({ name: 'mf', execute: async () => ({ success: false, error: { code: 'X', message: 'nope' }, executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }) });
        const mFail = mapTool(failing as any, (x: any) => x);
        const rFail = await (mFail as any).execute({}, ctx());
        expect(rFail.success).toBe(false);
    });

    it('filterTool: predicate true executes, false returns null', async () => {
        const inner = fx({ name: 'fi', execute: async () => ({ success: true, data: 'ran', executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }) });
        const yes = filterTool(inner as any, () => true);
        const r1 = await (yes as any).execute({}, ctx());
        expect(r1).toMatchObject({ success: true, data: 'ran' });

        const no = filterTool(inner as any, () => false);
        const r2 = await (no as any).execute({}, ctx());
        expect(r2).toMatchObject({ success: true, data: null });

        const asyncPred = filterTool(inner as any, async () => false);
        const r3 = await (asyncPred as any).execute({}, ctx());
        expect(r3.data).toBeNull();

        const usr = filterTool(inner as any, (_p, c) => c.permissions.allowNetwork);
        const r4 = await (usr as any).execute({}, ctx({ permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 1 } }));
        expect(r4.data).toBe('ran');
        expect((no as any).id).toBe('fx-fi:filtered');
    });
});
