/**
 * Hermetic 100% coverage for the remaining productivity tools:
 * Google Drive, Google Sheets, Jira, Linear, Notion, Todoist, Trello —
 * plus residual branch coverage for ClickUp / Confluence / Google Calendar
 * that the companion test (coverage-tools-productivity.test.ts) leaves open.
 *
 * All tools are fetch-based, so every call is stubbed via globalThis.fetch.
 * Where a schema default makes a `?? fallback` branch unreachable through
 * execute() (zod applies defaults during validation), `callRaw` invokes the
 * tool's real protected performExecute with raw, un-validated input so that
 * code path executes.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
    GoogleDriveListFilesTool,
    GoogleDriveGetFileTool,
    GoogleDriveCreateFolderTool,
    GoogleDriveDeleteFileTool,
    GoogleDriveMoveFileTool,
    GoogleDriveShareFileTool,
    GoogleDriveToolkit,
} from '../src/tools/productivity/google-drive.js';
import {
    GoogleSheetsGetValuesTool,
    GoogleSheetsUpdateValuesTool,
    GoogleSheetsAppendValuesTool,
    GoogleSheetsClearValuesTool,
    GoogleSheetsGetSheetInfoTool,
    GoogleSheetsBatchGetTool,
    GoogleSheetsToolkit,
} from '../src/tools/productivity/google-sheets.js';
import {
    JiraGetIssueTool,
    JiraCreateIssueTool,
    JiraSearchIssuesTool,
    JiraAddCommentTool,
    JiraToolkit,
} from '../src/tools/productivity/jira.js';
import {
    LinearCreateIssueTool,
    LinearGetIssueTool,
    LinearSearchIssuesTool,
    LinearUpdateIssueTool,
    LinearAddCommentTool,
    LinearListTeamsTool,
    LinearToolkit,
} from '../src/tools/productivity/linear.js';
import {
    NotionCreatePageTool,
    NotionSearchTool,
    NotionUpdatePageTool,
    NotionToolkit,
} from '../src/tools/productivity/notion.js';
import {
    TodoistUpdateTaskTool,
    TodoistCreateTaskTool,
    TodoistGetTasksTool,
    TodoistCompleteTaskTool,
    TodoistToolkit,
} from '../src/tools/productivity/todoist.js';
import {
    TrelloGetBoardsTool,
    TrelloGetBoardTool,
    TrelloGetCardsTool,
    TrelloCreateCardTool,
    TrelloUpdateCardTool,
    TrelloAddCommentTool,
    TrelloCreateListTool,
    TrelloToolkit,
} from '../src/tools/productivity/trello.js';
import {
    ClickUpGetWorkspacesTool,
    ClickUpGetSpacesTool,
    ClickUpGetListsTool,
    ClickUpGetTasksTool,
    ClickUpCreateTaskTool,
    ClickUpUpdateTaskTool,
    ClickUpSearchTasksTool,
} from '../src/tools/productivity/clickup.js';
import {
    ConfluenceSearchPagesTool,
    ConfluenceGetPageTool,
    ConfluenceCreatePageTool,
    ConfluenceUpdatePageTool,
    ConfluenceGetSpacesTool,
    ConfluenceGetChildPagesTool,
} from '../src/tools/productivity/confluence.js';
import {
    GoogleCalendarListEventsTool,
    GoogleCalendarCreateEventTool,
    GoogleCalendarUpdateEventTool,
    GoogleCalendarDeleteEventTool,
    GoogleCalendarGetEventTool,
} from '../src/tools/productivity/google-calendar.js';
import { ToolCategory, type ToolContext } from '../src/tools/core/types.js';

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

/**
 * Invoke a tool's real protected performExecute with raw input, bypassing the
 * schema-validation layer so zod `.default()` values are NOT injected. This
 * exercises the `x ?? fallback` branches whose fallback is shadowed by a
 * schema default during normal `execute()` calls.
 */
function callRaw(tool: object, input: unknown): Promise<unknown> {
    const t = tool as unknown as { performExecute(i: unknown, c: ToolContext): Promise<unknown> };
    return t.performExecute.call(tool, input, ctx());
}

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

// ──────────────────────────────── Google Drive ────────────────────────────────

describe('Google Drive tools', () => {
    const cfg = { accessToken: 'tok' };

    it('requires token (config empty + env missing)', async () => {
        const prev = process.env['GOOGLE_ACCESS_TOKEN'];
        delete process.env['GOOGLE_ACCESS_TOKEN'];
        const r = await new GoogleDriveListFilesTool({}).execute({}, ctx());
        expect(r.success).toBe(false);
        if (prev !== undefined) process.env['GOOGLE_ACCESS_TOKEN'] = prev; else delete process.env['GOOGLE_ACCESS_TOKEN'];
    });

    it('uses env token', async () => {
        const prev = process.env['GOOGLE_ACCESS_TOKEN'];
        process.env['GOOGLE_ACCESS_TOKEN'] = 'envtok';
        globalThis.fetch = vi.fn(async () => json({ files: [] })) as typeof fetch;
        const r = await new GoogleDriveListFilesTool({}).execute({}, ctx());
        expect(r.success).toBe(true);
        if (prev !== undefined) process.env['GOOGLE_ACCESS_TOKEN'] = prev; else delete process.env['GOOGLE_ACCESS_TOKEN'];
    });

    it('list files: query/folderId branches and defaults via raw performExecute', async () => {
        const tool = new GoogleDriveListFilesTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ files: [{ id: 'f1', name: 'A' }] })) as typeof fetch;

        const both = await tool.execute({ query: 'name contains "x"', folderId: 'fld', includeItemsFromAllDrives: true }, ctx());
        expect(both.data?.files?.[0]?.id).toBe('f1');

        await tool.execute({ query: 'q' }, ctx());
        await tool.execute({ folderId: 'fld' }, ctx());
        await tool.execute({}, ctx());

        // Un-validated input: pageSize/orderBy/includeItemsFromAllDrives fallbacks
        const rawRes = await callRaw(tool, { pageSize: undefined, orderBy: undefined, includeItemsFromAllDrives: undefined });
        expect(rawRes).toEqual({ files: [{ id: 'f1', name: 'A' }] });
    });

    it('get file: default fields + custom fields', async () => {
        const tool = new GoogleDriveGetFileTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ id: 'f1', name: 'N' })) as typeof fetch;
        expect((await tool.execute({ fileId: 'f1' }, ctx())).data?.id).toBe('f1');
        expect((await tool.execute({ fileId: 'f1', fields: 'id' }, ctx())).data?.id).toBe('f1');
        const rawRes = await callRaw(tool, { fileId: 'f1' });
        expect(rawRes).toEqual({ id: 'f1', name: 'N' });
    });

    it('create folder: with and without parent', async () => {
        const tool = new GoogleDriveCreateFolderTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ id: 'fld1' })) as typeof fetch;
        expect((await tool.execute({ name: 'New', parentId: 'p1' }, ctx())).data?.id).toBe('fld1');
        expect((await tool.execute({ name: 'Solo' }, ctx())).data?.id).toBe('fld1');
    });

    it('delete file: 204 → success', async () => {
        const tool = new GoogleDriveDeleteFileTool(cfg);
        globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch;
        const r = await tool.execute({ fileId: 'f1' }, ctx());
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ success: true });
    });

    it('move file: removeParents variants', async () => {
        const tool = new GoogleDriveMoveFileTool(cfg);
        globalThis.fetch = vi.fn(async (url) => {
            const u = String(url);
            if (u.includes('fields=parents') && !u.includes('removeParents')) return json({ parents: ['p1', 'p2'] });
            return json({ id: 'f1' });
        }) as typeof fetch;
        expect((await tool.execute({ fileId: 'f1', newParentId: 'np', removeFromCurrentFolder: true }, ctx())).success).toBe(true);
        expect((await tool.execute({ fileId: 'f1', newParentId: 'np', removeFromCurrentFolder: false }, ctx())).success).toBe(true);

        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        expect((await tool.execute({ fileId: 'f1', newParentId: 'np', removeFromCurrentFolder: true }, ctx())).success).toBe(true);
    });

    it('share file: role/type defaults and emailAddress branches', async () => {
        const tool = new GoogleDriveShareFileTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ id: 'perm1' })) as typeof fetch;
        expect((await tool.execute({ fileId: 'f1', email: 'a@b.com', role: 'writer' }, ctx())).success).toBe(true);
        expect((await tool.execute({ fileId: 'f1', email: 'a@b.com', type: 'domain' }, ctx())).success).toBe(true);
        expect((await tool.execute({ fileId: 'f1', type: 'anyone' }, ctx())).success).toBe(true);

        const rawRes = await callRaw(tool, { fileId: 'f1' });
        expect(rawRes).toEqual({ id: 'perm1' });
    });

    it('error path and toolkit', async () => {
        const tool = new GoogleDriveGetFileTool(cfg);
        globalThis.fetch = vi.fn(async () => new Response('denied', { status: 403 })) as typeof fetch;
        expect((await tool.execute({ fileId: 'f1' }, ctx())).success).toBe(false);

        const tk = new GoogleDriveToolkit(cfg);
        expect(tk.getTools()).toHaveLength(6);
    });
});

// ──────────────────────────────── Google Sheets ───────────────────────────────

describe('Google Sheets tools', () => {
    const cfg = { accessToken: 'tok' };

    it('requires token via env and error handling', async () => {
        const prev = process.env['GOOGLE_SHEETS_ACCESS_TOKEN'];
        delete process.env['GOOGLE_SHEETS_ACCESS_TOKEN'];
        expect((await new GoogleSheetsGetValuesTool({}).execute({ spreadsheetId: 's', range: 'A1' }, ctx())).success).toBe(false);
        process.env['GOOGLE_SHEETS_ACCESS_TOKEN'] = 'envtok';
        globalThis.fetch = vi.fn(async () => json({ range: 'A1', values: [] })) as typeof fetch;
        expect((await new GoogleSheetsGetValuesTool({}).execute({ spreadsheetId: 's', range: 'A1' }, ctx())).success).toBe(true);
        if (prev !== undefined) process.env['GOOGLE_SHEETS_ACCESS_TOKEN'] = prev; else delete process.env['GOOGLE_SHEETS_ACCESS_TOKEN'];
    });

    it('get values: majorDimension branches, missing values, defaults', async () => {
        const tool = new GoogleSheetsGetValuesTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ range: 'A1', values: [['x']] })) as typeof fetch;
        const r1 = await tool.execute({ spreadsheetId: 's', range: 'A1' }, ctx());
        expect(r1.data?.rowCount).toBe(1);
        const r2 = await tool.execute({ spreadsheetId: 's', range: 'A1', majorDimension: 'COLUMNS' }, ctx());
        expect(r2.data?.rowCount).toBe(1);

        globalThis.fetch = vi.fn(async () => json({ range: 'A1' })) as typeof fetch;
        const r3 = await tool.execute({ spreadsheetId: 's', range: 'A1' }, ctx());
        expect(r3.data?.values).toEqual([]);

        const raw = await callRaw(tool, { spreadsheetId: 's', range: 'A1' });
        expect(raw).toBeTruthy();
    });

    it('update values: both valueInputOption paths, error', async () => {
        const tool = new GoogleSheetsUpdateValuesTool(cfg);
        globalThis.fetch = vi.fn(async () => json({
            updatedRange: 'A1', updatedRows: 1, updatedColumns: 2, updatedCells: 2,
        })) as typeof fetch;
        const r1 = await tool.execute({ spreadsheetId: 's', range: 'A1', values: [['a', 'b']] }, ctx());
        expect(r1.data?.updatedCells).toBe(2);
        const r2 = await tool.execute({ spreadsheetId: 's', range: 'A1', values: [['a']], valueInputOption: 'RAW' }, ctx());
        expect(r2.data?.updatedRows).toBe(1);

        const raw = await callRaw(tool, { spreadsheetId: 's', range: 'A1', values: [['a']] });
        expect(raw).toBeTruthy();

        globalThis.fetch = vi.fn(async () => new Response('x', { status: 400 })) as typeof fetch;
        expect((await tool.execute({ spreadsheetId: 's', range: 'A1', values: [['a']] }, ctx())).success).toBe(false);
    });

    it('append values: updates fallback + raw default', async () => {
        const tool = new GoogleSheetsAppendValuesTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ tableRange: 'A1', updates: { updatedRows: 2, updatedCells: 4 } })) as typeof fetch;
        const r1 = await tool.execute({ spreadsheetId: 's', range: 'A1', values: [['a']] }, ctx());
        expect(r1.data?.updatedRows).toBe(2);
        const rawCall = await callRaw(tool, { spreadsheetId: 's', range: 'A1', values: [['a']] });
        expect(rawCall).toBeTruthy();

        globalThis.fetch = vi.fn(async () => json({ tableRange: 'A1' })) as typeof fetch;
        const r2 = await tool.execute({ spreadsheetId: 's', range: 'A1', values: [['a']] }, ctx());
        expect(r2.data?.updatedRows).toBe(0);
    });

    it('clear values + sheet info + batch get', async () => {
        const clear = new GoogleSheetsClearValuesTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ clearedRange: 'A1:C1' })) as typeof fetch;
        expect((await clear.execute({ spreadsheetId: 's', range: 'A1:C1' }, ctx())).data?.clearedRange).toBe('A1:C1');

        const info = new GoogleSheetsGetSheetInfoTool(cfg);
        globalThis.fetch = vi.fn(async () => json({
            properties: { title: 'Book' },
            sheets: [{ properties: { sheetId: 0, title: 'S1', gridProperties: { rowCount: 5, columnCount: 3 } } }],
        })) as typeof fetch;
        const infoRes = await info.execute({ spreadsheetId: 's' }, ctx());
        expect(infoRes.data?.title).toBe('Book');
        expect(infoRes.data?.sheets[0]?.sheetId).toBe(0);

        const batch = new GoogleSheetsBatchGetTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ valueRanges: [{ range: 'A1', values: [[1]] }, { range: 'B1' }] })) as typeof fetch;
        const b1 = await batch.execute({ spreadsheetId: 's', ranges: ['A1', 'B1'] }, ctx());
        expect(b1.data?.ranges).toHaveLength(2);
        expect(b1.data?.ranges[1]?.values).toEqual([]);

        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        const b2 = await batch.execute({ spreadsheetId: 's', ranges: ['A1'] }, ctx());
        expect(b2.data?.ranges).toEqual([]);
    });

    it('toolkit', () => {
        expect(new GoogleSheetsToolkit(cfg).tools).toHaveLength(6);
    });
});

// ──────────────────────────────── Jira ────────────────────────────────

describe('Jira tools', () => {
    const jcfg = { serverUrl: 'https://jira.example', token: 't', email: 'e@e.com' };

    it('constructor validation: serverUrl/token/email missing', () => {
        expect(() => new JiraGetIssueTool({})).toThrow(/JIRA_SERVER_URL/);
        expect(() => new JiraGetIssueTool({ serverUrl: 'u' })).toThrow(/JIRA_TOKEN/);
        expect(() => new JiraGetIssueTool({ serverUrl: 'u', token: 't' })).toThrow(/JIRA_EMAIL/);
    });

    it('constructor resolves credentials from env', () => {
        const sv = process.env['JIRA_SERVER_URL'];
        const tk = process.env['JIRA_TOKEN'];
        const em = process.env['JIRA_EMAIL'];
        process.env['JIRA_SERVER_URL'] = 'https://env.example';
        process.env['JIRA_TOKEN'] = 'tk';
        process.env['JIRA_EMAIL'] = 'env@e.com';
        const tool = new JiraGetIssueTool({});
        expect(tool).toBeInstanceOf(JiraGetIssueTool);
        if (sv !== undefined) process.env['JIRA_SERVER_URL'] = sv; else delete process.env['JIRA_SERVER_URL'];
        if (tk !== undefined) process.env['JIRA_TOKEN'] = tk; else delete process.env['JIRA_TOKEN'];
        if (em !== undefined) process.env['JIRA_EMAIL'] = em; else delete process.env['JIRA_EMAIL'];
    });

    it('constructor overrides with full config (name/description/category/permissions)', () => {
        const tool = new JiraGetIssueTool({
            serverUrl: 'u', token: 't', email: 'e',
            name: 'custom', description: 'custom desc', category: ToolCategory.DATA,
            permissions: { allowNetwork: false },
        });
        expect(tool.name).toBe('custom');
    });

    const issue = {
        key: 'PROJ-1',
        fields: {
            summary: 'Sum', description: 'Desc', status: { name: 'Open' },
            issuetype: { name: 'Task' },
            assignee: { displayName: 'Alice' }, reporter: { displayName: 'Bob' },
            project: { key: 'PROJ' },
        },
    };

    it('get issue: ok with assignee/reporter, without, not-ok, thrown non-Error', async () => {
        const tool = new JiraGetIssueTool(jcfg);

        globalThis.fetch = vi.fn(async () => json(issue)) as typeof fetch;
        const ok = await tool.execute({ issue_key: 'PROJ-1' }, ctx());
        expect(ok.data?.data?.assignee).toBe('Alice');
        expect(ok.data?.data?.reporter).toBe('Bob');

        globalThis.fetch = vi.fn(async () => json({
            key: 'PROJ-1',
            fields: { summary: 'S', status: { name: 'Open' }, issuetype: { name: 'Task' }, project: { key: 'P' } },
        })) as typeof fetch;
        expect((await tool.execute({ issue_key: 'PROJ-1' }, ctx())).data?.data?.assignee).toBeUndefined();

        globalThis.fetch = vi.fn(async () => new Response('nope', { status: 404 })) as typeof fetch;
        const nok = await tool.execute({ issue_key: 'PROJ-1' }, ctx());
        expect(nok.data?.error).toContain('404');

        globalThis.fetch = vi.fn(async () => { throw 'boom'; }) as typeof fetch;
        const thrown = await tool.execute({ issue_key: 'PROJ-1' }, ctx());
        expect(thrown.data?.error).toBe('Unknown error occurred');
    });

    it('create issue: ok and not-ok, thrown non-Error', async () => {
        const tool = new JiraCreateIssueTool(jcfg);
        globalThis.fetch = vi.fn(async () => json({ key: 'PROJ-2', self: 'u' })) as typeof fetch;
        const ok = await tool.execute({ project_key: 'PROJ', summary: 'S' }, ctx());
        expect(ok.data?.data?.url).toBe('https://jira.example/browse/PROJ-2');
        globalThis.fetch = vi.fn(async () => new Response('x', { status: 400 })) as typeof fetch;
        expect((await tool.execute({ project_key: 'PROJ', summary: 'S' }, ctx())).data?.error).toContain('400');
        globalThis.fetch = vi.fn(async () => { throw 'boom'; }) as typeof fetch;
        expect((await tool.execute({ project_key: 'PROJ', summary: 'S' }, ctx())).data?.error).toBe('Unknown error occurred');
    });

    it('search issues: assigned + unassigned + not-ok', async () => {
        const tool = new JiraSearchIssuesTool(jcfg);
        globalThis.fetch = vi.fn(async () => json({
            total: 2,
            issues: [
                { key: 'A-1', fields: { summary: 'a', status: { name: 'Open' }, assignee: { displayName: 'X' } } },
                { key: 'A-2', fields: { summary: 'b', status: { name: 'Open' } } },
            ],
        })) as typeof fetch;
        const ok = await tool.execute({ jql: 'project = P' }, ctx());
        expect(ok.data?.data?.total).toBe(2);
        expect(ok.data?.data?.issues[1]?.assignee).toBe('Unassigned');

        globalThis.fetch = vi.fn(async () => new Response('x', { status: 500 })) as typeof fetch;
        expect((await tool.execute({ jql: 'x' }, ctx())).data?.error).toContain('500');
        globalThis.fetch = vi.fn(async () => { throw 'boom'; }) as typeof fetch;
        expect((await tool.execute({ jql: 'x' }, ctx())).data?.error).toBe('Unknown error occurred');
    });

    it('add comment: ok and not-ok', async () => {
        const tool = new JiraAddCommentTool(jcfg);
        globalThis.fetch = vi.fn(async () => json({ id: 'c1' })) as typeof fetch;
        const ok = await tool.execute({ issue_key: 'P-1', comment: 'hi' }, ctx());
        expect(ok.data?.data?.commentId).toBe('c1');
        globalThis.fetch = vi.fn(async () => new Response('x', { status: 401 })) as typeof fetch;
        expect((await tool.execute({ issue_key: 'P-1', comment: 'hi' }, ctx())).data?.error).toContain('401');
        globalThis.fetch = vi.fn(async () => { throw 'boom'; }) as typeof fetch;
        expect((await tool.execute({ issue_key: 'P-1', comment: 'hi' }, ctx())).data?.error).toBe('Unknown error occurred');
    });

    it('empty name/description flows through to base fallback names', () => {
        new JiraGetIssueTool({ serverUrl: 'u', token: 't', email: 'e', name: '', description: '' });
        new JiraCreateIssueTool({ serverUrl: 'u', token: 't', email: 'e', name: '', description: '' });
        new JiraSearchIssuesTool({ serverUrl: 'u', token: 't', email: 'e', name: '', description: '' });
        new JiraAddCommentTool({ serverUrl: 'u', token: 't', email: 'e', name: '', description: '' });
    });

    it('toolkit: enabled by default, disabled flags, config transport', () => {
        expect(JiraToolkit.create({ serverUrl: 'u', token: 't', email: 'e' })).toHaveLength(4);
        expect(JiraToolkit.create({
            enableGetIssue: false, enableCreateIssue: false,
            enableSearchIssues: false, enableAddComment: false,
        })).toHaveLength(0);
        expect(() => JiraToolkit.create({ serverUrl: 'u' })).toThrow();
    });
});

// ──────────────────────────────── Linear ────────────────────────────────

describe('Linear tools', () => {
    const cfg = { apiKey: 'key' };

    it('requires key (empty + env)', async () => {
        const prev = process.env['LINEAR_API_KEY'];
        delete process.env['LINEAR_API_KEY'];
        expect((await new LinearGetIssueTool({}).execute({ issueId: 'i' }, ctx())).success).toBe(false);
        process.env['LINEAR_API_KEY'] = 'envkey';
        globalThis.fetch = vi.fn(async () => json({ data: { issue: { id: 'i', identifier: 'E', title: 'T', state: { name: 'Todo' }, priority: 0, url: 'u' } } })) as typeof fetch;
        expect((await new LinearGetIssueTool({}).execute({ issueId: 'i' }, ctx())).success).toBe(true);
        if (prev !== undefined) process.env['LINEAR_API_KEY'] = prev; else delete process.env['LINEAR_API_KEY'];
    });

    it('graphql error paths: http failure, graphql errors', async () => {
        const tool = new LinearListTeamsTool(cfg);
        globalThis.fetch = vi.fn(async () => new Response('gateway', { status: 502 })) as typeof fetch;
        const http = await tool.execute({}, ctx());
        expect(http.success).toBe(false);
        globalThis.fetch = vi.fn(async () => json({ errors: [{ message: 'boom' }] })) as typeof fetch;
        const graph = await tool.execute({}, ctx());
        expect(graph.success).toBe(false);
        expect(graph.error?.message).toContain('boom');
    });

    it('create / get / search / update / comment / teams', async () => {
        const create = new LinearCreateIssueTool(cfg);
        globalThis.fetch = vi.fn(async () => json({
            data: { issueCreate: { issue: { id: 'i1', identifier: 'ENG-1', title: 'T', url: 'u' } } },
        })) as typeof fetch;
        expect((await create.execute({ teamId: 'team1', title: 'T' }, ctx())).data?.id).toBe('i1');

        const get = new LinearGetIssueTool(cfg);
        globalThis.fetch = vi.fn(async () => json({
            data: { issue: { id: 'i1', identifier: 'ENG-1', title: 'T', description: 'd', state: { name: 'Todo' }, priority: 1, url: 'u' } },
        })) as typeof fetch;
        expect((await get.execute({ issueId: 'i1' }, ctx())).data?.state).toBe('Todo');

        const search = new LinearSearchIssuesTool(cfg);
        globalThis.fetch = vi.fn(async () => json({
            data: { issues: { nodes: [{ id: 'i1', identifier: 'E', title: 'T', state: { name: 'S' }, priority: 2 }] } },
        })) as typeof fetch;
        const withTeam = await search.execute({ query: 'q', teamId: 't1' }, ctx());
        expect(withTeam.data?.issues[0]?.id).toBe('i1');
        await search.execute({ query: 'q' }, ctx());
        const rawSearch = await callRaw(search, { query: 'q' });
        expect(rawSearch).toBeTruthy();

        const update = new LinearUpdateIssueTool(cfg);
        globalThis.fetch = vi.fn(async () => json({
            data: { issueUpdate: { success: true, issue: { id: 'i1' } } },
        })) as typeof fetch;
        expect((await update.execute({ issueId: 'i1', title: 'T2', description: 'd', priority: 3, stateId: 's1' }, ctx())).data?.success).toBe(true);

        const comment = new LinearAddCommentTool(cfg);
        globalThis.fetch = vi.fn(async () => json({
            data: { commentCreate: { success: true, comment: { id: 'c1' } } },
        })) as typeof fetch;
        expect((await comment.execute({ issueId: 'i1', body: 'note' }, ctx())).data?.id).toBe('c1');

        const teams = new LinearListTeamsTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ data: { teams: { nodes: [] } } })) as typeof fetch;
        expect((await teams.execute({}, ctx())).data?.teams).toHaveLength(0);
    });

    it('toolkit', () => {
        expect(new LinearToolkit(cfg).tools).toHaveLength(6);
    });
});

// ──────────────────────────────── Notion ────────────────────────────────

describe('Notion tools', () => {
    it('constructor validation: token missing', () => {
        expect(() => new NotionCreatePageTool({})).toThrow(/NOTION_API_TOKEN/);
    });

    it('constructor resolves token/databaseId from env', () => {
        const tk = process.env['NOTION_API_TOKEN'];
        const db = process.env['NOTION_DATABASE_ID'];
        process.env['NOTION_API_TOKEN'] = 'envtk';
        process.env['NOTION_DATABASE_ID'] = 'envdb';
        const tool = new NotionCreatePageTool({});
        expect(tool).toBeInstanceOf(NotionCreatePageTool);
        if (tk !== undefined) process.env['NOTION_API_TOKEN'] = tk; else delete process.env['NOTION_API_TOKEN'];
        if (db !== undefined) process.env['NOTION_DATABASE_ID'] = db; else delete process.env['NOTION_DATABASE_ID'];
    });

    it('constructor overrides name/description/category/permissions', () => {
        const tool = new NotionSearchTool({
            token: 't', name: 'custom', description: 'cd', category: ToolCategory.DATA,
            permissions: { maxExecutionTimeMs: 1000 },
        });
        expect(tool.name).toBe('custom');
    });

    it('create page: parent provided / inherited / missing db id', async () => {
        const tool = new NotionCreatePageTool({ token: 't' });
        globalThis.fetch = vi.fn(async () => json({ id: 'pg1', url: 'u', properties: {} })) as typeof fetch;
        const r1 = await tool.execute({ parent_database_id: 'db1', title: 'T', content: 'C' }, ctx());
        expect(r1.data?.data?.id).toBe('pg1');
        const toolDb = new NotionCreatePageTool({ token: 't', databaseId: 'dbcfg' });
        const r2 = await toolDb.execute({ title: 'T', content: 'C' }, ctx());
        expect(r2.data?.data?.url).toBe('u');
        const r3 = await tool.execute({ title: 'T', content: 'C' }, ctx());
        expect(r3.data?.error).toContain('Database ID is required');
    });

    it('create page: API error with/without message, thrown non-Error', async () => {
        const tool = new NotionCreatePageTool({ token: 't', databaseId: 'db' });

        globalThis.fetch = vi.fn(async () => json({ message: 'bad request' }, 400)) as typeof fetch;
        const withMsg = await tool.execute({ title: 'T', content: 'C' }, ctx());
        expect(withMsg.data?.error).toBe('bad request');

        globalThis.fetch = vi.fn(async () => json({}, 400)) as typeof fetch;
        const noMsg = await tool.execute({ title: 'T', content: 'C' }, ctx());
        expect(noMsg.data?.error).toContain('400');

        globalThis.fetch = vi.fn(async () => { throw 'boom'; }) as typeof fetch;
        const thrown = await tool.execute({ title: 'T', content: 'C' }, ctx());
        expect(thrown.data?.error).toBe('Unknown error occurred');
    });

    it('search: with/without filter, error variants', async () => {
        const tool = new NotionSearchTool({ token: 't' });
        globalThis.fetch = vi.fn(async () => json({
            results: [{ id: 'p1', url: 'u', properties: {} }],
        })) as typeof fetch;
        const withFilter = await tool.execute({ query: 'q', filter: 'page' }, ctx());
        expect(withFilter.data?.data?.count).toBe(1);
        const noFilter = await tool.execute({ query: 'q' }, ctx());
        expect(noFilter.data?.data?.results[0]?.id).toBe('p1');

        globalThis.fetch = vi.fn(async () => json({ message: 'err' }, 500)) as typeof fetch;
        expect((await tool.execute({ query: 'q' }, ctx())).data?.error).toBe('err');
        globalThis.fetch = vi.fn(async () => json({}, 500)) as typeof fetch;
        expect((await tool.execute({ query: 'q' }, ctx())).data?.error).toContain('500');
        globalThis.fetch = vi.fn(async () => { throw 'boom'; }) as typeof fetch;
        expect((await tool.execute({ query: 'q' }, ctx())).data?.error).toBe('Unknown error occurred');
    });

    it('update page: ok and error variants', async () => {
        const tool = new NotionUpdatePageTool({ token: 't' });
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        const ok = await tool.execute({ page_id: 'p1', content: 'C' }, ctx());
        expect(ok.data?.data?.pageId).toBe('p1');

        globalThis.fetch = vi.fn(async () => json({ message: 'x' }, 400)) as typeof fetch;
        expect((await tool.execute({ page_id: 'p1', content: 'C' }, ctx())).data?.error).toBe('x');
        globalThis.fetch = vi.fn(async () => json({}, 400)) as typeof fetch;
        expect((await tool.execute({ page_id: 'p1', content: 'C' }, ctx())).data?.error).toContain('400');
        globalThis.fetch = vi.fn(async () => { throw 'boom'; }) as typeof fetch;
        expect((await tool.execute({ page_id: 'p1', content: 'C' }, ctx())).data?.error).toBe('Unknown error occurred');
    });

    it('empty name/description flows through to base fallback names', () => {
        new NotionCreatePageTool({ token: 't', name: '', description: '' });
        new NotionSearchTool({ token: 't', name: '', description: '' });
        new NotionUpdatePageTool({ token: 't', name: '', description: '' });
    });

    it('toolkit', () => {
        expect(NotionToolkit.create({ token: 't', databaseId: 'db' })).toHaveLength(3);
        expect(NotionToolkit.create({ enableCreatePage: false, enableSearch: false, enableUpdatePage: false })).toHaveLength(0);
    });
});

// ──────────────────────────────── Todoist ────────────────────────────────

describe('Todoist tools', () => {
    const cfg = { apiToken: 'tok' };
    const fullTask = {
        id: 't1', content: 'Task', description: 'd', project_id: 'p1',
        due: { date: '2025-01-01', string: 'tomorrow' },
        priority: 2, is_completed: false, labels: ['l'], url: 'u',
    };
    const minTask = { id: 't2', content: 'Min', priority: 1, is_completed: true, labels: [], url: 'u' };

    it('requires token (empty + env)', async () => {
        const prev = process.env['TODOIST_API_TOKEN'];
        delete process.env['TODOIST_API_TOKEN'];
        expect((await new TodoistGetTasksTool({}).execute({}, ctx())).success).toBe(false);
        process.env['TODOIST_API_TOKEN'] = 'envtok';
        globalThis.fetch = vi.fn(async () => json([])) as typeof fetch;
        expect((await new TodoistGetTasksTool({}).execute({}, ctx())).success).toBe(true);
        if (prev !== undefined) process.env['TODOIST_API_TOKEN'] = prev; else delete process.env['TODOIST_API_TOKEN'];
    });

    it('create task: full + minimal mapping', async () => {
        const tool = new TodoistCreateTaskTool(cfg);
        globalThis.fetch = vi.fn(async () => json(fullTask)) as typeof fetch;
        const full = await tool.execute({
            content: 'Task', description: 'd', dueString: 'tomorrow', priority: 2,
            projectId: 'p1', labels: ['l'],
        }, ctx());
        expect(full.data?.description).toBe('d');
        expect(full.data?.due?.date).toBe('2025-01-01');
        globalThis.fetch = vi.fn(async () => json(minTask)) as typeof fetch;
        const min = await tool.execute({ content: 'Min' }, ctx());
        expect(min.data?.description).toBeUndefined();
        expect(min.data?.projectId).toBeUndefined();
        expect(min.data?.due).toBeUndefined();

        const rawMin = await callRaw(tool, { content: 'Min', priority: undefined });
        expect(rawMin).toBeTruthy();
    });

    it('get tasks: project+filter, empty params, limit default and given', async () => {
        const tool = new TodoistGetTasksTool(cfg);
        globalThis.fetch = vi.fn(async () => json([fullTask, minTask])) as typeof fetch;
        const withFilters = await tool.execute({ projectId: 'p1', filter: 'today', limit: 5 }, ctx());
        expect(withFilters.data?.count).toBe(2);
        const noFilters = await tool.execute({}, ctx());
        expect(noFilters.data?.count).toBe(2);
        const raw = await callRaw(tool, { limit: undefined });
        expect(raw).toBeTruthy();
    });

    it('update task: full + minimal', async () => {
        const tool = new TodoistUpdateTaskTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ ...fullTask, content: 'U' })) as typeof fetch;
        const full = await tool.execute({ taskId: 't1', content: 'U', description: 'd', dueString: 'x', priority: 1 }, ctx());
        expect(full.data?.content).toBe('U');
        const min = await tool.execute({ taskId: 't1' }, ctx());
        expect(min.data?.id).toBe('t1');
    });

    it('complete task: 204 + error', async () => {
        const tool = new TodoistCompleteTaskTool(cfg);
        globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch;
        expect((await tool.execute({ taskId: 't1' }, ctx())).data?.success).toBe(true);
        globalThis.fetch = vi.fn(async () => new Response('x', { status: 500 })) as typeof fetch;
        expect((await tool.execute({ taskId: 't1' }, ctx())).success).toBe(false);
    });

    it('toolkit', () => {
        expect(new TodoistToolkit(cfg).tools).toHaveLength(4);
    });
});

// ──────────────────────────────── Trello (companion test skips CRUD) ────────────────────────────────

describe('Trello tools — full CRUD', () => {
    const cfg = { apiKey: 'k', token: 't' };

    it('credential branches: token missing, both from env, config success', async () => {
        const k = process.env['TRELLO_API_KEY'];
        const t = process.env['TRELLO_TOKEN'];
        delete process.env['TRELLO_API_KEY'];
        delete process.env['TRELLO_TOKEN'];
        process.env['TRELLO_API_KEY'] = 'envk';
        expect((await new TrelloGetBoardsTool({}).execute({}, ctx())).success).toBe(false);
        process.env['TRELLO_TOKEN'] = 'envt';
        globalThis.fetch = vi.fn(async () => json([])) as typeof fetch;
        const ok = await new TrelloGetBoardsTool({}).execute({}, ctx());
        expect(ok.success).toBe(true);
        if (k !== undefined) process.env['TRELLO_API_KEY'] = k; else delete process.env['TRELLO_API_KEY'];
        if (t !== undefined) process.env['TRELLO_TOKEN'] = t; else delete process.env['TRELLO_TOKEN'];
    });

    it('boards: filter branches, desc fallback, board with/without lists', async () => {
        const boards = new TrelloGetBoardsTool(cfg);
        globalThis.fetch = vi.fn(async () => json([{ id: 'b1', name: 'B', url: 'u', closed: false }])) as typeof fetch;
        const r1 = await boards.execute({ filter: 'closed' }, ctx());
        expect(r1.data?.boards[0]?.desc).toBe('');
        const ok = await boards.execute({}, ctx());
        expect(ok.data?.boards[0]?.id).toBe('b1');
        const rawBoards = await callRaw(boards, { filter: undefined });
        expect(rawBoards).toBeTruthy();

        const board = new TrelloGetBoardTool(cfg);
        globalThis.fetch = vi.fn(async (url, init) => {
            const u = String(url);
            const m = (init?.method ?? 'GET').toUpperCase();
            if (m === 'GET' && u.includes('/lists')) return json([{ id: 'l1', name: 'Todo', closed: false }]);
            return json({ id: 'b1', name: 'B', url: 'u' });
        }) as typeof fetch;
        const withLists = await board.execute({ boardId: 'b1', includeLists: true }, ctx());
        expect(withLists.data?.lists?.[0]?.id).toBe('l1');
        const noLists = await board.execute({ boardId: 'b1', includeLists: false }, ctx());
        expect(noLists.data?.lists).toBeUndefined();
    });

    it('cards: listId/boardId paths, labels/due variants, missing selector', async () => {
        const tool = new TrelloGetCardsTool(cfg);
        globalThis.fetch = vi.fn(async (url) => {
            const u = String(url);
            if (u.includes('/lists/l1/cards')) {
                return json([{ id: 'c1', name: 'C', url: 'u', idList: 'l1', labels: [{ name: 'bug' }], due: '2025-01-01' }]);
            }
            return json([{ id: 'c2', name: 'C2', url: 'u', idList: 'l1' }]);
        }) as typeof fetch;
        const listCards = await tool.execute({ listId: 'l1' }, ctx());
        expect(listCards.data?.cards[0]?.labels).toEqual(['bug']);
        expect(listCards.data?.cards[0]?.due).toBe('2025-01-01');
        const boardCards = await tool.execute({ boardId: 'b1', filter: 'closed' }, ctx());
        expect(boardCards.data?.cards[0]?.labels).toEqual([]);
        expect(boardCards.data?.cards[0]?.due).toBeUndefined();
        return;
    });

    it('cards: default filter via raw, missing selector error', async () => {
        const tool = new TrelloGetCardsTool(cfg);
        globalThis.fetch = vi.fn(async () => json([])) as typeof fetch;
        const rawCards = await callRaw(tool, { boardId: 'b1', filter: undefined });
        expect(rawCards).toEqual({ cards: [] });
        const missing = await tool.execute({}, ctx());
        expect(missing.success).toBe(false);
    });

    it('create card: full + minimal, pos default via raw', async () => {
        const tool = new TrelloCreateCardTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ id: 'c3', name: 'N', url: 'u', shortUrl: 's' })) as typeof fetch;
        const full = await tool.execute({
            name: 'N', listId: 'l1', description: 'd', due: '2025-01-01',
            labelIds: ['lab'], memberIds: ['m'], position: 'top',
        }, ctx());
        expect(full.data?.id).toBe('c3');
        const min = await tool.execute({ name: 'N', listId: 'l1' }, ctx());
        expect(min.data?.shortUrl).toBe('s');
        const rawCard = await callRaw(tool, { name: 'N', listId: 'l1' });
        expect(rawCard).toBeTruthy();
    });

    it('update card: full + minimal', async () => {
        const tool = new TrelloUpdateCardTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ id: 'c1', name: 'U', url: 'u' })) as typeof fetch;
        const full = await tool.execute({
            cardId: 'c1', name: 'U', description: 'd', due: '2025-01-01',
            closed: true, listId: 'l2', position: 'bottom',
        }, ctx());
        expect(full.data?.name).toBe('U');
        const min = await tool.execute({ cardId: 'c1' }, ctx());
        expect(min.data?.id).toBe('c1');
    });

    it('add comment + create list (pos default via raw) + error', async () => {
        const comment = new TrelloAddCommentTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ id: 'a1' })) as typeof fetch;
        expect((await comment.execute({ cardId: 'c1', text: 'hi' }, ctx())).data?.id).toBe('a1');

        const list = new TrelloCreateListTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ id: 'l2', name: 'Done', idBoard: 'b1' })) as typeof fetch;
        expect((await list.execute({ boardId: 'b1', name: 'Done' }, ctx())).data?.id).toBe('l2');
        const rawList = await callRaw(list, { boardId: 'b1', name: 'Done' });
        expect(rawList).toBeTruthy();

        globalThis.fetch = vi.fn(async () => new Response('x', { status: 400 })) as typeof fetch;
        expect((await new TrelloGetBoardsTool(cfg).execute({}, ctx())).success).toBe(false);
    });

    it('toolkit', () => {
        expect(new TrelloToolkit(cfg).tools).toHaveLength(7);
    });
});

// ──────────────────────────────── ClickUp residual branches ────────────────────────────────

describe('ClickUp residual branches', () => {
    const cfg = { apiToken: 'tok' };

    it('token from env', async () => {
        const prev = process.env['CLICKUP_API_TOKEN'];
        process.env['CLICKUP_API_TOKEN'] = 'envtok';
        globalThis.fetch = vi.fn(async () => json({ teams: [] })) as typeof fetch;
        expect((await new ClickUpGetWorkspacesTool({}).execute({}, ctx())).success).toBe(true);
        if (prev !== undefined) process.env['CLICKUP_API_TOKEN'] = prev; else delete process.env['CLICKUP_API_TOKEN'];
    });

    it('empty collections fallbacks + minimal task mapping', async () => {
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        expect((await new ClickUpGetWorkspacesTool(cfg).execute({}, ctx())).data?.workspaces).toEqual([]);
        expect((await new ClickUpGetSpacesTool(cfg).execute({ workspaceId: 'w1' }, ctx())).data?.spaces).toEqual([]);

        const lists = new ClickUpGetListsTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ lists: [{ id: 'l0', name: 'N' }] })) as typeof fetch;
        const r = await lists.execute({ spaceId: 's1' }, ctx());
        expect(r.data?.lists?.[0]?.spaceId).toBe('');
        expect(r.data?.lists?.[0]?.taskCount).toBeUndefined();

        const create = new ClickUpCreateTaskTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ id: 'm1', name: 'Min', url: 'u', priority: 1 })) as typeof fetch;
        const created = await create.execute({ listId: 'l1', name: 'Min' }, ctx());
        expect(created.data?.status).toBe('open');
        expect(created.data?.priority).toBeUndefined();
        expect(created.data?.assignees).toEqual([]);
        expect(created.data?.tags).toEqual([]);
        expect(created.data?.listId).toBe('');
    });

    it('get tasks: empty filter arrays + defaults via raw', async () => {
        const tool = new ClickUpGetTasksTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ tasks: [] })) as typeof fetch;
        const r = await tool.execute({ listId: 'l1', statuses: [], assignees: [] }, ctx());
        expect(r.data?.count).toBe(0);
        const raw = await callRaw(tool, { listId: 'l1', page: undefined, orderBy: undefined, includeSubtasks: undefined });
        expect(raw).toEqual({ tasks: [], count: 0 });
    });

    it('search tasks: default page via raw + empty tasks', async () => {
        const tool = new ClickUpSearchTasksTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ tasks: [] })) as typeof fetch;
        const r = await callRaw(tool, { workspaceId: 'w1', query: 'q', page: undefined });
        expect(r).toEqual({ tasks: [], count: 0 });
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        expect((await tool.execute({ workspaceId: 'w1', query: 'q' }, ctx())).data?.tasks).toEqual([]);
    });

    it('empty-data fallbacks: lists/tasks/search collections and update default branches', async () => {
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;

        const lists = new ClickUpGetListsTool(cfg);
        expect((await lists.execute({ spaceId: 's1' }, ctx())).data?.lists).toEqual([]);

        const tasks = new ClickUpGetTasksTool(cfg);
        expect((await tasks.execute({ listId: 'l1' }, ctx())).data?.tasks).toEqual([]);

        const create = new ClickUpCreateTaskTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ id: 'c', name: 'N', url: 'u' })) as typeof fetch;
        const rawCreate = await callRaw(create, { listId: 'l1', name: 'N', notifyAll: undefined });
        expect(rawCreate).toBeTruthy();

        const update = new ClickUpUpdateTaskTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ id: 'c', name: 'N', url: 'u' })) as typeof fetch;
        const up = await update.execute({ taskId: 'c' }, ctx());
        expect(up.success).toBe(true);
    });
});

// ──────────────────────────────── Confluence residual branches ────────────────────────────────

describe('Confluence residual branches', () => {
    const cfg = { baseUrl: 'https://org.atlassian.net/', email: 'a@b.com', apiToken: 'tok' };

    it('credential branches: email/apiToken missing, env success', async () => {
        const base = process.env['CONFLUENCE_BASE_URL'];
        const email = process.env['CONFLUENCE_EMAIL'];
        const tok = process.env['CONFLUENCE_API_TOKEN'];

        delete process.env['CONFLUENCE_BASE_URL'];
        delete process.env['CONFLUENCE_EMAIL'];
        delete process.env['CONFLUENCE_API_TOKEN'];
        expect((await new ConfluenceSearchPagesTool({ baseUrl: 'u', apiToken: 't' }).execute({ query: 'x' }, ctx())).success).toBe(false);
        expect((await new ConfluenceSearchPagesTool({ baseUrl: 'u', email: 'e' }).execute({ query: 'x' }, ctx())).success).toBe(false);

        process.env['CONFLUENCE_BASE_URL'] = 'https://env.atlassian.net';
        process.env['CONFLUENCE_EMAIL'] = 'e@e.com';
        process.env['CONFLUENCE_API_TOKEN'] = 't';
        globalThis.fetch = vi.fn(async () => json({ results: [] })) as typeof fetch;
        expect((await new ConfluenceSearchPagesTool({}).execute({ query: 'x' }, ctx())).success).toBe(true);

        if (base !== undefined) process.env['CONFLUENCE_BASE_URL'] = base; else delete process.env['CONFLUENCE_BASE_URL'];
        if (email !== undefined) process.env['CONFLUENCE_EMAIL'] = email; else delete process.env['CONFLUENCE_EMAIL'];
        if (tok !== undefined) process.env['CONFLUENCE_API_TOKEN'] = tok; else delete process.env['CONFLUENCE_API_TOKEN'];
    });

    it('fetch: !ok throw and 204 null path', async () => {
        globalThis.fetch = vi.fn(async () => new Response('x', { status: 500 })) as typeof fetch;
        expect((await new ConfluenceGetPageTool(cfg).execute({ pageId: 'p' }, ctx())).success).toBe(false);
        globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch;
        expect((await new ConfluenceSearchPagesTool(cfg).execute({ query: 'x' }, ctx())).success).toBe(false);
    });

    it('mapPage minimal (absent-side) + version without createdAt', async () => {
        const get = new ConfluenceGetPageTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ id: 'p', title: 'T' })) as typeof fetch;
        const minimal = await get.execute({ pageId: 'p' }, ctx());
        expect(minimal.data?.status).toBe('current');
        expect(minimal.data?.version).toBe(1);
        expect(minimal.data?.updatedAt).toBeUndefined();
        expect(minimal.data?.spaceKey).toBeUndefined();

        globalThis.fetch = vi.fn(async () => json({ id: 'p2', title: 'T', version: { number: 3 } })) as typeof fetch;
        const v = await get.execute({ pageId: 'p2' }, ctx());
        expect(v.data?.version).toBe(3);
        expect(v.data?.updatedAt).toBeUndefined();
    });

    it('search: no spaceKey, spaceKey when cql already mentions space', async () => {
        const tool = new ConfluenceSearchPagesTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ results: [] })) as typeof fetch;
        await tool.execute({ query: 'q' }, ctx());
        await tool.execute({ query: 'space = FOO' }, ctx());
        await tool.execute({ query: 'q', spaceKey: 'S' }, ctx());
    });

    it('create without parentId + raw status default; update minimal + raw; spaces/children empty', async () => {
        const search = new ConfluenceSearchPagesTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ results: [] })) as typeof fetch;
        const rawSearch = await callRaw(search, { query: 'q' });
        expect(rawSearch).toEqual({ pages: [], count: 0 });
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        expect((await search.execute({ query: 'q' }, ctx())).data?.pages).toEqual([]);

        const create = new ConfluenceCreatePageTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ id: 'p1', title: 'T' })) as typeof fetch;
        expect((await create.execute({ title: 'T', spaceId: 'S1', body: '<p>b</p>' }, ctx())).data?.id).toBe('p1');
        const rawCreate = await callRaw(create, { title: 'T', spaceId: 'S1', body: '<p>b</p>' });
        expect(rawCreate).toBeTruthy();

        const update = new ConfluenceUpdatePageTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ id: 'p1', title: 'T' })) as typeof fetch;
        expect((await update.execute({ pageId: 'p1', version: 2 }, ctx())).data?.id).toBe('p1');

        const spaces = new ConfluenceGetSpacesTool(cfg);
        globalThis.fetch = vi.fn(async () => json({ results: [] })) as typeof fetch;
        await spaces.execute({}, ctx());
        const rawSpaces = await callRaw(spaces, {});
        expect(rawSpaces).toBeTruthy();
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        expect((await spaces.execute({}, ctx())).data?.spaces).toEqual([]);

        const children = new ConfluenceGetChildPagesTool(cfg);
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        expect((await children.execute({ pageId: 'p1' }, ctx())).data?.count).toBe(0);
        const rawChildren = await callRaw(children, { pageId: 'p1' });
        expect(rawChildren).toBeTruthy();
    });
});

// ──────────────────────────────── Google Calendar residual branches ────────────────────────────────

describe('Google Calendar residual branches', () => {
    it('token from env', async () => {
        const prev = process.env['GOOGLE_CALENDAR_ACCESS_TOKEN'];
        process.env['GOOGLE_CALENDAR_ACCESS_TOKEN'] = 'envtok';
        globalThis.fetch = vi.fn(async () => json({ items: [] })) as typeof fetch;
        expect((await new GoogleCalendarListEventsTool({}).execute({}, ctx())).success).toBe(true);
        if (prev !== undefined) process.env['GOOGLE_CALENDAR_ACCESS_TOKEN'] = prev; else delete process.env['GOOGLE_CALENDAR_ACCESS_TOKEN'];
    });

    it('mapEvent absent-side mapping', async () => {
        const get = new GoogleCalendarGetEventTool({ accessToken: 't' });
        globalThis.fetch = vi.fn(async () => json({ id: 'e' })) as typeof fetch;
        const r = await get.execute({ eventId: 'e' }, ctx());
        expect(r.data?.summary).toBe('(No title)');
        expect(r.data?.start).toBe('');
        expect(r.data?.end).toBe('');
        expect(r.data?.status).toBe('confirmed');
        expect(r.data?.description).toBeUndefined();
        expect(r.data?.location).toBeUndefined();
    });

    it('create minimal (absent description/location/attendees), update minimal, error path', async () => {
        const create = new GoogleCalendarCreateEventTool({ accessToken: 't' });
        globalThis.fetch = vi.fn(async () => json({ id: 'e1', summary: 'S', start: { dateTime: 'x' }, end: { dateTime: 'y' }, status: 'confirmed' })) as typeof fetch;
        const c = await create.execute({ summary: 'S', startDateTime: 'x', endDateTime: 'y' }, ctx());
        expect(c.data?.id).toBe('e1');

        const update = new GoogleCalendarUpdateEventTool({ accessToken: 't' });
        globalThis.fetch = vi.fn(async () => json({ id: 'e1', summary: 'S', start: { dateTime: 'x' }, end: { dateTime: 'y' }, status: 'x' })) as typeof fetch;
        const u = await update.execute({ eventId: 'e1' }, ctx());
        expect(u.success).toBe(true);

        globalThis.fetch = vi.fn(async () => new Response('x', { status: 403 })) as typeof fetch;
        expect((await create.execute({ summary: 'S', startDateTime: 'x', endDateTime: 'y' }, ctx())).success).toBe(false);
    });

    it('default fallbacks via raw performExecute for all event tools', async () => {
        const list = new GoogleCalendarListEventsTool({ accessToken: 't' });
        globalThis.fetch = vi.fn(async () => json({ items: [] })) as typeof fetch;
        await callRaw(list, { calendarId: undefined, maxResults: undefined, orderBy: undefined });
        const listCfg = new GoogleCalendarListEventsTool({ accessToken: 't', calendarId: 'cfgcal' });
        await callRaw(listCfg, { calendarId: undefined, maxResults: undefined, orderBy: undefined });
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        expect((await list.execute({}, ctx())).data?.events).toEqual([]);

        const create = new GoogleCalendarCreateEventTool({ accessToken: 't' });
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        await callRaw(create, { summary: 'S', startDateTime: 'x', endDateTime: 'y', calendarId: undefined });
        const createCfg = new GoogleCalendarCreateEventTool({ accessToken: 't', calendarId: 'cfgcal' });
        await callRaw(createCfg, { summary: 'S', startDateTime: 'x', endDateTime: 'y', calendarId: undefined });

        const update = new GoogleCalendarUpdateEventTool({ accessToken: 't' });
        await callRaw(update, { eventId: 'e', calendarId: undefined });

        const del = new GoogleCalendarDeleteEventTool({ accessToken: 't' });
        globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch;
        await callRaw(del, { eventId: 'e', calendarId: undefined });

        const get = new GoogleCalendarGetEventTool({ accessToken: 't' });
        globalThis.fetch = vi.fn(async () => json({})) as typeof fetch;
        await callRaw(get, { eventId: 'e', calendarId: undefined });
    });
});
