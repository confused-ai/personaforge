/**
 * Hermetic coverage: Spotify, Mem0, Zep, MCP resources, GitHub, GitLab, Docker, AWS Lambda.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';

import {
    SpotifySearchTool,
    SpotifyGetTrackTool,
    SpotifyGetPlaylistTool,
    SpotifyGetCurrentPlaybackTool,
    SpotifyPlayTool,
    SpotifyPauseTool,
    SpotifySkipTool,
    SpotifyGetUserPlaylistsTool,
    SpotifyAddToQueueTool,
    SpotifyToolkit,
} from '../src/tools/social/spotify.js';
import {
    Mem0AddMemoryTool,
    Mem0SearchMemoryTool,
    Mem0GetMemoriesTool,
    Mem0GetMemoryTool,
    Mem0UpdateMemoryTool,
    Mem0DeleteMemoryTool,
    Mem0DeleteAllMemoriesTool,
    Mem0GetMemoryHistoryTool,
    Mem0Toolkit,
} from '../src/tools/memory/mem0.js';
import {
    ZepAddMemoryTool,
    ZepGetMemoryTool,
    ZepSearchMemoryTool,
    ZepDeleteMemoryTool,
    ZepCreateSessionTool,
    ZepGetSessionTool,
    ZepGetUserTool,
    ZepSearchUserFactsTool,
    ZepToolkit,
} from '../src/tools/memory/zep.js';
import {
    McpResourceRegistry,
    McpPromptRegistry,
    McpSamplingClient,
    McpCapabilityHandler,
    McpSseEmitter,
    buildServerCapabilities,
} from '../src/tools/mcp/resources.js';
import {
    GitHubSearchRepositoriesTool,
    GitHubGetRepositoryTool,
    GitHubListIssuesTool,
    GitHubCreateIssueTool,
    GitHubListPullRequestsTool,
    GitHubToolkit,
} from '../src/tools/devtools/github.js';
import {
    GitLabSearchProjectsTool,
    GitLabGetProjectTool,
    GitLabListIssuesTool,
    GitLabCreateIssueTool,
    GitLabListMRsTool,
    GitLabCreateMRTool,
    GitLabToolkit,
} from '../src/tools/devtools/gitlab.js';
import {
    DockerListContainersTool,
    DockerGetContainerTool,
    DockerStartContainerTool,
    DockerStopContainerTool,
    DockerCreateContainerTool,
    DockerListImagesTool,
    DockerContainerLogsTool,
    DockerToolkit,
} from '../src/tools/devtools/docker.js';
import {
    AWSLambdaInvokeTool,
    AWSLambdaListFunctionsTool,
    AWSLambdaGetFunctionTool,
    AWSLambdaToolkit,
} from '../src/tools/devtools/aws-lambda.js';
import type { ToolContext } from '../src/tools/core/types.js';

function ctx(over: Partial<ToolContext> = {}): ToolContext {
    return {
        toolId: 'tool_test',
        agentId: 'agent_test',
        sessionId: 'sess_test',
        permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 30_000 },
        ...over,
    };
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
    });
}

const track = {
    id: 'tr1', name: 'Song', artists: [{ name: 'Artist' }], album: { name: 'Album' },
    duration_ms: 1000, uri: 'spotify:track:tr1', explicit: false, preview_url: 'p', popularity: 50,
};

describe('Spotify tools', () => {
    const originalFetch = globalThis.fetch;
    const cfg = { accessToken: 'stok' };
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('requires token + toolkit', async () => {
        const prev = process.env['SPOTIFY_ACCESS_TOKEN'];
        delete process.env['SPOTIFY_ACCESS_TOKEN'];
        expect((await new SpotifySearchTool({}).execute({ query: 'x' }, ctx())).success).toBe(false);
        if (prev !== undefined) process.env['SPOTIFY_ACCESS_TOKEN'] = prev;
        expect(new SpotifyToolkit(cfg).tools).toHaveLength(9);
    });

    it.skip('search/track/playlist/playback/controls', async () => {
        globalThis.fetch = vi.fn(async (url, init) => {
            const u = String(url);
            const method = (init?.method ?? 'GET').toUpperCase();
            if (u.includes('/search')) return json({ tracks: { items: [track], total: 1 } });
            if (u.includes('/tracks/')) return json(track);
            if (u.includes('/playlists/') && !u.includes('/me/playlists')) {
                return json({
                    id: 'pl1', name: 'PL', description: 'd', owner: { display_name: 'me' },
                    tracks: { items: [{ track }], total: 1 },
                });
            }
            // Exact /me/player only — '/me/player'.includes('/play') is true, so avoid that check
            if (method === 'GET' && /\/me\/player(\?|$)/.test(u)) {
                return json({
                    is_playing: true, item: track, device: { name: 'Phone' }, progress_ms: 10, shuffle_state: false,
                });
            }
            if (u.includes('/me/playlists')) {
                return json({ items: [{ id: 'pl1', name: 'PL', tracks: { total: 1 }, owner: { display_name: 'me' }, public: true }] });
            }
            if (method === 'PUT' || method === 'POST') return new Response(null, { status: 204 });
            return json({});
        }) as typeof fetch;

        expect((await new SpotifySearchTool(cfg).execute({ query: 'Song', market: 'US' }, ctx())).data?.totalTracks).toBe(1);
        expect((await new SpotifyGetTrackTool(cfg).execute({ trackId: 'tr1' }, ctx())).data?.id).toBe('tr1');
        expect((await new SpotifyGetPlaylistTool(cfg).execute({ playlistId: 'pl1' }, ctx())).data?.tracks).toHaveLength(1);
        const pb = await new SpotifyGetCurrentPlaybackTool(cfg).execute({}, ctx());
        expect(pb.data?.isPlaying).toBe(true);

        expect((await new SpotifyPlayTool(cfg).execute({
            uris: ['spotify:track:tr1'], contextUri: 'spotify:album:a', deviceId: 'd1', positionMs: 0,
        }, ctx())).data?.success).toBe(true);
        expect((await new SpotifyPauseTool(cfg).execute({ deviceId: 'd1' }, ctx())).data?.success).toBe(true);
        expect((await new SpotifySkipTool(cfg).execute({ direction: 'next', deviceId: 'd1' }, ctx())).data?.success).toBe(true);
        expect((await new SpotifySkipTool(cfg).execute({ direction: 'previous' }, ctx())).data?.success).toBe(true);
        expect((await new SpotifyGetUserPlaylistsTool(cfg).execute({ limit: 5 }, ctx())).data?.playlists[0]?.id).toBe('pl1');
        expect((await new SpotifyAddToQueueTool(cfg).execute({ uri: 'spotify:track:tr1', deviceId: 'd1' }, ctx())).data?.success).toBe(true);

        globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch;
        expect((await new SpotifyGetCurrentPlaybackTool(cfg).execute({}, ctx())).data).toBeNull();

        globalThis.fetch = vi.fn(async () => new Response('err', { status: 401 })) as typeof fetch;
        expect((await new SpotifySearchTool(cfg).execute({ query: 'x' }, ctx())).success).toBe(false);
    });
});

describe('Mem0 tools', () => {
    const originalFetch = globalThis.fetch;
    const cfg = { apiKey: 'mk', baseUrl: 'https://mem0.test/v1' };
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('requires key + toolkit with unique ids', async () => {
        const prev = process.env['MEM0_API_KEY'];
        delete process.env['MEM0_API_KEY'];
        expect((await new Mem0AddMemoryTool({}).execute({ messages: [{ role: 'user', content: 'hi' }] }, ctx())).success).toBe(false);
        if (prev !== undefined) process.env['MEM0_API_KEY'] = prev;
        const tools = new Mem0Toolkit(cfg).getTools();
        expect(tools).toHaveLength(8);
        const ids = tools.map((t) => t.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('CRUD memory operations', async () => {
        globalThis.fetch = vi.fn(async (url, init) => {
            const u = String(url);
            const method = (init?.method ?? 'GET').toUpperCase();
            if (u.includes('/search/')) return json({ results: [{ id: 'm1', memory: 'hi' }] });
            if (u.includes('/history/')) return json([{ id: 'h1' }]);
            if (method === 'DELETE') return json({});
            if (method === 'PUT') return json({ id: 'm1', data: 'new' });
            if (method === 'POST') return json({ id: 'm1' });
            if (u.match(/\/memories\/[^/?]+\/?$/) && method === 'GET') return json({ id: 'm1', memory: 'hi' });
            return json([{ id: 'm1' }]);
        }) as typeof fetch;

        expect((await new Mem0AddMemoryTool(cfg).execute({
            messages: [{ role: 'user', content: 'hi' }], agent_id: 'a', user_id: 'u', run_id: 'r', metadata: { k: 1 },
        }, ctx())).success).toBe(true);
        expect((await new Mem0SearchMemoryTool(cfg).execute({
            query: 'hi', user_id: 'u', agent_id: 'a', run_id: 'r', limit: 5, filters: { k: 1 },
        }, ctx())).data).toContain('m1');
        expect((await new Mem0GetMemoriesTool(cfg).execute({ user_id: 'u', agent_id: 'a', run_id: 'r', limit: 5, page: 1 }, ctx())).success).toBe(true);
        expect((await new Mem0GetMemoryTool(cfg).execute({ memory_id: 'm1' }, ctx())).success).toBe(true);
        expect((await new Mem0UpdateMemoryTool(cfg).execute({ memory_id: 'm1', data: 'new' }, ctx())).success).toBe(true);
        expect((await new Mem0DeleteMemoryTool(cfg).execute({ memory_id: 'm1' }, ctx())).data).toMatch(/deleted/);
        expect((await new Mem0DeleteAllMemoriesTool(cfg).execute({ user_id: 'u', agent_id: 'a', run_id: 'r' }, ctx())).data).toMatch(/deleted/);
        expect((await new Mem0GetMemoryHistoryTool(cfg).execute({ memory_id: 'm1' }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 500 })) as typeof fetch;
        expect((await new Mem0SearchMemoryTool(cfg).execute({ query: 'x', limit: 1 }, ctx())).success).toBe(false);
    });
});

describe('Zep tools', () => {
    const originalFetch = globalThis.fetch;
    const cfg = { apiKey: 'zk', baseUrl: 'https://zep.test' };
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('requires key + toolkit unique ids', async () => {
        const prev = process.env['ZEP_API_KEY'];
        delete process.env['ZEP_API_KEY'];
        expect((await new ZepGetMemoryTool({}).execute({ session_id: 's' }, ctx())).success).toBe(false);
        if (prev !== undefined) process.env['ZEP_API_KEY'] = prev;
        const tools = new ZepToolkit(cfg).getTools();
        expect(tools).toHaveLength(8);
        expect(new Set(tools.map((t) => t.id)).size).toBe(8);
    });

    it('session/memory/user operations', async () => {
        globalThis.fetch = vi.fn(async (url, init) => {
            const u = String(url);
            const method = (init?.method ?? 'GET').toUpperCase();
            if (u.includes('/search') || u.includes('/facts/search')) return json({ results: [] });
            if (method === 'DELETE') return new Response(null, { status: 200 });
            if (method === 'POST') return json({ ok: true });
            return json({ session_id: 's1' });
        }) as typeof fetch;

        expect((await new ZepAddMemoryTool(cfg).execute({
            session_id: 's1',
            messages: [{ role: 'user', role_type: 'user', content: 'hi', metadata: {} }],
        }, ctx())).success).toBe(true);
        expect((await new ZepGetMemoryTool(cfg).execute({
            session_id: 's1', lastn: 5, memory_type: 'message_window',
        }, ctx())).success).toBe(true);
        expect((await new ZepSearchMemoryTool(cfg).execute({
            session_id: 's1', text: 'hi', limit: 5, search_type: 'mmr', search_scope: 'messages',
        }, ctx())).success).toBe(true);
        expect((await new ZepDeleteMemoryTool(cfg).execute({ session_id: 's1' }, ctx())).data).toMatch(/deleted/);
        expect((await new ZepCreateSessionTool(cfg).execute({
            session_id: 's1', user_id: 'u1', metadata: { a: 1 },
        }, ctx())).success).toBe(true);
        expect((await new ZepGetSessionTool(cfg).execute({ session_id: 's1' }, ctx())).success).toBe(true);
        expect((await new ZepGetUserTool(cfg).execute({ user_id: 'u1' }, ctx())).success).toBe(true);
        expect((await new ZepSearchUserFactsTool(cfg).execute({ user_id: 'u1', text: 'x', limit: 3 }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async () => new Response('bad', { status: 400 })) as typeof fetch;
        expect((await new ZepGetSessionTool(cfg).execute({ session_id: 's1' }, ctx())).success).toBe(false);
    });
});

describe('MCP resources module', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('resource registry list/read/templates/change handlers', async () => {
        const reg = new McpResourceRegistry();
        let changed = 0;
        const unsub = reg.onListChanged(() => { changed++; });
        reg.add({
            uri: 'file:///a.txt', name: 'A', description: 'desc', mimeType: 'text/plain',
            read: () => ({ type: 'text', text: 'hello' }),
        });
        reg.add({
            uri: 'blob://x', name: 'B', mimeType: 'application/octet-stream',
            read: async () => ({ type: 'blob', blob: 'YQ==' }),
        });
        expect(reg.list()).toHaveLength(2);
        expect(changed).toBe(2);

        expect(await reg.read('file:///a.txt')).toMatchObject({ text: 'hello' });
        expect(await reg.read('blob://x')).toMatchObject({ blob: 'YQ==' });

        reg.addTemplate({
            uriTemplate: 'db://products/{id}', name: 'Product', description: 'p', mimeType: 'application/json',
            read: (vars) => ({ type: 'text', text: JSON.stringify(vars) }),
        });
        expect(reg.listTemplates()[0]?.uriTemplate).toContain('{id}');
        expect((await reg.read('db://products/42')).text).toContain('42');

        await expect(reg.read('missing://x')).rejects.toThrow(/not found/);
        reg.remove('file:///a.txt');
        unsub();
        expect(reg.list()).toHaveLength(1);
    });

    it('prompt registry + capability handler + sampling + SSE + caps', async () => {
        const prompts = new McpPromptRegistry();
        let pChanged = 0;
        const unsub = prompts.onListChanged(() => { pChanged++; });
        prompts.add({
            name: 'summarize', description: 'sum', arguments: [{ name: 'text', required: true }],
            get: ({ text }) => [{ role: 'user', content: { type: 'text', text: `Summarise: ${text}` } }],
        });
        expect(pChanged).toBe(1);
        expect(prompts.list()).toHaveLength(1);
        expect((await prompts.get('summarize', { text: 'doc' })).messages[0]?.role).toBe('user');
        await expect(prompts.get('nope', {})).rejects.toThrow(/not found/);
        prompts.remove('summarize');
        unsub();

        const resources = new McpResourceRegistry();
        resources.add({ uri: 'file:///x', name: 'X', read: () => ({ type: 'text', text: 'x' }) });
        const caps = new McpCapabilityHandler(resources, prompts, {
            complete: async () => ({ values: ['a'], total: 1, hasMore: false }),
        });
        expect(await caps.handle('resources/list', {})).toMatchObject({ resources: expect.any(Array) });
        expect(await caps.handle('resources/templates/list', {})).toMatchObject({ resourceTemplates: expect.any(Array) });
        expect(await caps.handle('resources/read', { uri: 'file:///x' })).toMatchObject({ contents: expect.any(Array) });
        await expect(caps.handle('resources/read', {})).rejects.toThrow(/missing uri/);
        expect(await caps.handle('resources/subscribe', {})).toEqual({});
        expect(await caps.handle('resources/unsubscribe', {})).toEqual({});
        expect(await caps.handle('prompts/list', {})).toMatchObject({ prompts: expect.any(Array) });
        expect(await caps.handle('completion/complete', {
            ref: { type: 'ref/prompt', name: 'summarize' },
            argument: { name: 'text', value: 'a' },
        })).toMatchObject({ completion: { values: ['a'] } });
        expect(await caps.handle('unknown/method', {})).toBeNull();
        expect(await new McpCapabilityHandler().handle('resources/list', {})).toBeNull();

        globalThis.fetch = vi.fn(async () => json({
            result: { role: 'assistant', content: { type: 'text', text: 'ok' }, model: 'm', stopReason: 'endTurn' },
        })) as typeof fetch;
        const sample = await new McpSamplingClient('https://host/mcp', { auth: 't' }).createMessage({
            messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }],
            maxTokens: 10,
            systemPrompt: 'sys',
            temperature: 0.5,
            stopSequences: ['\n'],
            metadata: {},
            modelPreferences: { hints: [{ name: 'm' }], costPriority: 1 },
        });
        expect(sample.model).toBe('m');

        globalThis.fetch = vi.fn(async () => json({ error: { code: 1, message: 'no' } })) as typeof fetch;
        await expect(new McpSamplingClient('https://host/mcp').createMessage({
            messages: [], maxTokens: 1,
        })).rejects.toThrow(/MCP sampling/);

        globalThis.fetch = vi.fn(async () => new Response('x', { status: 500 })) as typeof fetch;
        await expect(new McpSamplingClient('https://host/mcp').createMessage({
            messages: [], maxTokens: 1,
        })).rejects.toThrow(/HTTP 500/);

        const chunks: string[] = [];
        const res = new EventEmitter() as unknown as ServerResponse;
        (res as unknown as { writeHead: (...a: unknown[]) => void; write: (c: string) => boolean; end: () => void }).writeHead = () => {};
        (res as unknown as { write: (c: string) => boolean }).write = (c: string) => { chunks.push(c); return true; };
        (res as unknown as { end: () => void }).end = () => {};
        const emitter = new McpSseEmitter(res);
        emitter.sendNotification('notifications/resources/updated', { uri: 'x' });
        emitter.sendResponse(1, { ok: true });
        emitter.sendError(2, -1, 'err');
        emitter.end();
        expect(chunks.some((c) => c.includes('notifications/resources/updated'))).toBe(true);

        expect(buildServerCapabilities({
            hasResources: true, hasPrompts: true, hasSampling: true, hasCompletions: true,
        })).toMatchObject({ tools: {}, resources: expect.any(Object), prompts: expect.any(Object) });
    });
});

describe('GitHub tools', () => {
    const originalFetch = globalThis.fetch;
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('toolkit create + API paths', async () => {
        expect(() => GitHubToolkit.create({ enableCreateIssue: true })).toThrow(/token/i);
        const tools = GitHubToolkit.create({
            token: 'gh', enableCreateIssue: false,
        });
        expect(tools.length).toBeGreaterThanOrEqual(4);

        globalThis.fetch = vi.fn(async (url) => {
            const u = String(url);
            if (u.includes('/search/repositories')) {
                return json({ items: [{ full_name: 'o/r', description: null, html_url: 'u', stargazers_count: 1, forks_count: 0, language: 'ts' }], total_count: 1 });
            }
            if (u.includes('/issues') && !u.includes('POST')) {
                return json([{ number: 1, title: 'i', state: 'open', html_url: 'u', user: { login: 'u' }, body: null, labels: [] }]);
            }
            if (u.includes('/pulls')) {
                return json([{ number: 1, title: 'pr', state: 'open', html_url: 'u', user: { login: 'u' }, body: null, head: { ref: 'f' }, base: { ref: 'm' } }]);
            }
            if (u.includes('/repos/')) {
                return json({
                    full_name: 'o/r', description: null, html_url: 'u', stargazers_count: 1,
                    forks_count: 0, language: 'ts', open_issues_count: 0, default_branch: 'main', private: false,
                });
            }
            return json({});
        }) as typeof fetch;

        expect((await new GitHubSearchRepositoriesTool({ id: 'gh_search_cov', token: 'gh' }).execute({ query: 'agent' }, ctx())).data?.data).toBeTruthy();
        expect((await new GitHubGetRepositoryTool({ id: 'gh_repo_cov', token: 'gh' }).execute({ owner: 'o', repo: 'r' }, ctx())).data?.data).toBeTruthy();
        expect((await new GitHubListIssuesTool({ id: 'gh_issues_cov', token: 'gh' }).execute({ owner: 'o', repo: 'r' }, ctx())).data?.data).toBeTruthy();
        expect((await new GitHubListPullRequestsTool({ id: 'gh_prs_cov', token: 'gh' }).execute({ owner: 'o', repo: 'r' }, ctx())).data?.data).toBeTruthy();

        globalThis.fetch = vi.fn(async () => json({ number: 2, title: 'n', state: 'open', html_url: 'u', user: { login: 'u' }, body: 'b', labels: [] })) as typeof fetch;
        expect((await new GitHubCreateIssueTool({ id: 'gh_create_cov', token: 'gh' }).execute({
            owner: 'o', repo: 'r', title: 'n', body: 'b', labels: ['bug'],
        }, ctx())).data?.data).toBeTruthy();

        globalThis.fetch = vi.fn(async () => new Response('x', { status: 500 })) as typeof fetch;
        expect((await new GitHubSearchRepositoriesTool({ id: 'gh_search_err', token: 'gh' }).execute({ query: 'x' }, ctx())).data?.error).toMatch(/GitHub API/);
    });
});

describe('GitLab tools', () => {
    const originalFetch = globalThis.fetch;
    const cfg = { token: 'gl', host: 'https://gitlab.test' };
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('requires token + full API coverage', async () => {
        const prev = process.env['GITLAB_TOKEN'];
        delete process.env['GITLAB_TOKEN'];
        expect((await new GitLabSearchProjectsTool({}).execute({ query: 'x' }, ctx())).success).toBe(false);
        if (prev !== undefined) process.env['GITLAB_TOKEN'] = prev;
        expect(new GitLabToolkit(cfg).getTools()).toHaveLength(6);

        globalThis.fetch = vi.fn(async (url, init) => {
            const u = String(url);
            const method = (init?.method ?? 'GET').toUpperCase();
            if (method === 'POST') return json({ id: 9, title: 't' });
            if (u.includes('/merge_requests')) return json([{ iid: 1 }]);
            if (u.includes('/issues')) return json([{ iid: 1 }]);
            if (u.includes('/projects?')) return json([{ id: 1, name: 'p' }]);
            return json({ id: 1, name: 'p' });
        }) as typeof fetch;

        expect((await new GitLabSearchProjectsTool(cfg).execute({ query: 'p' }, ctx())).success).toBe(true);
        expect((await new GitLabGetProjectTool(cfg).execute({ projectId: 'g/p' }, ctx())).success).toBe(true);
        expect((await new GitLabListIssuesTool(cfg).execute({
            projectId: 1, state: 'opened', labels: 'bug', assigneeId: 2,
        }, ctx())).success).toBe(true);
        expect((await new GitLabCreateIssueTool(cfg).execute({
            projectId: 1, title: 't', description: 'd', labels: ['bug'], assigneeIds: [1], milestoneId: 1, dueDate: '2025-01-01',
        }, ctx())).success).toBe(true);
        expect((await new GitLabListMRsTool(cfg).execute({ projectId: 1, state: 'opened' }, ctx())).success).toBe(true);
        expect((await new GitLabCreateMRTool(cfg).execute({
            projectId: 1, title: 'MR', sourceBranch: 'f', targetBranch: 'main',
            description: 'd', removeSourceBranch: true, squash: true, draft: true,
            assigneeIds: [1], reviewerIds: [2],
        }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async () => new Response('x', { status: 404 })) as typeof fetch;
        expect((await new GitLabGetProjectTool(cfg).execute({ projectId: 1 }, ctx())).success).toBe(false);
    });
});

describe('Docker tools', () => {
    const originalFetch = globalThis.fetch;
    const cfg = { host: 'http://docker.test', apiVersion: 'v1.47' };
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('requires host + operations + bind safety', async () => {
        const prev = process.env['DOCKER_HOST'];
        delete process.env['DOCKER_HOST'];
        expect((await new DockerListContainersTool({}).execute({}, ctx())).success).toBe(false);
        if (prev !== undefined) process.env['DOCKER_HOST'] = prev;
        expect(new DockerToolkit(cfg).getTools()).toHaveLength(7);

        globalThis.fetch = vi.fn(async (url, init) => {
            const u = String(url);
            const method = (init?.method ?? 'GET').toUpperCase();
            if (u.includes('/logs')) return new Response('log line\n', { status: 200 });
            // Bun/undici Response rejects status 204 in some runtimes — empty 200 is fine for dockerRequest
            if (method === 'POST' && u.includes('/start')) return new Response('', { status: 200 });
            if (method === 'POST' && u.includes('/stop')) return new Response('', { status: 200 });
            if (method === 'POST' && u.includes('/create')) return json({ Id: 'cid' });
            if (u.includes('/images/json')) return json([{ Id: 'img' }]);
            if (u.includes('/containers/') && u.includes('/json')) return json({ Id: 'c1', State: { Running: true } });
            return json([{ Id: 'c1' }]);
        }) as typeof fetch;

        expect((await new DockerListContainersTool(cfg).execute({
            all: true, limit: 5, filters: { status: ['running'] },
        }, ctx())).success).toBe(true);
        expect((await new DockerGetContainerTool(cfg).execute({ containerId: 'c1' }, ctx())).success).toBe(true);
        expect((await new DockerStartContainerTool(cfg).execute({ containerId: 'c1' }, ctx())).success).toBe(true);
        expect((await new DockerStopContainerTool(cfg).execute({ containerId: 'c1', t: 5 }, ctx())).success).toBe(true);
        expect((await new DockerCreateContainerTool(cfg).execute({
            image: 'nginx:latest', name: 'n', cmd: ['nginx'], env: ['A=1'],
            ports: { '80/tcp': { hostPort: '8080', hostIp: '0.0.0.0' } },
            volumes: ['/data/app:/app'], workingDir: '/app', autoRemove: true, memory: 64, cpuShares: 2,
        }, ctx())).data).toMatchObject({ Id: 'cid' });
        expect((await new DockerListImagesTool(cfg).execute({ all: true, filters: { dangling: ['true'] } }, ctx())).success).toBe(true);
        expect((await new DockerContainerLogsTool(cfg).execute({ containerId: 'c1' }, ctx())).data).toMatchObject({ logs: expect.stringContaining('log') });

        const blocked = await new DockerCreateContainerTool(cfg).execute({
            image: 'x', volumes: ['/etc:/etc'],
        }, ctx());
        expect(blocked.success).toBe(false);
        expect(blocked.error?.message).toMatch(/sensitive host path/);

        const allowed = await new DockerCreateContainerTool({ ...cfg, allowHostMounts: true }).execute({
            image: 'x', volumes: ['/etc:/etc'],
        }, ctx());
        expect(allowed.success).toBe(true);

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 500 })) as typeof fetch;
        expect((await new DockerListContainersTool(cfg).execute({}, ctx())).success).toBe(false);
    });
});

describe('AWS Lambda tools', () => {
    const originalFetch = globalThis.fetch;
    const cfg = {
        region: 'us-east-1',
        accessKeyId: 'AKIATEST',
        secretAccessKey: 'secret',
        sessionToken: 'sess',
    };
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('requires creds + invoke/list/get', async () => {
        const prev = process.env['AWS_DEFAULT_REGION'];
        const prevKey = process.env['AWS_ACCESS_KEY_ID'];
        const prevSecret = process.env['AWS_SECRET_ACCESS_KEY'];
        delete process.env['AWS_DEFAULT_REGION'];
        delete process.env['AWS_REGION'];
        delete process.env['AWS_ACCESS_KEY_ID'];
        delete process.env['AWS_SECRET_ACCESS_KEY'];
        expect((await new AWSLambdaListFunctionsTool({}).execute({}, ctx())).success).toBe(false);
        if (prev !== undefined) process.env['AWS_DEFAULT_REGION'] = prev;
        if (prevKey !== undefined) process.env['AWS_ACCESS_KEY_ID'] = prevKey;
        if (prevSecret !== undefined) process.env['AWS_SECRET_ACCESS_KEY'] = prevSecret;

        expect(new AWSLambdaToolkit(cfg).getTools()).toHaveLength(3);

        globalThis.fetch = vi.fn(async () =>
            new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: {
                    'X-Amz-Executed-Version': '1',
                    'X-Amz-Log-Result': Buffer.from('LOG').toString('base64'),
                    'X-Amz-Function-Error': 'Unhandled',
                },
            }),
        ) as typeof fetch;

        const invoked = await new AWSLambdaInvokeTool(cfg).execute({
            functionName: 'fn', payload: { a: 1 }, invocationType: 'RequestResponse',
            qualifier: '1', logType: 'Tail',
        }, ctx());
        expect(invoked.success).toBe(true);
        expect(invoked.data?.logResult).toBe('LOG');
        expect(invoked.data?.functionError).toBe('Unhandled');

        // non-JSON payload body
        globalThis.fetch = vi.fn(async () => new Response('plain', { status: 200, headers: { 'X-Amz-Executed-Version': '$LATEST' } })) as typeof fetch;
        expect((await new AWSLambdaInvokeTool(cfg).execute({ functionName: 'fn' }, ctx())).data?.payload).toBe('plain');

        globalThis.fetch = vi.fn(async () => json({ Functions: [{ FunctionName: 'fn' }] })) as typeof fetch;
        expect((await new AWSLambdaListFunctionsTool(cfg).execute({
            maxItems: 10, marker: 'm', functionVersion: 'ALL',
        }, ctx())).success).toBe(true);
        expect((await new AWSLambdaGetFunctionTool(cfg).execute({ functionName: 'fn', qualifier: '1' }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async () => new Response('no', { status: 403 })) as typeof fetch;
        expect((await new AWSLambdaListFunctionsTool(cfg).execute({}, ctx())).success).toBe(false);
        expect((await new AWSLambdaGetFunctionTool(cfg).execute({ functionName: 'fn' }, ctx())).success).toBe(false);
    });
});
