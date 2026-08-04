/**
 * @personaforge/memory — ThreadStore contract.
 *
 * Persists {@link Thread}s and their {@link StorageMessage} history for the
 * Mastra-style inspired memory layer. Implementations: {@link InMemoryThreadStore}
 * (zero-config default), {@link LibSqlThreadStore} (libSQL file/remote — the
 * recommended production default) and {@link SqliteThreadStore}
 * (better-sqlite3, optional).
 */

import type { StorageMessage, Thread, ThreadMetadata, ThreadState } from './threads.js';

export interface CreateThreadInput {
    /** Explicit thread id (stable). Omitted → generated. */
    id?: string;
    resourceId: string;
    title?: string;
    metadata?: ThreadMetadata | Record<string, unknown>;
}

export interface UpdateThreadInput {
    title?: string;
    metadata?: ThreadMetadata | Record<string, unknown>;
    state?: ThreadState;
}

export interface ListThreadsOptions {
    resourceId?: string;
    title?: string;
    limit?: number;
    offset?: number;
}

export interface GetMessagesOptions {
    /** Maximum number of messages to return (chronological tail when not 0). */
    limit?: number;
    offset?: number;
    /** Include tool messages. Default true. */
    includeToolMessages?: boolean;
    /** Only messages with id after this one (OM cursor semantics). */
    afterId?: string;
    /** Only messages with id before this one. */
    beforeId?: string;
}

export interface ThreadStore {
    createThread(input: CreateThreadInput): Promise<Thread>;
    getThread(id: string): Promise<Thread | null>;
    getThreadByResourceId(resourceId: string): Promise<Thread[]>;
    updateThread(id: string, input: UpdateThreadInput): Promise<Thread>;
    deleteThread(id: string): Promise<void>;
    listThreads(options?: ListThreadsOptions): Promise<Thread[]>;

    /** Persist messages, assigning ids/timestamps, returning the stored rows. */
    saveMessages(threadId: string, messages: StorageMessage[]): Promise<StorageMessage[]>;

    /** Load messages for a thread, oldest-first. */
    getMessages(threadId: string, options?: GetMessagesOptions): Promise<StorageMessage[]>;

    /** Delete individual messages (used by OM trimming / PII redaction). */
    deleteMessages?(threadId: string, ids: string[]): Promise<void>;

    /** Optional total message count for a thread (used by pagination). */
    getMessageCount?(threadId: string): Promise<number>;

    /** Optional: close underlying connections. */
    close?(): Promise<void>;
}

/** No-op default for optional store hooks. */
export async function noopClose(): Promise<void> {}
