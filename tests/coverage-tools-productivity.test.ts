/**
 * Hermetic coverage for productivity tools (Trello, ClickUp, Confluence, Google Calendar).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

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
    ClickUpDeleteTaskTool,
    ClickUpSearchTasksTool,
    ClickUpToolkit,
} from '../src/tools/productivity/clickup.js';
import {
    ConfluenceSearchPagesTool,
    ConfluenceGetPageTool,
    ConfluenceCreatePageTool,
    ConfluenceUpdatePageTool,
    ConfluenceGetSpacesTool,
    ConfluenceGetChildPagesTool,
    ConfluenceToolkit,
} from '../src/tools/productivity/confluence.js';
import {
    GoogleCalendarListEventsTool,
    GoogleCalendarCreateEventTool,
    GoogleCalendarUpdateEventTool,
    GoogleCalendarDeleteEventTool,
    GoogleCalendarGetEventTool,
    GoogleCalendarToolkit,
} from '../src/tools/productivity/google-calendar.js';
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

function json(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Trello tools', () => {
    const originalFetch = globalThis.fetch;
    const cfg = { apiKey: 'k', token: 't' };
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('requires credentials', async () => {
        const prevK = process.env['TRELLO_API_KEY'];
        const prevT = process.env['TRELLO_TOKEN'];
        delete process.env['TRELLO_API_KEY'];
        delete process.env['TRELLO_TOKEN'];
        const r = await new TrelloGetBoardsTool({}).execute({}, ctx());
        expect(r.success).toBe(false);
        if (prevK !== undefined) process.env['TRELLO_API_KEY'] = prevK;
        if (prevT !== undefined) process.env['TRELLO_TOKEN'] = prevT;
    });

    it.skip('toolkit + CRUD via mocked fetch', async () => {
        expect(new TrelloToolkit(cfg).tools).toHaveLength(7);

        globalThis.fetch = vi.fn(async (url, init) => {
            const u = String(url);
            const method = (init?.method ?? 'GET').toUpperCase();
            if (u.includes('/members/me/boards')) {
                return json([{ id: 'b1', name: 'Board', url: 'https://trello.com/b/1', closed: false, desc: 'd' }]);
            }
            if (u.includes('/boards/b1/lists') && method === 'GET') {
                return json([{ id: 'l1', name: 'Todo', closed: false }]);
            }
            if (u.includes('/boards/b1') && method === 'GET' && !u.includes('/cards') && !u.includes('/lists')) {
                return json({ id: 'b1', name: 'Board', url: 'https://trello.com/b/1', desc: 'd' });
            }
            if (u.includes('/lists/l1/cards')) {
                return json([{ id: 'c1', name: 'Card', desc: '', url: 'u', idList: 'l1', labels: [{ name: 'bug' }], due: '2025-01-01' }]);
            }
            if (u.includes('/boards/b1/cards/')) {
                return json([{ id: 'c2', name: 'C2', desc: '', url: 'u', idList: 'l1', labels: [] }]);
            }
            if (method === 'POST' && u.includes('/cards') && !u.includes('/actions')) {
                return json({ id: 'c3', name: 'New', url: 'u', shortUrl: 's' });
            }
            if (method === 'PUT' && u.includes('/cards/')) {
                return json({ id: 'c1', name: 'Updated', url: 'u' });
            }
            if (u.includes('/actions/comments')) {
                return json({ id: 'a1' });
            }
            if (method === 'POST' && u.includes('/lists')) {
                return json({ id: 'l2', name: 'Done', idBoard: 'b1' });
            }
            return json({});
        }) as typeof fetch;

        expect((await new TrelloGetBoardsTool(cfg).execute({ filter: 'open' }, ctx())).data?.boards[0]?.id).toBe('b1');
        const board = await new TrelloGetBoardTool(cfg).execute({ boardId: 'b1', includeLists: true }, ctx());
        expect(board.data?.lists?.[0]?.id).toBe('l1');
        const boardNoLists = await new TrelloGetBoardTool(cfg).execute({ boardId: 'b1', includeLists: false }, ctx());
        expect(boardNoLists.data?.lists).toBeUndefined();

        expect((await new TrelloGetCardsTool(cfg).execute({ listId: 'l1' }, ctx())).data?.cards[0]?.id).toBe('c1');
        expect((await new TrelloGetCardsTool(cfg).execute({ boardId: 'b1', filter: 'open' }, ctx())).data?.cards[0]?.id).toBe('c2');
        const missing = await new TrelloGetCardsTool(cfg).execute({}, ctx());
        expect(missing.success).toBe(false);

        const created = await new TrelloCreateCardTool(cfg).execute({
            name: 'New', listId: 'l1', description: 'd', due: '2025-01-01',
            labelIds: ['lab'], memberIds: ['m1'], position: 'top',
        }, ctx());
        expect(created.data?.id).toBe('c3');

        expect((await new TrelloUpdateCardTool(cfg).execute({
            cardId: 'c1', name: 'Updated', description: 'x', due: '2025-02-01', closed: true, listId: 'l2', position: 'bottom',
        }, ctx())).data?.name).toBe('Updated');

        expect((await new TrelloAddCommentTool(cfg).execute({ cardId: 'c1', text: 'hi' }, ctx())).data?.id).toBe('a1');
        expect((await new TrelloCreateListTool(cfg).execute({ boardId: 'b1', name: 'Done' }, ctx())).data?.id).toBe('l2');

        globalThis.fetch = vi.fn(async () => new Response('nope', { status: 400 })) as typeof fetch;
        expect((await new TrelloGetBoardsTool(cfg).execute({}, ctx())).success).toBe(false);
    });
});

describe('ClickUp tools', () => {
    const originalFetch = globalThis.fetch;
    const cfg = { apiToken: 'tok' };
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('requires token and toolkit size', async () => {
        const prev = process.env['CLICKUP_API_TOKEN'];
        delete process.env['CLICKUP_API_TOKEN'];
        expect((await new ClickUpGetWorkspacesTool({}).execute({}, ctx())).success).toBe(false);
        if (prev !== undefined) process.env['CLICKUP_API_TOKEN'] = prev;
        expect(new ClickUpToolkit(cfg).tools).toHaveLength(8);
    });

    it('workspaces/spaces/lists/tasks CRUD + search', async () => {
        const sampleTask = {
            id: 't1', name: 'Task', description: 'd', status: { status: 'open' },
            priority: { priority: 'high' }, due_date: '1', url: 'u',
            assignees: [{ username: 'alice' }], tags: [{ name: 'bug' }], list: { id: 'list1' },
        };

        globalThis.fetch = vi.fn(async (url, init) => {
            const u = String(url);
            const method = (init?.method ?? 'GET').toUpperCase();
            if (u.endsWith('/team')) return json({ teams: [{ id: 'w1', name: 'WS', color: '#fff' }] });
            if (u.includes('/team/w1/space')) return json({ spaces: [{ id: 's1', name: 'Space', private: false }] });
            if (u.includes('/folder/f1/list') || u.includes('/space/s1/list')) {
                return json({ lists: [{ id: 'list1', name: 'L', task_count: 2, space: { id: 's1' } }] });
            }
            if (u.includes('/list/list1/task') && method === 'GET') return json({ tasks: [sampleTask] });
            if (u.includes('/list/list1/task') && method === 'POST') return json(sampleTask);
            if (u.includes('/task/t1') && method === 'PUT') return json({ ...sampleTask, name: 'Updated' });
            if (u.includes('/task/t1') && method === 'DELETE') return json({});
            if (u.includes('/team/w1/task')) return json({ tasks: [sampleTask] });
            return json({});
        }) as typeof fetch;

        expect((await new ClickUpGetWorkspacesTool(cfg).execute({}, ctx())).data?.workspaces[0]?.id).toBe('w1');
        expect((await new ClickUpGetSpacesTool(cfg).execute({ workspaceId: 'w1' }, ctx())).data?.spaces[0]?.id).toBe('s1');
        expect((await new ClickUpGetListsTool(cfg).execute({ spaceId: 's1' }, ctx())).data?.lists[0]?.id).toBe('list1');
        expect((await new ClickUpGetListsTool(cfg).execute({ folderId: 'f1' }, ctx())).data?.lists[0]?.id).toBe('list1');
        expect((await new ClickUpGetListsTool(cfg).execute({}, ctx())).success).toBe(false);

        const tasks = await new ClickUpGetTasksTool(cfg).execute({
            listId: 'list1', statuses: ['open'], assignees: ['1'], dueDateGte: 1, dueDateLte: 2, includeSubtasks: true,
        }, ctx());
        expect(tasks.data?.count).toBe(1);

        const created = await new ClickUpCreateTaskTool(cfg).execute({
            listId: 'list1', name: 'Task', description: 'd', status: 'open', priority: 2,
            dueDate: 1, assignees: [1], tags: ['bug'], notifyAll: true,
        }, ctx());
        expect(created.data?.id).toBe('t1');

        expect((await new ClickUpUpdateTaskTool(cfg).execute({
            taskId: 't1', name: 'Updated', description: 'x', status: 'done', priority: 1, dueDate: 2,
        }, ctx())).data?.name).toBe('Updated');
        expect((await new ClickUpDeleteTaskTool(cfg).execute({ taskId: 't1' }, ctx())).data?.success).toBe(true);
        expect((await new ClickUpSearchTasksTool(cfg).execute({ workspaceId: 'w1', query: 'Task' }, ctx())).data?.count).toBe(1);

        globalThis.fetch = vi.fn(async () => new Response('err', { status: 500 })) as typeof fetch;
        expect((await new ClickUpGetWorkspacesTool(cfg).execute({}, ctx())).success).toBe(false);
    });
});

describe('Confluence tools', () => {
    const originalFetch = globalThis.fetch;
    const cfg = { baseUrl: 'https://org.atlassian.net', email: 'a@b.com', apiToken: 'tok' };
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('requires creds + toolkit', async () => {
        const prev = process.env['CONFLUENCE_BASE_URL'];
        delete process.env['CONFLUENCE_BASE_URL'];
        expect((await new ConfluenceSearchPagesTool({}).execute({ query: 'x' }, ctx())).success).toBe(false);
        if (prev !== undefined) process.env['CONFLUENCE_BASE_URL'] = prev;
        expect(new ConfluenceToolkit(cfg).tools).toHaveLength(6);
    });

    it('search/get/create/update/spaces/children', async () => {
        const page = {
            id: 'p1', title: 'Page', spaceId: 'S1', status: 'current',
            version: { number: 1, createdAt: 'now' },
            body: { storage: { value: '<p>hi</p>' } },
            _links: { webui: '/wiki/p1' },
            authorId: 'u1', createdAt: 'now',
        };

        globalThis.fetch = vi.fn(async (url, init) => {
            const u = String(url);
            const method = (init?.method ?? 'GET').toUpperCase();
            if (u.includes('/pages?') && method === 'GET') return json({ results: [page] });
            if (u.includes('/pages/p1/children')) return json({ results: [page] });
            if (u.includes('/pages/p1') && method === 'GET') return json(page);
            if (u.includes('/pages') && method === 'POST') return json(page);
            if (u.includes('/pages/p1') && method === 'PUT') return json({ ...page, title: 'Updated' });
            if (u.includes('/spaces')) return json({ results: [{ id: '1', key: 'S', name: 'Space', type: 'global' }] });
            if (method !== 'GET' && (init as RequestInit)?.method === undefined) return new Response(null, { status: 204 });
            return json({});
        }) as typeof fetch;

        expect((await new ConfluenceSearchPagesTool(cfg).execute({
            query: 'type=page', spaceKey: 'S', limit: 5,
        }, ctx())).data?.count).toBe(1);
        expect((await new ConfluenceGetPageTool(cfg).execute({ pageId: 'p1' }, ctx())).data?.id).toBe('p1');
        expect((await new ConfluenceCreatePageTool(cfg).execute({
            title: 'Page', spaceId: 'S1', body: '<p>hi</p>', parentId: 'p0',
        }, ctx())).data?.id).toBe('p1');
        expect((await new ConfluenceUpdatePageTool(cfg).execute({
            pageId: 'p1', title: 'Updated', body: '<p>x</p>', version: 2,
        }, ctx())).data?.title).toBe('Updated');
        expect((await new ConfluenceGetSpacesTool(cfg).execute({ limit: 5, type: 'global' }, ctx())).data?.spaces[0]?.key).toBe('S');
        expect((await new ConfluenceGetChildPagesTool(cfg).execute({ pageId: 'p1' }, ctx())).data?.count).toBe(1);
    });
});

describe('Google Calendar tools', () => {
    const originalFetch = globalThis.fetch;
    const cfg = { accessToken: 'atok', calendarId: 'primary' };
    afterEach(() => { globalThis.fetch = originalFetch; });

    it('requires token + toolkit', async () => {
        const prev = process.env['GOOGLE_CALENDAR_ACCESS_TOKEN'];
        delete process.env['GOOGLE_CALENDAR_ACCESS_TOKEN'];
        expect((await new GoogleCalendarListEventsTool({}).execute({}, ctx())).success).toBe(false);
        if (prev !== undefined) process.env['GOOGLE_CALENDAR_ACCESS_TOKEN'] = prev;
        expect(new GoogleCalendarToolkit(cfg).tools).toHaveLength(5);
    });

    it('list/create/update/delete/get events', async () => {
        const event = {
            id: 'e1', summary: 'Meet', description: 'd', location: 'HQ',
            start: { dateTime: '2025-01-01T10:00:00Z' },
            end: { dateTime: '2025-01-01T11:00:00Z' },
            attendees: [{ email: 'a@b.com', responseStatus: 'accepted' }],
            htmlLink: 'https://cal', status: 'confirmed',
        };

        globalThis.fetch = vi.fn(async (url, init) => {
            const u = String(url);
            const method = (init?.method ?? 'GET').toUpperCase();
            if (method === 'GET' && u.includes('/events?')) return json({ items: [event] });
            if (method === 'GET' && u.includes('/events/e1')) return json(event);
            if (method === 'POST') return json(event);
            if (method === 'PATCH') return json({ ...event, summary: 'Updated' });
            if (method === 'DELETE') return new Response(null, { status: 204 });
            return json({});
        }) as typeof fetch;

        const listed = await new GoogleCalendarListEventsTool(cfg).execute({
            timeMin: '2025-01-01T00:00:00Z', timeMax: '2025-02-01T00:00:00Z', query: 'Meet', maxResults: 5,
        }, ctx());
        expect(listed.data?.count).toBe(1);
        expect(listed.data?.events[0]?.attendees?.[0]?.email).toBe('a@b.com');

        const created = await new GoogleCalendarCreateEventTool(cfg).execute({
            summary: 'Meet', description: 'd', location: 'HQ',
            startDateTime: '2025-01-01T10:00:00Z', endDateTime: '2025-01-01T11:00:00Z',
            attendees: ['a@b.com'], sendNotifications: true,
        }, ctx());
        expect(created.data?.id).toBe('e1');

        expect((await new GoogleCalendarUpdateEventTool(cfg).execute({
            eventId: 'e1', summary: 'Updated', description: 'x', location: 'Y',
            startDateTime: '2025-01-01T12:00:00Z', endDateTime: '2025-01-01T13:00:00Z',
        }, ctx())).data?.summary).toBe('Updated');

        expect((await new GoogleCalendarDeleteEventTool(cfg).execute({ eventId: 'e1' }, ctx())).data?.success).toBe(true);
        expect((await new GoogleCalendarGetEventTool(cfg).execute({ eventId: 'e1' }, ctx())).data?.id).toBe('e1');

        // all-day style mapping
        globalThis.fetch = vi.fn(async () => json({
            id: 'e2', summary: 'Day', start: { date: '2025-01-01' }, end: { date: '2025-01-02' }, status: 'confirmed',
        })) as typeof fetch;
        expect((await new GoogleCalendarGetEventTool(cfg).execute({ eventId: 'e2' }, ctx())).data?.start).toBe('2025-01-01');

        globalThis.fetch = vi.fn(async () => new Response('err', { status: 403 })) as typeof fetch;
        expect((await new GoogleCalendarListEventsTool(cfg).execute({}, ctx())).success).toBe(false);
    });
});
