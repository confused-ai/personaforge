/**
 * Multi-modal content builders
 * ==============================
 * Convenience factories for building structured `MessageContent` arrays that
 * mix text, images, audio, video and file attachments.  These map directly to
 * the `MessageContent` union in `@personaforge/core` so they work with every
 * LLMProvider adapter that supports multi-modal input.
 *
 * Usage:
 *   import { image, audio, text, buildMessage, isVisionCapable } from './multimodal.js';
 *
 *   const msg = buildMessage('user', [
 *     text('Describe what you see:'),
 *     image.fromUrl('https://example.com/photo.jpg', 'high'),
 *   ]);
 *
 *   // or inline in an agent run:
 *   await agent.run({ prompt: buildMultimodalPrompt([
 *     image.fromBase64(buf, 'image/png'),
 *     text('What is in this image?'),
 *   ]) });
 */

import { readFile } from 'node:fs/promises';
import { extname }  from 'node:path';
import type { Message, MessageContent } from '../core/index.js';

// ── Re-declare content-part types locally (not exported from @personaforge/core) ──

interface TextContent {
    type: 'text';
    text: string;
}

interface ImageContent {
    type: 'image_url';
    image_url: { url: string; detail?: 'low' | 'high' | 'auto' };
}

// ── Content-part types ────────────────────────────────────────────────────────

export interface AudioContent {
    type: 'audio';
    audio: { url: string; format?: 'mp3' | 'wav' | 'ogg' | 'm4a' | 'flac' | 'webm' };
}

export interface VideoContent {
    type: 'video';
    video: { url: string; format?: 'mp4' | 'webm' | 'mov' };
}

export interface FileContent {
    type: 'file';
    file: { url: string; filename?: string; mimeType?: string };
}

/** Union of all supported content parts */
export type ContentPart = TextContent | ImageContent | AudioContent | VideoContent | FileContent;

// ── Text ──────────────────────────────────────────────────────────────────────

/** Create a text content part */
export function text(content: string): TextContent {
    return { type: 'text', text: content };
}

// ── Image ─────────────────────────────────────────────────────────────────────

export const image = {
    /**
     * Reference an image by URL (http/https or data URI).
     * @param url   - Publicly accessible image URL
     * @param detail - OpenAI detail level ('low' | 'high' | 'auto'). Default: 'auto'
     */
    fromUrl(url: string, detail: 'low' | 'high' | 'auto' = 'auto'): ImageContent {
        return { type: 'image_url', image_url: { url, detail } };
    },

    /**
     * Encode a raw buffer as a base64 data URI.
     * @param buffer   - Image bytes (Buffer or Uint8Array)
     * @param mimeType - e.g. 'image/png', 'image/jpeg', 'image/webp'
     * @param detail   - OpenAI detail level. Default: 'auto'
     */
    fromBase64(
        buffer: Buffer | Uint8Array,
        mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' = 'image/png',
        detail: 'low' | 'high' | 'auto' = 'auto',
    ): ImageContent {
        const b64 = Buffer.isBuffer(buffer)
            ? buffer.toString('base64')
            : Buffer.from(buffer).toString('base64');
        return { type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}`, detail } };
    },

    /**
     * Load an image from the local filesystem and encode as base64.
     * Infers MIME type from file extension (.png, .jpg/.jpeg, .webp, .gif).
     * @param filePath - Absolute or relative filesystem path
     * @param detail   - OpenAI detail level. Default: 'auto'
     */
    async fromFile(filePath: string, detail: 'low' | 'high' | 'auto' = 'auto'): Promise<ImageContent> {
        const buf  = await readFile(filePath);
        const mime = _imageMimeFromExt(extname(filePath).toLowerCase());
        return image.fromBase64(buf, mime, detail);
    },
} as const;

// ── Audio ─────────────────────────────────────────────────────────────────────

export const audio = {
    /** Reference an audio file by URL */
    fromUrl(url: string, format?: AudioContent['audio']['format']): AudioContent {
        return { type: 'audio', audio: { url, ...(format ? { format } : {}) } };
    },

    /** Encode an audio buffer as a base64 data URI */
    fromBase64(
        buffer: Buffer | Uint8Array,
        mimeType: 'audio/mp3' | 'audio/wav' | 'audio/ogg' | 'audio/webm' = 'audio/wav',
        format?: AudioContent['audio']['format'],
    ): AudioContent {
        const b64 = Buffer.isBuffer(buffer)
            ? buffer.toString('base64')
            : Buffer.from(buffer).toString('base64');
        return { type: 'audio', audio: { url: `data:${mimeType};base64,${b64}`, ...(format ? { format } : {}) } };
    },

    /** Load an audio file from the filesystem */
    async fromFile(filePath: string): Promise<AudioContent> {
        const buf  = await readFile(filePath);
        const fmt  = _audioFormatFromExt(extname(filePath).toLowerCase());
        const mime = `audio/${fmt}` as AudioContent['audio']['format'];
        return audio.fromBase64(buf, `audio/${fmt}`, mime);
    },
} as const;

// ── Video ─────────────────────────────────────────────────────────────────────

export const video = {
    /** Reference a video by URL */
    fromUrl(url: string, format?: VideoContent['video']['format']): VideoContent {
        return { type: 'video', video: { url, ...(format ? { format } : {}) } };
    },
} as const;

// ── File attachment ───────────────────────────────────────────────────────────

export const file = {
    /** Attach a file by URL */
    fromUrl(url: string, filename?: string, mimeType?: string): FileContent {
        return { type: 'file', file: { url, ...(filename ? { filename } : {}), ...(mimeType ? { mimeType } : {}) } };
    },
} as const;

// ── Message builder ───────────────────────────────────────────────────────────

/**
 * Build a `Message` with an array of content parts.
 *
 * @example
 * const msg = buildMessage('user', [
 *   text('What breed is this dog?'),
 *   image.fromUrl('https://example.com/dog.jpg'),
 * ]);
 */
export function buildMessage(
    role: Message['role'],
    parts: ContentPart[],
): Message {
    return { role, content: parts };
}

/**
 * Stringify multi-modal content back to a plain text string (strips non-text parts).
 * Useful for logging, fallback providers, or audit logs.
 */
export function contentToText(content: MessageContent): string {
    if (typeof content === 'string') return content;
    return content
        .filter((p): p is TextContent => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
}

// ── Capability detection ──────────────────────────────────────────────────────

/** Known vision-capable model name substrings (lower-case) */
const VISION_MODELS = [
    'gpt-4o', 'gpt-4-turbo', 'gpt-4-vision',
    'claude-3', 'claude-opus', 'claude-sonnet', 'claude-haiku',
    'gemini-pro-vision', 'gemini-1.5', 'gemini-2',
    'llava', 'bakllava', 'moondream', 'cogvlm',
    'pixtral', 'qwen-vl', 'internvl',
] as const;

/** Known audio-input-capable model name substrings (lower-case) */
const AUDIO_MODELS = [
    'gpt-4o-audio', 'whisper', 'gemini-2.0-flash',
    'claude-3-5-haiku', // hypothetical
] as const;

/**
 * Heuristic check: does this model string suggest vision capability?
 * Pass the model ID exactly as you would to your LLM provider.
 */
export function isVisionCapable(modelId: string): boolean {
    const lower = modelId.toLowerCase();
    return VISION_MODELS.some((m) => lower.includes(m));
}

/**
 * Heuristic check: does this model string suggest audio-input capability?
 */
export function isAudioCapable(modelId: string): boolean {
    const lower = modelId.toLowerCase();
    return AUDIO_MODELS.some((m) => lower.includes(m));
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _imageMimeFromExt(ext: string): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' {
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif')  return 'image/gif';
    return 'image/png'; // default
}

function _audioFormatFromExt(ext: string): 'mp3' | 'wav' | 'ogg' | 'webm' {
    if (ext === '.mp3')  return 'mp3';
    if (ext === '.ogg')  return 'ogg';
    if (ext === '.webm') return 'webm';
    return 'wav'; // default
}
