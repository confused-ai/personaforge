/**
 * Memory threads — thread / message model shared by the Mastra-style inspired memory layer.
 *
 * A thread is owned by a resource (a user/entity) and holds an ordered message
 * history. Threads can be shared across participants; messages are stored rows
 * with ids/timestamps and converted to/from framework conversation `Message`s.
 */

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** A message's content — plain text or a list of content parts. */
export type StoredContent = string | readonly unknown[];

/** Arbitrary thread-level metadata. */
export interface ThreadMetadata {
    [key: string]: unknown;
}

/** Per-thread state used by memory subsystems (e.g. OM cursors). */
export interface ThreadState {
    readonly observedUntilId?: string;
    readonly status?: 'active' | 'idle' | 'archived';
    [key: string]: unknown;
}

/** A stored message row. `id`/`threadId`/`createdAt` are assigned by the store. */
export interface StorageMessage {
    id?: string;
    threadId?: string;
    role: MessageRole;
    content: StoredContent;
    name?: string;
    toolCallId?: string;
    toolCalls?: readonly unknown[];
    metadata?: Record<string, unknown>;
    createdAt?: string;
}

/** A persisted thread. */
export interface Thread {
    id: string;
    resourceId?: string;
    title?: string;
    metadata?: ThreadMetadata;
    createdAt: string;
    updatedAt: string;
    state?: ThreadState;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Extract the textual content of a stored content value. */
export function textOfContent(content: unknown): string {
    if (content === undefined || content === null) return '';
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        const parts: string[] = [];
        for (const part of content) {
            if (typeof part === 'string') {
                parts.push(part);
                continue;
            }
            if (part && typeof part === 'object') {
                const p = part as { type?: string; text?: unknown; [k: string]: unknown };
                if (typeof p.text === 'string') {
                    parts.push(p.text);
                } else if (p.text && typeof p.text === 'object') {
                    const inner = p.text as { text?: unknown };
                    if (typeof inner.text === 'string') parts.push(inner.text);
                }
            }
        }
        return parts.join('\n').trim();
    }
    if (typeof content === 'object') {
        const c = content as { text?: unknown };
        if (typeof c.text === 'string') return c.text;
    }
    return String(content);
}

/** Extract the textual content of a stored message. */
export function textOfMessage(message: { content: unknown }): string {
    return textOfContent(message.content);
}

/** Sort comparator — ascending by `createdAt`. */
export function byTimestamp(a: { createdAt?: string }, b: { createdAt?: string }): number {
    return (a.createdAt ?? '').localeCompare(b.createdAt ?? '');
}

/** Remove rows sharing the same `id` (first occurrence wins). */
export function dedupeMessages<T extends { id?: string }>(messages: T[]): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const m of messages) {
        if (m.id === undefined) {
            out.push(m);
            continue;
        }
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        out.push(m);
    }
    return out;
}

/** Merge several ordered message lists, dedup by id, keep chronological order. */
export function mergeMessagesByTimestamp<T extends { id?: string; createdAt?: string }>(...lists: T[][]): T[] {
    const all = lists.flat();
    return dedupeMessages(all).sort((a, b) => byTimestamp(a, b));
}

/** Drop system messages (used when building user-visible conversation rows). */
export function filterSystemMessages<T extends { role?: string }>(messages: T[]): T[] {
    return messages.filter((m) => m.role !== 'system');
}
