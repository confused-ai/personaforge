/**
 * Resumable Streaming — Stream Reconnection
 *
 * Enables clients to reconnect to in-flight streams after refresh/disconnect:
 * - Checkpoint-based stream state persistence
 * - Automatic resume from last position
 * - SSE-compatible output format
 */

import { newId } from '../contracts/index.js';

/** Stream checkpoint for resumption */
export interface StreamCheckpoint {
    /** Unique stream ID */
    readonly streamId: string;
    /** Position in the stream (chunk index) */
    readonly position: number;
    /** Accumulated content up to this point */
    readonly accumulatedContent: string;
    /** Tool calls seen so far */
    readonly toolCalls: Array<{
        id: string;
        name: string;
        arguments: string;
    }>;
    /** Stream start time */
    readonly startedAt: Date;
    /** Last activity time */
    readonly lastActivityAt: Date;
    /** Is stream complete? */
    readonly isComplete: boolean;
    /** Finish reason if complete */
    readonly finishReason?: string;
}

/** Resumable stream configuration */
export interface ResumableStreamConfig {
    /** Maximum age of resumable streams in ms (default: 5 minutes) */
    readonly maxAgeMs?: number;
    /** Cleanup interval in ms (default: 1 minute) */
    readonly cleanupIntervalMs?: number;
    /** Maximum number of stored streams (default: 1000) */
    readonly maxStreams?: number;
}

/** Stream chunk for SSE */
export interface StreamChunkSSE {
    readonly id: string;
    readonly event: 'delta' | 'error' | 'done';
    readonly data: {
        type: 'text' | 'tool_call';
        content?: string;
        toolCall?: {
            id: string;
            name: string;
            arguments: string;
        };
    };
    readonly position: number;
}

/**
 * ResumableStreamManager - manages stream checkpoints for reconnection.
 *
 * @example
 * const manager = new ResumableStreamManager();
 *
 * // Start a stream
 * const streamId = manager.createStream();
 *
 * // As chunks arrive, save checkpoints
 * manager.saveChunk(streamId, { type: 'text', content: 'Hello' });
 *
 * // Client reconnects - get missed content
 * const checkpoint = manager.getCheckpoint(streamId);
 * const missedChunks = manager.getChunksSince(streamId, clientPosition);
 */
export class ResumableStreamManager {
    private readonly streams = new Map<string, StreamCheckpoint>();
    private readonly chunks = new Map<string, StreamChunkSSE[]>();
    private readonly config: Required<ResumableStreamConfig>;
    private cleanupTimer: NodeJS.Timeout | null = null;

    constructor(config: ResumableStreamConfig = {}) {
        this.config = {
            maxAgeMs: config.maxAgeMs ?? 5 * 60 * 1000, // 5 minutes
            cleanupIntervalMs: config.cleanupIntervalMs ?? 60 * 1000, // 1 minute
            maxStreams: config.maxStreams ?? 1000,
        };

        this.startCleanup();
    }

    /** Create a new resumable stream */
    createStream(): string {
        const streamId = this.generateId();
        const now = new Date();

        // Evict if at capacity
        if (this.streams.size >= this.config.maxStreams) {
            this.evictOldest();
        }

        this.streams.set(streamId, {
            streamId,
            position: 0,
            accumulatedContent: '',
            toolCalls: [],
            startedAt: now,
            lastActivityAt: now,
            isComplete: false,
        });

        this.chunks.set(streamId, []);

        return streamId;
    }

    /** Get current checkpoint for a stream */
    getCheckpoint(streamId: string): StreamCheckpoint | null {
        return this.streams.get(streamId) ?? null;
    }

    /** Save a chunk to the stream */
    saveChunk(
        streamId: string,
        chunk: { type: 'text'; content: string } | { type: 'tool_call'; toolCall: { id: string; name: string; arguments: string } }
    ): StreamChunkSSE | null {
        const checkpoint = this.streams.get(streamId);
        if (!checkpoint) return null;

        const position = checkpoint.position + 1;
        const now = new Date();

        // Create SSE chunk
        const sseChunk: StreamChunkSSE = {
            id: `${streamId}_${position}`,
            event: 'delta',
            data: chunk.type === 'text'
                ? { type: 'text', content: chunk.content }
                : { type: 'tool_call', toolCall: chunk.toolCall },
            position,
        };

        // Save chunk
        this.chunks.get(streamId)!.push(sseChunk);

        // Update checkpoint
        const newToolCalls = chunk.type === 'tool_call'
            ? [...checkpoint.toolCalls, chunk.toolCall]
            : checkpoint.toolCalls;

        this.streams.set(streamId, {
            ...checkpoint,
            position,
            accumulatedContent: checkpoint.accumulatedContent + (chunk.type === 'text' ? chunk.content : ''),
            toolCalls: newToolCalls,
            lastActivityAt: now,
        });

        return sseChunk;
    }

    /** Complete the stream */
    completeStream(streamId: string, finishReason = 'stop'): void {
        const checkpoint = this.streams.get(streamId);
        if (!checkpoint) return;

        this.streams.set(streamId, {
            ...checkpoint,
            isComplete: true,
            finishReason,
            lastActivityAt: new Date(),
        });

        // Send done event
        this.chunks.get(streamId)?.push({
            id: `${streamId}_done`,
            event: 'done',
            data: { type: 'text', content: finishReason },
            position: checkpoint.position + 1,
        });
    }

    /** Get all chunks since a position (for resume) */
    getChunksSince(streamId: string, position: number): StreamChunkSSE[] {
        const chunks = this.chunks.get(streamId);
        if (!chunks) return [];

        return chunks.filter(c => c.position > position);
    }

    /** Get all chunks for a stream */
    getAllChunks(streamId: string): StreamChunkSSE[] {
        return this.chunks.get(streamId) ?? [];
    }

    /** Check if stream exists and is active */
    isStreamActive(streamId: string): boolean {
        const checkpoint = this.streams.get(streamId);
        return checkpoint !== undefined && !checkpoint.isComplete;
    }

    /** Delete a stream */
    deleteStream(streamId: string): boolean {
        this.chunks.delete(streamId);
        return this.streams.delete(streamId);
    }

    /** Shutdown the manager */
    shutdown(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    // --- Private ---

    private generateId(): string {
        return newId('stream');
    }

    private startCleanup(): void {
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, this.config.cleanupIntervalMs);
        this.cleanupTimer.unref?.();
    }

    private cleanup(): void {
        const now = Date.now();
        const maxAge = this.config.maxAgeMs;

        for (const [streamId, checkpoint] of this.streams.entries()) {
            const age = now - checkpoint.lastActivityAt.getTime();
            if (age > maxAge) {
                this.deleteStream(streamId);
            }
        }
    }

    private evictOldest(): void {
        let oldest: StreamCheckpoint | null = null;
        let oldestId = '';

        for (const [id, checkpoint] of this.streams.entries()) {
            if (!oldest || checkpoint.lastActivityAt < oldest.lastActivityAt) {
                oldest = checkpoint;
                oldestId = id;
            }
        }

        if (oldestId) {
            this.deleteStream(oldestId);
        }
    }
}

/**
 * Format a chunk for SSE transmission
 */
export function formatSSE(chunk: StreamChunkSSE): string {
    return `id: ${chunk.id}\nevent: ${chunk.event}\ndata: ${JSON.stringify(chunk.data)}\n\n`;
}

/**
 * Create a resumable stream wrapper for async generators
 */
export function createResumableStream(
    manager: ResumableStreamManager,
    generator: AsyncGenerator<{ type: 'text'; content: string } | { type: 'tool_call'; toolCall: { id: string; name: string; arguments: string } }>
): { streamId: string; stream: AsyncGenerator<StreamChunkSSE> } {
    const streamId = manager.createStream();

    async function* wrappedGenerator(): AsyncGenerator<StreamChunkSSE> {
        try {
            for await (const chunk of generator) {
                const sseChunk = manager.saveChunk(streamId, chunk);
                if (sseChunk) {
                    yield sseChunk;
                }
            }
            manager.completeStream(streamId);
        } catch (error) {
            manager.completeStream(streamId, 'error');
            throw error;
        }
    }

    return { streamId, stream: wrappedGenerator() };
}
