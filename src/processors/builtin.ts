/**
 * Built-in processors — Mastra-style inspired guardrail / utility processors.
 *
 * Includes normalization, token limiting, moderation, PII detection/redaction,
 * prompt-injection detection, language detection, cost guarding, response
 * caching, and stream batching. LLM-backed processors accept an optional
 * `classify` function so you can plug in any model judge; heuristic
 * implementations are used by default (deterministic, zero extra calls).
 */

import {
    Processor,
    ProcessInputArgs,
    ProcessInputStepArgs,
    ProcessInputStepResult,
    ProcessLLMRequestArgs,
    ProcessLLMRequestResult,
    ProcessLLMResponseArgs,
    ProcessOutputStepArgs,
    ProcessOutputStepResult,
    ProcessOutputResultArgs,
    ProcessOutputStreamArgs,
    ProcessAPIErrorArgs,
    ProcessAPIErrorResult,
    ProcessorViolation,
    StreamOutputPart,
    TripWireError,
} from './types.js';
import type { Message } from '../core/index.js';

// ── Shared helpers ───────────────────────────────────────────────────────────

type TextMap = (text: string) => string;

function mapTextParts(messages: Message[], fn: TextMap, roles?: string[]): Message[] {
    return messages.map((m) => {
        if (roles && !roles.includes(m.role)) return m;
        const content = m.content as unknown;
        if (typeof content === 'string') return { ...m, content: fn(content) };
        if (Array.isArray(content)) {
            return {
                ...m,
                content: content.map((part) => {
                    const p = part as unknown;
                    if (typeof p === 'string') return fn(p);
                    if (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string') {
                        return { ...(p as Record<string, unknown>), text: fn((p as { text: string }).text) };
                    }
                    return part;
                }) as unknown as Message['content'],
            };
        }
        return m;
    });
}

function collectText(messages: Message[], roles: string[]): string[] {
    const out: string[] = [];
    for (const m of messages) {
        if (!roles.includes(m.role)) continue;
        const content = m.content as unknown;
        if (typeof content === 'string') out.push(content);
        else if (Array.isArray(content)) {
            for (const part of content) {
                const p = part as unknown;
                if (typeof p === 'string') out.push(p);
                else if (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string') {
                    out.push((p as { text: string }).text);
                }
            }
        }
    }
    return out;
}

function estimatedTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

export type ProcessorStrategy = 'block' | 'warn' | 'detect' | 'redact' | 'rewrite' | 'translate';

function emitViolation(processor: Processor, message: string, detail?: unknown): void {
    try {
        processor.onViolation?.({ processorId: processor.id, message, detail } satisfies ProcessorViolation);
    } catch {
        /* swallow */
    }
}

// ── Unicode normalizer ───────────────────────────────────────────────────────

export interface UnicodeNormalizerOptions {
    stripControlChars?: boolean;
    collapseWhitespace?: boolean;
    normalizeForm?: 'NFC' | 'NFD' | 'NFKC' | 'NFKD';
    /** Characters (code points) to hard-remove. */
    removeChars?: string;
}

export class UnicodeNormalizer implements Processor {
    readonly id = 'unicode-normalizer';
    private readonly opts: Required<UnicodeNormalizerOptions>;
    onViolation?: (v: ProcessorViolation) => void;

    constructor(opts: UnicodeNormalizerOptions = {}) {
        this.opts = {
            stripControlChars: opts.stripControlChars ?? true,
            collapseWhitespace: opts.collapseWhitespace ?? true,
            normalizeForm: opts.normalizeForm ?? 'NFKC',
            removeChars: opts.removeChars ?? '',
        };
    }

    async processInput({ messages }: ProcessInputArgs): Promise<Message[]> {
        const { normalizeForm, stripControlChars, collapseWhitespace, removeChars } = this.opts;
        return mapTextParts(messages, (text) => {
            let out = text.normalize(normalizeForm);
            if (removeChars) {
                const set = new Set(Array.from(removeChars));
                out = Array.from(out).filter((c) => !set.has(c)).join('');
            }
            if (stripControlChars) {
                out = out.replace(/[\u0000-\u001f\u007f]/g, '');
            }
            if (collapseWhitespace) {
                out = out.replace(/\s+/g, ' ').trim();
            }
            return out;
        });
    }
}

// ── Token limiter ────────────────────────────────────────────────────────────

export interface TokenLimiterOptions {
    /** Preserve system messages even when trimming. Default: true. */
    preserveSystem?: boolean;
    /** Always keep the newest N messages regardless of budget. */
    keepNewest?: number;
}

export class TokenLimiter implements Processor {
    readonly id = 'token-limiter';
    onViolation?: (v: ProcessorViolation) => void;
    private readonly limit: number;
    private readonly opts: Required<TokenLimiterOptions>;

    constructor(limit: number, opts: TokenLimiterOptions = {}) {
        this.limit = Math.max(1, limit);
        this.opts = {
            preserveSystem: opts.preserveSystem ?? true,
            keepNewest: opts.keepNewest ?? 0,
        };
    }

    async processInput({ messages, abort }: ProcessInputArgs): Promise<Message[]> {
        const { preserveSystem, keepNewest } = this.opts;
        const system = preserveSystem ? messages.filter((m) => m.role === 'system') : [];
        const conv = messages.filter((m) => m.role !== 'system');

        let total = system.reduce((n, m) => n + estimatedTokens(typeof m.content === 'string' ? m.content : ''), 0);
        const kept: Message[] = [];
        for (let i = conv.length - 1; i >= 0; i--) {
            const m = conv[i];
            const cost = estimatedTokens(typeof m.content === 'string' ? m.content : '');
            if (total + cost > this.limit && kept.length >= keepNewest) {
                emitViolation(this, `Token budget exceeded (${this.limit}): dropped older messages`);
                break;
            }
            kept.unshift(m);
            total += cost;
        }
        return [...system, ...kept];
    }
}

// ── Tool call filter ─────────────────────────────────────────────────────────

export interface ToolCallFilterOptions {
    /** Keep the last N tool-producing steps in context. Default 0. */
    filterAfterToolSteps?: number;
    /** Preserve compact `toModelOutput` summaries instead of raw results. */
    preserveModelOutput?: boolean;
    /** Only filter these tools (by name). */
    only?: string[];
}

export class ToolCallFilter implements Processor {
    readonly id = 'tool-call-filter';
    onViolation?: (v: ProcessorViolation) => void;
    private readonly opts: Required<Omit<ToolCallFilterOptions, 'only'>> & { only?: string[] };

    constructor(opts: ToolCallFilterOptions = {}) {
        this.opts = {
            filterAfterToolSteps: opts.filterAfterToolSteps ?? 0,
            preserveModelOutput: opts.preserveModelOutput ?? false,
            only: opts.only,
        };
    }

    async processInput({ messages }: ProcessInputArgs): Promise<Message[]> {
        return this._filter(messages);
    }

    private _filter(messages: Message[]): Message[] {
        const { filterAfterToolSteps, only } = this.opts;
        const onlySet = only && only.length > 0 ? new Set(only) : undefined;
        if (filterAfterToolSteps <= 0 && !onlySet) {
            // Drop every tool message (and the tool-producing assistant turns).
            return messages.filter((m) => m.role !== 'tool');
        }
        // Collect the tool call ids we are allowed to keep:
        //  - when `only` is set, keep every tool message for those tool names;
        //  - otherwise keep only the last `filterAfterToolSteps` tool messages
        //    (from the newest).
        const keep = new Set<string>();
        const toolMessages = messages.filter((m) => m.role === 'tool');
        const candidates = onlySet ? toolMessages : toolMessages.slice(-Math.max(1, filterAfterToolSteps));
        for (const m of candidates) {
            const id = (m as unknown as { toolCallId?: string }).toolCallId;
            if (!id) continue;
            if (onlySet && !onlySet.has(m.name ?? '')) continue;
            keep.add(id);
        }
        return messages.filter((m) => {
            if (m.role !== 'tool') return true;
            return keep.has((m as unknown as { toolCallId?: string }).toolCallId ?? '');
        });
    }
}

// ── PII detection / redaction ────────────────────────────────────────────────

export const PII_PATTERN_SET: Record<string, RegExp> = {
    email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    phone: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g,
    'credit-card': /\b(?:\d[ -]*?){13,16}\b/g,
    ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
    ip: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
};

export interface PIIDetectorOptions {
    strategy?: ProcessorStrategy;
    detectionTypes?: Array<keyof typeof PII_PATTERN_SET>;
    redactionMethod?: 'mask' | 'placeholder' | 'remove';
    placeholderText?: string;
    threshold?: number;
    /** Optional async classifier (e.g. LLM) — receives unmatched text, returns detected types. */
    classify?: (text: string) => Promise<string[]> | string[];
}

export class PIIDetector implements Processor {
    readonly id = 'pii-detector';
    onViolation?: (v: ProcessorViolation) => void;
    private readonly strategy: ProcessorStrategy;
    private readonly types: string[];
    private readonly method: 'mask' | 'placeholder' | 'remove';
    private readonly placeholder: string;
    private readonly classify?: PIIDetectorOptions['classify'];

    constructor(opts: PIIDetectorOptions = {}) {
        this.strategy = opts.strategy ?? 'redact';
        this.types = opts.detectionTypes ?? ['email', 'phone', 'credit-card', 'ssn'];
        this.method = opts.redactionMethod ?? 'mask';
        this.placeholder = opts.placeholderText ?? '[REDACTED]';
        this.classify = opts.classify;
    }

    private detect(text: string): { type: string; value: string }[] {
        const hits: { type: string; value: string }[] = [];
        for (const type of this.types) {
            const re = PII_PATTERN_SET[type];
            if (!re) continue;
            re.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = re.exec(text)) !== null) hits.push({ type, value: match[0] });
        }
        return hits;
    }

    private redact(text: string, hits: { type: string; value: string }[]): string {
        let out = text;
        for (const hit of hits) {
            const replacement =
                this.method === 'remove' ? '' : this.method === 'mask' ? '[REDACTED:' + hit.type + ']' : this.placeholder;
            out = out.split(hit.value).join(replacement);
        }
        return out;
    }

    async processInput({ messages, abort, state }: ProcessInputArgs): Promise<Message[]> {
        const user = messages.filter((m) => m.role === 'user');
        const rest = messages.filter((m) => m.role !== 'user');
        let result: Message[] = messages;
        for (const m of user) {
            const text = typeof m.content === 'string' ? m.content : '';
            const hits = this.detect(text);
            const extra = this.classify ? await Promise.resolve(this.classify(text)).catch(() => []) : [];
            const all = [...hits, ...extra.map((t) => ({ type: t, value: text }))];
            if (!all.length) continue;
            if (this.strategy === 'block') {
                emitViolation(this, `PII detected: ${all.map((h) => h.type).join(', ')}`, all);
                abort(`Request blocked: PII detected (${all.map((h) => h.type).join(', ')})`, {
                    metadata: { pii: all.map((h) => h.type) },
                });
            }
            if (this.strategy === 'warn' || this.strategy === 'detect') {
                emitViolation(this, `PII detected: ${all.map((h) => h.type).join(', ')}`, all);
                continue;
            }
            if (this.strategy === 'redact' || this.strategy === 'rewrite') {
                emitViolation(this, `PII redacted: ${all.map((h) => h.type).join(', ')}`, all);
                const idx = messages.indexOf(m);
                result = result.map((orig, i) =>
                    i === idx ? { ...orig, content: this.redact(text, all) } : orig,
                );
            }
        }
        void rest;
        state.detected = true;
        return result;
    }
}

// ── Prompt injection detector ────────────────────────────────────────────────

export interface PromptInjectionDetectorOptions {
    strategy?: ProcessorStrategy;
    threshold?: number;
    detectionTypes?: string[];
    /** Optional LLM classifier `(text) => { injection: boolean, reason }`. */
    classify?: (text: string) => Promise<{ injection: boolean; reason?: string }> | { injection: boolean; reason?: string };
}

const INJECTION_PATTERNS: { type: string; re: RegExp }[] = [
    { type: 'system-override', re: /ignore (all )?(previous|prior) (instructions|directions|prompts)/i },
    { type: 'system-override', re: /\b(reveal|show|print) (your|the) (system prompt|system instructions|initial prompt)\b/i },
    { type: 'jailbreak', re: /\b(DAN|developer mode|do anything now|jailbreak)\b/i },
    { type: 'jailbreak', re: /\byou are now (without|cannot|able to see|free from) (limits|restrictions|constraints)\b/i },
    { type: 'injection', re: /\bignore (the )?content above and\b/i },
    { type: 'injection', re: /<!--\s*system/i },
];

export class PromptInjectionDetector implements Processor {
    readonly id = 'prompt-injection-detector';
    onViolation?: (v: ProcessorViolation) => void;
    private readonly strategy: ProcessorStrategy;
    private readonly classify?: PromptInjectionDetectorOptions['classify'];

    constructor(opts: PromptInjectionDetectorOptions = {}) {
        this.strategy = opts.strategy ?? 'block';
        this.classify = opts.classify;
    }

    async processInput({ messages, abort }: ProcessInputArgs): Promise<Message[]> {
        const user = messages.filter((m) => m.role === 'user');
        for (const m of user) {
            const text = typeof m.content === 'string' ? m.content : '';
            const heuristic = INJECTION_PATTERNS
                .filter((p) => p.re.test(text))
                .map((p) => p.type);
            const llm = this.classify ? await Promise.resolve(this.classify(text)).catch(() => undefined) : undefined;
            const detections = [...new Set([...heuristic, ...(llm?.injection ? ['llm-classified'] : [])])];
            if (!detections.length) continue;
            const reason = llm?.reason ?? `Prompt injection detected (${detections.join(', ')})`;
            if (this.strategy === 'block') {
                emitViolation(this, reason, detections);
                abort(`Blocked: ${reason}`, { metadata: { detections } });
            } else {
                emitViolation(this, reason, detections);
            }
        }
        return messages;
    }
}

// ── Moderation processor ─────────────────────────────────────────────────────

export const MODERATION_KEYWORDS: Record<string, string[]> = {
    hate: ['hate', 'racial slur', 'bigot'],
    harassment: ['harass', 'bully', 'intimidate'],
    violence: ['kill you', 'hurt you', 'violent', 'assault'],
    selfharm: ['suicide', 'kill myself', 'self-harm'],
    sexual: ['sexual assault', 'explicit'],
};

export interface ModerationProcessorOptions {
    strategy?: ProcessorStrategy;
    categories?: string[];
    threshold?: number;
    /** Optional classifier `(text) => { categories: string[] }`. */
    classify?: (text: string) => Promise<{ categories: string[]; flagged?: boolean }> | { categories: string[]; flagged?: boolean };
}

export class ModerationProcessor implements Processor {
    readonly id = 'moderation-processor';
    onViolation?: (v: ProcessorViolation) => void;
    private readonly strategy: ProcessorStrategy;
    private readonly categories: string[];
    private readonly classify?: ModerationProcessorOptions['classify'];

    constructor(opts: ModerationProcessorOptions = {}) {
        this.strategy = opts.strategy ?? 'block';
        this.categories = opts.categories ?? Object.keys(MODERATION_KEYWORDS);
        this.classify = opts.classify;
    }

    private detect(text: string): string[] {
        const found: string[] = [];
        for (const cat of this.categories) {
            const kws = MODERATION_KEYWORDS[cat] ?? [];
            if (kws.some((kw) => text.toLowerCase().includes(kw))) found.push(cat);
        }
        return found;
    }

    async processInput({ messages, abort }: ProcessInputArgs): Promise<Message[]> {
        const text = collectText(messages, ['user', 'assistant']).join('\n');
        const categories = this.detect(text);
        const llm = this.classify ? await Promise.resolve(this.classify(text)).catch(() => undefined) : undefined;
        const all = [...new Set([...categories, ...(llm?.categories ?? [])])];
        if (!all.length) return messages;
        if (this.strategy === 'block') {
            emitViolation(this, `Content moderation: ${all.join(', ')}`, all);
            abort(`Blocked: content violates moderation policy (${all.join(', ')})`, {
                metadata: { categories: all },
            });
        } else {
            emitViolation(this, `Content moderation warning: ${all.join(', ')}`, all);
        }
        return messages;
    }
}

// ── Cost guard processor ─────────────────────────────────────────────────────

export interface CostGuardProcessorOptions {
    maxCost: number;
    scope?: 'thread' | 'resource' | 'global';
    window?: string;
    /** Optional cost reporter `(usage) => number` (USD). Default: naive estimator. */
    costFor?: (usage: { promptTokens?: number; completionTokens?: number }) => number;
}

const NAIVE_PER_MT: Record<string, number> = {
    input: 5, // $5 / 1M tokens
    output: 15, // $15 / 1M tokens
};

export class CostGuardProcessor implements Processor {
    readonly id = 'cost-guard';
    onViolation?: (v: ProcessorViolation) => void;
    private readonly maxCost: number;
    private readonly scope: string;
    private readonly costFor: NonNullable<CostGuardProcessorOptions['costFor']>;
    private spent = 0;

    constructor(opts: CostGuardProcessorOptions) {
        this.maxCost = opts.maxCost;
        this.scope = opts.scope ?? 'thread';
        this.costFor =
            opts.costFor ??
            ((u) =>
                ((u.promptTokens ?? 0) / 1_000_000) * NAIVE_PER_MT.input +
                ((u.completionTokens ?? 0) / 1_000_000) * NAIVE_PER_MT.output);
    }

    // Cost is accounted once per run in `processOutputResult`, which carries the
    // provider usage payload. There is deliberately no `processLLMResponse` hook:
    // per-step calls don't expose usage, so tallying there would be guesswork.
    async processOutputResult({ result, state, context }: ProcessOutputResultArgs): Promise<void> {
        void state;
        this.spent += this.costFor(result.usage ?? {});
        const detail = {
            usage: result.usage,
            limit: this.maxCost,
            totalUsage: this.spent,
            scope: this.scope,
            scopeKey: context.threadId ?? context.resourceId ?? context.sessionId ?? 'thread',
        };
        if (this.spent > this.maxCost) {
            emitViolation(this, `Cost limit exceeded: $${this.spent.toFixed(4)} > $${this.maxCost}`, detail);
            throw new TripWireError(this.id, `Blocked: estimated cost exceeds $${this.maxCost}`, { metadata: detail });
        }
    }
}

// ── Language detector ────────────────────────────────────────────────────────

export interface LanguageDetectorOptions {
    targetLanguages?: string[];
    strategy?: 'translate' | 'detect' | 'block';
    threshold?: number;
    /** Optional detector `(text) => { language, isTarget }`. */
    detect?: (text: string) => Promise<{ language: string; isTarget: boolean }> | { language: string; isTarget: boolean };
    /** Optional translator `(text) => string`. */
    translate?: (text: string) => Promise<string> | string;
}

const ASCII_RANGE = /^[\x00-\x7F]*$/;

export class LanguageDetector implements Processor {
    readonly id = 'language-detector';
    onViolation?: (v: ProcessorViolation) => void;
    private readonly targets: string[];
    private readonly strategy: 'translate' | 'detect' | 'block';
    private readonly detect?: LanguageDetectorOptions['detect'];
    private readonly translate?: LanguageDetectorOptions['translate'];

    constructor(opts: LanguageDetectorOptions = {}) {
        this.targets = opts.targetLanguages ?? [];
        this.strategy = opts.strategy ?? 'detect';
        this.detect = opts.detect;
        this.translate = opts.translate;
    }

    async processInput({ messages, abort, state }: ProcessInputArgs): Promise<Message[]> {
        const user = messages.filter((m) => m.role === 'user');
        if (!user.length || this.targets.length === 0) return messages;
        let result: Message[] = messages;
        for (const m of user) {
            const text = typeof m.content === 'string' ? m.content : '';
            if (!text || ASCII_RANGE.test(text)) continue;
            const info = this.detect
                ? await Promise.resolve(this.detect(text)).catch(() => undefined)
                : { language: 'unknown', isTarget: false };
            const isTarget = info?.isTarget ?? false;
            if (isTarget) continue;
            if (this.strategy === 'block') {
                emitViolation(this, `Message not in target language (${info?.language ?? 'unknown'})`);
                abort(`Blocked: message language not supported`);
            }
            if (this.strategy === 'translate' && this.translate) {
                const translated = await this.translate(text);
                const idx = messages.indexOf(m);
                result = result.map((orig, i) =>
                    i === idx ? { ...orig, content: translated } : orig,
                );
                emitViolation(this, `Translated message from ${info?.language ?? 'unknown'}`, translated);
            } else {
                emitViolation(this, `Non-target language detected: ${info?.language ?? 'unknown'}`);
            }
        }
        void state;
        return result;
    }
}

// ── Batch parts processor ────────────────────────────────────────────────────

export interface BatchPartsProcessorOptions {
    batchSize?: number;
    maxWaitTime?: number;
    emitOnNonText?: boolean;
}

export class BatchPartsProcessor implements Processor {
    readonly id = 'batch-parts';
    onViolation?: (v: ProcessorViolation) => void;
    private readonly batchSize: number;
    private readonly maxWaitTime: number;
    private readonly emitOnNonText: boolean;

    constructor(opts: BatchPartsProcessorOptions = {}) {
        this.batchSize = opts.batchSize ?? 5;
        this.maxWaitTime = opts.maxWaitTime ?? 50;
        this.emitOnNonText = opts.emitOnNonText ?? false;
    }

    async processOutputStream({ part, state }: ProcessOutputStreamArgs): Promise<StreamOutputPart | null> {
        if (part.type !== 'text-delta') return part;
        state.parts = (state.parts ?? []) as string[];
        (state.parts as string[]).push(part.text ?? '');
        if ((state.parts as string[]).length < this.batchSize) {
            return null; // hold until the batch is full
        }
        const text = (state.parts as string[]).join('');
        state.parts = [];
        return { type: 'text-delta', text };
    }
}

// ── System prompt scrubber ───────────────────────────────────────────────────

export interface SystemPromptScrubberOptions {
    strategy?: ProcessorStrategy;
    customPatterns?: string[];
    placeholderText?: string;
    redactionMethod?: 'placeholder' | 'remove';
}

export class SystemPromptScrubber implements Processor {
    readonly id = 'system-prompt-scrubber';
    onViolation?: (v: ProcessorViolation) => void;
    private readonly strategy: ProcessorStrategy;
    private readonly patterns: RegExp[];
    private readonly placeholder: string;
    private readonly method: 'placeholder' | 'remove';

    constructor(opts: SystemPromptScrubberOptions = {}) {
        this.strategy = opts.strategy ?? 'redact';
        this.placeholder = opts.placeholderText ?? '[REDACTED]';
        this.method = opts.redactionMethod ?? 'placeholder';
        this.patterns = (opts.customPatterns ?? ['system prompt', 'system instructions', 'internal instructions', 'secret key', 'api[_-]?key'])
            .map((p) => new RegExp(p, 'gi'));
    }

    async processOutputResult({ messages, state }: ProcessOutputResultArgs): Promise<Message[]> {
        void state;
        return mapTextParts(messages, (text) => {
            let out = text;
            for (const re of this.patterns) {
                out = out.replace(re, () =>
                    this.method === 'remove' ? '' : this.placeholder,
                );
            }
            return out;
        }, ['assistant']);
    }
}

// ── Response cache ───────────────────────────────────────────────────────────

export interface ResponseCacheBackend {
    get(key: string): Promise<{ text: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } } | null>;
    set(key: string, value: { text: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }, ttlSeconds?: number): Promise<void>;
}

export interface ResponseCacheOptions {
    cache: ResponseCacheBackend;
    ttl?: number;
    agentId?: string;
    scope?: string | null;
    key?: (inputs: { agentId?: string; model: string; step: number; messages: Message[] }) => string;
}

/** Deterministic key default. */
export function buildResponseCacheKey(inputs: { agentId?: string; model: string; step: number; scope?: string; messages: Message[] }): string {
    const tail = inputs.messages
        .slice(-4)
        .map((m) => `${m.role}:${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
        .join('|');
    return `${inputs.agentId ?? 'agent'}:${inputs.scope ?? ''}:${inputs.model}:step-${inputs.step}:${hashStable(tail)}`;
}

function hashStable(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36) + s.length.toString(36);
}

export class ResponseCache implements Processor {
    readonly id = 'response-cache';
    onViolation?: (v: ProcessorViolation) => void;
    private readonly cache: ResponseCacheBackend;
    private readonly ttl: number;
    private readonly agentId?: string;
    private readonly scope?: string | null;
    private readonly keyFn?: ResponseCacheOptions['key'];

    constructor(opts: ResponseCacheOptions) {
        this.cache = opts.cache;
        this.ttl = opts.ttl ?? 600;
        this.agentId = opts.agentId;
        this.scope = opts.scope === undefined ? 'resource' : opts.scope;
        this.keyFn = opts.key;
    }

    static context(overrides: { key?: string | ((i: unknown) => string); scope?: string | null; bust?: boolean }): Record<string, unknown> {
        return { 'response-cache': overrides };
    }

    static applyContext(ctx: Record<string, unknown>, overrides: { key?: string | ((i: unknown) => string); scope?: string | null; bust?: boolean }): void {
        ctx['response-cache'] = { ...(ctx['response-cache'] as Record<string, unknown> ?? {}), ...overrides };
    }

    async processLLMRequest({ messages, model, stepNumber, context, state, abort }: ProcessLLMRequestArgs): Promise<ProcessLLMRequestResult> {
        const requestCtx = context.requestContext?.[this.id] as { key?: string | ((i: unknown) => string); scope?: string | null; bust?: boolean } | undefined;
        const scope = requestCtx?.scope === undefined ? this.scope : requestCtx.scope;
        const key = (requestCtx?.key
            ? typeof requestCtx.key === 'function'
                ? String(requestCtx.key({ agentId: this.agentId, model, step: stepNumber, messages }))
                : requestCtx.key
            : this.keyFn
              ? this.keyFn({ agentId: this.agentId, model, step: stepNumber, messages })
              : buildResponseCacheKey({ agentId: this.agentId, model, step: stepNumber, scope: scope ?? '', messages })) + (requestCtx?.bust ? ':bust' : '');

        if (!requestCtx?.bust) {
            const hit = await this.cache.get(key).catch(() => null);
            if (hit) {
                state.hit = true;
                return { cached: hit };
            }
        }
        state.key = key;
        state.requestTail = messages.slice(-4);
        return {};
    }

    async processLLMResponse({ chunks, text, context, state, fromCache }: ProcessLLMResponseArgs): Promise<void> {
        if (fromCache) return;
        const key = state.key as string | undefined;
        if (!key) return;
        const requestCtx = context.requestContext?.[this.id] as { scope?: string | null; bust?: boolean } | undefined;
        void requestCtx;
        // `processLLMResponse` has no provider usage payload, so estimate tokens
        // deterministically from the streamed text (same estimator used by
        // TokenLimiter). Callers that need exact usage can read it from the run
        // result instead — the cache entry still records a sane, non-zero value.
        const completionTokens = chunks.length
            ? chunks.reduce((n, c) => n + estimatedTokens(c), 0)
            : estimatedTokens(text);
        const promptTokens = estimatedTokens(JSON.stringify(state.requestTail ?? ''));
        const usage = { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
        state.cached = { text };
        await this.cache.set(key, { text, usage }, this.ttl).catch(() => undefined);
    }
}

// ── Ensure-final-response (maxSteps signal) ──────────────────────────────────

export interface EnsureFinalResponseOptions {
    maxSteps: number;
    reminderText?: string;
}

/** Inject a reactive <system-reminder> on the final step so the agent returns text. */
export class EnsureFinalResponse implements Processor {
    readonly id = 'ensure-final-response';
    private readonly maxSteps: number;
    private readonly reminderText: string;
    onViolation?: (v: ProcessorViolation) => void;

    constructor(opts: EnsureFinalResponseOptions) {
        this.maxSteps = opts.maxSteps;
        this.reminderText =
            opts.reminderText ??
            'This is your final step. Do not call any more tools. Summarize what you have found and give the user a complete final answer now.';
    }

    async processInputStep({ stepNumber, sendSignal }: ProcessInputStepArgs): Promise<void> {
        if (stepNumber !== this.maxSteps - 1) return;
        await sendSignal?.({
            type: 'reactive',
            contents: this.reminderText,
            attributes: { reason: 'max-steps-reached', step: stepNumber + 1 },
        });
    }
}

// ── Context-length error handler ─────────────────────────────────────────────

export class ContextLengthHandler implements Processor {
    readonly id = 'context-length-handler';
    onViolation?: (v: ProcessorViolation) => void;

    async processAPIError({ error, messages, retryCount, state }: ProcessAPIErrorArgs): Promise<ProcessAPIErrorResult | void> {
        if (retryCount > 0) return;
        const msg = error instanceof Error ? error.message : String(error);
        if (/context length exceeded|maximum context|too many tokens|exceeded.*token/i.test(msg)) {
            if (messages.length > 4) {
                state.removed = (state.removed as number ?? 0) + 2;
                const ids = new Set<string>();
                const nonSystem = messages.filter((m) => m.role !== 'system');
                for (const m of nonSystem.slice(0, 2)) {
                    ids.add((m as unknown as { toolCallId?: string }).toolCallId ?? `${m.role}:${String(m.content).slice(0, 40)}`);
                }
                const next = messages.filter((m) => {
                    const id = (m as unknown as { toolCallId?: string }).toolCallId ?? `${m.role}:${String(m.content).slice(0, 40)}`;
                    return m.role === 'system' || !ids.has(id);
                });
                return { retry: true, messages: next };
            }
        }
    }
}
