/**
 * Hermetic coverage for src/planner/llm-planner, src/artifacts/media,
 * src/scheduler (SchedulerTools, DbScheduleStore edges).
 * Callers: vitest only. Existing: planner.test, artifact.test, scheduler-artifacts, learning-reasoning-context.
 */

import { describe, it, expect, vi } from 'vitest';
import { LLMPlanner } from '../src/planner/llm-planner.js';
import { TaskPriority } from '../src/planner/types.js';
import type { Plan, PlanFeedback, Task } from '../src/planner/types.js';
import {
    createImageFromUrl,
    createImageFromBase64,
    createAudioFromUrl,
    createVideoFromUrl,
    MediaManager,
} from '../src/artifacts/media.js';
import { InMemoryArtifactStorage } from '../src/artifacts/artifact.js';
import { SchedulerTools } from '../src/scheduler/scheduler-tools.js';
import { ScheduleManager, InMemoryScheduleRunStore } from '../src/scheduler/manager.js';
import { DbScheduleStore } from '../src/scheduler/db-schedule-store.js';

describe('LLMPlanner', () => {
    function mockLlm(response: string) {
        return { generateText: vi.fn(async () => response) };
    }

    it('plans from JSON response with context and priorities', async () => {
        const llm = mockLlm(
            JSON.stringify({
                tasks: [
                    { name: 'Research', description: 'Look up', priority: 'HIGH', estimatedDurationMs: 1000 },
                    { name: 'Write', description: 'Draft', priority: 'LOW', dependencies: [] },
                    { name: 'Review', description: 'Check', priority: 'CRITICAL' },
                    { name: 'Ship', description: 'Deploy', priority: 'MEDIUM', metadata: { k: 1 } },
                ],
            }),
        );
        const planner = new LLMPlanner({ model: 'gpt-test', temperature: 0.1 }, llm);
        const plan = await planner.plan('ship feature', {
            availableTools: ['search'],
            constraints: ['fast'],
            memory: ['prior'],
            metadata: { tenant: 't1' },
        });
        expect(plan.metadata.plannerType).toBe('llm');
        expect(plan.tasks.length).toBe(4);
        expect(plan.tasks[0]!.priority).toBe(TaskPriority.HIGH);
        expect(plan.tasks[1]!.dependencies.length).toBeGreaterThan(0);
        expect(llm.generateText).toHaveBeenCalled();
    });

    it('falls back when response is not JSON', async () => {
        const planner = new LLMPlanner({ model: 'm' }, mockLlm('just do it'));
        const plan = await planner.plan('goal');
        expect(plan.tasks).toHaveLength(1);
        expect(plan.tasks[0]!.name).toBe('Execute Plan');
    });

    it('parses tasks object and refine()', async () => {
        // parseTasksFromResponse extracts the first {...} block (not bare arrays)
        const llm = mockLlm(
            JSON.stringify({
                tasks: [{ name: 'A', description: 'a', priority: 'HIGH', estimatedDurationMs: 50 }],
            }),
        );
        const planner = new LLMPlanner({ model: 'm', systemPrompt: 'custom' }, llm);
        const plan = await planner.plan('g');
        expect(plan.tasks[0]!.name).toBe('A');

        llm.generateText.mockResolvedValueOnce(
            JSON.stringify({ tasks: [{ name: 'B', description: 'b', priority: 'LOW' }] }),
        );
        const feedback: PlanFeedback = {
            planId: plan.id,
            failedTaskId: plan.tasks[0]!.id,
            error: 'timeout',
            suggestions: ['retry'],
            taskFeedback: [],
        };
        const refined = await planner.refine(plan, feedback);
        expect(refined.tasks[0]!.name).toBe('B');
        expect(refined.metadata.confidence).toBeLessThan(plan.metadata.confidence ?? 1);
    });

    it('validate detects cycles, missing deps, and empty names', () => {
        const planner = new LLMPlanner({ model: 'm' }, mockLlm('{}'));
        const t1: Task = {
            id: 't1',
            name: 'A',
            description: 'a',
            dependencies: ['t2'],
            priority: TaskPriority.MEDIUM,
            metadata: {},
        };
        const t2: Task = {
            id: 't2',
            name: 'B',
            description: 'b',
            dependencies: ['t1'],
            priority: TaskPriority.MEDIUM,
            metadata: {},
        };
        const cyclic: Plan = {
            id: 'p',
            goal: 'g',
            tasks: [t1, t2],
            createdAt: new Date(),
            metadata: {},
        };
        expect(planner.validate(cyclic).valid).toBe(false);
        expect(planner.validate(cyclic).errors.some((e) => e.message.includes('Circular'))).toBe(true);

        const missing: Plan = {
            ...cyclic,
            tasks: [
                {
                    id: 'x',
                    name: '',
                    description: '',
                    dependencies: ['ghost'],
                    priority: TaskPriority.LOW,
                    metadata: {},
                },
            ],
        };
        const v = planner.validate(missing);
        expect(v.valid).toBe(false);
        expect(v.errors.some((e) => e.message.includes('Missing dependency'))).toBe(true);
        expect(v.errors.some((e) => e.message.includes('Task name'))).toBe(true);

        const ok: Plan = {
            id: 'p2',
            goal: 'g',
            tasks: [
                {
                    id: 'a',
                    name: 'Ok',
                    description: 'd',
                    dependencies: [],
                    priority: TaskPriority.MEDIUM,
                    metadata: {},
                },
            ],
            createdAt: new Date(),
            metadata: {},
        };
        expect(planner.validate(ok).valid).toBe(true);
    });
});

describe('artifacts/media', () => {
    it('creates image/audio/video helpers with mime guessing', () => {
        expect(createImageFromUrl('i', 'https://x/a.png', { width: 1, height: 2 }).mimeType).toBe('image/png');
        expect(createImageFromUrl('i', 'https://x/a.jpg').mimeType).toBe('image/jpeg');
        expect(createImageFromUrl('i', 'https://x/a.webp').mimeType).toBe('image/webp');
        expect(createImageFromUrl('i', 'https://x/a').mimeType).toBe('image/png');
        expect(createImageFromBase64('i', 'AAA', 'image/png', { prompt: 'p' }).base64).toBe('AAA');

        expect(createAudioFromUrl('a', 'https://x/a.mp3', { transcript: 'hi' }).mimeType).toBe('audio/mpeg');
        expect(createAudioFromUrl('a', 'https://x/a.wav').mimeType).toBe('audio/wav');
        expect(createAudioFromUrl('a', 'https://x/a').mimeType).toBe('audio/mpeg');

        expect(createVideoFromUrl('v', 'https://x/a.webm', { fps: 24 }).mimeType).toBe('video/webm');
        expect(createVideoFromUrl('v', 'https://x/a.mp4').mimeType).toBe('video/mp4');
        expect(createVideoFromUrl('v', 'https://x/a').mimeType).toBe('video/mp4');
    });

    it('MediaManager save/get/list round-trip', async () => {
        const storage = new InMemoryArtifactStorage();
        const mgr = new MediaManager(storage);

        const img = await mgr.saveImage('pic', 'https://cdn/x.png', { width: 10 });
        const img2 = await mgr.saveImage('pic2', { base64: 'QQ==', mimeType: 'image/jpeg' });
        const audio = await mgr.saveAudio('a', 'https://cdn/a.mp3', { durationSeconds: 1 });
        const video = await mgr.saveVideo('v', 'https://cdn/v.mp4', { fps: 30 });

        expect(await mgr.getImage(img.id)).toMatchObject({ type: 'image', name: 'pic' });
        expect(await mgr.getImage(img2.id)).toMatchObject({ type: 'image' });
        expect(await mgr.getAudio(audio.id)).toMatchObject({ type: 'audio' });
        expect(await mgr.getVideo(video.id)).toMatchObject({ type: 'video' });

        expect(await mgr.listImages()).toHaveLength(2);
        expect(await mgr.listAudio()).toHaveLength(1);
        expect(await mgr.listVideos()).toHaveLength(1);
    });
});

describe('SchedulerTools', () => {
    it('exposes CRUD tools that operate on ScheduleManager', async () => {
        const manager = new ScheduleManager({ debug: true });
        manager.register('/agents/assistant/run', async () => ({ ok: true }));
        const tools = new SchedulerTools({ manager }).getTools();
        const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

        expect(Object.keys(byName)).toEqual(
            expect.arrayContaining([
                'create_schedule',
                'list_schedules',
                'delete_schedule',
                'enable_schedule',
                'disable_schedule',
                'trigger_schedule_now',
            ]),
        );

        expect(await byName['create_schedule']!.execute({})).toMatch(/name is required/);
        expect(await byName['create_schedule']!.execute({ name: 'n' })).toMatch(/cron_expr is required/);

        const created = await byName['create_schedule']!.execute({
            name: 'daily',
            cron_expr: '0 9 * * *',
            payload: '{"msg":"hi"}',
            timezone: 'UTC',
        });
        expect(created).toMatch(/Schedule created/);

        // Message is "ID: <id>. Will run..." — exclude trailing punctuation
        const idMatch = /ID: ([\w-]+)/.exec(created);
        const id = idMatch?.[1] ?? '';
        expect(id).toBeTruthy();

        expect(await byName['list_schedules']!.execute({})).toContain('daily');
        expect(await byName['list_schedules']!.execute({ filter: 'enabled' })).toContain('daily');
        expect(await byName['list_schedules']!.execute({ filter: 'disabled' })).toMatch(/No schedules|disabled/);

        expect(await byName['disable_schedule']!.execute({ schedule_id: id })).toMatch(/disabled/);
        expect(await byName['enable_schedule']!.execute({ schedule_id: id })).toMatch(/enabled/);
        expect(await byName['trigger_schedule_now']!.execute({ schedule_id: id })).toMatch(/triggered/);

        expect(await byName['delete_schedule']!.execute({})).toMatch(/schedule_id is required/);
        expect(await byName['delete_schedule']!.execute({ schedule_id: 'missing' })).toMatch(/not found/);
        expect(await byName['delete_schedule']!.execute({ schedule_id: id })).toMatch(/deleted/);
        expect(await byName['list_schedules']!.execute({})).toMatch(/No schedules/);

        expect(await byName['trigger_schedule_now']!.execute({})).toMatch(/schedule_id is required/);
        expect(await byName['trigger_schedule_now']!.execute({ schedule_id: 'x' })).toMatch(/not found/);
        expect(await byName['enable_schedule']!.execute({})).toMatch(/schedule_id is required/);
        expect(await byName['disable_schedule']!.execute({})).toMatch(/schedule_id is required/);
    });
});

describe('DbScheduleStore', () => {
    it('maps rows through mock AgentDb', async () => {
        const rows = new Map<string, Record<string, unknown>>();
        const db = {
            init: vi.fn(async () => undefined),
            getSchedule: vi.fn(async (id: string) => rows.get(id) ?? null),
            getSchedules: vi.fn(async (filter?: { enabled?: boolean }) => {
                const all = [...rows.values()];
                if (filter?.enabled != null) return all.filter((r) => r['enabled'] === filter.enabled);
                return all;
            }),
            createSchedule: vi.fn(async (input: Record<string, unknown>) => {
                const row = {
                    ...input,
                    created_at: 1_700_000_000,
                    updated_at: 1_700_000_000,
                };
                rows.set(String(input['id']), row);
                return row;
            }),
            updateSchedule: vi.fn(async (id: string, patch: Record<string, unknown>) => {
                const prev = rows.get(id);
                if (!prev) return null;
                const next = { ...prev, ...patch, updated_at: 1_700_000_100 };
                rows.set(id, next);
                return next;
            }),
            deleteSchedule: vi.fn(async (id: string) => rows.delete(id)),
        };

        const store = new DbScheduleStore(db as never);
        const saved = await store.save({
            id: 's1',
            name: 'n',
            cronExpr: '0 * * * *',
            endpoint: '/run',
            method: 'POST',
            payload: { a: 1 },
            timezone: 'UTC',
            enabled: true,
            nextRunAt: new Date(1_700_000_060_000).toISOString(),
            maxRetries: 1,
            retryDelaySeconds: 5,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        expect(saved.id).toBe('s1');
        expect(await store.get('s1')).toMatchObject({ name: 'n', endpoint: '/run' });
        expect(await store.list(true)).toHaveLength(1);

        const updated = await store.save({
            ...saved,
            name: 'n2',
            enabled: false,
        });
        expect(updated.name).toBe('n2');
        expect(await store.delete('s1')).toBe(true);
        expect(await store.get('s1')).toBeNull();
    });

    it('InMemoryScheduleRunStore update miss paths', async () => {
        const runs = new InMemoryScheduleRunStore();
        expect(await runs.update('missing', { status: 'failed' })).toBe(false);
        expect(await runs.list('none')).toEqual([]);
    });
});
