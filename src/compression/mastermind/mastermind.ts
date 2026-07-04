/**
 * Mastermind — context compression pipeline
 * ==========================================
 * Orchestrates all compression techniques to minimise tokens sent to the LLM
 * while preserving semantic completeness.
 *
 * Pipeline per run:
 *   1. CacheAligner  — stabilise prefix for KV-cache hits
 *   2. Per-message compression (ContentRouter → algorithm)
 *   3. Budget check  — if still over budget, apply SlidingWindow on history
 *   4. CCR annotation — stash originals, inject retrieve tool hint
 *
 * All steps are deterministic except 'summary-llm' which requires a generate fn.
 * Every step degrades gracefully: if an algorithm fails, original is kept.
 */

import type {
    MastermindMessage,
    MastermindConfig,
    MastermindStats,
    MastermindLifetimeStats,
    RecentCompressionEvent,
    CompressionAlgorithm,
    ContentType,
} from './types.js';
import { routeContent, estimateTokens } from './router.js';
import { crushJsonText } from './smart-crusher.js';
import { compressCode, compressCodeBlocks } from './code-compressor.js';
import { crushLog, crushXml, crushCsv } from './specialized-crushers.js';
import { CacheAligner } from './cache-aligner.js';
import { CCRStore, createRetrieveTool, annotateCCR } from './ccr.js';
import type { MastermindRetrieveTool } from './ccr.js';

export type {
    MastermindMessage,
    MastermindConfig,
    MastermindStats,
    MastermindLifetimeStats,
    RecentCompressionEvent,
    MastermindRetrieveTool,
};
export { CCRStore, createRetrieveTool };

/** Recent-events ring buffer size for session stats. */
const RECENT_EVENTS_LIMIT = 20;

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULTS: Required<Omit<MastermindConfig, 'generate'>> = {
    contextTokenBudget:       12_000,
    messageTokenThreshold:     2_000,
    recentMessagesWindow:          4,
    enableCCR:                  true,
    ccrMaxEntries:               200,
    enableCacheAligner:          true,
    compressToolResults:         true,
    compressAssistantMessages:   true,
    minRatio:                   0.15,
    costPer1kTokens:           0.003,
    debug:                     false,
};

// ── LLM-powered summary (prose / markdown) ────────────────────────────────────

const SUMMARY_PROMPT = `You are a precise context compressor for an AI agent.
Compress the following content into a dense, fact-preserving summary.

RULES:
1. Keep ALL key facts: IDs, numbers, names, dates, error messages, file paths, code snippets.
2. Remove filler, pleasantries, repeated boilerplate, and excessive whitespace.
3. Use direct language — no passive voice, no preamble.
4. Preserve structure where it aids comprehension (short lists, key:value).
5. If content contains code, preserve function signatures and critical logic.
6. Output ONLY the compressed content — no labels, no meta-commentary.`;

async function summaryCompress(
    text: string,
    generate: (messages: Array<{ role: string; content: string }>) => Promise<string>,
    debug: boolean,
): Promise<string> {
    try {
        const result = await generate([
            { role: 'system', content: SUMMARY_PROMPT },
            { role: 'user',   content: text },
        ]);
        return result.trim();
    } catch (err) {
        if (debug) console.warn('[Mastermind] summary-llm failed, keeping original', err);
        return text;
    }
}

// ── Algorithm dispatch ────────────────────────────────────────────────────────

async function applyAlgorithm(
    text: string,
    algorithm: CompressionAlgorithm,
    generate: MastermindConfig['generate'],
    debug: boolean,
): Promise<string> {
    switch (algorithm) {
        case 'smart-crusher':
            return crushJsonText(text);

        case 'code-compressor':
            // If it contains fenced blocks inside prose, compress each block
            if (/```/.test(text)) return compressCodeBlocks(text);
            return compressCode(text);

        case 'log-crusher':
            return crushLog(text);

        case 'xml-crusher':
            return crushXml(text);

        case 'csv-crusher':
            return crushCsv(text);

        case 'summary-llm':
            if (!generate) return text; // no LLM available — skip
            return summaryCompress(text, generate, debug);

        case 'sliding-window': {
            // Hard truncation to half the text
            const half = Math.floor(text.length / 2);
            return `${text.slice(0, half)}\n… (+${text.length - half} chars truncated)`;
        }

        case 'passthrough':
        default:
            return text;
    }
}

// ── Sliding-window budget enforcement ────────────────────────────────────────

/** Token cost of a single message (compressed content if present). */
function msgTokens(m: MastermindMessage): number {
    return estimateTokens(m.compressedContent ?? (typeof m.content === 'string' ? m.content : ''));
}

/** True if the assistant message carries tool calls that expect tool results. */
function hasToolCalls(m: MastermindMessage): boolean {
    return m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0;
}

/** True if the message is a tool result (must stay paired with its tool call). */
function isToolResult(m: MastermindMessage): boolean {
    return m.role === 'tool' || (m.role === 'user' && typeof m.tool_call_id === 'string');
}

/**
 * Enforce the token budget by dropping whole conversation groups oldest-first.
 *
 * A "group" is an atomic unit that must never be split:
 *   - an assistant message with tool_calls + every following tool-result message
 *   - a standalone tool-result message that wasn't absorbed (scans backward to
 *     find its parent assistant tool_call and groups them together)
 *   - otherwise a single standalone message
 *
 * System messages and the most-recent `recentWindow` messages are always kept,
 * so we never orphan a tool_call/tool_result pair or drop the live turn.
 */
function applyTokenBudget(
    messages: MastermindMessage[],
    budget: number,
    recentWindow: number,
): MastermindMessage[] {
    let total = messages.reduce((s, m) => s + msgTokens(m), 0);
    if (total <= budget) return messages;

    // Indices that are pinned and may never be dropped.
    const pinned = new Set<number>();
    messages.forEach((m, i) => {
        if (m.role === 'system') pinned.add(i);
    });
    // Pin the recent window (guard against recentWindow <= 0 → no negative slice).
    const recentCount = Math.max(0, Math.min(recentWindow, messages.length));
    for (let i = messages.length - recentCount; i < messages.length; i++) {
        if (i >= 0) pinned.add(i);
    }

    // Track which indices are already assigned to a group.
    const assigned = new Set<number>();

    // Build droppable groups over the non-pinned span, preserving order.
    type Group = { indices: number[]; tokens: number };
    const groups: Group[] = [];
    for (let i = 0; i < messages.length; i++) {
        if (pinned.has(i) || assigned.has(i)) continue;
        const msg = messages[i]!;
        const group: Group = { indices: [i], tokens: msgTokens(msg) };
        assigned.add(i);

        if (hasToolCalls(msg)) {
            // Forward scan: absorb trailing tool results belonging to this call.
            let j = i + 1;
            while (j < messages.length && !pinned.has(j) && isToolResult(messages[j]!)) {
                group.indices.push(j);
                group.tokens += msgTokens(messages[j]!);
                assigned.add(j);
                j++;
            }
            i = j - 1;
        } else if (isToolResult(msg)) {
            // Backward scan: find the parent assistant message with tool_calls.
            // This prevents orphaning when a pinned message sits between the
            // tool_call assistant and its tool results.
            for (let k = i - 1; k >= 0; k--) {
                if (pinned.has(k)) continue; // skip pinned but keep searching
                if (hasToolCalls(messages[k]!)) {
                    if (!assigned.has(k)) {
                        group.indices.unshift(k);
                        group.tokens += msgTokens(messages[k]!);
                        assigned.add(k);
                    }
                    // Also absorb any sibling tool results between k and i.
                    for (let s = k + 1; s < i; s++) {
                        if (!assigned.has(s) && !pinned.has(s) && isToolResult(messages[s]!)) {
                            group.indices.push(s);
                            group.tokens += msgTokens(messages[s]!);
                            assigned.add(s);
                        }
                    }
                    break;
                }
                // Stop scanning if we hit another non-tool message
                if (!isToolResult(messages[k]!)) break;
            }
            // Forward scan: absorb any further sibling tool results after i.
            let j = i + 1;
            while (j < messages.length && !pinned.has(j) && !assigned.has(j) && isToolResult(messages[j]!)) {
                group.indices.push(j);
                group.tokens += msgTokens(messages[j]!);
                assigned.add(j);
                j++;
            }
            // Sort indices so the group is in message order.
            group.indices.sort((a, b) => a - b);
        }
        groups.push(group);
    }

    // Drop oldest groups first until under budget.
    const dropIdx = new Set<number>();
    for (const group of groups) {
        if (total <= budget) break;
        for (const idx of group.indices) dropIdx.add(idx);
        total -= group.tokens;
    }

    if (dropIdx.size === 0) return messages;
    return messages.filter((_, i) => !dropIdx.has(i));
}

// ── Mastermind ────────────────────────────────────────────────────────────────

export class Mastermind {
    private readonly cfg: Required<Omit<MastermindConfig, 'generate'>> & { generate?: MastermindConfig['generate'] };
    private readonly aligner: CacheAligner;
    readonly ccrStore: CCRStore;
    readonly retrieveTool: MastermindRetrieveTool;

    /** Cumulative session savings (cost computed on read in stats()). */
    private readonly _lifetime = {
        compressions: 0,
        messagesCompressed: 0,
        tokensBefore: 0,
        tokensAfter: 0,
        tokensSaved: 0,
        algorithms: {} as Partial<Record<CompressionAlgorithm, number>>,
        recent: [] as RecentCompressionEvent[],
    };

    constructor(config: MastermindConfig = {}) {
        this.cfg = { ...DEFAULTS, ...config };
        this.aligner   = new CacheAligner({ normaliseWhitespace: true });
        this.ccrStore  = new CCRStore(this.cfg.ccrMaxEntries);
        this.retrieveTool = createRetrieveTool(this.ccrStore);
    }

    /**
     * Compress a message list in-place and return stats.
     * The returned array is a new array; individual message objects may be mutated.
     *
     * @param messages   Full message list (system + history + current turn)
     * @returns          { messages, stats }
     */
    async compress(messages: MastermindMessage[]): Promise<{
        messages: MastermindMessage[];
        stats: MastermindStats;
    }> {
        const stats: MastermindStats = {
            totalTokensBefore: 0,
            totalTokensAfter:  0,
            messagesCompressed: 0,
            ccrEntries: 0,
            algorithms: {},
        };

        if (messages.length === 0) return { messages, stats };

        // Size on entry (compressed content already counts as its own cost),
        // measured over the whole list so the lifetime saved is apples-to-apples
        // with the whole-list total recomputed at the end.
        const inputTokens = messages.reduce(
            (s, m) => s + estimateTokens(m.compressedContent ?? (typeof m.content === 'string' ? m.content : '')),
            0,
        );

        // ── Step 1: CacheAligner ─────────────────────────────────────────
        let result: MastermindMessage[] = this.cfg.enableCacheAligner
            ? (this.aligner.align(messages) as MastermindMessage[])
            : messages.map(m => ({ ...m }));

        // ── Step 2: Per-message compression ─────────────────────────────
        const hasLLM = !!this.cfg.generate;
        const recentStart = result.length - this.cfg.recentMessagesWindow;

        for (let i = 0; i < result.length; i++) {
            const msg = result[i]!;

            // Never compress system messages or recent messages
            if (msg.role === 'system') continue;
            if (i >= recentStart) continue;

            // Skip already-compressed messages
            if (msg.compressedContent) continue;

            const shouldCompress =
                (msg.role === 'tool' && this.cfg.compressToolResults) ||
                (msg.role === 'user'  && typeof msg.tool_call_id === 'string' && this.cfg.compressToolResults) ||
                (msg.role === 'assistant' && this.cfg.compressAssistantMessages);

            if (!shouldCompress) continue;

            const raw = typeof msg.content === 'string' ? msg.content : '';
            if (!raw) continue;

            const originalTokens = estimateTokens(raw);
            stats.totalTokensBefore += originalTokens;

            if (originalTokens < 100) {
                // Too small to bother
                stats.totalTokensAfter += originalTokens;
                continue;
            }

            const { algorithm, contentType } = routeContent(raw, hasLLM);

            if (algorithm === 'passthrough') {
                stats.totalTokensAfter += originalTokens;
                continue;
            }

            let compressed = await applyAlgorithm(raw, algorithm, this.cfg.generate, this.cfg.debug);

            const compressedTokens = estimateTokens(compressed);
            const ratio = originalTokens > 0 ? 1 - compressedTokens / originalTokens : 0;

            if (ratio < this.cfg.minRatio) {
                // Didn't save enough — keep original
                stats.totalTokensAfter += originalTokens;
                continue;
            }

            // CCR: stash original
            if (this.cfg.enableCCR) {
                const handle = this.ccrStore.store({
                    original: raw,
                    compressed,
                    algorithm,
                    contentType: contentType as ContentType,
                });
                compressed = annotateCCR(compressed, handle);
                msg._ccrHandle = handle;
                stats.ccrEntries++;
            }

            msg.compressedContent = compressed;
            stats.messagesCompressed++;
            stats.totalTokensAfter += estimateTokens(compressed);
            stats.algorithms[algorithm] = (stats.algorithms[algorithm] ?? 0) + 1;

            if (this.cfg.debug) {
                console.warn(
                    `[Mastermind] compressed msg[${i}] role=${msg.role} algo=${algorithm} ` +
                    `${originalTokens}→${compressedTokens} tokens (${(ratio * 100).toFixed(0)}% saved)`,
                );
            }
        }

        // ── Step 3: Budget enforcement ───────────────────────────────────
        result = applyTokenBudget(result, this.cfg.contextTokenBudget, this.cfg.recentMessagesWindow);

        // Final token count
        stats.totalTokensAfter = result.reduce(
            (s, m) => s + estimateTokens(m.compressedContent ?? (typeof m.content === 'string' ? m.content : '')),
            0,
        );

        // ── Fold into session lifetime stats ─────────────────────────────
        const saved = Math.max(0, inputTokens - stats.totalTokensAfter);
        if (stats.messagesCompressed > 0 || saved > 0) {
            const life = this._lifetime;
            life.compressions++;
            life.messagesCompressed += stats.messagesCompressed;
            life.tokensBefore += inputTokens;
            life.tokensAfter += stats.totalTokensAfter;
            life.tokensSaved += saved;
            for (const [algo, n] of Object.entries(stats.algorithms)) {
                const k = algo as CompressionAlgorithm;
                life.algorithms[k] = (life.algorithms[k] ?? 0) + (n ?? 0);
            }
            life.recent.push({
                at: Date.now(),
                tokensBefore: inputTokens,
                tokensAfter: stats.totalTokensAfter,
                tokensSaved: saved,
                messagesCompressed: stats.messagesCompressed,
                algorithms: { ...stats.algorithms },
            });
            if (life.recent.length > RECENT_EVENTS_LIMIT) {
                life.recent.splice(0, life.recent.length - RECENT_EVENTS_LIMIT);
            }
        }

        return { messages: result, stats };
    }

    /**
     * Session-lifetime savings dashboard (headroom_stats parity).
     * Aggregates every compress() call on this instance and prices the tokens
     * saved via `costPer1kTokens`. Returns copies — safe to mutate/serialise.
     */
    stats(): MastermindLifetimeStats {
        const l = this._lifetime;
        return {
            compressions: l.compressions,
            messagesCompressed: l.messagesCompressed,
            tokensBefore: l.tokensBefore,
            tokensAfter: l.tokensAfter,
            tokensSaved: l.tokensSaved,
            costSavedUsd: (l.tokensSaved / 1000) * this.cfg.costPer1kTokens,
            algorithms: { ...l.algorithms },
            recent: l.recent.map(e => ({ ...e, algorithms: { ...e.algorithms } })),
        };
    }

    /**
     * Prepare messages for sending to the LLM.
     * Replaces `content` with `compressedContent` where available.
     */
    static materialize(messages: MastermindMessage[]): MastermindMessage[] {
        return messages.map(msg => {
            if (!msg.compressedContent) return msg;
            return { ...msg, content: msg.compressedContent };
        });
    }

    /**
     * Quick check: is the message list over the token budget?
     */
    isOverBudget(messages: MastermindMessage[]): boolean {
        const total = messages.reduce(
            (s, m) => s + estimateTokens(typeof m.content === 'string' ? m.content : ''),
            0,
        );
        return total > this.cfg.contextTokenBudget;
    }

    /** Stats about the CCR store. */
    ccrStats(): { size: number; maxEntries: number } {
        return { size: this.ccrStore.size, maxEntries: this.cfg.ccrMaxEntries };
    }
}
