/**
 * Hermetic coverage for devtools (aws-lambda, bitbucket, code-exec, docker, github, gitlab, sleep),
 * social (spotify, twitter, xquik) and ai (openai, serpapi).
 *
 * Adds tests ONLY for lines/branches not already covered by coverage-tools-batch2.test.ts
 * and xquik-social-tools.test.ts (combined run reaches 100%).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ToolContext } from '../src/tools/core/types.js';
import { ToolCategory } from '../src/tools/core/types.js';

// ── Shared helpers (repo convention) ───────────────────────────────────────

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
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function callRaw(tool: any, input: unknown, tc: ToolContext = ctx()) {
    const t: any = tool;
    return t.performExecute.call(tool, input, tc);
}

function rawRes(status: number, body = '', headers: Record<string, string> = {}) {
    return new Response(body, { status, headers: { 'Content-Type': 'text/plain', ...headers } });
}

async function tick() {
    await new Promise((r) => setTimeout(r, 0));
}

const originalFetch = globalThis.fetch;

function stubFetch(impl: (url: string, init?: RequestInit) => unknown): typeof fetch {
    const m = vi.fn(async (input: unknown, init?: RequestInit) => impl(String(input), init)) as unknown as typeof fetch;
    globalThis.fetch = m;
    return m;
}

function fetched(): any {
    return (globalThis.fetch as any).mock;
}

function saveEnv(key: string): string | undefined {
    const v = process.env[key];
    delete process.env[key];
    return v;
}

afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
});

// ── Mock node:child_process for deterministic python/shell branches ────────

const childMock = vi.hoisted(() => {
    const makeEmitter = () => {
        const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
        return {
            handlers,
            on(ev: string, fn: (...a: unknown[]) => void) {
                (handlers[ev] = handlers[ev] || []).push(fn);
                return this;
            },
            emit(ev: string, ...args: unknown[]) {
                (handlers[ev] || []).forEach((fn) => fn(...args));
                return true;
            },
        };
    };
    const spawned: Array<{ proc: any; cmd: string; args: unknown[]; opts: any }> = [];
    function spawn(cmd: string, args: unknown[] = [], opts: any = {}) {
        const proc: any = makeEmitter();
        proc.stdout = makeEmitter();
        proc.stderr = makeEmitter();
        spawned.push({ proc, cmd, args, opts });
        return proc;
    }
    return { spawn, spawned };
});

vi.mock('node:child_process', () => ({ spawn: childMock.spawn }));

import {
    AWSLambdaInvokeTool,
    AWSLambdaListFunctionsTool,
    AWSLambdaGetFunctionTool,
    AWSLambdaToolkit,
} from '../src/tools/devtools/aws-lambda.js';
import {
    BitbucketListReposTool,
    BitbucketGetRepoTool,
    BitbucketListPRsTool,
    BitbucketCreatePRTool,
    BitbucketGetPRTool,
    BitbucketListIssuesTool,
    BitbucketToolkit,
} from '../src/tools/devtools/bitbucket.js';
import {
    JavaScriptExecTool,
    PythonExecTool,
    ShellCommandTool,
    CodeExecToolkit,
} from '../src/tools/devtools/code-exec.js';
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
import { SleepTool, SleepToolkit } from '../src/tools/devtools/sleep.js';
import {
    E2BRunCodeTool,
    E2BInstallPackagesTool,
    E2BRunNotebookTool,
    E2BToolkit,
} from '../src/tools/devtools/e2b.js';
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
    TwitterSearchTweetsTool,
    TwitterGetTweetTool,
    TwitterPostTweetTool,
    TwitterGetUserTool,
    TwitterGetUserTimelineTool,
    TwitterToolkit,
} from '../src/tools/social/twitter.js';
import { XquikSearchPostsTool, XquikTrendsTool, XquikToolkit } from '../src/tools/social/xquik.js';
import { OpenAIGenerateImageTool, OpenAITranscribeAudioTool, OpenAIToolkit } from '../src/tools/ai/openai.js';
import { SerpApiGoogleSearchTool, SerpApiYouTubeSearchTool, SerpApiToolkit } from '../src/tools/ai/serpapi.js';

// ── AWS Lambda ─────────────────────────────────────────────────────────────

describe('AWS Lambda coverage', () => {
    const cfg = { region: 'us-east-1', accessKeyId: 'AKIATEST', secretAccessKey: 'secret', sessionToken: 'sess' };
    const cfgNoSess = { region: 'us-east-1', accessKeyId: 'AKIATEST', secretAccessKey: 'secret' };

    it('getAuth missing access/secret throws gracefully', async () => {
        const r1 = await new AWSLambdaInvokeTool({ region: 'r', secretAccessKey: 's' }).execute({ functionName: 'f' }, ctx());
        expect(r1.success).toBe(false);
        expect(r1.error?.message).toMatch(/AWS_ACCESS_KEY_ID/);
        const r2 = await new AWSLambdaListFunctionsTool({ region: 'r', accessKeyId: 'a' }).execute({}, ctx());
        expect(r2.success).toBe(false);
        expect(r2.error?.message).toMatch(/AWS_SECRET_ACCESS_KEY/);
        expect(new AWSLambdaToolkit(cfg).getTools()).toHaveLength(3);
    });

    it('sign header without session token', async () => {
        globalThis.fetch = stubFetch(() => json({ ok: true }));
        const r = await new AWSLambdaInvokeTool(cfgNoSess).execute({ functionName: 'fn' }, ctx());
        expect(r.success).toBe(true);
    });

    it('invoke raw defaults (invocationType/logType/qualifier) and missing headers', async () => {
        globalThis.fetch = stubFetch(() => rawRes(200, '{}'));
        const r = await callRaw(new AWSLambdaInvokeTool(cfg), { functionName: 'fn' });
        expect(r.statusCode).toBe(200);
        expect(r.executedVersion).toBe('$LATEST');
        expect(r.payload).toEqual({});
        expect(r.functionError).toBeUndefined();
        expect(r.logResult).toBeUndefined();
    });

    it('list functions default maxItems via raw', async () => {
        globalThis.fetch = stubFetch(() => json({ Functions: [] }));
        await callRaw(new AWSLambdaListFunctionsTool(cfg), {});
        expect(fetched().calls[0][0]).toContain('MaxItems=50');
    });
});

// ── Bitbucket ──────────────────────────────────────────────────────────────

describe('Bitbucket coverage', () => {
    const cfg = { workspace: 'ws', username: 'u', appPassword: 'p' };

    it('getAuth missing fields + env fallback + toolkit', async () => {
        const w = saveEnv('BITBUCKET_WORKSPACE');
        const u = saveEnv('BITBUCKET_USERNAME');
        const p = saveEnv('BITBUCKET_APP_PASSWORD');

        const r1 = await new BitbucketListReposTool({}).execute({}, ctx());
        expect(r1.success).toBe(false);
        expect(r1.error?.message).toMatch(/BITBUCKET_WORKSPACE/);
        if (w !== undefined) process.env['BITBUCKET_WORKSPACE'] = w;

        const r2 = await new BitbucketGetRepoTool({ workspace: 'ws' }).execute({ repoSlug: 'r' }, ctx());
        expect(r2.success).toBe(false);
        expect(r2.error?.message).toMatch(/BITBUCKET_USERNAME and BITBUCKET_APP_PASSWORD/);
        if (u !== undefined) process.env['BITBUCKET_USERNAME'] = u;
        if (p !== undefined) process.env['BITBUCKET_APP_PASSWORD'] = p;

        process.env['BITBUCKET_WORKSPACE'] = 'ws';
        process.env['BITBUCKET_USERNAME'] = 'u';
        process.env['BITBUCKET_APP_PASSWORD'] = 'p';
        globalThis.fetch = stubFetch(() => json([{ slug: 'r' }]));
        expect((await new BitbucketListReposTool({}).execute({}, ctx())).success).toBe(true);

        delete process.env['BITBUCKET_WORKSPACE'];
        delete process.env['BITBUCKET_USERNAME'];
        delete process.env['BITBUCKET_APP_PASSWORD'];
        if (w !== undefined) process.env['BITBUCKET_WORKSPACE'] = w;
        if (u !== undefined) process.env['BITBUCKET_USERNAME'] = u;
        if (p !== undefined) process.env['BITBUCKET_APP_PASSWORD'] = p;

        expect(new BitbucketToolkit(cfg).getTools()).toHaveLength(6);
    });

    it('repos/prs/issues operations incl. 204 and failure', async () => {
        globalThis.fetch = stubFetch((url, init) => {
            const m = (init?.method ?? 'GET').toUpperCase();
            if (m === 'POST') return json({ id: 1 });
            if (url.includes('/pullrequests')) return json([{ id: 1 }]);
            if (url.includes('/issues')) return json([{ iid: 1 }]);
            return json([{ slug: 'r' }]);
        });
        expect((await new BitbucketListReposTool(cfg).execute({ query: 'qa' }, ctx())).success).toBe(true);
        expect((await new BitbucketGetRepoTool(cfg).execute({ repoSlug: 'r' }, ctx())).success).toBe(true);
        expect((await new BitbucketListPRsTool(cfg).execute({ repoSlug: 'r', state: 'OPEN' }, ctx())).success).toBe(true);
        expect((await new BitbucketCreatePRTool(cfg).execute({
            repoSlug: 'r', title: 't', sourceBranch: 'f', destinationBranch: 'main',
            description: 'd', closeSourceBranch: true, reviewers: ['r1', 'r2'],
        }, ctx())).success).toBe(true);
        expect((await new BitbucketGetPRTool(cfg).execute({ repoSlug: 'r', prId: 1 }, ctx())).success).toBe(true);
        expect((await new BitbucketListIssuesTool(cfg).execute({
            repoSlug: 'r', status: 'open', priority: 'minor',
        }, ctx())).success).toBe(true);

        globalThis.fetch = stubFetch(() => new Response(null, { status: 204 }));
        expect((await new BitbucketListReposTool(cfg).execute({}, ctx())).data).toEqual({ success: true });

        globalThis.fetch = stubFetch(() => rawRes(500, 'boom'));
        expect((await new BitbucketGetRepoTool(cfg).execute({ repoSlug: 'r' }, ctx())).success).toBe(false);
    });

    it('optional-parameter default/falsy branches via raw', async () => {
        globalThis.fetch = stubFetch(() => json({}));
        await callRaw(new BitbucketListReposTool(cfg), {});
        expect(fetched().calls[0][0]).toContain('page=1');
        expect(fetched().calls[0][0]).toContain('pagelen=25');

        await callRaw(new BitbucketListReposTool(cfg), {});
        expect(fetched().calls[1][0]).not.toContain('q='); // no query

        await callRaw(new BitbucketListPRsTool(cfg), { repoSlug: 'r' });
        expect(fetched().calls[2][0]).toContain('state=OPEN');

        await callRaw(new BitbucketCreatePRTool(cfg), { repoSlug: 'r', title: 't', sourceBranch: 'f' });
        const body = fetched().calls[3][1] as RequestInit;
        expect(JSON.parse(String(body.body))).toMatchObject({
            title: 't',
            destination: { branch: { name: 'main' } },
            close_source_branch: false,
        });

        await callRaw(new BitbucketCreatePRTool(cfg),
            { repoSlug: 'r', title: 't', sourceBranch: 'f', reviewers: [] });
        expect(JSON.parse(String((fetched().calls[4][1] as RequestInit).body))['reviewers']).toBeUndefined();

        await callRaw(new BitbucketListIssuesTool(cfg), { repoSlug: 'r' });
        expect(fetched().calls[5][0]).toContain('/issues?');
    });
});

// ── Docker ─────────────────────────────────────────────────────────────────

describe('Docker coverage', () => {
    const cfg = { host: 'http://docker.test', apiVersion: 'v1.47' };

    it('default apiVersion, no filters, empty-host bind, hostIp-less port', async () => {
        globalThis.fetch = stubFetch((url, init) => {
            const m = (init?.method ?? 'GET').toUpperCase();
            if (m === 'POST' && url.includes('/create')) return json({ Id: 'cid' });
            if (url.includes('/logs')) return rawRes(200, 'line\n');
            if (url.includes('/images/json') || url.includes('/containers/json')) return json([]);
            return rawRes(200, '');
        });

        // no apiVersion -> RHS 'v1.47'; trailing-slash host -> RHS of replace
        expect((await new DockerListContainersTool({ host: 'http://docker.test/' }).execute({}, ctx())).success).toBe(true);

        // no filters -> falsy arm in list images
        expect((await new DockerListImagesTool(cfg).execute({ all: true }, ctx())).success).toBe(true);

        // port binding without hostIp -> `{ }` RHS
        const created = await callRaw(new DockerCreateContainerTool(cfg), {
            image: 'x', ports: { '80/tcp': { hostPort: '8080' } },
        });
        expect(created).toMatchObject({ Id: 'cid' });

        // empty host side of a bind -> `|| '/'` RHS (blocked)
        const blocked = await new DockerCreateContainerTool(cfg).execute({ image: 'x', volumes: ['/:x'] }, ctx());
        expect(blocked.success).toBe(false);
        expect(blocked.error?.message).toMatch(/sensitive host path "\/"/);
    });

    it('HOME-absent bind check + non-JSON dockerRequest body', async () => {
        const prev = saveEnv('HOME');
        globalThis.fetch = stubFetch(() => json({}));
        const r = await new DockerCreateContainerTool(cfg).execute({ image: 'x', volumes: ['/data:/data'] }, ctx());
        expect(r.success).toBe(true);
        if (prev !== undefined) process.env['HOME'] = prev;

        globalThis.fetch = stubFetch(() => rawRes(200, 'not-json'));
        expect((await new DockerListContainersTool(cfg).execute({}, ctx())).data).toBe('not-json');
    });

    it('logs failure + other ops + toolkit', async () => {
        globalThis.fetch = stubFetch((url, init) => {
            const m = (init?.method ?? 'GET').toUpperCase();
            if (m === 'POST') return rawRes(200, '');
            if (url.includes('/logs')) return rawRes(200, 'logs');
            return json({ Id: 'c1' });
        });
        expect((await new DockerGetContainerTool(cfg).execute({ containerId: 'c1' }, ctx())).success).toBe(true);
        expect((await new DockerStartContainerTool(cfg).execute({ containerId: 'c1' }, ctx())).success).toBe(true);
        expect((await new DockerStopContainerTool(cfg).execute({ containerId: 'c1' }, ctx())).success).toBe(true);
        expect((await new DockerContainerLogsTool(cfg).execute({ containerId: 'c1' }, ctx())).data).toEqual({ logs: 'logs' });
        expect(new DockerToolkit(cfg).getTools()).toHaveLength(7);

        globalThis.fetch = stubFetch(() => rawRes(500, 'bad'));
        expect((await new DockerContainerLogsTool(cfg).execute({ containerId: 'c1' }, ctx())).success).toBe(false);
    });
});
// ── GitHub ─────────────────────────────────────────────────────────────────

describe('GitHub coverage', () => {
    const okSearch = json({ items: [], total_count: 0 });
    const okIssue = json({ number: 1, title: 't', state: 'open', html_url: 'u', user: { login: 'u' }, body: null, labels: [] });
    const okRepo = json({
        full_name: 'o/r', description: null, html_url: 'u', stargazers_count: 1, forks_count: 0,
        language: 'ts', open_issues_count: 0, default_branch: 'main', private: false,
    });
    const okPr = json([{ number: 1, title: 'p', state: 'open', html_url: 'u', user: { login: 'u' }, body: null, head: { ref: 'f' }, base: { ref: 'm' } }]);

    it('token env fallback and no-token paths', async () => {
        const prev = saveEnv('GITHUB_ACCESS_TOKEN');
        process.env['GITHUB_ACCESS_TOKEN'] = 'ghtok';
        globalThis.fetch = stubFetch((url) => (url.includes('/pulls') ? okPr : okSearch));
        expect((await new GitHubListPullRequestsTool({}).execute({ owner: 'o', repo: 'r' }, ctx())).success).toBe(true);
        expect((await new GitHubSearchRepositoriesTool({}).execute({ query: 'x' }, ctx())).success).toBe(true);
        delete process.env['GITHUB_ACCESS_TOKEN'];

        globalThis.fetch = stubFetch(() => okSearch);
        expect((await new GitHubSearchRepositoriesTool({}).execute({ query: 'x' }, ctx())).success).toBe(true);
        expect((await new GitHubListPullRequestsTool({}).execute({ owner: 'o', repo: 'r' }, ctx())).success).toBe(true);
        if (prev !== undefined) process.env['GITHUB_ACCESS_TOKEN'] = prev;
    });

    it('per-tool API/throws-string error branches', async () => {
        const cfg = { id: 'gh_cov', token: 'gh' };
        globalThis.fetch = stubFetch((url) => {
            if (url.includes('/issues')) return okIssue;
            if (url.includes('/pulls')) return okPr;
            return okRepo;
        });
        expect((await new GitHubGetRepositoryTool(cfg).execute({ owner: 'o', repo: 'r' }, ctx())).success).toBe(true);
        expect((await new GitHubListIssuesTool(cfg).execute({ owner: 'o', repo: 'r' }, ctx())).success).toBe(true);
        expect((await new GitHubListPullRequestsTool(cfg).execute({ owner: 'o', repo: 'r' }, ctx())).success).toBe(true);
        expect((await new GitHubCreateIssueTool(cfg).execute({
            owner: 'o', repo: 'r', title: 'n', body: 'b', labels: ['bug'],
        }, ctx())).success).toBe(true);

        globalThis.fetch = stubFetch(() => rawRes(500, 'x'));
        expect((await new GitHubGetRepositoryTool(cfg).execute({ owner: 'o', repo: 'r' }, ctx())).data?.error).toMatch(/GitHub API/);
        expect((await new GitHubListIssuesTool(cfg).execute({ owner: 'o', repo: 'r' }, ctx())).data?.error).toMatch(/GitHub API/);
        expect((await new GitHubListPullRequestsTool(cfg).execute({ owner: 'o', repo: 'r' }, ctx())).data?.error).toMatch(/GitHub API/);
        expect((await new GitHubCreateIssueTool(cfg).execute({ owner: 'o', repo: 'r', title: 'n' }, ctx())).data?.error).toMatch(/GitHub API/);
        expect((await new GitHubSearchRepositoriesTool(cfg).execute({ query: 'x' }, ctx())).data?.error).toMatch(/GitHub API/);

        globalThis.fetch = stubFetch(() => { throw 'string-boom'; });
        expect((await new GitHubSearchRepositoriesTool(cfg).execute({ query: 'x' }, ctx())).data?.error).toBe('Unknown error occurred');
        expect((await new GitHubGetRepositoryTool(cfg).execute({ owner: 'o', repo: 'r' }, ctx())).data?.error).toBe('Unknown error occurred');
        expect((await new GitHubListIssuesTool(cfg).execute({ owner: 'o', repo: 'r' }, ctx())).data?.error).toBe('Unknown error occurred');
        expect((await new GitHubListPullRequestsTool(cfg).execute({ owner: 'o', repo: 'r' }, ctx())).data?.error).toBe('Unknown error occurred');
        expect((await new GitHubCreateIssueTool(cfg).execute({ owner: 'o', repo: 'r', title: 'n' }, ctx())).data?.error).toBe('Unknown error occurred');
    });

    it('toolkit create option branches', () => {
        const prev = saveEnv('GITHUB_ACCESS_TOKEN');
        process.env['GITHUB_ACCESS_TOKEN'] = 'ghtok';
        expect(GitHubToolkit.create()).toHaveLength(5);
        delete process.env['GITHUB_ACCESS_TOKEN'];
        if (prev !== undefined) process.env['GITHUB_ACCESS_TOKEN'] = prev;

        expect(GitHubToolkit.create({ token: 'gh', enableSearch: false, enableGetRepo: false, enableListIssues: false,
            enableListPRs: false, enableCreateIssue: false,
        })).toHaveLength(0);
        expect(GitHubToolkit.create({ token: 'gh' })).toHaveLength(5);
    });
});

// ── GitLab ─────────────────────────────────────────────────────────────────

describe('GitLab coverage', () => {
    const cfg = { token: 'gl', host: 'https://gitlab.test' };

    it('host env fallback + default host + trailing slash', async () => {
        const t = saveEnv('GITLAB_TOKEN');
        const h = saveEnv('GITLAB_HOST');
        process.env['GITLAB_TOKEN'] = 'gl';
        process.env['GITLAB_HOST'] = 'https://gl-env.test';
        globalThis.fetch = stubFetch(() => json([{ id: 1 }]));
        const envR = await new GitLabSearchProjectsTool({}).execute({ query: 'p' }, ctx());
        expect(envR.success).toBe(true);
        expect(fetched().calls[0][0]).toContain('https://gl-env.test/api/v4');
        delete process.env['GITLAB_HOST'];
        if (t !== undefined) process.env['GITLAB_TOKEN'] = t;
        if (h !== undefined) process.env['GITLAB_HOST'] = h;

        globalThis.fetch = stubFetch(() => json([{ id: 1 }]));
        const def = await new GitLabSearchProjectsTool({ token: 'gl' }).execute({ query: 'p' }, ctx());
        expect(def.success).toBe(true);
        expect(fetched().calls[0][0]).toContain('https://gitlab.com/api/v4');

        globalThis.fetch = stubFetch(() => json({ id: 1 }));
        const slash = await new GitLabGetProjectTool({ token: 'gl', host: 'https://gl-slash.test/' }).execute({ projectId: 1 }, ctx());
        expect(slash.success).toBe(true);
        expect(fetched().calls[0][0]).toContain('https://gl-slash.test/api/v4');
    });

    it('204 handling and optional-parameter branches', async () => {
        globalThis.fetch = stubFetch(() => new Response(null, { status: 204 }));
        expect((await new GitLabGetProjectTool(cfg).execute({ projectId: 1 }, ctx())).data).toEqual({ success: true });

        globalThis.fetch = stubFetch(() => json({}));
        await callRaw(new GitLabSearchProjectsTool(cfg), { query: 'p' });
        expect(fetched().calls[0][0]).toContain('per_page=20');

        await callRaw(new GitLabListIssuesTool(cfg), { projectId: 1 });
        expect(fetched().calls[1][0]).toContain('state=opened');

        await callRaw(new GitLabListMRsTool(cfg), { projectId: 1 });
        expect(fetched().calls[2][0]).toContain('state=opened');

        await callRaw(new GitLabCreateIssueTool(cfg), { projectId: 1, title: 't' });
        await callRaw(new GitLabCreateMRTool(cfg), { projectId: 1, title: 'MR', sourceBranch: 'f' });
        const mrBody = JSON.parse(String((fetched().calls[4][1] as RequestInit).body));
        expect(mrBody).toMatchObject({ title: 'MR', target_branch: 'main', remove_source_branch: false, squash: false });
        expect(mrBody['description']).toBeUndefined();
        expect(mrBody['assignee_ids']).toBeUndefined();
        expect(mrBody['reviewer_ids']).toBeUndefined();

        // falsy optional fields via execute
        globalThis.fetch = stubFetch(() => json({}));
        await new GitLabListIssuesTool(cfg).execute({ projectId: 1 }, ctx());
        await new GitLabCreateIssueTool(cfg).execute({ projectId: 1, title: 't' }, ctx());
        expect(new GitLabToolkit(cfg).getTools()).toHaveLength(6);
    });
});

// ── Code exec (js/python/shell) ────────────────────────────────────────────

describe('Code exec coverage', () => {
    it('JS sandbox success + console capture', async () => {
        const r = await new JavaScriptExecTool().execute({
            code: 'const a=1; console.log("hi"); console.warn("w"); console.error("e"); console.info("i"); a+1;',
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data).toMatchObject({ stdout: 'hi\n[info] i', stderr: '[warn] w\ne' });
    });

    it('JS undefined return + syntax/string-throw errors + toolkit', async () => {
        const u = await new JavaScriptExecTool({}).execute({ code: 'undefined' }, ctx());
        expect(u.data?.returnValue).toBeNull();
        const bad = await new JavaScriptExecTool({}).execute({ code: 'let = ;' }, ctx());
        expect(bad.data?.success).toBe(false);
        expect(bad.data?.error).toBeTruthy();
        const strThrown = await new JavaScriptExecTool({}).execute({ code: 'throw "boom"' }, ctx());
        expect(strThrown.data?.success).toBe(false);
        expect(strThrown.data?.error).toBe('boom');
        expect(new CodeExecToolkit().tools).toHaveLength(3);
    });

    it('python success via child mock (default timeout RHS)', async () => {
        childMock.spawned.length = 0;
        const p = callRaw(new PythonExecTool(), { code: 'print(1)' });
        await tick();
        const rec = childMock.spawned[0];
        expect(rec.cmd).toBe('python3');
        expect(rec.opts.timeout).toBe(10000);
        rec.proc.stdout.emit('data', Buffer.from('hello\n'));
        rec.proc.emit('close', 0);
        const r = await p;
        expect(r.success).toBe(true);
        expect(r.stdout).toBe('hello');
    });

    it('python env PATH fallback RHS', async () => {
        const prev = saveEnv('PATH');
        childMock.spawned.length = 0;
        const p = callRaw(new PythonExecTool(), { code: 'x' });
        await tick();
        const rec = childMock.spawned[0];
        expect(rec.opts.env.PATH).toBe('/usr/bin:/bin');
        rec.proc.emit('close', 0);
        await p;
        if (prev !== undefined) process.env['PATH'] = prev;
    });

    it('python error event + non-zero exit', async () => {
        childMock.spawned.length = 0;
        const p1 = callRaw(new PythonExecTool({ timeoutMs: 2000 }), { code: 'x' });
        await tick();
        const rec1 = childMock.spawned[0];
        rec1.proc.emit('error', new Error('ENOENT'));
        const r1 = await p1;
        expect(r1.success).toBe(false);
        expect(r1.error).toBe('ENOENT');

        childMock.spawned.length = 0;
        const p2 = callRaw(new PythonExecTool(), { code: 'x' });
        await tick();
        const rec2 = childMock.spawned[0];
        rec2.proc.stderr.emit('data', Buffer.from('oops'));
        rec2.proc.emit('close', 3);
        const r2 = await p2;
        expect(r2.success).toBe(false);
        expect(r2.error).toContain('Process exited with code 3');
        expect(r2.stderr).toBe('oops');
    });

    it('shell deny not-in-allowlist', async () => {
        const r = await new ShellCommandTool({ allowedCommands: ['echo'] }).execute({ command: 'rm' }, ctx());
        expect(r.data?.success).toBe(false);
        expect(r.data?.error).toMatch(/not in the allowed list/);
    });

    it('shell allow + args default RHS + error + non-zero', async () => {
        childMock.spawned.length = 0;
        const p1 = callRaw(new ShellCommandTool(), { command: 'echo' });
        await tick();
        const rec1 = childMock.spawned[0];
        expect(rec1.args).toEqual([]);
        rec1.proc.stdout.emit('data', Buffer.from('hi'));
        rec1.proc.stderr.emit('data', Buffer.from('warn'));
        rec1.proc.emit('close', 0);
        const r1 = await p1;
        expect(r1.success).toBe(true);
        expect(r1.stdout).toBe('hi');
        expect(r1.stderr).toBe('warn');

        childMock.spawned.length = 0;
        const p2 = callRaw(new ShellCommandTool({ timeoutMs: 3000 }), { command: 'echo', args: ['x'] });
        await tick();
        const rec2 = childMock.spawned[0];
        expect(rec2.args).toEqual(['x']);
        expect(rec2.opts.timeout).toBe(3000);
        rec2.proc.emit('error', new Error('nope'));
        expect((await p2).error).toBe('nope');

        childMock.spawned.length = 0;
        const p3 = callRaw(new ShellCommandTool(), { command: 'echo' });
        await tick();
        childMock.spawned[0].proc.emit('close', 2);
        const r3 = await p3;
        expect(r3.success).toBe(false);
        expect(r3.error).toContain('Exited with code 2');
    });
});

// ── Sleep ──────────────────────────────────────────────────────────────────

describe('Sleep coverage', () => {
    it('sleep success with and without reason + toolkit', async () => {
        const r = await new SleepTool().execute({ seconds: 0.1, reason: 'poll' }, ctx());
        expect(r.data).toMatchObject({ sleptForSeconds: 0.1, reason: 'poll' });
        const r2 = await new SleepTool().execute({ seconds: 0.1 }, ctx());
        expect(r2.data?.reason).toBeUndefined();
        expect(new SleepToolkit().getTools()).toHaveLength(1);
    });
});
// ── E2B ────────────────────────────────────────────────────────────────────

function e2bStub(o: { createStatus?: number; execStatus?: number; deleteReject?: boolean; execBody?: unknown } = {}) {
    return stubFetch((url, init) => {
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url === 'https://api.e2b.dev/sandboxes' && method === 'POST') {
            if (o.createStatus && o.createStatus !== 200) return rawRes(o.createStatus, 'create-err');
            return json({ sandboxID: 'sb1' });
        }
        if (url.includes('/files?')) return rawRes(200, '');
        if (url === 'https://api.e2b.dev/sandboxes/sb1' && method === 'DELETE') {
            if (o.deleteReject) throw new Error('close failed');
            return rawRes(204);
        }
        if (url.includes('/process')) {
            if (o.execStatus && o.execStatus !== 200) return rawRes(o.execStatus, 'exec-err');
            return json(o.execBody ?? { stdout: 'o', stderr: 'e', exitCode: 0, results: [1, 2] });
        }
        return rawRes(200, '');
    });
}

describe('E2B coverage', () => {
    const cfg = { apiKey: 'k' };

    it('run code python with files + close-delete failure swallowed', async () => {
        e2bStub({ deleteReject: true });
        const r = await new E2BRunCodeTool(cfg).execute({
            code: 'x=1', language: 'python', sandboxTemplate: 'base', timeoutSecs: 30,
            files: [{ path: '/a.txt', content: 'hi' }], envVars: { A: '1' },
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data).toMatchObject({ stdout: 'o', stderr: 'e', exitCode: 0, results: [1, 2], sandboxId: 'sb1' });
    });

    it('run code other languages + missing result fields', async () => {
        e2bStub({ execBody: {} });
        for (const lang of ['javascript', 'typescript', 'bash']) {
            const rr = await new E2BRunCodeTool(cfg).execute({ code: 'x', language: lang as any }, ctx());
            expect(rr.data?.stdout).toBe('');
            expect(rr.data?.exitCode).toBe(0);
            expect(rr.data?.results).toEqual([]);
        }
    });

    it('run code raw defaults (timeout/sandboxTemplate/envVars) + api errors', async () => {
        e2bStub({});
        await callRaw(new E2BRunCodeTool(cfg), { code: 'x' });
        const createBody = JSON.parse(String((fetched().calls[0][1] as RequestInit).body));
        expect(createBody).toMatchObject({ templateID: 'base', timeout: 60 });

        e2bStub({ createStatus: 500 });
        expect((await new E2BRunCodeTool(cfg).execute({ code: 'x' }, ctx())).success).toBe(false);

        e2bStub({ execStatus: 500 });
        expect((await new E2BRunCodeTool(cfg).execute({ code: 'x' }, ctx())).success).toBe(false);
    });

    it('config timeoutSecs middle arm + missing key + toolkit', async () => {
        e2bStub({});
        const r = await new E2BRunCodeTool({ apiKey: 'k', timeoutSecs: 90 }).execute({ code: 'x' }, ctx());
        expect(r.success).toBe(true);

        const prev = saveEnv('E2B_API_KEY');
        const missing = await new E2BRunCodeTool({}).execute({ code: 'x' }, ctx());
        expect(missing.success).toBe(false);
        expect(missing.error?.message).toMatch(/E2B_API_KEY/);
        if (prev !== undefined) process.env['E2B_API_KEY'] = prev;

        expect(new E2BToolkit(cfg).getTools()).toHaveLength(3);
    });

    it('install packages python + javascript', async () => {
        e2bStub({});
        expect((await new E2BInstallPackagesTool(cfg).execute({ packages: ['requests'] }, ctx())).success).toBe(true);
        expect((await new E2BInstallPackagesTool(cfg).execute({
            packages: ['lodash'], language: 'javascript',
        }, ctx())).success).toBe(true);

        e2bStub({ createStatus: 500 });
        expect((await new E2BInstallPackagesTool(cfg).execute({ packages: ['x'] }, ctx())).success).toBe(false);

        e2bStub({ execStatus: 400 });
        expect((await new E2BInstallPackagesTool(cfg).execute({ packages: ['x'] }, ctx())).success).toBe(false);
    });

    it('notebook markdown + code + raw defaults + errors', async () => {
        e2bStub({});
        const r = await new E2BRunNotebookTool(cfg).execute({
            cells: [{ source: '# title', cellType: 'markdown' }, { source: 'print(1)' }],
        }, ctx());
        expect(r.success).toBe(true);
        expect(r.data?.cells).toHaveLength(2);
        expect(r.data?.cells[0]).toMatchObject({ cellType: 'markdown' });

        await callRaw(new E2BRunNotebookTool(cfg), { cells: [{ source: 'x' }] });
        const nbBody = JSON.parse(String((fetched().calls[0][1] as RequestInit).body));
        expect(nbBody).toMatchObject({ templateID: 'code-interpreter-v1', timeout: 120 });

        e2bStub({ execStatus: 500 });
        expect((await new E2BRunNotebookTool(cfg).execute({ cells: [{ source: 'x' }] }, ctx())).success).toBe(false);

        e2bStub({ createStatus: 500 });
        expect((await new E2BRunNotebookTool(cfg).execute({ cells: [{ source: 'x' }] }, ctx())).success).toBe(false);
    });
});

// ── Spotify ────────────────────────────────────────────────────────────────

const spotifyTrack = {
    id: 'tr1', name: 'Song', artists: [{ name: 'A' }], album: { name: 'Alb' },
    duration_ms: 1000, uri: 'spotify:track:tr1', explicit: false, preview_url: 'p', popularity: 50,
};

function spotifyStub(playlistFull = true) {
    return stubFetch((url, init) => {
        const method = (init?.method ?? 'GET').toUpperCase();
        if (url.includes('/search')) return json({ tracks: { items: [spotifyTrack], total: 1 } });
        if (url.includes('/tracks/')) return json(spotifyTrack);
        if (url.includes('/playlists/') && !url.includes('/me/playlists')) {
            if (playlistFull) {
                return json({
                    id: 'pl1', name: 'PL', description: 'd', owner: { display_name: 'me' },
                    tracks: { items: [{ track: spotifyTrack }], total: 1 },
                });
            }
            return json({ id: 'pl1', name: 'PL' });
        }
        if (method === 'GET' && /\/me\/player(\?|$)/.test(url)) {
            return json({
                is_playing: true, item: spotifyTrack, device: { name: 'Phone' },
                progress_ms: 10, shuffle_state: false,
            });
        }
        if (url.includes('/me/playlists')) {
            return json({
                items: [{ id: 'pl1', name: 'PL', tracks: { total: 1 }, owner: { display_name: 'me' }, public: true }],
            });
        }
        if (method === 'PUT' || method === 'POST') return new Response(null, { status: 204 });
        return json({});
    });
}

describe('Spotify coverage', () => {
    const cfg = { accessToken: 'stok' };

    it('token throw + env fallback + toolkit', async () => {
        const prev = saveEnv('SPOTIFY_ACCESS_TOKEN');
        const missing = await new SpotifySearchTool({}).execute({ query: 'x' }, ctx());
        expect(missing.success).toBe(false);
        expect(missing.error?.message).toMatch(/SPOTIFY_ACCESS_TOKEN/);
        delete process.env['SPOTIFY_ACCESS_TOKEN'];

        process.env['SPOTIFY_ACCESS_TOKEN'] = 'envtok';
        globalThis.fetch = stubFetch(() => json({}));
        expect((await new SpotifySearchTool({}).execute({ query: 'x' }, ctx())).success).toBe(true);
        if (prev !== undefined) process.env['SPOTIFY_ACCESS_TOKEN'] = prev;
        else delete process.env['SPOTIFY_ACCESS_TOKEN'];

        expect(new SpotifyToolkit(cfg).tools).toHaveLength(9);
    });

    it('search variants', async () => {
        globalThis.fetch = stubFetch(() => json({ tracks: { items: [spotifyTrack], total: 1 } }));
        const s = await new SpotifySearchTool(cfg).execute({ query: 'Song', market: 'US' }, ctx());
        expect(s.data?.tracks).toHaveLength(1);
        expect(s.data?.totalTracks).toBe(1);

        globalThis.fetch = stubFetch(() => json({}));
        const none = await new SpotifySearchTool(cfg).execute({ query: 'x' }, ctx());
        expect(none.data?.tracks).toBeUndefined();
        expect(none.data?.totalTracks).toBeUndefined();

        await callRaw(new SpotifySearchTool(cfg), { query: 'x' });
        expect(fetched().calls[0][0]).toContain('type=track');
        expect(fetched().calls[0][0]).toContain('limit=10');

        globalThis.fetch = stubFetch(() => rawRes(401, 'no'));
        expect((await new SpotifySearchTool(cfg).execute({ query: 'x' }, ctx())).success).toBe(false);
    });

    it('getTrack with and without optional keys', async () => {
        globalThis.fetch = stubFetch(() => json(spotifyTrack));
        const full = await new SpotifyGetTrackTool(cfg).execute({ trackId: 'tr1' }, ctx());
        expect(full.data).toMatchObject({ id: 'tr1', previewUrl: 'p', popularity: 50 });

        globalThis.fetch = stubFetch(() => json({ id: 'x', name: 'n', duration_ms: 1, uri: 'u', explicit: false }));
        const bare = await new SpotifyGetTrackTool(cfg).execute({ trackId: 'x' }, ctx());
        expect(bare.data?.artists).toEqual([]);
        expect(bare.data?.album).toBe('');
        expect(bare.data?.previewUrl).toBeUndefined();
        expect(bare.data?.popularity).toBeUndefined();
    });

    it('getPlaylist full + minimal', async () => {
        spotifyStub(true);
        const full = await new SpotifyGetPlaylistTool(cfg).execute({ playlistId: 'pl1' }, ctx());
        expect(full.data?.tracks).toHaveLength(1);
        expect(full.data?.description).toBe('d');

        spotifyStub(false);
        const min = await new SpotifyGetPlaylistTool(cfg).execute({ playlistId: 'pl1' }, ctx());
        expect(min.data?.tracks).toEqual([]);
        expect(min.data?.totalTracks).toBe(0);
        expect(min.data?.owner).toBe('');
        expect(min.data?.description).toBeUndefined();

        await callRaw(new SpotifyGetPlaylistTool(cfg), { playlistId: 'pl1' });
        expect(fetched().calls[0][0]).toContain('limit=20');
    });

    it('current playback full/minimal/null via 204', async () => {
        spotifyStub();
        const full = await new SpotifyGetCurrentPlaybackTool(cfg).execute({}, ctx());
        expect(full.data?.isPlaying).toBe(true);
        expect(full.data?.track?.id).toBe('tr1');
        expect(full.data?.deviceName).toBe('Phone');
        expect(full.data?.progressMs).toBe(10);
        expect(full.data?.shuffleState).toBe(false);

        globalThis.fetch = stubFetch(() => json({ is_playing: false }));
        const min = await new SpotifyGetCurrentPlaybackTool(cfg).execute({}, ctx());
        expect(min.data?.track).toBeUndefined();
        expect(min.data?.deviceName).toBeUndefined();
        expect(min.data?.progressMs).toBeUndefined();
        expect(min.data?.shuffleState).toBeUndefined();

        globalThis.fetch = stubFetch(() => new Response(null, { status: 204 }));
        expect((await new SpotifyGetCurrentPlaybackTool(cfg).execute({}, ctx())).data).toBeNull();
    });

    it('play/pause/skip/addToQueue optional branches', async () => {
        spotifyStub();
        expect((await new SpotifyPlayTool(cfg).execute({
            uris: ['spotify:track:tr1'], contextUri: 'spotify:album:a', deviceId: 'd1', positionMs: 0,
        }, ctx())).data?.success).toBe(true);
        expect((await new SpotifyPlayTool(cfg).execute({}, ctx())).data?.success).toBe(true);
        expect((await new SpotifyPauseTool(cfg).execute({ deviceId: 'd1' }, ctx())).data?.success).toBe(true);
        expect((await new SpotifyPauseTool(cfg).execute({}, ctx())).data?.success).toBe(true);
        expect((await new SpotifySkipTool(cfg).execute({ direction: 'next', deviceId: 'd1' }, ctx())).data?.success).toBe(true);
        expect((await new SpotifySkipTool(cfg).execute({ direction: 'previous' }, ctx())).data?.success).toBe(true);
        expect((await new SpotifyAddToQueueTool(cfg).execute({ uri: 'u', deviceId: 'd1' }, ctx())).data?.success).toBe(true);
        expect((await new SpotifyAddToQueueTool(cfg).execute({ uri: 'u' }, ctx())).data?.success).toBe(true);
    });

    it('getUserPlaylists full + minimal', async () => {
        spotifyStub();
        const full = await new SpotifyGetUserPlaylistsTool(cfg).execute({ limit: 5 }, ctx());
        expect(full.data?.playlists[0]).toMatchObject({ id: 'pl1', trackCount: 1, owner: 'me', public: true });

        globalThis.fetch = stubFetch(() => json({ items: [{ id: 'a', name: 'n' }] }));
        const min = await new SpotifyGetUserPlaylistsTool(cfg).execute({}, ctx());
        expect(min.data?.playlists[0]).toMatchObject({ trackCount: 0, owner: '' });
        expect(min.data?.playlists[0].public).toBeUndefined();

        globalThis.fetch = stubFetch(() => json({}));
        const none = await new SpotifyGetUserPlaylistsTool(cfg).execute({}, ctx());
        expect(none.data?.playlists).toEqual([]);

        await callRaw(new SpotifyGetUserPlaylistsTool(cfg), {});
        expect(fetched().calls[0][0]).toContain('limit=20');
    });
});

// ── Twitter ────────────────────────────────────────────────────────────────

describe('Twitter coverage', () => {
    const cfg = { bearerToken: 'b', accessToken: 'at' };

    it('token throw + env fallback + toolkit', async () => {
        const b = saveEnv('X_BEARER_TOKEN');
        const a = saveEnv('X_ACCESS_TOKEN');
        const missing = await new TwitterSearchTweetsTool({}).execute({ query: 'q' }, ctx());
        expect(missing.success).toBe(false);
        expect(missing.error?.message).toMatch(/X_BEARER_TOKEN/);
        const missingPost = await new TwitterPostTweetTool({}).execute({ text: 'hi' }, ctx());
        expect(missingPost.success).toBe(false);
        expect(missingPost.error?.message).toMatch(/X_ACCESS_TOKEN/);
        if (b !== undefined) process.env['X_BEARER_TOKEN'] = b;
        if (a !== undefined) process.env['X_ACCESS_TOKEN'] = a;

        process.env['X_BEARER_TOKEN'] = 'ebb';
        process.env['X_ACCESS_TOKEN'] = 'eat';
        globalThis.fetch = stubFetch(() => json({}));
        expect((await new TwitterGetTweetTool({}).execute({ tweetId: '1' }, ctx())).success).toBe(true);
        expect((await new TwitterPostTweetTool({}).execute({ text: 'hi' }, ctx())).success).toBe(true);
        delete process.env['X_BEARER_TOKEN'];
        delete process.env['X_ACCESS_TOKEN'];
        if (b !== undefined) process.env['X_BEARER_TOKEN'] = b;
        if (a !== undefined) process.env['X_ACCESS_TOKEN'] = a;

        expect(new TwitterToolkit(cfg).getTools()).toHaveLength(5);
    });

    it('search/getTweet/default fields via raw', async () => {
        globalThis.fetch = stubFetch(() => json({ data: [] }));
        await new TwitterSearchTweetsTool(cfg).execute({ query: 'q', startTime: '2024-01-01', endTime: '2024-01-02' }, ctx());
        expect(fetched().calls[0][0]).toContain('start_time=');
        expect(fetched().calls[0][0]).toContain('end_time=');

        await callRaw(new TwitterSearchTweetsTool(cfg), { query: 'q' });
        expect(fetched().calls[1][0]).toContain('max_results=10');
        expect(fetched().calls[1][0]).toContain('tweet.fields=created_at%2Cauthor_id%2Cpublic_metrics%2Clang');

        await new TwitterSearchTweetsTool(cfg).execute({ query: 'q' }, ctx());
        expect(fetched().calls[2][0]).not.toContain('start_time=');

        await callRaw(new TwitterGetTweetTool(cfg), { tweetId: '1' });
        expect(fetched().calls[3][0]).toContain('tweet.fields=');
    });

    it('postTweet optional branches (reply/quote/poll)', async () => {
        globalThis.fetch = stubFetch(() => json({ data: { id: '1' } }));
        const full = await new TwitterPostTweetTool(cfg).execute({
            text: 'hi', replyToTweetId: '9', quoteTweetId: '8',
            poll: { options: ['a', 'b'], durationMinutes: 60 },
        }, ctx());
        expect(full.success).toBe(true);

        await new TwitterPostTweetTool(cfg).execute({ text: 'plain' }, ctx());
        const bodies = fetched().calls.map((c: any) => JSON.parse(String((c[1] as RequestInit).body)));
        const last = bodies[bodies.length - 1];
        expect(last['reply']).toBeUndefined();
        expect(last['quote_tweet_id']).toBeUndefined();
        expect(last['poll']).toBeUndefined();
    });

    it('getUser/getUserTimeline raw defaults + error path', async () => {
        globalThis.fetch = stubFetch(() => json({ data: {} }));
        await callRaw(new TwitterGetUserTool(cfg), { username: 'u' });
        expect(fetched().calls[0][0]).toContain('user.fields=');

        await callRaw(new TwitterGetUserTimelineTool(cfg), { userId: '1' });
        expect(fetched().calls[1][0]).toContain('max_results=10');

        await new TwitterGetUserTimelineTool(cfg).execute({
            userId: '1', excludeReplies: true, excludeRetweets: true,
        }, ctx());
        expect(fetched().calls[2][0]).toContain('exclude=replies%2Cretweets');

        await new TwitterGetUserTimelineTool(cfg).execute({ userId: '1' }, ctx());
        expect(fetched().calls[3][0]).not.toContain('exclude=');

        globalThis.fetch = stubFetch(() => rawRes(429, 'rate'));
        expect((await new TwitterSearchTweetsTool(cfg).execute({ query: 'q' }, ctx())).success).toBe(false);
    });
});

// ── Xquik ──────────────────────────────────────────────────────────────────

describe('Xquik coverage', () => {
    const cfg = { apiKey: 'k' };

    it('empty-body + non-JSON + error-body variants', async () => {
        globalThis.fetch = stubFetch(() => new Response('', { status: 200 }));
        const empty = await new XquikSearchPostsTool(cfg).execute({ query: 'q' }, ctx());
        expect(empty.success).toBe(true);
        expect(empty.data).toBeUndefined();

        globalThis.fetch = stubFetch(() => rawRes(200, 'raw'));
        expect((await new XquikSearchPostsTool(cfg).execute({ query: 'q' }, ctx())).data).toBe('raw');

        globalThis.fetch = stubFetch(() => rawRes(500, 'err'));
        const nonRecord = await new XquikSearchPostsTool(cfg).execute({ query: 'q' }, ctx());
        expect(nonRecord.success).toBe(false);
        expect(nonRecord.error?.message).toContain('Xquik API 500: err');

        globalThis.fetch = stubFetch(() => json({ error: 123, message: 'denied' }, 402));
        const msg = await new XquikSearchPostsTool(cfg).execute({ query: 'q' }, ctx());
        expect(msg.error?.message).toContain('Xquik API 402: denied');

        globalThis.fetch = stubFetch(() => json({ error: 123 }, 402));
        const noMsg = await new XquikSearchPostsTool(cfg).execute({ query: 'q' }, ctx());
        expect(noMsg.error?.message).toContain('Xquik API 402:');

        globalThis.fetch = stubFetch(() => new Response('', { status: 402 }));
        const emptyErr = await new XquikSearchPostsTool(cfg).execute({ query: 'q' }, ctx());
        expect(emptyErr.error?.message).toContain('Xquik API 402: Request failed');
    });

    it('trends raw defaults', async () => {
        globalThis.fetch = stubFetch(() => json({ trends: [] }));
        await callRaw(new XquikTrendsTool(cfg), {});
        expect(fetched().calls[0][0]).toContain('woeid=1');
        expect(fetched().calls[0][0]).toContain('count=30');
        expect(new XquikToolkit(cfg).getTools()).toHaveLength(3);
    });
});
// ── OpenAI ─────────────────────────────────────────────────────────────────

function openaiStub(o: {
    imgStatus?: number;
    imgErr?: Record<string, unknown>;
    emptyData?: boolean;
    audioFetchStatus?: number;
    transcribeStatus?: number;
    transcribeErr?: Record<string, unknown>;
    text?: string;
} = {}) {
    return stubFetch((url) => {
        if (!url.startsWith('https://api.openai.com/v1')) {
            if (o.audioFetchStatus && o.audioFetchStatus !== 200) return rawRes(o.audioFetchStatus, 'no-au');
            return rawRes(200, 'mp3-bytes');
        }
        if (url.includes('/images/generations')) {
            if (o.imgStatus && o.imgStatus !== 200) {
                if (o.imgErr) return json({ error: o.imgErr }, o.imgStatus);
                return json({}, o.imgStatus);
            }
            if (o.emptyData) return json({ data: [] });
            return json({ data: [{ url: 'http://img', b64_json: 'b64' }] });
        }
        if (url.includes('/audio/transcriptions')) {
            if (o.transcribeStatus && o.transcribeStatus !== 200) {
                if (o.transcribeErr) return json({ error: o.transcribeErr }, o.transcribeStatus);
                return json({}, o.transcribeStatus);
            }
            return json({ text: o.text ?? 'hello' });
        }
        return rawRes(200, '');
    });
}

describe('OpenAI coverage', () => {
    const baseCfg = { apiKey: 'k' };

    it('apiKey required throw + env fallback', async () => {
        const prev = saveEnv('OPENAI_API_KEY');
        expect(() => new OpenAIGenerateImageTool({})).toThrow(/OPENAI_API_KEY/);
        expect(() => new OpenAITranscribeAudioTool({})).toThrow(/OPENAI_API_KEY/);

        process.env['OPENAI_API_KEY'] = 'envk';
        openaiStub();
        expect((await new OpenAIGenerateImageTool({}).execute({ prompt: 'p' }, ctx())).success).toBe(true);
        delete process.env['OPENAI_API_KEY'];
        if (prev !== undefined) process.env['OPENAI_API_KEY'] = prev;
    });

    it('generate image dall-e-3 success + dall-e-2 skip quality', async () => {
        openaiStub();
        const full = await new OpenAIGenerateImageTool(baseCfg).execute({
            prompt: 'p', size: '1024x1024', quality: 'hd', style: 'natural', model: 'dall-e-3',
        }, ctx());
        expect(full.data?.data).toMatchObject({ url: 'http://img', b64_json: 'b64', prompt: 'p' });

        const img = await new OpenAIGenerateImageTool(baseCfg).execute({ prompt: 'p', model: 'dall-e-2' }, ctx());
        expect(img.success).toBe(true);
    });

    it('generation API/empty-data/throw errors', async () => {
        openaiStub({ imgStatus: 500, imgErr: { message: 'boom' } });
        const e1 = await new OpenAIGenerateImageTool(baseCfg).execute({ prompt: 'p' }, ctx());
        expect(e1.data?.error).toBe('boom');

        openaiStub({ imgStatus: 400 });
        const e2 = await new OpenAIGenerateImageTool(baseCfg).execute({ prompt: 'p' }, ctx());
        expect(e2.data?.error).toMatch(/OpenAI API error: 400/);

        openaiStub({ emptyData: true });
        const e3 = await new OpenAIGenerateImageTool(baseCfg).execute({ prompt: 'p' }, ctx());
        expect(e3.data?.error).toMatch(/No image data/);

        globalThis.fetch = stubFetch(() => { throw new Error('net'); });
        expect((await new OpenAIGenerateImageTool(baseCfg).execute({ prompt: 'p' }, ctx())).data?.error).toBe('net');

        globalThis.fetch = stubFetch(() => { throw 'str'; });
        expect((await new OpenAIGenerateImageTool(baseCfg).execute({ prompt: 'p' }, ctx())).data?.error).toBe('Unknown error occurred');
    });

    it('openAIRequest default options arm + constructor name/description/category defaults', async () => {
        openaiStub();
        const t: any = new OpenAIGenerateImageTool(baseCfg);
        await t.openAIRequest('/images/generations');

        const named = new OpenAIGenerateImageTool({ apiKey: 'k', name: 'MyImg', description: 'd', category: ToolCategory.AI });
        expect(named.name).toBe('MyImg');
        // empty-string name/description exercise the base-class `||` RHS fallbacks
        // (`...config` then re-spreads the empty strings back over the computed defaults)
        expect(new OpenAIGenerateImageTool({ apiKey: 'k', name: '', description: '' }).name).toBe('');
        expect(new OpenAIGenerateImageTool(baseCfg).name).toBe('openai_generate_image');
        expect(new OpenAITranscribeAudioTool(baseCfg).name).toBe('openai_transcribe_audio');
    });

    it('transcribe with/without language + audio/endpoint errors', async () => {
        openaiStub();
        const ok1 = await new OpenAITranscribeAudioTool(baseCfg).execute({
            audio_url: 'http://audio', model: 'whisper-1', language: 'en',
        }, ctx());
        expect(ok1.data?.data).toEqual({ text: 'hello' });
        const ok2 = await new OpenAITranscribeAudioTool(baseCfg).execute({ audio_url: 'http://audio', model: 'whisper-1' }, ctx());
        expect(ok2.success).toBe(true);

        openaiStub({ audioFetchStatus: 500 });
        const f = await new OpenAITranscribeAudioTool(baseCfg).execute({ audio_url: 'http://audio', model: 'whisper-1' }, ctx());
        expect(f.data?.error).toMatch(/Failed to fetch audio: 500/);

        openaiStub({ transcribeStatus: 500, transcribeErr: { message: 'tr-boom' } });
        const s1 = await new OpenAITranscribeAudioTool(baseCfg).execute({ audio_url: 'http://audio', model: 'whisper-1' }, ctx());
        expect(s1.data?.error).toBe('tr-boom');

        openaiStub({ transcribeStatus: 422 });
        const s2 = await new OpenAITranscribeAudioTool(baseCfg).execute({ audio_url: 'http://audio', model: 'whisper-1' }, ctx());
        expect(s2.data?.error).toMatch(/OpenAI API error: 422/);

        globalThis.fetch = stubFetch(() => { throw 'str2'; });
        expect((await new OpenAITranscribeAudioTool(baseCfg).execute({ audio_url: 'http://audio', model: 'whisper-1' }, ctx())).data?.error).toBe('Unknown error occurred');
    });

    it('toolkit create option branches', () => {
        expect(OpenAIToolkit.create({ apiKey: 'k', enableImageGeneration: false, enableTranscription: false })).toHaveLength(0);
        expect(OpenAIToolkit.create({ apiKey: 'k', enableImageGeneration: false })).toHaveLength(1);
        expect(OpenAIToolkit.create({ apiKey: 'k', enableTranscription: false })).toHaveLength(1);
        expect(OpenAIToolkit.create({ apiKey: 'k' })).toHaveLength(2);

        const prev = saveEnv('OPENAI_API_KEY');
        process.env['OPENAI_API_KEY'] = 'envk';
        expect(OpenAIToolkit.create()).toHaveLength(2);
        delete process.env['OPENAI_API_KEY'];
        if (prev !== undefined) process.env['OPENAI_API_KEY'] = prev;
    });
});

// ── SerpApi ────────────────────────────────────────────────────────────────

describe('SerpApi coverage', () => {
    const baseCfg = { apiKey: 'k' };

    it('apiKey required throw + env fallback + constructor defaults', async () => {
        const prev = saveEnv('SERPAPI_API_KEY');
        expect(() => new SerpApiGoogleSearchTool({})).toThrow(/SERPAPI_API_KEY/);
        expect(() => new SerpApiYouTubeSearchTool({})).toThrow(/SERPAPI_API_KEY/);

        process.env['SERPAPI_API_KEY'] = 'envk';
        globalThis.fetch = stubFetch(() => json({}));
        expect((await new SerpApiGoogleSearchTool({}).execute({ query: 'q' }, ctx())).success).toBe(true);
        delete process.env['SERPAPI_API_KEY'];
        if (prev !== undefined) process.env['SERPAPI_API_KEY'] = prev;

        const named = new SerpApiGoogleSearchTool({ apiKey: 'k', name: 'G', description: 'D', category: ToolCategory.WEB });
        expect(named.name).toBe('G');
        // empty-string name/description exercise the base-class `||` RHS fallbacks
        // (`...config` then re-spreads the empty strings back over the computed defaults)
        expect(new SerpApiGoogleSearchTool({ apiKey: 'k', name: '', description: '' }).name).toBe('');
        expect(new SerpApiGoogleSearchTool(baseCfg).name).toBe('serpapi_google_search');
        expect(new SerpApiYouTubeSearchTool(baseCfg).name).toBe('serpapi_youtube_search');
    });

    it('google search full + no-organic + errors', async () => {
        globalThis.fetch = stubFetch(() => json({
            organic_results: [{ title: 't', link: 'l', snippet: 's', displayed_link: 'd' }],
            knowledge_graph: { k: 1 }, related_questions: [{ r: 1 }],
        }));
        const full = await new SerpApiGoogleSearchTool(baseCfg).execute({ query: 'q' }, ctx());
        expect(full.data?.data).toMatchObject({ search_results: [{ title: 't', url: 'l', snippet: 's', displayed_link: 'd' }], knowledge_graph: { k: 1 } });

        globalThis.fetch = stubFetch(() => json({}));
        const none = await new SerpApiGoogleSearchTool(baseCfg).execute({ query: 'q', num_results: 5 }, ctx());
        expect(none.data?.data).toMatchObject({ search_results: [] });

        globalThis.fetch = stubFetch(() => rawRes(500, 'x'));
        expect((await new SerpApiGoogleSearchTool(baseCfg).execute({ query: 'q' }, ctx())).data?.error).toMatch(/SerpApi error: 500/);

        globalThis.fetch = stubFetch(() => { throw 'gb'; });
        expect((await new SerpApiGoogleSearchTool(baseCfg).execute({ query: 'q' }, ctx())).data?.error).toBe('Unknown error occurred');
    });

    it('youtube search full + no-results + errors', async () => {
        globalThis.fetch = stubFetch(() => json({
            video_results: [{ title: 'v', link: 'l', snippet: 's', thumbnail: 'th', duration: '1:00' }],
            channel_results: [{ title: 'c', link: 'l', thumbnail: 'th' }],
        }));
        const full = await new SerpApiYouTubeSearchTool(baseCfg).execute({ query: 'q' }, ctx());
        expect(full.data?.data).toMatchObject({
            video_results: [{ title: 'v', url: 'l', snippet: 's', thumbnail: 'th', duration: '1:00' }],
            channel_results: [{ title: 'c', url: 'l', thumbnail: 'th' }],
        });

        globalThis.fetch = stubFetch(() => json({}));
        const none = await new SerpApiYouTubeSearchTool(baseCfg).execute({ query: 'q', num_results: 3 }, ctx());
        expect(none.data?.data).toMatchObject({ video_results: [], channel_results: [] });

        globalThis.fetch = stubFetch(() => rawRes(400, 'x'));
        expect((await new SerpApiYouTubeSearchTool(baseCfg).execute({ query: 'q' }, ctx())).data?.error).toMatch(/SerpApi error: 400/);

        globalThis.fetch = stubFetch(() => { throw 'yb'; });
        expect((await new SerpApiYouTubeSearchTool(baseCfg).execute({ query: 'q' }, ctx())).data?.error).toBe('Unknown error occurred');
    });

    it('toolkit create option branches', () => {
        expect(SerpApiToolkit.create({ apiKey: 'k', enableGoogleSearch: false, enableYouTubeSearch: false })).toHaveLength(0);
        expect(SerpApiToolkit.create({ apiKey: 'k', enableGoogleSearch: false })).toHaveLength(1);
        expect(SerpApiToolkit.create({ apiKey: 'k', enableYouTubeSearch: false })).toHaveLength(1);
        expect(SerpApiToolkit.create({ apiKey: 'k' })).toHaveLength(2);

        const prev = saveEnv('SERPAPI_API_KEY');
        process.env['SERPAPI_API_KEY'] = 'envk';
        expect(SerpApiToolkit.create()).toHaveLength(2);
        delete process.env['SERPAPI_API_KEY'];
        if (prev !== undefined) process.env['SERPAPI_API_KEY'] = prev;
    });
});
