/**
 * Hermetic coverage for src/video/video.ts — VideoOrchestrator with mocked
 * optional peers (openai, pexels, fluent-ffmpeg) and fetch.
 * No network. Callers: vitest only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Mock optional peer deps BEFORE importing the module under test
const openaiChatMock = vi.fn();
const openaiSpeechMock = vi.fn();
vi.mock('openai', () => ({
    default: class {
        chat = { completions: { create: openaiChatMock } };
        audio = { speech: { create: openaiSpeechMock } };
    },
}));

const pexelsSearchMock = vi.fn();
vi.mock('pexels', () => ({
    createClient: () => ({ videos: { search: pexelsSearchMock } }),
}));

const ffmpegFactoryMock = vi.fn().mockImplementation(() => {
    const cmd: Record<string, unknown> = {};
    cmd.input = vi.fn().mockReturnValue(cmd);
    cmd.inputOptions = vi.fn().mockReturnValue(cmd);
    cmd.outputOptions = vi.fn().mockReturnValue(cmd);
    cmd.save = vi.fn().mockReturnValue(cmd);
    cmd.on = vi.fn().mockImplementation((event: string, cb: () => void) => {
        if (event === 'end') setTimeout(cb, 0);
        return cmd;
    });
    return cmd;
});
vi.mock('fluent-ffmpeg', () => ({ default: ffmpegFactoryMock }));
vi.mock('@ffmpeg-installer/ffmpeg', () => ({ default: { path: '/fake/ffmpeg' } }));

import { VideoOrchestrator } from '../src/video/video.js';

describe('video VideoOrchestrator', () => {
    const saved: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const k of ['OPENAI_API_KEY', 'PEXELS_API_KEY']) {
            saved[k] = process.env[k];
        }
        process.env.OPENAI_API_KEY = 'sk-test';
        process.env.PEXELS_API_KEY = 'pexels-test';
        openaiChatMock.mockReset();
        openaiSpeechMock.mockReset();
        pexelsSearchMock.mockReset();
        ffmpegFactoryMock.mockClear();
        ffmpegFactoryMock.mockImplementation(() => {
            const cmd: Record<string, unknown> = {};
            cmd.input = vi.fn().mockReturnValue(cmd);
            cmd.inputOptions = vi.fn().mockReturnValue(cmd);
            cmd.outputOptions = vi.fn().mockReturnValue(cmd);
            cmd.save = vi.fn().mockReturnValue(cmd);
            cmd.on = vi.fn().mockImplementation((event: string, cb: () => void) => {
                if (event === 'end') setTimeout(cb, 0);
                return cmd;
            });
            return cmd;
        });
    });

    afterEach(() => {
        for (const k of ['OPENAI_API_KEY', 'PEXELS_API_KEY']) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
        // cleanup temp dirs created by the orchestrator
        const tempDir = path.join(process.cwd(), 'temp_videos');
        if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    });

    // NOTE: missing-key tests must run FIRST (before the happy path caches the
    // module-level client singletons). Vitest runs in declaration order, and
    // getOpenai()/getPexels() cache their clients in module scope.
    it('fails gracefully when OPENAI_API_KEY missing', async () => {
        delete process.env.OPENAI_API_KEY;
        const orch = new VideoOrchestrator();
        const result = await orch.generateShort('topic');
        expect(result.success).toBe(false);
        expect(result.error).toContain('OPENAI_API_KEY');
    });

    it('fails gracefully when PEXELS_API_KEY missing', async () => {
        openaiChatMock.mockResolvedValue({ choices: [{ message: { content: 'Script' } }] });
        openaiSpeechMock.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1]).buffer });
        delete process.env.PEXELS_API_KEY;
        const orch = new VideoOrchestrator();
        const result = await orch.generateShort('topic');
        expect(result.success).toBe(false);
        expect(result.error).toContain('PEXELS_API_KEY');
    });

    it('full happy path generates a short', async () => {
        openaiChatMock.mockResolvedValue({ choices: [{ message: { content: 'Script here' } }] });
        openaiSpeechMock.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
        pexelsSearchMock.mockResolvedValue({
            videos: [{ video_files: [{ quality: 'hd', link: 'https://example.com/v.mp4' }] }],
        });
        const origFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([9, 9]), { status: 200 })) as never;

        const orch = new VideoOrchestrator();
        const result = await orch.generateShort('cats');
        expect(result.success).toBe(true);
        expect(result.videoPath).toMatch(/final_.*\.mp4/);
        expect(ffmpegFactoryMock).toHaveBeenCalled();

        globalThis.fetch = origFetch;
    });

    it('fails when no background videos found', async () => {
        openaiChatMock.mockResolvedValue({ choices: [{ message: { content: 'Script' } }] });
        openaiSpeechMock.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1]).buffer });
        pexelsSearchMock.mockResolvedValue({ videos: [] });
        const orch = new VideoOrchestrator();
        const result = await orch.generateShort('topic');
        expect(result.success).toBe(false);
        expect(result.error).toContain('Could not find any background videos');
    });

    it('fails when pexels response has no videos key', async () => {
        openaiChatMock.mockResolvedValue({ choices: [{ message: { content: 'Script' } }] });
        openaiSpeechMock.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1]).buffer });
        pexelsSearchMock.mockResolvedValue({});
        const orch = new VideoOrchestrator();
        const result = await orch.generateShort('topic');
        expect(result.success).toBe(false);
        expect(result.error).toContain('Could not find any background videos');
    });

    it('fails when download fails (non-ok response)', async () => {
        openaiChatMock.mockResolvedValue({ choices: [{ message: { content: 'Script' } }] });
        openaiSpeechMock.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1]).buffer });
        pexelsSearchMock.mockResolvedValue({
            videos: [{ video_files: [{ quality: 'sd', link: 'https://example.com/v.mp4' }] }],
        });
        const origFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as never;
        const orch = new VideoOrchestrator();
        const result = await orch.generateShort('topic');
        expect(result.success).toBe(false);
        expect(result.error).toContain('Failed to download');
        globalThis.fetch = origFetch;
    });

    it('generates content fallback when script empty; ffmpeg error path', async () => {
        openaiChatMock.mockResolvedValue({ choices: [{ message: { content: null } }] });
        openaiSpeechMock.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1]).buffer });
        pexelsSearchMock.mockResolvedValue({
            videos: [{ video_files: [{ quality: 'hd', link: 'https://example.com/v.mp4' }] }],
        });
        const origFetch = globalThis.fetch;
        globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 })) as never;

        // ffmpeg error
        const errCmd: Record<string, unknown> = {};
        errCmd.input = vi.fn().mockReturnValue(errCmd);
        errCmd.inputOptions = vi.fn().mockReturnValue(errCmd);
        errCmd.outputOptions = vi.fn().mockReturnValue(errCmd);
        errCmd.save = vi.fn().mockReturnValue(errCmd);
        errCmd.on = vi.fn().mockImplementation((event: string, cb: (e?: Error) => void) => {
            if (event === 'error') setTimeout(() => cb(new Error('encode fail')), 0);
            return errCmd;
        });
        ffmpegFactoryMock.mockReturnValueOnce(errCmd);

        const orch = new VideoOrchestrator();
        const result = await orch.generateShort('topic');
        expect(result.success).toBe(false);
        expect(result.error).toContain('FFmpeg error');
        globalThis.fetch = origFetch;
    });
});
