/**
 * Tests for:
 *   - validateCronExpr + computeNextRun (personaforge/scheduler cron)
 *   - InMemoryArtifactStorage + artifact factories (personaforge/artifacts)
 */

import { describe, it, expect } from 'vitest';
import { validateCronExpr, computeNextRun } from '../src/scheduler/cron.js';
import {
    InMemoryArtifactStorage,
    createTextArtifact,
    createMarkdownArtifact,
    createDataArtifact,
} from '../src/artifacts/artifact.js';

describe('validateCronExpr', () => {
    it('accepts valid 5-field expressions', () => {
        expect(validateCronExpr('* * * * *')).toBe(true);
        expect(validateCronExpr('0 3 * * *')).toBe(true);
        expect(validateCronExpr('*/15 * * * *')).toBe(true);
        expect(validateCronExpr('0 0 1 1 *')).toBe(true);
        expect(validateCronExpr('30 9 * * 1-5')).toBe(true);
    });

    it('rejects malformed expressions', () => {
        expect(validateCronExpr('')).toBe(false);
        expect(validateCronExpr('* * * *')).toBe(false);       // 4 fields
        expect(validateCronExpr('* * * * * *')).toBe(false);   // 6 fields
        expect(validateCronExpr('not a cron')).toBe(false);    // non-numeric fields
    });
});

describe('computeNextRun', () => {
    it('returns null for an invalid expression', () => {
        expect(computeNextRun('bad expr', 'UTC', Date.UTC(2026, 0, 1))).toBeNull();
    });

    it('computes the next matching minute for "every minute"', () => {
        const base = Date.UTC(2026, 0, 1, 10, 30, 0);
        const next = computeNextRun('* * * * *', 'UTC', base);
        expect(next).not.toBeNull();
        expect(next!.getTime()).toBe(base + 60_000);
    });

    it('computes the next daily 03:00 UTC run', () => {
        const base = Date.UTC(2026, 0, 1, 10, 0, 0); // 10:00 → next 03:00 is tomorrow
        const next = computeNextRun('0 3 * * *', 'UTC', base);
        expect(next).not.toBeNull();
        expect(next!.getUTCHours()).toBe(3);
        expect(next!.getUTCMinutes()).toBe(0);
        expect(next!.getTime()).toBeGreaterThan(base);
    });

    it('advances to the correct minute for */15', () => {
        const base = Date.UTC(2026, 0, 1, 10, 7, 0);
        const next = computeNextRun('*/15 * * * *', 'UTC', base);
        expect(next!.getUTCMinutes()).toBe(15);
    });
});

describe('artifact factories', () => {
    it('createTextArtifact produces a text/plain file artifact', () => {
        const a = createTextArtifact('notes', 'hello');
        expect(a.name).toBe('notes');
        expect(a.content).toBe('hello');
        expect(a.mimeType).toBe('text/plain');
        expect(a.type).toBe('file');
    });

    it('createMarkdownArtifact sets markdown type + mime', () => {
        const a = createMarkdownArtifact('doc', '# Title', ['tag1']);
        expect(a.type).toBe('markdown');
        expect(a.mimeType).toBe('text/markdown');
        expect(a.tags).toEqual(['tag1']);
    });

    it('createDataArtifact stores structured data', () => {
        const a = createDataArtifact('metrics', { count: 3, ok: true });
        expect(a.name).toBe('metrics');
        expect((a as { data?: unknown }).data ?? (a as { content?: unknown }).content).toBeDefined();
    });
});

describe('InMemoryArtifactStorage', () => {
    it('saves and retrieves an artifact with an id + version', async () => {
        const store = new InMemoryArtifactStorage();
        const saved = await store.save(createTextArtifact('f', 'v1'));
        expect(saved.id).toBeTruthy();
        expect(saved.version).toBeGreaterThanOrEqual(1);
        const got = await store.get(saved.id);
        expect(got?.content).toBe('v1');
    });

    it('lists saved artifacts', async () => {
        const store = new InMemoryArtifactStorage();
        await store.save(createTextArtifact('a', '1'));
        await store.save(createTextArtifact('b', '2'));
        const all = await store.list();
        expect(all.length).toBe(2);
    });

    it('deletes an artifact', async () => {
        const store = new InMemoryArtifactStorage();
        const saved = await store.save(createTextArtifact('c', 'x'));
        await store.delete(saved.id);
        expect(await store.get(saved.id)).toBeNull();
    });
});
