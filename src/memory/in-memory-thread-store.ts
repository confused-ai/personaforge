/**
 * @personaforge/memory — in-memory ThreadStore.
 *
 * Map-backed, process-lifetime storage. Threads and messages live in memory and
 * are lost on restart. This is the zero-config fallback when neither libSQL nor
 * better-sqlite3 is installed. For durable memory use {@link LibSqlThreadStore}.
 */

import { newId } from '../contracts/index.js';
import type {
    CreateThreadInput,
    GetMessagesOptions,
    ListThreadsOptions,
    ThreadStore,
    UpdateThreadInput,
} from './thread-store.js';
import type { StorageMessage, Thread, ThreadMetadata, ThreadState } from './threads.js';

/** Internal mutable record (Thread fields are readonly in the public shape). */
interface MutableThread {
    id: string;
    resourceId: string;
    title?: string;
    metadata: ThreadMetadata;
    createdAt: string;
    updatedAt: string;
    createdAtMs: number;
}

type StoredMessage = StorageMessage & { createdAtMs: number };

const SORTED = (a: { id?: string; createdAtMs: number }, b: { id?: string; createdAtMs: number }) => a.createdAtMs - b.createdAtMs;

export class InMemoryThreadStore implements ThreadStore {
    private readonly threads = new Map<string, MutableThread>();
    private readonly states = new Map<string, ThreadState>();
    private readonly messages = new Map<string, Map<string, StoredMessage>>();

    async createThread(input: CreateThreadInput): Promise<Thread> {
        const id = input.id ?? newId('thr');
        if (this.threads.has(id)) throw new Error(`InMemoryThreadStore: thread "${id}" already exists`);
        const now = new Date();
        const createdAtMs = now.getTime();
        const thread: MutableThread = {
            id,
            resourceId: input.resourceId,
            title: input.title,
            metadata: { ...(input.metadata ?? {}) },
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            createdAtMs,
        };
        this.threads.set(id, thread);
        this.messages.set(id, new Map());
        return stripThread(thread);
    }

    async getThread(id: string): Promise<Thread | null> {
        const thread = this.threads.get(id);
        if (!thread) return null;
        return { ...stripThread(thread), state: this.states.get(id) };
    }

    async getThreadByResourceId(resourceId: string): Promise<Thread[]> {
        const out: Thread[] = [];
        for (const thread of this.threads.values()) {
            if (thread.resourceId === resourceId) {
                out.push({ ...stripThread(thread), state: this.states.get(thread.id) });
            }
        }
        return out.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    }

    async updateThread(id: string, input: UpdateThreadInput): Promise<Thread> {
        const thread = this.threads.get(id);
        if (!thread) throw new Error(`InMemoryThreadStore: thread "${id}" not found`);
        if (input.title !== undefined) thread.title = input.title;
        if (input.metadata !== undefined) thread.metadata = { ...input.metadata };
        if (input.state !== undefined) this.states.set(id, input.state);
        thread.updatedAt = new Date().toISOString();
        return { ...stripThread(thread), state: this.states.get(id) };
    }

    async deleteThread(id: string): Promise<void> {
        this.threads.delete(id);
        this.states.delete(id);
        this.messages.delete(id);
    }

    async listThreads(options: ListThreadsOptions = {}): Promise<Thread[]> {
        let list = [...this.threads.values()].sort((a, b) => b.createdAtMs - a.createdAtMs);
        if (options.resourceId) list = list.filter((t) => t.resourceId === options.resourceId);
        if (options.title) list = list.filter((t) => t.title?.toLowerCase().includes(options.title!.toLowerCase()));
        const offset = options.offset ?? 0;
        const limit = options.limit ?? list.length;
        return list
            .slice(offset, offset + limit)
            .map((t) => ({ ...stripThread(t), state: this.states.get(t.id) }));
    }

    async saveMessages(threadId: string, messages: StorageMessage[]): Promise<StorageMessage[]> {
        let bucket = this.messages.get(threadId);
        if (!bucket) {
            bucket = new Map();
            this.messages.set(threadId, bucket);
        }
        const stored: StorageMessage[] = [];
        for (const message of messages) {
            const id = message.id ?? newId('msg');
            const createdAtMs = message.createdAt ? Date.parse(message.createdAt) : Date.now();
            const row: StoredMessage = {
                ...message,
                id,
                threadId,
                createdAtMs,
                createdAt: message.createdAt ?? new Date(createdAtMs).toISOString(),
            };
            bucket.set(id, row);
            stored.push(stripMessage(row));
        }
        return stored;
    }

    async getMessages(threadId: string, options: GetMessagesOptions = {}): Promise<StorageMessage[]> {
        const bucket = this.messages.get(threadId);
        if (!bucket) return [];
        let list = [...bucket.values()].sort(SORTED);
        if (options.afterId) {
            const idx = list.findIndex((m) => m.id === options.afterId);
            if (idx >= 0) list = list.slice(idx + 1);
        }
        if (options.beforeId) {
            const idx = list.findIndex((m) => m.id === options.beforeId);
            if (idx >= 0) list = list.slice(0, idx);
        }
        if (options.includeToolMessages === false) list = list.filter((m) => m.role !== 'tool');
        const offset = options.offset ?? 0;
        if (options.limit && options.limit > 0) list = list.slice(offset, offset + options.limit);
        return list.map(stripMessage);
    }

    async deleteMessages(threadId: string, ids: string[]): Promise<void> {
        const bucket = this.messages.get(threadId);
        if (!bucket) return;
        for (const id of ids) bucket.delete(id);
    }

    async getMessageCount(threadId: string): Promise<number> {
        return this.messages.get(threadId)?.size ?? 0;
    }

    /** Estimate of all stored messages (for tests / diagnostics). */
    get size(): number {
        let n = 0;
        for (const bucket of this.messages.values()) n += bucket.size;
        return n;
    }
}

function stripMessage(row: StoredMessage): StorageMessage {
    const { createdAtMs: _ms, ...rest } = row;
    void _ms;
    return rest;
}

function stripThread(thread: MutableThread): Thread {
    const { createdAtMs: _ms, ...rest } = thread;
    void _ms;
    return rest;
}
