/**
 * Mock memory store for unit testing.
 *
 * Wraps InMemoryStore to provide functional correctness (similarity search, limits)
 * while exposing audit logs of all operations.
 */

import { InMemoryStore } from '../memory/in-memory-store.js';
import type { MemoryStore, MemoryEntry, MemoryQuery, MemorySearchResult, MemoryType } from '../memory/types.js';
import type { EntityId } from '../core/index.js';

export interface MockMemoryStoreOptions {
    /** Whether store/retrieve operations should throw mock errors. */
    shouldError?: boolean;
    /** Underlying store to wrap (defaults to InMemoryStore). */
    store?: MemoryStore;
}

export class MockMemoryStore implements MemoryStore {
    private innerStore: MemoryStore;
    private options: MockMemoryStoreOptions;

    // Audit logs for assertion
    private readonly _storedEntries: Array<Omit<MemoryEntry, 'id' | 'createdAt'>> = [];
    private readonly _retrievedQueries: MemoryQuery[] = [];
    private readonly _getCalls: EntityId[] = [];
    private readonly _updatedEntries: Array<{ id: EntityId; updates: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>> }> = [];
    private readonly _deletedIds: EntityId[] = [];

    constructor(options: MockMemoryStoreOptions = {}) {
        this.options = options;
        this.innerStore = options.store ?? new InMemoryStore({ debug: false });
    }

    /** Set whether the store should error on operations. */
    setShouldError(shouldError: boolean): void {
        this.options.shouldError = shouldError;
    }

    /** All entries stored via .store() */
    get storedEntries(): ReadonlyArray<Omit<MemoryEntry, 'id' | 'createdAt'>> {
        return this._storedEntries;
    }

    /** All queries retrieved via .retrieve() */
    get retrievedQueries(): ReadonlyArray<MemoryQuery> {
        return this._retrievedQueries;
    }

    /** All get calls queried via .get() */
    get getCalls(): ReadonlyArray<EntityId> {
        return this._getCalls;
    }

    /** All update requests sent via .update() */
    get updatedEntries(): ReadonlyArray<{ id: EntityId; updates: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>> }> {
        return this._updatedEntries;
    }

    /** All deleted IDs passed to .delete() */
    get deletedIds(): ReadonlyArray<EntityId> {
        return this._deletedIds;
    }

    async store(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry> {
        if (this.options.shouldError) {
            throw new Error('Mock Memory Store error');
        }
        this._storedEntries.push(entry);
        return this.innerStore.store(entry);
    }

    async retrieve(query: MemoryQuery): Promise<MemorySearchResult[]> {
        if (this.options.shouldError) {
            throw new Error('Mock Memory Store error');
        }
        this._retrievedQueries.push(query);
        return this.innerStore.retrieve(query);
    }

    async get(id: EntityId): Promise<MemoryEntry | null> {
        if (this.options.shouldError) {
            throw new Error('Mock Memory Store error');
        }
        this._getCalls.push(id);
        return this.innerStore.get(id);
    }

    async update(id: EntityId, updates: Partial<Omit<MemoryEntry, 'id' | 'createdAt'>>): Promise<MemoryEntry> {
        if (this.options.shouldError) {
            throw new Error('Mock Memory Store error');
        }
        this._updatedEntries.push({ id, updates });
        return this.innerStore.update(id, updates);
    }

    async delete(id: EntityId): Promise<boolean> {
        if (this.options.shouldError) {
            throw new Error('Mock Memory Store error');
        }
        this._deletedIds.push(id);
        return this.innerStore.delete(id);
    }

    async clear(type?: MemoryType): Promise<void> {
        if (this.options.shouldError) {
            throw new Error('Mock Memory Store error');
        }
        return this.innerStore.clear(type);
    }

    async getRecent(limit: number, type?: MemoryType): Promise<MemoryEntry[]> {
        if (this.options.shouldError) {
            throw new Error('Mock Memory Store error');
        }
        return this.innerStore.getRecent(limit, type);
    }

    async snapshot(): Promise<MemoryEntry[]> {
        if (this.options.shouldError) {
            throw new Error('Mock Memory Store error');
        }
        return this.innerStore.snapshot();
    }

    /** Reset audit log history and wipe store state. */
    reset(): void {
        this._storedEntries.length = 0;
        this._retrievedQueries.length = 0;
        this._getCalls.length = 0;
        this._updatedEntries.length = 0;
        this._deletedIds.length = 0;
        this.innerStore = this.options.store ?? new InMemoryStore({ debug: false });
    }
}
