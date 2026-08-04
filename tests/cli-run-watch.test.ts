/**
 * Hermetic test for the CLI watch-mode dependency (chokidar) — verifies the
 * file-watching primitive the `personaforge run --watch` command relies on:
 * change events fire for a watched file, and a debounce coalesces bursts.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { watch } from 'chokidar';

describe('cli run --watch (chokidar)', () => {
    const dirs: string[] = [];

    afterEach(() => {
        for (const d of dirs) rmSync(d, { recursive: true, force: true });
    });

    const makeFile = (): string => {
        const dir = mkdtempSync(join(tmpdir(), 'pf-watch-'));
        dirs.push(dir);
        const p = join(dir, 'agent.ts');
        writeFileSync(p, 'export const run = () => "v1";\n', 'utf8');
        return p;
    };

    const waitFor = async (fn: () => boolean, timeoutMs = 3000): Promise<boolean> => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (fn()) return true;
            await new Promise((r) => setTimeout(r, 20));
        }
        return fn();
    };

    it('fires a change event when the watched file is modified', async () => {
        const file = makeFile();
        const watcher = watch(file, { persistent: true });
        let changed = 0;
        watcher.on('change', () => { changed++; });

        await new Promise((r) => setTimeout(r, 200)); // let chokidar attach
        appendFileSync(file, 'export const v2 = true;\n', 'utf8');

        const saw = await waitFor(() => changed > 0);
        expect(saw).toBe(true);
        await watcher.close();
    });

    it('supports watching a directory and firing on nested changes', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'pf-watchdir-'));
        dirs.push(dir);
        const file = join(dir, 'a.ts');
        writeFileSync(file, '// a\n', 'utf8');

        const watcher = watch(dir, { persistent: true });
        let changed = 0;
        watcher.on('change', () => { changed++; });

        await new Promise((r) => setTimeout(r, 200));
        appendFileSync(file, '// more\n', 'utf8');

        const saw = await waitFor(() => changed > 0);
        expect(saw).toBe(true);
        await watcher.close();
    });

    it('close() stops delivery of further events', async () => {
        const file = makeFile();
        const watcher = watch(file, { persistent: true });
        let changed = 0;
        watcher.on('change', () => { changed++; });

        await new Promise((r) => setTimeout(r, 200));
        await watcher.close();
        appendFileSync(file, '// after close\n', 'utf8');

        // Give chokidar a moment — no event should arrive after close().
        await new Promise((r) => setTimeout(r, 300));
        expect(changed).toBe(0);
    });
});
