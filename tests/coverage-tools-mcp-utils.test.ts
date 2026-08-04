/**
 * Hermetic coverage: MCP machinery (HTTP JSON-RPC client, HTTP server, stdio
 * server, streamable-SSE transport, resources/prompts/sampling/SSE helpers).
 *
 * All transports are stubbed: fetch is mocked per-test, node:http createServer
 * is replaced with an in-memory fake, node:readline is replaced with an async
 * iterable, and child_process is mocked so no real shell ever runs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mock state ──────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
    serverHandler: undefined as undefined | ((req: unknown, res: unknown) => void),
    httpServers: [] as any[],
    rlObject: undefined as undefined | AsyncIterable<string>,
    readlineOpts: undefined as unknown,
    execFileMock: vi.fn(),
    dnsLookupMock: vi.fn(),
}));

vi.mock('node:http', () => ({
    createServer: vi.fn((handler: (req: unknown, res: unknown) => void) => {
        h.serverHandler = handler;
        const listeners: Record<string, Array<(x: unknown) => void>> = {};
        const server: any = {
            on(ev: string, fn: (x: unknown) => void) {
                (listeners[ev] ??= []).push(fn);
                return server;
            },
            emit(ev: string, ...args: unknown[]) {
                (listeners[ev] ?? []).forEach((fn) => fn(args[matchKey(ev)]));
                return true;
            },
            listen(port: number, host: string, cb: () => void) {
                server.port = port;
                server.host = host;
                setImmediate(cb);
                return server;
            },
            close(cb?: (err?: unknown) => void) {
                cb?.(server.closeErr);
                return server;
            },
        };
        function matchKey(ev: string): number {
            return ev === 'error' ? 0 : 0;
        }
        h.httpServers.push(server);
        return server;
    }),
}));

vi.mock('node:readline', () => ({
    createInterface: vi.fn((opts: unknown) => {
        h.readlineOpts = opts;
        return h.rlObject;
    }),
}));

vi.mock('node:child_process', () => ({ execFile: h.execFileMock }));
vi.mock('child_process', () => ({ execFile: h.execFileMock }));

vi.mock('node:dns/promises', () => ({ lookup: h.dnsLookupMock }));

// ── Imports (after mocks) ───────────────────────────────────────────────────
import { HttpMcpClient, loadMcpToolsFromUrl } from '../src/tools/mcp/client.js';
import {
    McpResourceRegistry,
    McpPromptRegistry,
    McpSamplingClient,
    McpCapabilityHandler,
    McpSseEmitter,
    buildServerCapabilities,
} from '../src/tools/mcp/resources.js';
import { McpHttpServer, createMcpServer } from '../src/tools/mcp/server.js';
import {
    handleMcpStdioLine,
    runMcpStdioToolServer,
} from '../src/tools/mcp/stdio-server.js';
import {
    StreamableMcpClient,
    connectMcpServer,
} from '../src/tools/mcp/transport-sse.js';
import type { Tool, ToolContext } from '../src/tools/core/types.js';
import { ToolCategory } from '../src/tools/core/types.js';
import { z } from 'zod';

const originalFetch = globalThis.fetch;

function ctx(over: Partial<ToolContext> = {}): ToolContext {
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

function sseStream(frames: string): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream<Uint8Array>({
        start(c) {
            c.enqueue(enc.encode(frames));
            c.close();
        },
    });
}

function okResult(result: unknown): ToolResultLike {
    return { success: true, data: result, executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } };
}
interface ToolResultLike {
    success: boolean;
    data?: unknown;
    error?: { code: string; message: string };
    executionTimeMs: number;
    metadata: { startTime: Date; endTime: Date; retries: number };
}

function failResult(message: string): ToolResultLike {
    return { success: false, error: { code: 'X', message }, executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } };
}

function mkTool(over: Partial<Tool> & { name: string }): Tool {
    const tool: Tool = {
        id: `id-${over.name}`,
        name: over.name,
        description: `desc-${over.name}`,
        parameters: {} as Tool['parameters'],
        permissions: { allowNetwork: false, allowFileSystem: false, maxExecutionTimeMs: 30_000 },
        category: ToolCategory.UTILITY,
        version: '1.0.0',
        validate: () => true,
        execute: async () => okResult('ok') as any,
        ...over,
    };
    return tool;
}

function mkRegistry(over: Record<string, unknown> = {}) {
    const tools: Tool[] = [];
    return {
        register: (t: Tool) => { tools.push(t); },
        unregister: () => true,
        get: () => undefined,
        getByName: (n: string) => tools.find((t) => t.name === n),
        list: () => tools,
        listByCategory: () => [],
        search: () => [],
        has: () => false,
        clear: () => {},
        ...over,
    };
}

beforeEach(() => {
    h.execFileMock.mockReset();
    h.dnsLookupMock.mockReset();
    h.dnsLookupMock.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    h.rlObject = undefined;
    h.readlineOpts = undefined;
});
afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
});

// ── helpers for the SSE client ──────────────────────────────────────────────
function lastFetchCall() {
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    return { url: call?.[0], init: call?.[1] as RequestInit };
}

// ══════════════════════════════════════════════════════════════════════════
// resources.ts
// ══════════════════════════════════════════════════════════════════════════
describe('MCP resources: registry', () => {
    it('add/remove/templates/change handlers/list/read', async () => {
        const reg = new McpResourceRegistry();
        let changed = 0;
        const unsub = reg.onListChanged(() => { changed++; });
        reg.add({ uri: 'file:///a', name: 'A', description: 'd', mimeType: 'text/plain', read: () => ({ type: 'text', text: 'x' }) });
        reg.add({ uri: 'blob://b', name: 'B', read: async () => ({ type: 'blob', blob: 'YQ==' }) });
        reg.addTemplate({ uriTemplate: 'db://p/{id}', name: 'T', description: 'prod', mimeType: 'application/json', read: (v) => ({ type: 'text', text: v['id']! }) });
        reg.addTemplate({ uriTemplate: 'static://x', name: 'S' } as any);

        expect(reg.list()).toHaveLength(2);
        expect(reg.list()[0]).toMatchObject({ uri: 'file:///a', description: 'd', mimeType: 'text/plain' });
        expect(reg.list()[1]!.description).toBeUndefined();
        expect(reg.listTemplates()[0]).toMatchObject({ uriTemplate: 'db://p/{id}', description: 'prod', mimeType: 'application/json' });
        expect(reg.listTemplates()[1]!.description).toBeUndefined();
        expect(reg.listTemplates()[1]!.mimeType).toBeUndefined();
        expect(changed).toBe(2);

        expect(await reg.read('file:///a')).toMatchObject({ uri: 'file:///a', text: 'x', mimeType: 'text/plain' });
        expect(await reg.read('blob://b')).toMatchObject({ blob: 'YQ==' });
        expect(await reg.read('db://p/42')).toMatchObject({ text: '42', uri: 'db://p/42', mimeType: 'application/json' });

        await expect(reg.read('db://other/7')).rejects.toThrow('Resource not found: db://other/7');
        await expect(reg.read('nope://x')).rejects.toThrow(/not found/);

        reg.remove('file:///a');
        expect(reg.list()).toHaveLength(1);
        unsub();
        reg.add({ uri: 'file:///a', name: 'A', read: () => ({ type: 'text', text: 'x' }) });
        expect(changed).toBe(3); // handler unsubscribed → no further increments
    });

    it('exact-read without mimeType and blob branch via template', async () => {
        const reg = new McpResourceRegistry();
        reg.add({ uri: 'u://1', name: 'U', read: () => ({ type: 'text', text: 't' }) });
        expect(await reg.read('u://1')).toMatchObject({ text: 't' });
        expect((await reg.read('u://1'))['mimeType']).toBeUndefined();
        reg.addTemplate({ uriTemplate: 'blob://{id}', name: 'B', read: () => ({ type: 'blob', blob: 'abc' }) });
        expect(await reg.read('blob://z')).toMatchObject({ blob: 'abc' });
    });
});

describe('MCP resources: prompts + sampling + caps + SSE', () => {
    it('prompt registry add/get/remove/handlers/list details', async () => {
        const p = new McpPromptRegistry();
        let n = 0;
        const unsub = p.onListChanged(() => { n++; });
        p.add({ name: 'noDesc', get: () => [{ role: 'user', content: { type: 'text', text: 'a' } }] });
        p.add({ name: 'withDesc', description: 'dd', arguments: [{ name: 'x', required: true }], get: () => [] });
        expect(n).toBe(2);
        expect(p.list()[0]!.description).toBeUndefined();
        expect(p.list()[0]!.arguments).toBeUndefined();
        expect(p.list()[1]).toMatchObject({ description: 'dd', arguments: [{ name: 'x', required: true }] });
        const r1 = await p.get('noDesc', {});
        expect(r1['description']).toBeUndefined();
        const r2 = await p.get('withDesc', { x: '1' });
        expect(r2['description']).toBe('dd');
        expect(r2.messages).toEqual([]);
        await expect(p.get('missing', {})).rejects.toThrow('Prompt not found: missing');
        p.remove('noDesc');
        unsub();
        expect(p.list()).toHaveLength(1);
    });

    it('capability handler — every case incl. passthrough', async () => {
        const resources = new McpResourceRegistry();
        resources.add({ uri: 'file:///x', name: 'X', read: () => ({ type: 'text', text: 'x' }) });
        const prompts = new McpPromptRegistry();
        prompts.add({ name: 'g', get: () => [] });
        const completer = { complete: async () => ({ values: ['v'], total: 1, hasMore: true }) };

        const caps = new McpCapabilityHandler(resources, prompts, completer);
        expect(await caps.handle('resources/list', undefined)).toMatchObject({ resources: expect.any(Array) });
        expect(await caps.handle('resources/templates/list', {})).toMatchObject({ resourceTemplates: expect.any(Array) });
        expect(await caps.handle('resources/read', { uri: 'file:///x' })).toMatchObject({ contents: [{ uri: 'file:///x' }] });
        await expect(caps.handle('resources/read', {})).rejects.toThrow(/missing uri/);
        expect(await caps.handle('resources/subscribe', {})).toEqual({});
        expect(await caps.handle('resources/unsubscribe', {})).toEqual({});
        expect(await caps.handle('prompts/list', {})).toMatchObject({ prompts: expect.any(Array) });
        expect(await caps.handle('prompts/get', { name: 'g' })).toMatchObject({ messages: expect.any(Array) });
        expect(await caps.handle('completion/complete', { ref: { type: 'ref/prompt' as string, name: 'g' }, argument: { name: 'a', value: 'v' } })).toMatchObject({ completion: { values: ['v'] } });
        expect(await caps.handle('whatever', {})).toBeNull();

        // without registries → passthrough null
        const none = new McpCapabilityHandler();
        expect(await none.handle('resources/list', {})).toBeNull();
        expect(await none.handle('resources/templates/list', {})).toBeNull();
        expect(await none.handle('resources/read', { uri: 'x' })).toBeNull();
        expect(await none.handle('prompts/list', {})).toBeNull();
        expect(await none.handle('prompts/get', { name: 'x' })).toBeNull();
        expect(await none.handle('completion/complete', {})).toBeNull();

        // no completions provider
        const noComp = new McpCapabilityHandler(resources, prompts);
        expect(await noComp.handle('completion/complete', {})).toBeNull();
    });

    it('sampling client: success / http / rpc errors', async () => {
        globalThis.fetch = vi.fn(async () => json({
            result: { role: 'assistant', content: { type: 'text', text: 'ok' }, model: 'm' },
        })) as typeof fetch;
        const c = new McpSamplingClient('https://h/mcp', { 'x-h': '1' });
        const r = await c.createMessage({
            messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }],
            maxTokens: 5,
            modelPreferences: { hints: [{ name: 'm' }], costPriority: 1 },
            systemPrompt: 'sys',
            temperature: 0.5,
            stopSequences: ['\n'],
            metadata: { k: 1 },
        } as any);
        expect(r.model).toBe('m');
        expect((lastFetchCall() as any).init.body).toContain('"includeContext":"none"');

        const noPrefs = new McpSamplingClient('https://h/mcp');
        globalThis.fetch = vi.fn(async () => json({ result: { role: 'assistant', content: { type: 'text', text: 'z' }, model: 'z' } })) as typeof fetch;
        await noPrefs.createMessage({ messages: [], maxTokens: 1 } as any);

        globalThis.fetch = vi.fn(async () => json({ error: { code: -1, message: 'no' } })) as typeof fetch;
        await expect(c.createMessage({ messages: [], maxTokens: 1 } as any)).rejects.toThrow('MCP sampling -1: no');

        globalThis.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as typeof fetch;
        await expect(c.createMessage({ messages: [], maxTokens: 1 } as any)).rejects.toThrow('MCP sampling HTTP 500: nope');
    });

    it('SSE emitter + capabilities builder combos', () => {
        const chunks: string[] = [];
        const res = {
            writeHead: vi.fn((status: number, headers: Record<string, string>) => { res['status'] = status; res['headers'] = headers; return res; }),
            write: vi.fn((c: string) => { chunks.push(c); return true; }),
            end: vi.fn(() => { res['ended'] = true; }),
        } as any;
        const em = new McpSseEmitter(res);
        em.sendNotification('notifications/resources/updated', { uri: 'x' });
        em.sendResponse(1, { ok: true });
        em.sendResponse(null, null);
        em.sendError(2, -32601, 'm');
        em.sendError(null, 0, 'e');
        em.end();
        expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({ 'content-type': 'text/event-stream' }));
        expect(chunks.join('')).toContain('notifications/resources/updated');
        expect(chunks.join('')).toContain('"id":2');

        expect(buildServerCapabilities({})).toEqual({ tools: {} });
        expect(buildServerCapabilities({ hasResources: true })).toMatchObject({ resources: { subscribe: true, listChanged: true } });
        expect(buildServerCapabilities({ hasPrompts: true })).toMatchObject({ prompts: { listChanged: true } });
        expect(buildServerCapabilities({ hasSampling: true })).toMatchObject({ sampling: {} });
        expect(buildServerCapabilities({ hasCompletions: true })).toMatchObject({ completions: {} });
        expect(buildServerCapabilities({ hasResources: true, hasPrompts: true, hasSampling: true, hasCompletions: true })).toMatchObject({
            tools: {}, resources: expect.any(Object), prompts: expect.any(Object), sampling: expect.any(Object), completions: expect.any(Object),
        });
    });
});

// ══════════════════════════════════════════════════════════════════════════
// client.ts (HttpMcpClient)
// ══════════════════════════════════════════════════════════════════════════
describe('HttpMcpClient', () => {
    function rpcRespond(init: RequestInit, result: unknown) {
        const body = JSON.parse(String(init.body)) as { id?: unknown };
        return json({ jsonrpc: '2.0', id: body['id'], result });
    }

    it('constructor normalizes url + rpc request/response lifecycle', async () => {
        const calls: Array<{ url: unknown; init: RequestInit }> = [];
        globalThis.fetch = vi.fn(async (url, init) => {
            calls.push({ url, init: init as RequestInit });
            return rpcRespond(init as RequestInit, { tools: [{ name: 't1', description: 'd' }] });
        }) as typeof fetch;
        const client = new HttpMcpClient({ url: 'https://h/mcp/', headers: { 'x-a': 'b' }, timeoutMs: 5000 });
        const tools = await client.listTools();
        expect(tools).toEqual([{ name: 't1', description: 'd' }]);
        expect(calls[0]!.url).toBe('https://h/mcp');
        expect((calls[0]!.init.headers as Record<string, string>)['x-a']).toBe('b');
        expect(String(calls[0]!.init.body)).toContain('"jsonrpc":"2.0"');
        expect(String(calls[0]!.init.body)).toContain('"method":"tools/list"');
    });

    it('listTools with no description/inputSchema + callTool + getTools + bridge', async () => {
        globalThis.fetch = vi.fn(async (_url, init) => rpcRespond(init as RequestInit, { tools: [{ name: 'a_b' }, { name: 'with-schema', description: 'd', inputSchema: { type: 'object' } }] })) as typeof fetch;
        const client = new HttpMcpClient({ url: 'https://h/mcp' });
        const tools = await client.getTools();
        expect(tools).toHaveLength(2);
        expect(tools[0]!.name).toBe('a_b');
        expect((tools[0] as any).mcpName).toBe('a_b');

        // listTools with NO tools key → `?? []`
        globalThis.fetch = vi.fn(async (_url, init) => rpcRespond(init as RequestInit, {})) as typeof fetch;
        const emptyClient = new HttpMcpClient({ url: 'https://h/mcp' });
        expect(await emptyClient.listTools()).toEqual([]);

        // tool.execute → bridge performExecute → callTool → rpc
        globalThis.fetch = vi.fn(async (_url, init) => rpcRespond(init as RequestInit, {
            content: [{ type: 'text', text: 'hello' }, { type: 'text', text: '' }, { type: 'image', data: 'x' }],
        })) as typeof fetch;
        const out = await (tools[0] as any).performExecute({ a: 1 });
        expect(out).toContain('hello');
        expect(out).toContain('{"type":"image","data":"x"}');
        expect(String((lastFetchCall() as any).init.body)).toContain('"method":"tools/call"');

        // callTool returns no content → `out.content ?? []`
        globalThis.fetch = vi.fn(async (_url, init) => rpcRespond(init as RequestInit, {})) as typeof fetch;
        expect(await (tools[0] as any).performExecute({})).toBe('');
    });

    it('rpc error branches: invalid response / rpc error / missing result / timeout abort', async () => {
        const client = new HttpMcpClient({ url: 'https://h/mcp', timeoutMs: 100 });
        globalThis.fetch = vi.fn(async (_url, init) => rpcRespond(init as RequestInit, 123)) as typeof fetch;
        await expect((client as any).rpc('ping', {} as any)).resolves.toBe(123);

        globalThis.fetch = vi.fn(async () => json([1, 2])) as typeof fetch;
        await expect((client as any).rpc('ping' as any)).rejects.toThrow('MCP: invalid JSON-RPC response');

        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body)) as { id?: unknown };
            return json({ jsonrpc: '2.0', id: body['id'], error: { code: -1, message: 'boom' } });
        }) as typeof fetch;
        await expect((client as any).rpc('ping' as any)).rejects.toThrow('MCP error -1: boom');

        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body)) as { id?: unknown };
            return json({ jsonrpc: '2.0', id: body['id'], result: undefined });
        }) as typeof fetch;
        await expect((client as any).rpc('ping' as any)).rejects.toThrow('MCP: missing result');

        // fetch throws → finally clears timer, error propagates
        globalThis.fetch = vi.fn(async () => { throw new Error('net'); }) as typeof fetch;
        await expect((client as any).rpc('ping' as any)).rejects.toThrow('net');

        // timer fires → controller.abort() → the setTimeout callback executes
        globalThis.fetch = vi.fn((_url, init) => new Promise((_res, reject) => {
            (init as RequestInit).signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        })) as typeof fetch;
        const abortClient = new HttpMcpClient({ url: 'https://h/mcp', timeoutMs: 15 });
        await expect((abortClient as any).rpc('ping' as any)).rejects.toThrow('Aborted');
    });

    it('loadMcpToolsFromUrl shorthand', async () => {
        globalThis.fetch = vi.fn(async (_url, init) => rpcRespond(init as RequestInit, { tools: [{ name: 'x' }] })) as typeof fetch;
        const tools = await loadMcpToolsFromUrl('https://h/mcp', { 'a': 'b' });
        expect(tools).toHaveLength(1);
    });
});

// ══════════════════════════════════════════════════════════════════════════
// server.ts (McpHttpServer)
// ══════════════════════════════════════════════════════════════════════════
describe('McpHttpServer', () => {
    it('constructor defaults + registerTool + baseUrl', () => {
        const registry = mkRegistry();
        const s = new McpHttpServer(registry as any);
        expect(s.baseUrl).toBe('http://127.0.0.1:3100/mcp');
        const register = vi.fn();
        const s2 = new McpHttpServer({ ...mkRegistry(), register } as any, {
            name: 'n', version: '2.0', port: 9999, host: '0.0.0.0', path: '/api', maxBodyBytes: 123,
            toolTimeoutMs: 5, cors: ['https://ok.example'], auth: { type: 'api-key', key: 'k', header: 'x-custom' }, logger: {},
        });
        const t = mkTool({ name: 'tt' });
        s2.registerTool(t);
        expect(register).toHaveBeenCalledWith(t);
        expect(s2['opts'].name).toBe('n');
    });

    it('createMcpServer factory', () => {
        const s = createMcpServer(mkRegistry() as any, { port: 0 });
        expect(s).toBeInstanceOf(McpHttpServer);
    });

    it('start/stop lifecycle + start error', async () => {
        const s = new McpHttpServer(mkRegistry() as any, { port: 0, host: '127.0.0.1' });
        const logger = { debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() };
        (s as any).opts.logger = logger;
        await s.start();
        expect(h.httpServers).toHaveLength(1);
        expect(logger.info).toHaveBeenCalled();

        // second start is a no-op
        await s.start();
        expect(h.httpServers).toHaveLength(1);

        await s.stop();
        // stop again with no server → undefined
        await s.stop();

        // start → error event rejects
        const sErr = new McpHttpServer(mkRegistry() as any, {});
        const p = sErr.start();
        const last = h.httpServers.at(-1)!;
        last.emit('error', new Error('EADDRINUSE'));
        await expect(p).rejects.toThrow('EADDRINUSE');

        // stop() with a close error → rejects (close callback err branch)
        const sClose = new McpHttpServer(mkRegistry() as any, {});
        await sClose.start();
        h.httpServers.at(-1)!.closeErr = new Error('close failed');
        await expect(sClose.stop()).rejects.toThrow('close failed');
    });

    // ── request handler level ────────────────────────────────────────────
    async function withServer(cfg: Record<string, unknown> = {}, registryOver: Record<string, unknown> = {}) {
        const s = new McpHttpServer({ ...mkRegistry(), ...registryOver } as any, cfg as any);
        await s.start();
        const handler = h.serverHandler!;
        return { s, handler };
    }

    function makeRes() {
        const state = { status: 0, headers: {} as Record<string, string>, body: '', ended: false };
        const res: any = {
            writeHead(status: number, headers: Record<string, string> = {}) {
                state.status = status;
                Object.assign(state.headers, headers);
                return res;
            },
            end(body?: unknown) {
                state.ended = true;
                if (typeof body === 'string') state.body = body;
                else if (body !== undefined && body !== null) state.body = String(body);
                return res;
            },
            write(chunk: string) { state.body += chunk; return true; },
            get headersSent() { return state.status !== 0; },
            get state() { return state; },
        };
        return res;
    }

    function makeReq(init: { method?: string; url?: string; noUrl?: boolean; headers?: Record<string, string>; data?: string; streamError?: boolean } = {}) {
        const events: Record<string, Array<(x?: unknown) => void>> = {};
        const req: any = {
            method: init.method ?? 'POST',
            url: init.noUrl ? undefined : (init.url ?? '/mcp'),
            headers: { ...(init.headers ?? {}) },
            destroy: () => {},
            on: (ev: string, fn: (x?: unknown) => void) => { (events[ev] ??= []).push(fn); return req; },
            emit: (ev: string, x?: unknown) => { (events[ev] ?? []).forEach((fn) => fn(x)); },
            _data: init.data ?? '',
            _streamError: init.streamError ?? false,
        };
        return req;
    }

    function driveBody(req: any): void {
        if (req._streamError) {
            req.emit('error', new Error('stream failed'));
            return;
        }
        if (req._data.length > 0) req.emit('data', Buffer.from(req._data));
        req.emit('end');
    }

    function invoke(handler: (req: unknown, res: unknown) => void, req: any, res: any): Promise<void> {
        handler(req, res);
        driveBody(req);
        return new Promise((resolve) => {
            const tick = () => (res.state.ended ? resolve() : setTimeout(tick, 1));
            tick();
        });
    }

    it('OPTIONS preflight (cors * / disabled)', async () => {
        const { handler } = await withServer({ cors: '*' });
        const res = makeRes();
        await invoke(handler, makeReq({ method: 'OPTIONS' }), res);
        expect(res.state.status).toBe(204);
        expect(res.state.headers['access-control-allow-origin']).toBe('*');

        const { handler: h2 } = await withServer({ cors: false });
        const res2 = makeRes();
        await invoke(h2, makeReq({ method: 'OPTIONS' }), res2);
        expect(res2.state.status).toBe(204);
        expect(res2.state.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('method guard + path guard', async () => {
        const { handler } = await withServer({});
        const res = makeRes();
        await invoke(handler, makeReq({ method: 'GET' }), res);
        expect(res.state.status).toBe(405);

        const res2 = makeRes();
        await invoke(handler, makeReq({ method: 'POST', url: '/other' }), res2);
        expect(res2.state.status).toBe(404);

        // no url → `req.url?.split('?')[0] ?? '/'` fallback → 404
        const res3 = makeRes();
        await invoke(handler, makeReq({ method: 'POST', noUrl: true }), res3);
        expect(res3.state.status).toBe(404);
    });

    it('auth: bearer + api-key + none', async () => {
        const { handler } = await withServer({ auth: { type: 'bearer', token: 'secret-token' } });
        const res = makeRes();
        await invoke(handler, makeReq({ headers: { authorization: 'Bearer secret-token' }, data: '{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}' }), res);
        expect(res.state.status).toBe(200);
        expect(JSON.parse(res.state.body)).toMatchObject({ result: {} });

        const resBad = makeRes();
        await invoke(handler, makeReq({ data: '{"jsonrpc":"2.0","id":2,"method":"ping"}' }), resBad);
        expect(resBad.state.status).toBe(401);

        // wrong length token → length-mismatch timing-safe loop
        const resLen = makeRes();
        await invoke(handler, makeReq({ headers: { authorization: 'Bearer short' }, data: '{"jsonrpc":"2.0","id":3,"method":"ping"}' }), resLen);
        expect(resLen.state.status).toBe(401);

        // same length, wrong chars → equal-length XOR loop returns false
        const resChars = makeRes();
        await invoke(handler, makeReq({ headers: { authorization: 'Bearer secret-tokem' }, data: '{"jsonrpc":"2.0","id":4,"method":"ping"}' }), resChars);
        expect(resChars.state.status).toBe(401);

        const { handler: h2 } = await withServer({ cors: false, auth: { type: 'api-key', key: 'k1' } });
        const resOk = makeRes();
        await invoke(h2, makeReq({ headers: { 'x-api-key': 'k1' }, data: '{"jsonrpc":"2.0","id":3,"method":"ping"}' }), resOk);
        expect(resOk.state.status).toBe(200);
        const resBadKey = makeRes();
        await invoke(h2, makeReq({ data: '{"jsonrpc":"2.0","id":4,"method":"ping"}' }), resBadKey);
        expect(resBadKey.state.status).toBe(401);

        // api-key with a custom header name
        const { handler: h4 } = await withServer({ auth: { type: 'api-key', key: 'k2', header: 'x-custom-key' } });
        const resCustom = makeRes();
        await invoke(h4, makeReq({ headers: { 'x-custom-key': 'k2' }, data: '{"jsonrpc":"2.0","id":5,"method":"ping"}' }), resCustom);
        expect(resCustom.state.status).toBe(200);

        const { handler: h3 } = await withServer({ auth: { type: 'none' } });
        const res3 = makeRes();
        await invoke(h3, makeReq({ data: '{"jsonrpc":"2.0","id":5,"method":"ping"}' }), res3);
        expect(res3.state.status).toBe(200);

        // unknown auth type (cast past the union) → fall-through `return false`
        const { handler: h5 } = await withServer({ auth: { type: 'bogus' } as unknown as never });
        const res5 = makeRes();
        await invoke(h5, makeReq({ data: '{"jsonrpc":"2.0","id":6,"method":"ping"}' }), res5);
        expect(res5.state.status).toBe(401);
    });

    it('request body: too large (413) + post-abort data/error + stream error (400)', async () => {
        const { handler } = await withServer({ maxBodyBytes: 5 });
        const res = makeRes();
        const req = makeReq({ data: '{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}' });
        handler(req, res);
        req.emit('data', Buffer.from('{"json'));
        // aborted already: extra data + error + end must be ignored
        req.emit('data', Buffer.from('more'));
        req.emit('error', new Error('late'));
        req.emit('end');
        await new Promise((r) => setTimeout(r, 5));
        expect(res.state.status).toBe(413);

        const { handler: h2 } = await withServer({});
        const res2 = makeRes();
        await invoke(h2, makeReq({ streamError: true, data: 'x' }), res2);
        expect(res2.state.status).toBe(400);
    });

    it('parse errors: bad JSON, batch, invalid request', async () => {
        const { handler } = await withServer({});
        const badJson = makeRes();
        await invoke(handler, makeReq({ data: 'not json' }), badJson);
        expect(badJson.state.status).toBe(400);
        expect(JSON.parse(badJson.state.body)).toMatchObject({ error: { code: -32700 } });

        const batch = makeRes();
        await invoke(handler, makeReq({ data: '[{"jsonrpc":"2.0"}]' }), batch);
        expect(batch.state.status).toBe(400);
        expect(JSON.parse(batch.state.body)).toMatchObject({ error: { code: -32600 } });

        const invalid = makeRes();
        await invoke(handler, makeReq({ data: '{"id":7}' }), invalid);
        expect(invalid.state.status).toBe(400);
        expect(JSON.parse(invalid.state.body)).toMatchObject({ error: { code: -32600 } });

        // invalid with NO id present → `req2.id ?? null` fallback
        const invalidNoId = makeRes();
        await invoke(handler, makeReq({ data: '{"jsonrpc":1}' }), invalidNoId);
        expect(invalidNoId.state.status).toBe(400);
        expect(JSON.parse(invalidNoId.state.body)).toMatchObject({ id: null, error: { code: -32600 } });
    });

    it('notifications (no id) short-circuit 204', async () => {
        const { handler } = await withServer({});
        const res = makeRes();
        await invoke(handler, makeReq({ data: '{"jsonrpc":"2.0","method":"notifications/initialized"}' }), res);
        expect(res.state.status).toBe(204);
    });

    it('dispatch: initialize / ping / unknown method + logger debug', async () => {
        const { handler } = await withServer({});
        const res = makeRes();
        await invoke(handler, makeReq({ data: '{"jsonrpc":"2.0","id":1,"method":"initialize"}' }), res);
        expect(res.state.status).toBe(200);
        expect(JSON.parse(res.state.body).result.serverInfo.name).toBe('personaforge-mcp');

        const res2 = makeRes();
        await invoke(handler, makeReq({ data: '{"jsonrpc":"2.0","id":2,"method":"ping"}' }), res2);
        expect(JSON.parse(res2.state.body)).toMatchObject({ result: {} });

        const res3 = makeRes();
        await invoke(handler, makeReq({ data: '{"jsonrpc":"2.0","id":3,"method":"bogus"}' }), res3);
        expect(JSON.parse(res3.state.body)).toMatchObject({ error: { code: -32601 } });
    });

    it('tools/list maps zod schema fields and optionality', async () => {
        const schema = z.object({
            num: z.number().describe('a number'),
            boo: z.boolean(),
            arr: z.array(z.string()),
            obj: z.object({ k: z.string() }),
            str: z.string().optional(),
            def: z.string().default('d'),
            nullable: z.string().nullable(),
        });
        const t = mkTool({
            name: 'complex',
            parameters: schema as unknown as Tool['parameters'],
            description: 'c',
        });
        // all fields optional/default → no `required` key
        const optsOnly = mkTool({
            name: 'optional-only',
            parameters: z.object({ a: z.string().optional(), b: z.string().default('b') }) as unknown as Tool['parameters'],
        });
        const { handler } = await withServer({}, { getByName: () => t, list: () => [t, optsOnly] });
        const res = makeRes();
        await invoke(handler, makeReq({ data: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' }), res);
        const { tools } = JSON.parse(res.state.body).result;
        const desc = tools[0];
        // NOTE: repo uses zod v4 where `_def.typeName` is absent → every field maps
        // to the `string` fallback in toolToMcpDescriptor; the number/boolean/
        // array/object branches are unreachable under zod v4.
        expect(desc.inputSchema.properties.num).toMatchObject({ type: 'string', description: 'a number' });
        expect(desc.inputSchema.properties.boo.type).toBe('string');
        expect(desc.inputSchema.properties.arr.type).toBe('string');
        expect(desc.inputSchema.properties.obj.type).toBe('string');
        expect(desc.inputSchema.properties.str.type).toBe('string');
        expect(desc.inputSchema.required.sort()).toEqual(['arr', 'boo', 'nullable', 'num', 'obj']);
        expect(desc.inputSchema.required).not.toContain('str');
        expect(desc.inputSchema.required).not.toContain('def');
        // required array omitted when empty → `required.length > 0 ? ... : {}`
        expect(tools[1].inputSchema.required).toBeUndefined();
    });

    it('tools/list: no description; shape-throw catch; bare descriptor', async () => {
        const tNoDesc = mkTool({ name: 'nd' });
        const tUndefDesc = { ...mkTool({ name: 'undesc' }), description: undefined };
        const tThrows = mkTool({
            name: 'thrower',
            parameters: {
                get shape() { throw new Error('introspection boom'); },
            } as unknown as Tool['parameters'],
        });
        const tNoShape = mkTool({ name: 'noshape' });
        const { handler } = await withServer({}, { list: () => [tNoDesc, tUndefDesc, tThrows, tNoShape] });
        const res = makeRes();
        await invoke(handler, makeReq({ data: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' }), res);
        const { tools } = JSON.parse(res.state.body).result;
        expect(tools[0].description).toBe('desc-nd');
        expect(tools[0].inputSchema).toBeUndefined();
        expect(tools[1].description).toBeUndefined();
        expect(tools[1].inputSchema).toBeUndefined();
        expect(tools[2].inputSchema).toBeUndefined();
        expect(tools[3].inputSchema).toBeUndefined();
    });

    it('tools/call: param validation + tool lookup + validate fail + exec success', async () => {
        const stringTool = mkTool({ name: 'str', execute: async () => okResult('plain string') });
        const objTool = mkTool({ name: 'obj', execute: async () => okResult({ deep: true }) });
        const { handler } = await withServer({}, {
            getByName: (n: string) => (n === 'str' ? stringTool : n === 'obj' ? objTool : undefined),
        });

        // params not object
        const r1 = makeRes();
        await invoke(handler, makeReq({ data: '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":[1]}' }), r1);
        expect(JSON.parse(r1.state.body)).toMatchObject({ error: { code: -32602 } });

        // missing name
        const r2 = makeRes();
        await invoke(handler, makeReq({ data: '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{}}' }), r2);
        expect(JSON.parse(r2.state.body).error.message).toBe('params.name is required');

        // tool not found
        const r3 = makeRes();
        await invoke(handler, makeReq({ data: '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ghost"}}' }), r3);
        expect(JSON.parse(r3.state.body).error.message).toContain('Tool not found: ghost');

        // validate fails
        const invalid = mkTool({ name: 'invalid', validate: () => false });
        const { handler: h2 } = await withServer({}, { getByName: () => invalid });
        const r4 = makeRes();
        await invoke(h2, makeReq({ data: '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"invalid","arguments":{}}}' }), r4);
        expect(JSON.parse(r4.state.body).error.message).toContain('Invalid arguments');

        // string result → string content
        const r5 = makeRes();
        await invoke(handler, makeReq({ data: '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"str","arguments":{}}}' }), r5);
        const out = JSON.parse(r5.state.body).result;
        expect(out.isError).toBe(false);
        expect(out.content[0].text).toBe('plain string');

        // object result → JSON.stringify content; no arguments provided → {}
        const r6 = makeRes();
        await invoke(handler, makeReq({ data: '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"obj"}}' }), r6);
        expect(JSON.parse(r6.state.body).result.content[0].text).toBe('{"deep":true}');
    });

    it('tools/call: execute throws (internal error) + failure result + timeout', async () => {
        const thrower = mkTool({ name: 'thrower', execute: async () => { throw new Error('kaboom'); } });
        const failer = mkTool({ name: 'failer', execute: async () => failResult('nah') as any });
        const noMsg = mkTool({ name: 'nomsg', execute: async () => ({ success: false, error: { code: 'X' } as Record<string, string>, executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }) as any });
        const { handler } = await withServer({}, { getByName: (n: string) => (n === 'thrower' ? thrower : n === 'failer' ? failer : noMsg) });

        const r1 = makeRes();
        await invoke(handler, makeReq({ data: '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"thrower","arguments":{}}}' }), r1);
        expect(JSON.parse(r1.state.body)).toMatchObject({ error: { code: -32603, message: 'kaboom' } });

        const r2 = makeRes();
        await invoke(handler, makeReq({ data: '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"failer","arguments":{}}}' }), r2);
        expect(JSON.parse(r2.state.body)).toMatchObject({ error: { code: -32603, message: 'nah' } });

        // failure without error.message → default message
        const r5 = makeRes();
        await invoke(handler, makeReq({ data: '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"nomsg","arguments":{}}}' }), r5);
        expect(JSON.parse(r5.state.body)).toMatchObject({ error: { message: 'Tool execution failed' } });

        // non-Error throw → generic message
        const raw = mkTool({ name: 'raw', execute: async () => { throw 'string-err'; } });
        const { handler: h3 } = await withServer({}, { getByName: () => raw });
        const r3 = makeRes();
        await invoke(h3, makeReq({ data: '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"raw","arguments":{}}}' }), r3);
        expect(JSON.parse(r3.state.body).error.message).toBe('Internal error');

        // timeout
        const slow = mkTool({
            name: 'slow',
            execute: () => new Promise(() => { /* never resolves */ }) as Promise<any>,
        });
        const { handler: h4 } = await withServer({ toolTimeoutMs: 20 }, { getByName: () => slow });
        const r4 = makeRes();
        await invoke(h4, makeReq({ data: '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"slow","arguments":{}}}' }), r4);
        expect(JSON.parse(r4.state.body).error.message).toContain('timed out');
    });

    it('unhandled handler error → 500 via catch + logger.error', async () => {
        const boomRegistry = {
            ...mkRegistry(),
            list: () => { throw new Error('registry exploded'); },
        };
        const { handler } = await withServer({}, {});
        const s = new McpHttpServer(boomRegistry as any, {});
        await s.start();
        const logger = { error: vi.fn() };
        (s as any).opts.logger = logger;
        const handler2 = h.serverHandler!;
        const res = makeRes();
        const req = makeReq({ data: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
        handler2(req, res);
        driveBody(req);
        await new Promise((r) => setTimeout(r, 10));
        expect(res.state.status).toBe(500);
        expect(logger.error).toHaveBeenCalled();
    });

    it('handler catch with headers already sent → no 500 retry', async () => {
        const s = new McpHttpServer(mkRegistry() as any, {});
        await s.start();
        const logger = { error: vi.fn() };
        (s as any).opts.logger = logger;
        const handler2 = h.serverHandler!;
        let status = 0;
        const res = {
            writeHead: vi.fn((code: number) => { status = code; res.headersSent = code !== 0; return res; }),
            end: vi.fn(() => { throw new Error('end exploded'); }),
            headersSent: false,
        } as any;
        const req = makeReq({ data: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
        handler2(req, res);
        driveBody(req);
        await new Promise((r) => setTimeout(r, 5));
        expect(logger.error).toHaveBeenCalled();
        expect(status).toBe(200); // writeHead succeeded; no 500 override
    });

    it('cors array origin matching', async () => {
        const { handler } = await withServer({ cors: ['https://ok.example'] });
        const res = makeRes();
        await invoke(handler, makeReq({
            headers: { origin: 'https://ok.example' },
            data: '{"jsonrpc":"2.0","id":1,"method":"ping"}',
        }), res);
        expect(res.state.status).toBe(200);
        expect(res.state.headers['access-control-allow-origin']).toBe('https://ok.example');

        const res2 = makeRes();
        await invoke(handler, makeReq({
            headers: { origin: 'https://evil.example' },
            data: '{"jsonrpc":"2.0","id":2,"method":"ping"}',
        }), res2);
        expect(res2.state.status).toBe(200);
        expect(res2.state.headers['access-control-allow-origin']).toBeUndefined();

        // request with NO origin header → `req.headers['origin'] ?? ''`
        const res3 = makeRes();
        await invoke(handler, makeReq({ data: '{"jsonrpc":"2.0","id":3,"method":"ping"}' }), res3);
        expect(res3.state.status).toBe(200);
        expect(res3.state.headers['access-control-allow-origin']).toBeUndefined();
    });
});

// ══════════════════════════════════════════════════════════════════════════
// stdio-server.ts
// ══════════════════════════════════════════════════════════════════════════
describe('handleMcpStdioLine', () => {
    const info = { name: 'svr', version: '1.2.3' };

    it('protocol error + initialize + notifications null', async () => {
        const r0 = await handleMcpStdioLine('{"jsonrpc":"1.0","id":9}', [], info);
        expect(JSON.parse(r0!)).toMatchObject({ error: { code: -32600 } });
        // protocol error WITHOUT id → `msg.id ?? null`
        const r0b = await handleMcpStdioLine('{"jsonrpc":"1.0"}', [], info);
        expect(JSON.parse(r0b!)).toMatchObject({ id: null, error: { code: -32600 } });
        const rInit = await handleMcpStdioLine('{"jsonrpc":"2.0","id":1,"method":"initialize"}', [], info);
        expect(JSON.parse(rInit!).result.serverInfo.name).toBe('svr');
        expect(await handleMcpStdioLine('{"jsonrpc":"2.0","method":"notifications/initialized"}', [], info)).toBeNull();
        expect(await handleMcpStdioLine('{"jsonrpc":"2.0","id":2,"method":"initialized"}', [], info)).toBeNull();
    });

    it('tools/list with a real tool', async () => {
        const tool = mkTool({
            name: 'add',
            parameters: z.object({ a: z.number() }) as unknown as Tool['parameters'],
        });
        const r = await handleMcpStdioLine('{"jsonrpc":"2.0","id":3,"method":"tools/list"}', [tool], info);
        const parsed = JSON.parse(r!);
        expect(parsed.result.tools[0].name).toBe('add');
        expect(parsed.result.tools[0].inputSchema).toBeTruthy();
    });

    it('tools/call success/error + missing/unknown tool + non-object args', async () => {
        const ok = mkTool({ name: 'ok', execute: async () => okResult({ sum: 5 }) as any });
        const fn = mkTool({ name: 'fn', execute: async () => failResult('bad input') as any });
        const noMsg = mkTool({ name: 'nomsg', execute: async () => ({ success: false, error: { code: 'X' } as Record<string, string>, executionTimeMs: 1, metadata: { startTime: new Date(), endTime: new Date(), retries: 0 } }) as any });

        const r1 = await handleMcpStdioLine('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{}}', [ok], info);
        expect(JSON.parse(r1!).error.code).toBe(-32602);

        const r2 = await handleMcpStdioLine('{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ghost"}}', [ok], info);
        expect(JSON.parse(r2!).error.message).toContain('Unknown tool');

        const r3 = await handleMcpStdioLine('{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"ok"}}', [ok], info);
        expect(JSON.parse(r3!).result.content[0].text).toBe('{"sum":5}');

        // args = string (non-object) → defaults to {}
        const r3b = await handleMcpStdioLine('{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"ok","arguments":"wat"}}', [ok], info);
        expect(JSON.parse(r3b!).result.content[0].text).toBe('{"sum":5}');

        const r4 = await handleMcpStdioLine('{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"fn","arguments":{}}}', [fn], info);
        const parsed = JSON.parse(r4!);
        expect(parsed.result.isError).toBe(true);
        expect(parsed.result.content[0].text).toBe('bad input');

        // failure whose error has no message → default 'Tool failed'
        const r6 = await handleMcpStdioLine('{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"nomsg","arguments":{}}}', [noMsg], info);
        expect(JSON.parse(r6!).result.content[0].text).toBe('Tool failed');

        // execute returns null-ish data → {}
        const nul = mkTool({ name: 'nul', execute: async () => okResult(null) as any });
        const r5 = await handleMcpStdioLine('{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"nul"}}', [nul], info);
        expect(JSON.parse(r5!).result.content[0].text).toBe('{}');

        // gateway context reflects per-tool permissions + defaults when permissions absent
        const permTool: Tool = {
            ...mkTool({ name: 'pt' }),
            permissions: { allowNetwork: true, allowFileSystem: true, maxExecutionTimeMs: 7 },
        };
        const bareTool: Tool = { ...mkTool({ name: 'bare' }), permissions: undefined as unknown as Tool['permissions'] };
        let seenCtx: ToolContext | undefined;
        const spyTool = mkTool({ name: 'spy', execute: async (_p, c: ToolContext) => { seenCtx = c; return okResult('x') as any; } });
        await handleMcpStdioLine('{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"spy"}}', [spyTool, permTool, bareTool], info);
        expect(seenCtx!.agentId).toBe('mcp-stdio');
        expect(seenCtx!.permissions.maxExecutionTimeMs).toBe(30000);
        await handleMcpStdioLine('{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"bare"}}', [bareTool], info);
        expect(seenCtx).toBeTruthy();
    });

    it('ping + unknown/missing method', async () => {
        const rPing = await handleMcpStdioLine('{"jsonrpc":"2.0","id":1,"method":"ping"}', [], info);
        expect(JSON.parse(rPing!)).toMatchObject({ result: {} });
        const rUnk = await handleMcpStdioLine('{"jsonrpc":"2.0","id":2,"method":"frobnicate"}', [], info);
        expect(JSON.parse(rUnk!).error).toMatchObject({ code: -32601 });
        const rNone = await handleMcpStdioLine('{"jsonrpc":"2.0","id":3}', [], info);
        expect(JSON.parse(rNone!).error.message).toBe('Missing method');
    });
});

describe('runMcpStdioToolServer', () => {
    it('processes lines, skips blanks, writes -32603 on JSON parse failure', async () => {
        const writes: string[] = [];
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
            writes.push(String(c));
            return true;
        });
        try {
            const tool = mkTool({ name: 'ok', execute: async () => okResult('hi') as any });
            const stringThrower: Tool = {
                ...mkTool({ name: 'strthrow' }),
                execute: async () => { throw 'plain-string-error'; },
            };
            h.rlObject = {
                [Symbol.asyncIterator]: async function* () {
                    yield '';
                    yield '  ';
                    yield '{"jsonrpc":"2.0","id":1,"method":"ping"}';
                    yield 'not json at all';
                    yield '{"jsonrpc":"2.0","method":"notifications/initialized"}';
                    yield '{"jsonrpc":"2.0","method":"ping"}';
                    yield '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ok"}}';
                    yield '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"strthrow"}}';
                },
            };
            await runMcpStdioToolServer([tool, stringThrower], { name: 'svr' });
            const joined = writes.join('\n');
            expect(joined).toContain('"result":{}');
            expect(joined).toContain('"code":-32603');
            expect(joined).toContain('"content":[{"type":"text","text":"\\"hi\\""}],"isError":false');
            expect(joined).toContain('plain-string-error');
            expect(joined).toContain('"id":null');
            expect(h.readlineOpts).toBeTruthy();
        } finally {
            stdoutSpy.mockRestore();
        }
    });

    it('default server info + tools/call invoked via run loop', async () => {
        const writes: string[] = [];
        const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c: unknown) => {
            writes.push(String(c));
            return true;
        });
        try {
            h.rlObject = {
                [Symbol.asyncIterator]: async function* () {
                    yield '{"jsonrpc":"2.0","id":1,"method":"initialize"}';
                },
            };
            await runMcpStdioToolServer([]);
            expect(writes.join('\n')).toContain('"version":"0.6.0"');
        } finally {
            stdoutSpy.mockRestore();
        }
    });
});

// ══════════════════════════════════════════════════════════════════════════
// transport-sse.ts (StreamableMcpClient)
// ══════════════════════════════════════════════════════════════════════════
describe('StreamableMcpClient', () => {
    it('constructor + buildHeaders variants + session id capture', async () => {
        const headersSeen: Array<Record<string, string>> = [];
        globalThis.fetch = vi.fn(async (_url, init) => {
            headersSeen.push((init as RequestInit).headers as Record<string, string>);
            return json({ result: {} }, 200, { 'mcp-session-id': 'sess-1' });
        }) as typeof fetch;

        const client = new StreamableMcpClient({ url: 'https://h/mcp/', headers: { 'x-h': 'v' }, timeoutMs: 999, preferStreaming: true });
        await (client as any).rpc('ping');
        expect(headersSeen[0]!['accept']).toContain('text/event-stream');
        expect(headersSeen[0]!['mcp-session-id']).toBeUndefined();
        // second call includes session id
        await (client as any).rpc('ping');
        expect(headersSeen[1]!['mcp-session-id']).toBe('sess-1');

        const clientNoStream = new StreamableMcpClient({ url: 'https://h/mcp', preferStreaming: false });
        await (clientNoStream as any).rpc('ping');
        expect(headersSeen[2]!['accept']).toBeUndefined();
        expect((clientNoStream as any).timeoutMs).toBe(60000);
    });

    it('SSE stream: notification + response, blank data, malformed JSON', async () => {
        const handler = vi.fn(async () => {});
        const client = new StreamableMcpClient({ url: 'https://h/mcp' });
        client.onNotification(handler);

        const frames =
            'event: notification\n' +
            'data: {"jsonrpc":"2.0","method":"notifications/updated","params":{"u":1}}\n\n' +
            'data: \n\n' +
            'data: {bad json\n\n' +
            'data: {"jsonrpc":"2.0","id":1,"result":{"value":42}}\n\n';
        globalThis.fetch = vi.fn(async () => new Response(sseStream(frames), {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
        })) as typeof fetch;

        const result = await (client as any).rpc('tools/whatever');
        expect(result).toEqual({ value: 42 });
        await vi.waitFor(() => expect(handler).toHaveBeenCalled());
        expect(handler).toHaveBeenCalledWith({ method: 'notifications/updated', params: { u: 1 } });
    });

    it('SSE stream: mismatched id → stream-end error; id-match error; non-ok', async () => {
        const clientA = new StreamableMcpClient({ url: 'https://h/mcp' });
        globalThis.fetch = vi.fn(async () => new Response(sseStream('data: {"jsonrpc":"2.0","id":999,"result":{}}\n\n'), {
            status: 200, headers: { 'content-type': 'text/event-stream' },
        })) as typeof fetch;
        await expect((clientA as any).rpc('x')).rejects.toThrow('SSE stream ended without matching response');

        const clientB = new StreamableMcpClient({ url: 'https://h/mcp' });
        globalThis.fetch = vi.fn(async () => new Response(sseStream('data: {"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"oops"}}\n\n'), {
            status: 200, headers: { 'content-type': 'text/event-stream' },
        })) as typeof fetch;
        await expect((clientB as any).rpc('x')).rejects.toThrow('MCP -32000: oops');

        const clientC = new StreamableMcpClient({ url: 'https://h/mcp' });
        globalThis.fetch = vi.fn(async () => new Response('nope', { status: 503 })) as typeof fetch;
        await expect((clientC as any).rpc('x')).rejects.toThrow('MCP HTTP 503: nope');
    });

    it('plain JSON responses: success + rpc error + fetch reject + abort timeout + no-content-type', async () => {
        const client = new StreamableMcpClient({ url: 'https://h/mcp', timeoutMs: 100 });

        globalThis.fetch = vi.fn(async () => json({ result: 'ok' })) as typeof fetch;
        expect(await (client as any).rpc('m1')).toBe('ok');

        globalThis.fetch = vi.fn(async () => json({ error: { code: -1, message: 'bad' } })) as typeof fetch;
        await expect((client as any).rpc('m2')).rejects.toThrow('MCP -1: bad');

        globalThis.fetch = vi.fn(async () => { throw new Error('conn refused'); }) as typeof fetch;
        await expect((client as any).rpc('m3')).rejects.toThrow('conn refused');

        // response WITHOUT content-type header → `?? ''` fallback, JSON path
        globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ result: 'noct' }), { status: 200 })) as typeof fetch;
        expect(await (client as any).rpc('m5')).toBe('noct');

        // response WITHOUT content-type header → `res.headers.get('content-type') ?? ''`
        globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch;
        await expect((client as any).rpc('m6')).rejects.toThrow(SyntaxError);

        // abort path: fetch respects the abort signal
        globalThis.fetch = vi.fn((_url, init) => new Promise((_res, reject) => {
            const sig = (init as RequestInit).signal as AbortSignal | undefined;
            sig?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        })) as typeof fetch;
        const abortClient = new StreamableMcpClient({ url: 'https://h/mcp', timeoutMs: 15 });
        await expect((abortClient as any).rpc('m4')).rejects.toThrow('Aborted');
    });

    it('high-level RPC methods (resources/prompts/completions/calls)', async () => {
        const client = new StreamableMcpClient({ url: 'https://h/mcp' });
        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body)) as { method: string; params?: any };
            const m = body.method;
            if (m === 'resources/list') return json({ result: { resources: [{ uri: 'u', name: 'n' }], nextCursor: 'c2' } });
            if (m === 'resources/read') return json({ result: { contents: [{ uri: 'u', text: 't' }] } });
            if (m === 'resources/subscribe') return json({ result: {} });
            if (m === 'resources/unsubscribe') return json({ result: {} });
            if (m === 'resources/templates/list') return json({ result: { resourceTemplates: [{ uriTemplate: '{x}' }] } });
            if (m === 'prompts/list') return json({ result: { prompts: [{ name: 'p' }], nextCursor: 'c' } });
            if (m === 'prompts/get') return json({ result: { messages: [] } });
            if (m === 'completion/complete') return json({ result: { completion: { values: ['a'] } } });
            if (m === 'tools/call') return json({ result: { content: [{ type: 'text', text: 'z' }], isError: false } });
            if (m === 'tools/list') return json({
                result: {
                    tools: [
                        { name: 'x y' },
                        { name: 'with-desc', description: 'd', inputSchema: { type: 'object' } },
                    ],
                },
            });
            return json({ result: {} });
        }) as typeof fetch;

        const res = await client.listResources();
        expect(res.nextCursor).toBe('c2');
        const resNoCursor = await client.listResources('c1');
        expect(resNoCursor.resources).toHaveLength(1);
        expect((await client.listResources()).nextCursor).toBe('c2');
        const resList = await client.listResources();
        expect(resList.resources[0]?.name).toBe('n');

        expect(await client.readResource('u')).toMatchObject({ contents: [{ uri: 'u', text: 't' }] });
        await client.subscribeResource('u');
        await client.unsubscribeResource('u');
        expect((await client.listResourceTemplates()).resourceTemplates[0]?.uriTemplate).toBe('{x}');
        const prompts = await client.listPrompts();
        expect(prompts.nextCursor).toBe('c');
        const promptsNoCursor = await client.listPrompts('x');
        expect(promptsNoCursor.prompts[0]?.name).toBe('p');
        expect(await client.getPrompt('p')).toMatchObject({ messages: [] });
        expect(await client.getPrompt('p', { a: '1' })).toMatchObject({ messages: [] });
        expect(await client.complete({ type: 'ref/prompt' as any, name: 'p' }, { name: 'a', value: 'v' })).toMatchObject({ completion: { values: ['a'] } });
        expect(await client.callTool('t', {})).toMatchObject({ content: [{ type: 'text', text: 'z' }] });

        const tools = await client.listTools();
        expect(tools[0]!.name).toBe('x y');
        expect(tools[0]!.description).toBeUndefined();
        expect(tools[1]!.description).toBe('d');
        expect(tools[1]!.inputSchema).toBeTruthy();

        // listTools with no tools key → `?? []`
        const emptyClient = new StreamableMcpClient({ url: 'https://h/mcp' });
        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body)) as { method: string };
            if (body.method === 'tools/list') return json({ result: {} });
            return json({ result: {} });
        }) as typeof fetch;
        expect(await emptyClient.listTools()).toEqual([]);
    });

    it('initialize with/without clientInfo + bridge tool + connectMcpServer', async () => {
        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body)) as { method: string; params?: any };
            if (body.method === 'initialize') {
                return json({ result: { protocolVersion: 'x', capabilities: {}, serverInfo: { name: 's', version: 'v' } } });
            }
            if (body.method === 'tools/list') {
                return json({ result: { tools: [{ name: 'a/b', description: 'dd' }, { name: 'no-desc' }] } });
            }
            if (body.method === 'tools/call') {
                return json({
                    result: {
                        content: [
                            { type: 'text', text: 'tt' },
                            { type: 'text', text: '' },
                            { type: 'image', data: 'i' },
                        ],
                    },
                });
            }
            return json({ result: {} });
        }) as typeof fetch;

        const client = new StreamableMcpClient({ url: 'https://h/mcp' });
        const initRes = await client.initialize();
        expect(initRes.serverInfo.name).toBe('s');
        const initRes2 = await client.initialize({ name: 'me', version: '0.1' });
        expect(initRes2.protocolVersion).toBe('x');

        const tools = await client.getTools();
        expect(tools).toHaveLength(2);
        expect(tools[0]!.name).toBe('a_b');
        expect(tools[1]!.name).toBe('no-desc');
        const out = await (tools[0] as any).performExecute({});
        expect(out).toContain('tt');
        expect(out).toContain('{"type":"text","text":""}');
        expect(out).toContain('{"type":"image","data":"i"}');

        // callTool returns no content → `out.content ?? []`
        globalThis.fetch = vi.fn(async (_url, init) => {
            const body = JSON.parse(String((init as RequestInit).body)) as { method: string };
            if (body.method === 'initialize') return json({ result: { serverInfo: { name: 's', version: 'v' }, protocolVersion: 'x', capabilities: {} } });
            if (body.method === 'tools/list') return json({ result: { tools: [{ name: 'empty' }] } });
            return json({ result: {} });
        }) as typeof fetch;
        const { client: c2, tools: t2 } = await connectMcpServer('https://h/mcp', { preferStreaming: false });
        expect(t2).toHaveLength(1);
        expect(await (t2[0] as any).performExecute({})).toBe('');
        await c2.disconnect();
    });

    it('disconnect branches (no session / best-effort errors)', async () => {
        const client = new StreamableMcpClient({ url: 'https://h/mcp' });
        await client.disconnect();

        globalThis.fetch = vi.fn(async (_url, init) => {
            if ((init as RequestInit).method === 'DELETE') throw new Error('gone');
            return json({ result: {} });
        }) as typeof fetch;
        await (client as any).rpc('ping');
        expect((client as any).sessionId).toBeUndefined();
        ((client as any)).sessionId = 'sess';
        await client.disconnect();
        expect((client as any).sessionId).toBeUndefined();
    });

    it('onNotification unsubscribe + emitNotification ignores malformed/handler errors', async () => {
        const client = new StreamableMcpClient({ url: 'https://h/mcp' });
        const throwing = vi.fn(async () => { throw new Error('handler boom'); });
        const okHandler = vi.fn(async () => {});
        const unsubThrow = client.onNotification(throwing);
        client.onNotification(okHandler);

        // throwing handler short-circuits the loop; error swallowed
        await (client as any).emitNotification('{"method":"n","params":1}');
        expect(throwing).toHaveBeenCalledTimes(1);
        expect(okHandler).toHaveBeenCalledTimes(0);

        // malformed + no-method are ignored
        await (client as any).emitNotification('not-json{{');
        await (client as any).emitNotification('{"params":1}');

        unsubThrow();
        await (client as any).emitNotification('{"method":"m2"}');
        expect(okHandler).toHaveBeenCalledTimes(1);
        expect(okHandler).toHaveBeenCalledWith({ method: 'm2', params: undefined });
    });

    it('openNotificationChannel: failure, end, abort-break, non-ok', async () => {
        const client = new StreamableMcpClient({ url: 'https://h/mcp' });
        const handler = vi.fn(async () => {});
        client.onNotification(handler);

        let fetchCalls = 0;
        let release: (() => void) | undefined;
        const enc = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
            start(c) {
                c.enqueue(enc.encode('data: {"method":"evtA"}\n\n'));
                release = () => c.enqueue(enc.encode('data: {"method":"evtB"}\n\n'));
            },
        });
        const fetchMock = vi.fn(async (_url, init) => {
            fetchCalls++;
            if (fetchCalls === 1) return new Response('x', { status: 500 });
            if (fetchCalls === 2) throw new Error('closed');
            return new Response(stream, {
                status: 200,
                headers: { 'content-type': 'text/event-stream' },
            });
        }) as typeof fetch;
        globalThis.fetch = fetchMock;

        // non-ok response → run returns early
        client.openNotificationChannel();
        await vi.waitFor(() => expect(fetchCalls).toBeGreaterThanOrEqual(1));

        // fetch throws → caught
        client.openNotificationChannel();
        await vi.waitFor(() => expect(fetchCalls).toBeGreaterThanOrEqual(2));

        // streamed notification + abort-break
        const cleanup = client.openNotificationChannel();
        await vi.waitFor(() => expect(handler).toHaveBeenCalledWith({ method: 'evtA', params: undefined }));
        expect(fetchCalls).toBe(3);
        cleanup();
        release?.();
        await new Promise((r) => setTimeout(r, 10));
        expect(handler).not.toHaveBeenCalledWith({ method: 'evtB', params: undefined });
    });
});
