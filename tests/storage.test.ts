/**
 * Tests: Storage module — MemoryStorageAdapter + FileStorageAdapter + typed Storage
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStorage } from '@personaforge/storage';

describe('In-memory storage', () => {
    it('stores and retrieves typed values', async () => {
        const store = createStorage();
        await store.set('key1', { name: 'Alice', score: 42 });
        const val = await store.get<{ name: string; score: number }>('key1');
        expect(val?.name).toBe('Alice');
        expect(val?.score).toBe(42);
    });

    it('returns undefined for missing keys', async () => {
        const store = createStorage();
        const val = await store.get('nonexistent');
        expect(val).toBeUndefined();
    });

    it('deletes keys', async () => {
        const store = createStorage();
        await store.set('del-key', 'hello');
        await store.delete('del-key');
        expect(await store.has('del-key')).toBe(false);
    });

    it('lists keys by prefix', async () => {
        const store = createStorage();
        await store.set('user:1', 'Alice');
        await store.set('user:2', 'Bob');
        await store.set('session:1', 'sess');
        const users = await store.list('user:');
        expect(users).toContain('user:1');
        expect(users).toContain('user:2');
        expect(users).not.toContain('session:1');
    });

    it('checks key existence', async () => {
        const store = createStorage();
        await store.set('exists', true);
        expect(await store.has('exists')).toBe(true);
        expect(await store.has('not-exists')).toBe(false);
    });

    it('clears all keys', async () => {
        const store = createStorage();
        await store.set('a', 1);
        await store.set('b', 2);
        await store.clear();
        expect(await store.list()).toHaveLength(0);
    });

    it('respects TTL expiry', async () => {
        const store = createStorage();
        await store.set('ttl-key', 'value', 0.001); // 1ms TTL
        await new Promise((r) => setTimeout(r, 10)); // wait for expiry
        const val = await store.get('ttl-key');
        expect(val).toBeUndefined();
    });
});

describe('File-based storage', () => {
    let tmpDir: string;

    afterEach(async () => {
        if (tmpDir) {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('persists values to disk', async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ca-storage-'));
        const store = createStorage({ driver: 'file', basePath: tmpDir });

        await store.set('persist:key', { value: 'disk-data' });
        const val = await store.get<{ value: string }>('persist:key');
        expect(val?.value).toBe('disk-data');
    });

    it('lists keys from disk', async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ca-storage-'));
        const store = createStorage({ driver: 'file', basePath: tmpDir });

        await store.set('a', 1);
        await store.set('b', 2);
        const keys = await store.list();
        expect(keys).toContain('a');
        expect(keys).toContain('b');
    });

    it('deletes files from disk', async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ca-storage-'));
        const store = createStorage({ driver: 'file', basePath: tmpDir });

        await store.set('del-file', 'hello');
        await store.delete('del-file');
        expect(await store.has('del-file')).toBe(false);
    });
});
