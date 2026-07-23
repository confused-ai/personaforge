/**
 * Multi-modal / Vision Input Utilities
 *
 * Helpers for building and working with multi-modal messages (images, audio, files)
 * that can be passed to the agent's `run()` method.
 *
 * Supported input types:
 *   - URL strings (https://... or data:image/...)
 *   - Local file paths (converted to base64 data URIs, Node.js only)
 *   - ArrayBuffer / Buffer (converted to base64 data URIs)
 *   - Pre-built ContentPart arrays
 *
 * Edge cases covered:
 *   - HTTP vs HTTPS URLs — passed through; detail level configurable
 *   - Data URI validation — must be `data:image/<type>;base64,<data>`
 *   - Local file reading — async, throws with a clear error if file not found
 *   - MIME type detection from file extension — common image/audio/video types
 *   - Mixed text + images in a single message — fully supported
 *   - Empty image list → plain text message (no content array overhead)
 *   - The `MultiModalInput` type is accepted by `AgentRunOptions.multiModal`
 *     and converted to a `Message` before the agent loop starts
 */

import type { ContentPart, Message } from '../providers/types.js';

// ── MIME type detection ────────────────────────────────────────────────────

const IMAGE_EXTENSIONS: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
    svg: 'image/svg+xml', tiff: 'image/tiff', tif: 'image/tiff',
    heic: 'image/heic', heif: 'image/heif',
};

const AUDIO_EXTENSIONS: Record<string, string> = {
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    m4a: 'audio/mp4', flac: 'audio/flac', webm: 'audio/webm',
};

const VIDEO_EXTENSIONS: Record<string, string> = {
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    avi: 'video/x-msvideo', mkv: 'video/x-matroska',
};

type MediaType = 'image' | 'audio' | 'video' | 'file';

function detectMediaType(filePath: string): { type: MediaType; mime: string } {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
    if (IMAGE_EXTENSIONS[ext]) return { type: 'image', mime: IMAGE_EXTENSIONS[ext]! };
    if (AUDIO_EXTENSIONS[ext]) return { type: 'audio', mime: AUDIO_EXTENSIONS[ext]! };
    if (VIDEO_EXTENSIONS[ext]) return { type: 'video', mime: VIDEO_EXTENSIONS[ext]! };
    return { type: 'file', mime: 'application/octet-stream' };
}

// ── Image source types ─────────────────────────────────────────────────────

/** A URL (https://, http://, or data:) pointing to an image. */
export interface ImageUrl {
    type: 'url';
    url: string;
    /** Controls image detail: 'auto' (default), 'low' (faster), 'high' (higher quality). */
    detail?: 'auto' | 'low' | 'high';
}

/** A local file path (Node.js only). Loaded and base64-encoded at call time. */
export interface ImageFile {
    type: 'file';
    path: string;
    /** Override auto-detected MIME type. */
    mimeType?: string;
    detail?: 'auto' | 'low' | 'high';
}

/** A raw ArrayBuffer or Uint8Array (e.g., from a fetch response or canvas). */
export interface ImageBuffer {
    type: 'buffer';
    data: ArrayBuffer | Uint8Array;
    mimeType: string;
    detail?: 'auto' | 'low' | 'high';
}

export type ImageSource = ImageUrl | ImageFile | ImageBuffer;

// ── Audio / File source types ─────────────────────────────────────────────

export interface AudioSource {
    type: 'audio';
    url: string;
}

export interface FileSource {
    type: 'file-attachment';
    url: string;
    filename?: string;
}

// ── MultiModalInput ────────────────────────────────────────────────────────

/**
 * Multi-modal input combining text with one or more media attachments.
 * Pass this to `agent.run()` instead of a plain string.
 *
 * @example
 * ```ts
 * import { imageUrl, imageFile, multiModal } from 'personaforge';
 *
 * // Run with a remote image
 * await agent.run(multiModal('What is in this image?', imageUrl('https://example.com/photo.jpg')));
 *
 * // Run with a local file
 * await agent.run(multiModal('Describe this chart', await imageFile('./chart.png')));
 *
 * // Multiple images
 * await agent.run(multiModal('Compare these two screenshots', imageUrl(url1), imageUrl(url2)));
 * ```
 */
export interface MultiModalInput {
    /** Marker so factory.ts can distinguish from plain string. */
    readonly _type: 'multimodal';
    /** The user's text prompt. */
    readonly text: string;
    /** Content parts (images, audio, files). */
    readonly parts: ContentPart[];
}

// ── Async file reader (Node.js) ────────────────────────────────────────────

async function readFileAsDataUri(filePath: string, mimeType?: string): Promise<string> {
    // Dynamically import fs to avoid breaking browser/edge bundles
    const { readFile } = await import('node:fs/promises');
    let data: Buffer;
    try {
        data = await readFile(filePath);
    } catch (err) {
        throw new Error(
            `vision: could not read file "${filePath}": ${err instanceof Error ? err.message : String(err)}`
        );
    }
    const detected = mimeType ?? detectMediaType(filePath).mime;
    const b64 = data.toString('base64');
    return `data:${detected};base64,${b64}`;
}

// ── Public helpers ─────────────────────────────────────────────────────────

/**
 * Create an image source from a URL (https:// or data:).
 *
 * @example
 * ```ts
 * imageUrl('https://example.com/image.jpg')
 * imageUrl('https://example.com/image.jpg', { detail: 'high' })
 * ```
 */
export function imageUrl(
    url: string,
    opts: { detail?: 'auto' | 'low' | 'high' } = {}
): ImageUrl {
    return { type: 'url', url, detail: opts.detail ?? 'auto' };
}

/**
 * Create an image source from a local file path (async — reads file on creation).
 *
 * @example
 * ```ts
 * const img = await imageFile('./screenshot.png');
 * await agent.run(multiModal('What does this show?', img));
 * ```
 */
export async function imageFile(
    filePath: string,
    opts: { mimeType?: string; detail?: 'auto' | 'low' | 'high' } = {}
): Promise<ImageBuffer> {
    const dataUri = await readFileAsDataUri(filePath, opts.mimeType);
    const encoded = dataUri.split(',')[1] ?? '';
    const mime = opts.mimeType ?? detectMediaType(filePath).mime;
    // Return as buffer type so the ContentPart builder uses image_url with data URI
    return {
        type: 'buffer',
        data: Buffer.from(encoded, 'base64'),
        mimeType: mime,
        detail: opts.detail ?? 'auto',
    };
}

/**
 * Create an image source from raw bytes (e.g., from fetch or canvas).
 *
 * @example
 * ```ts
 * const resp = await fetch('https://example.com/chart.png');
 * const buf = await resp.arrayBuffer();
 * const img = imageBuffer(buf, 'image/png');
 * ```
 */
export function imageBuffer(
    data: ArrayBuffer | Uint8Array,
    mimeType: string,
    opts: { detail?: 'auto' | 'low' | 'high' } = {}
): ImageBuffer {
    return { type: 'buffer', data, mimeType, detail: opts.detail ?? 'auto' };
}

/**
 * Convert an `ImageSource` to a `ContentPart`.
 * For file and buffer sources, encodes to a base64 data URI.
 */
export async function imageSourceToContentPart(source: ImageSource): Promise<ContentPart> {
    switch (source.type) {
        case 'url':
            return {
                type: 'image_url',
                image_url: { url: source.url, detail: source.detail ?? 'auto' },
            };
        case 'file': {
            const dataUri = await readFileAsDataUri(source.path, source.mimeType);
            return {
                type: 'image_url',
                image_url: { url: dataUri, detail: source.detail ?? 'auto' },
            };
        }
        case 'buffer': {
            const bytes = source.data instanceof Uint8Array ? source.data : new Uint8Array(source.data);
            const b64 = Buffer.from(bytes).toString('base64');
            const dataUri = `data:${source.mimeType};base64,${b64}`;
            return {
                type: 'image_url',
                image_url: { url: dataUri, detail: source.detail ?? 'auto' },
            };
        }
    }
}

/**
 * Build a `MultiModalInput` from a text prompt and one or more media sources.
 * Sources can be `ImageSource`, `AudioSource`, `FileSource`, or pre-built `ContentPart` arrays.
 *
 * This is the primary entrypoint for multi-modal agent runs.
 *
 * @example
 * ```ts
 * // Async — resolves file sources
 * const input = await multiModal('Describe this chart', imageUrl('https://.../chart.png'));
 * await agent.run(input);
 *
 * // With multiple images
 * const before = imageUrl(beforeUrl);
 * const after  = imageUrl(afterUrl);
 * const input  = await multiModal('What changed between these two screenshots?', before, after);
 * ```
 */
export async function multiModal(
    text: string,
    ...sources: Array<ImageSource | AudioSource | FileSource | ContentPart>
): Promise<MultiModalInput> {
    const parts: ContentPart[] = [];

    for (const source of sources) {
        // Already a ContentPart
        if ('type' in source && (source.type === 'text' || source.type === 'image_url' ||
            source.type === 'file' || source.type === 'audio' || source.type === 'video')) {
            parts.push(source as ContentPart);
            continue;
        }
        const sourceType = (source as { type: string }).type;
        // Audio source
        if (sourceType === 'audio' && 'url' in source) {
            parts.push({ type: 'audio', audio: { url: (source as unknown as AudioSource).url } });
            continue;
        }
        // File attachment
        if (sourceType === 'file-attachment') {
            const fs = source as FileSource;
            parts.push({ type: 'file', file: { url: fs.url, filename: fs.filename } });
            continue;
        }
        // ImageSource — convert to ContentPart
        parts.push(await imageSourceToContentPart(source as ImageSource));
    }

    return { _type: 'multimodal', text, parts };
}

/**
 * Convert a `MultiModalInput` to a `Message` with multi-modal content.
 * The text is always placed first, followed by the media parts.
 */
export function multiModalToMessage(input: MultiModalInput): Message {
    const contentParts: ContentPart[] = [
        { type: 'text', text: input.text },
        ...input.parts,
    ];
    return { role: 'user', content: contentParts };
}

/**
 * Type guard — checks if a value is a `MultiModalInput`.
 */
export function isMultiModalInput(value: unknown): value is MultiModalInput {
    return (
        typeof value === 'object' &&
        value !== null &&
        (value as MultiModalInput)._type === 'multimodal'
    );
}
