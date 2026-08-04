/**
 * @personaforge/memory — Observational Memory (OM).
 *
 * Mastra-style inspired long-context memory. Background agents — an **Observer** and a
 * **Reflector** — watch a conversation and maintain a dense observation log
 * that replaces raw message history as it grows:
 *
 *   1.  Raw message history stays in context until it crosses `messageTokens`
 *       (default 30k). The Observer compresses the oldest messages into dense
 *       observation notes (5–40x) and observed messages leave the window.
 *   2.  When the observation log crosses `observationTokens` (default 40k), the
 *       Reflector condenses the whole log, keeping memory bounded.
 *   3.  Continuation hints (current task, suggested response) keep the agent
 *       on-task after a shrink. Optional extractors persist structured values
 *       (profiles, blockers) and can drive working-memory updates.
 *
 * Observed messages remain in storage (retrieval mode / exact recall); only the
 * *context window* is trimmed.
 */

import { safeValidate, type SchemaInput } from '../validation/index.js';
import type { LLMProvider, Message } from '../contracts/index.js';
import type { ThreadStore } from './thread-store.js';
import type { ThreadState, StoredContent } from './threads.js';
import { textOfContent } from './threads.js';
import { estimateConversationTokens, estimateTokenCount, type TokenEstimator } from './token-estimator.js';
import type { WorkingMemoryManager } from './working-memory.js';

// ── Config ─────────────────────────────────────────────────────────────────

export interface ObservationalObservationConfig {
    /** When to run the Observer (tokens of unobserved history). Default 30_000. */
    messageTokens?: number;
    /** Buffer cadence: `0.2` (fraction of messageTokens) or absolute token count; `false` disables. */
    bufferTokens?: number | false;
    /** How aggressively to clear the window on activation. Default 0.8 (keep 20%). */
    bufferActivation?: number;
    /** Safety multiplier for a synchronous observation (default 1.2). */
    blockAfter?: number;
    /** Cap the previous-observer context (tokens). Default 2000; 0 omits; false keeps all. */
    previousObserverTokens?: number | false;
    /** Let the Observer own working memory (adds a built-in profile extractor). */
    manageWorkingMemory?: boolean;
    /** Suggest a thread title when the topic meaningfully changes. */
    threadTitle?: boolean;
    /** Structured extractors run on observation. */
    extract?: Extractor | Extractor[];
    /** Max words for the observation notes. Default 300. */
    maxObservationWords?: number;
}

export interface ObservationalReflectionConfig {
    /** When to run the Reflector (tokens of the observation log). Default 40_000. */
    observationTokens?: number;
    /** Structured extractors run on reflection. */
    extract?: Extractor | Extractor[];
}

export interface ObservationalMemoryConfig {
    enabled?: boolean;
    /** Observer/Reflector model id — informational; `llm` drives calls. */
    model?: string;
    /** Override the LLM used for observation/reflection. */
    llm?: LLMProvider;
    /** `thread` (default, per-conversation) or `resource` (shared across threads). */
    scope?: 'thread' | 'resource';
    /** Observer threshold. Default 30_000. */
    messageTokens?: number;
    /** Reflector threshold. Default 40_000. */
    observationTokens?: number;
    /** Safety multiplier for sync observation when buffering lags (default 1.2). */
    blockAfter?: number;
    /** Background buffer cadence (fraction or absolute); `false` disables. */
    bufferTokens?: number | false;
    /** Keep this fraction of the window after activation. Default 0.8. */
    bufferActivation?: number;
    /** Insert a dated reminder when a new message follows a ≥10 minute gap. */
    temporalMarkers?: boolean;
    /** Activate buffered observations after idle: ms, "5m"/"1h", or "auto" (5 min). */
    activateAfterIdle?: false | number | string;
    /** Enable the `recall` tool to browse source messages behind observations. */
    retrieval?: boolean | { vector?: boolean; scope?: 'thread' | 'resource' };
    observation?: ObservationalObservationConfig;
    reflection?: ObservationalReflectionConfig;
    /** Global extractors run on both observation and reflection. */
    extractors?: Extractor | Extractor[];
    /** Local token-estimator override. */
    tokenEstimator?: TokenEstimator;
    /** Callbacks for observability. */
    onObserved?: (event: ObservationEvent) => void;
    onReflected?: (event: ReflectionEvent) => void;
    onBuffered?: (event: { threadId: string; notes: string[]; tokens: number }) => void;
    onError?: (error: unknown) => void;
    /** Internal: working-memory manager when `manageWorkingMemory` is enabled. */
    workingMemoryManager?: WorkingMemoryManager;
}

export interface ExtractorConfig {
    /** Human name — also used to derive the result key. */
    name: string;
    /** What to extract and persist. */
    instructions: string;
    /** Structured extraction (JSON). When set, runs as a follow-up LLM call. */
    schema?: SchemaInput;
    /** Show the previous extracted value to the extractor. Default true. */
    includePreviousExtraction?: boolean;
    /** Normalize/react to the extracted value before persistence. */
    onExtracted?: (args: { current: unknown; previous?: unknown }) => unknown | Promise<unknown>;
}

/** A named, reusable extraction unit. */
export class Extractor {
    readonly name: string;
    readonly slug: string;
    readonly instructions: string;
    readonly schema?: SchemaInput;
    readonly includePreviousExtraction: boolean;
    readonly onExtracted?: ExtractorConfig['onExtracted'];

    constructor(config: ExtractorConfig) {
        this.name = config.name;
        this.slug =
            config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'extractor';
        this.instructions = config.instructions;
        this.schema = config.schema;
        this.includePreviousExtraction = config.includePreviousExtraction ?? true;
        this.onExtracted = config.onExtracted;
    }
}

// ── Events ─────────────────────────────────────────────────────────────────

export interface ObservationEvent {
    threadId: string;
    resourceId: string;
    kind: 'activate' | 'buffer';
    notes: string[];
    messageCount: number;
    tokensIn: number;
    tokensOut: number;
    extractedValues?: Record<string, unknown>;
    extractionFailures?: Array<{ slug: string; error: string }>;
}

export interface ReflectionEvent {
    threadId: string;
    resourceId: string;
    tokensIn: number;
    tokensOut: number;
    linesIn: number;
    linesOut: number;
    extractedValues?: Record<string, unknown>;
    extractionFailures?: Array<{ slug: string; error: string }>;
}

export interface ObservationContextResult {
    /** Recent (unobserved / post-activation) messages to keep in the window. */
    messages: StorageMessageLike[];
    /** System-block text for the observation log, if the log is non-empty. */
    system?: string;
    /** Continuation reminder placed at the start of the conversation. */
    continuation?: string;
    /** True when an observation or reflection activated during this read. */
    activated: boolean;
    /** Token counts for diagnostics. */
    counts: { messages: number; observations: number; messageTokens: number; observationTokens: number };
}

export interface ObservationActivationResult {
    activated: boolean;
    notes: string[];
    count?: number;
    logTokens?: number;
}

type StorageMessageLike = { id?: string; role: string; content: unknown; createdAt?: string };

// ── OM state ────────────────────────────────────────────────────────────────
// Stored inside `ThreadState` (which has an index signature), so we keep a
// locally-typed view to stay decoupled from the storage layer.

interface OmState {
    observedUntilId?: string;
    log?: string[];
    logTokens?: number;
    currentTask?: string;
    suggestedResponse?: string;
    title?: string;
    buffer?: Array<{ range: string; notes: string; tokens: number }>;
    extractions?: Record<string, unknown>;
    lastActivityAt?: number;
}

type MutableState = OmState;

function stateFromThread(threadState: ThreadState | undefined): MutableState {
    return { ...(threadState ?? {}) } as MutableState;
}

// ── Prompts ─────────────────────────────────────────────────────────────────

const SYSTEM_OBSERVER =
    'You are an Observer agent inside a memory system. Watch a conversation and produce a dense, structured ' +
    'observation log an assistant can use later instead of the raw transcript. Rules:\n' +
    '- Write concise bullet observations capturing facts, decisions, goals, preferences, blockers, ' +
    'entity names, and the current state of any ongoing task.\n' +
    '- Compress aggressively (target 5-40x); drop small talk, duplication, and verbose tool output (keep conclusions).\n' +
    '- Mark importance: [H] high, [M] medium, [L] low.\n' +
    '- Never invent facts absent from the transcript.\n' +
    'Respond with ONLY a JSON object: {"observations":["..."], "currentTask":"...", "suggestedResponse":"..."}';

const SYSTEM_REFLECTOR =
    'You are a Reflector agent inside a memory system. Given the current observation log of a long ' +
    'conversation, condense and reorganize it into an updated log that:\n' +
    '- Keeps recent, concrete detail.\n' +
    '- Aggressively compresses older, superseded information.\n' +
    '- Merges duplicates, removes contradictions.\n' +
    '- Preserves every hard fact (names, numbers, decisions) somewhere.\n' +
    'Respond with ONLY a JSON object: {"reflections":["..."]}';

// ── Manager ────────────────────────────────────────────────────────────────

export interface ObservationalMemoryManagerOptions {
    store: ThreadStore;
    llm?: LLMProvider;
    config: ObservationalMemoryConfig;
    /** Working-memory manager used when `manageWorkingMemory` is enabled. */
    workingMemory?: WorkingMemoryManager;
}

const DEFAULT_MESSAGE_TOKENS = 30_000;
const DEFAULT_OBSERVATION_TOKENS = 40_000;
const DEFAULT_BUFFER_FRACTION = 0.2;
const DEFAULT_BUFFER_ACTIVATION = 0.8;
const DEFAULT_BLOCK_AFTER = 1.2;
const DEFAULT_PREVIOUS_OBSERVER_TOKENS = 2_000;
const DEFAULT_MAX_OBSERVATION_WORDS = 300;
const TEMPORAL_MARKER_MS = 10 * 60 * 1000;

export class ObservationalMemoryManager {
    readonly config: ObservationalMemoryConfig;
    private readonly store: ThreadStore;
    private readonly llm: LLMProvider;
    private readonly estimator: TokenEstimator;
    private readonly workingMemory?: WorkingMemoryManager;
    private readonly resolved: {
        scope: 'thread' | 'resource';
        messageTokens: number;
        observationTokens: number;
        bufferFraction: number | false;
        bufferActivation: number;
        blockAfter: number;
        previousObserverTokens: number | false;
        manageWorkingMemory: boolean;
        threadTitle: boolean;
        maxObservationWords: number;
        temporalMarkers: boolean;
        extractors: Extractor[];
        retrieval: { vector: boolean; scope: 'thread' | 'resource' } | false;
    };

    constructor(options: ObservationalMemoryManagerOptions) {
        this.store = options.store;
        this.config = options.config;
        this.workingMemory = options.workingMemory;
        if (!options.llm) {
            throw new Error('ObservationalMemory requires an llm (pass `llm` on Memory or bind the agent llm).');
        }
        this.llm = options.llm;
        this.estimator = options.config.tokenEstimator ?? estimateTokenCount;
        const cfg = options.config;
        const obs = cfg.observation ?? {};
        const ref = cfg.reflection ?? {};
        const extractors = flattenExtractors(
            obs.extract,
            cfg.extractors,
            obs.manageWorkingMemory || cfg.workingMemoryManager ? [PROFILE_EXTRACTOR] : [],
        );
        this.resolved = {
            scope: cfg.scope ?? 'thread',
            messageTokens: obs.messageTokens ?? cfg.messageTokens ?? DEFAULT_MESSAGE_TOKENS,
            observationTokens: ref.observationTokens ?? cfg.observationTokens ?? DEFAULT_OBSERVATION_TOKENS,
            bufferFraction: obs.bufferTokens ?? cfg.bufferTokens ?? DEFAULT_BUFFER_FRACTION,
            bufferActivation: obs.bufferActivation ?? cfg.bufferActivation ?? DEFAULT_BUFFER_ACTIVATION,
            blockAfter: obs.blockAfter ?? cfg.blockAfter ?? DEFAULT_BLOCK_AFTER,
            previousObserverTokens: obs.previousObserverTokens ?? DEFAULT_PREVIOUS_OBSERVER_TOKENS,
            manageWorkingMemory: obs.manageWorkingMemory ?? false,
            threadTitle: obs.threadTitle ?? false,
            maxObservationWords: obs.maxObservationWords ?? DEFAULT_MAX_OBSERVATION_WORDS,
            temporalMarkers: cfg.temporalMarkers ?? false,
            extractors,
            retrieval: resolveRetrieval(cfg.retrieval),
        };
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /** Messages not yet observed (cursor semantics). */
    async getUnobserved(threadId: string): Promise<StorageMessageLike[]> {
        const thread = await this.store.getThread(threadId).catch(() => null);
        const cursor = thread?.state?.observedUntilId;
        return this.store.getMessages(threadId, { afterId: cursor });
    }

    /** Complete observation log lines (diagnostics). */
    async getObservationLog(threadId: string): Promise<string[]> {
        return (await this.loadState(threadId)).log ?? [];
    }

    /**
     * Compute the OM context window for a thread. Activates buffered or
     * synchronous observations when thresholds cross; otherwise all unobserved
     * messages stay in context.
     */
    async getContextWindow(opts: {
        threadId: string;
        resourceId: string;
        scope?: 'thread' | 'resource';
    }): Promise<ObservationContextResult> {
        const scope = opts.scope ?? this.resolved.scope;
        const state = await this.loadState(opts.threadId);
        const unobserved = await this.getUnobserved(opts.threadId);
        const unobservedTokens = estimateConversationTokens(unobserved, this.estimator);
        const messageTokens = this.resolved.messageTokens;
        const observationTokens = this.resolved.observationTokens;

        const buffered = state.buffer ?? [];
        const idle = this.shouldActivateOnIdle(state, buffered);
        const canActivateBuffered = buffered.length > 0 && unobservedTokens >= messageTokens;
        const needsSync = unobservedTokens >= messageTokens * this.resolved.blockAfter;

        let notes: string[] | undefined;
        let kept = unobserved;
        let activated = false;

        if (canActivateBuffered || (idle && buffered.length > 0)) {
            notes = buffered.flatMap((chunk) => splitNotes(chunk.notes));
            state.log = [...(state.log ?? []), ...notes];
            state.buffer = [];
            state.observedUntilId = unobserved[unobserved.length - 1]?.id ?? state.observedUntilId;
            state.logTokens = estimateObservationTokensArr(state.log, this.estimator);
            state.lastActivityAt = Date.now();
            await this.persistState(opts.threadId, state);
            kept = this.keepTail(unobserved, messageTokens * (1 - this.resolved.bufferActivation));
            activated = true;
        } else if (needsSync) {
            const result = await this.observeRange(opts, state, unobserved, 'activate');
            if (result) {
                notes = result.notes;
                state.observedUntilId = unobserved[unobserved.length - 1]?.id;
                await this.commitObservation(opts, state, result.notes, {
                    currentTask: result.currentTask,
                    suggestedResponse: result.suggestedResponse,
                    title: result.title,
                    extractedValues: result.extractedValues,
                });
                kept = this.keepTail(unobserved, messageTokens * (1 - this.resolved.bufferActivation));
                activated = true;
            }
        }

        const log = state.log ?? [];
        const logTokens = estimateObservationTokensArr(log, this.estimator);

        let reflected = false;
        if (logTokens >= observationTokens) {
            const ref = await this.maybeReflect(opts, state, false);
            reflected = ref.reflected;
        }

        const system = this.buildObservationSystem(log, logTokens, observationTokens, reflected, state.title);
        const continuation = this.buildContinuation(unobserved, state, activated);

        return {
            messages: activated ? kept : unobserved,
            system,
            continuation,
            activated: activated || reflected,
            counts: {
                messages: unobservedTokens,
                observations:
                    (state.logTokens ?? logTokens) + (state.buffer ?? []).reduce((n, c) => n + (c.tokens ?? 0), 0),
                messageTokens,
                observationTokens,
            },
        };
    }

    /** Post-turn hook: refresh idle tracking and kick off async buffering. */
    async afterTurn(opts: { threadId: string; resourceId: string; scope?: 'thread' | 'resource' }): Promise<void> {
        const state = await this.loadState(opts.threadId);
        state.lastActivityAt = Date.now();
        await this.persistState(opts.threadId, state);
        void this.maybeBuffer(opts).catch((error) => this.config.onError?.(error));
    }

    /** Queue a buffered observation when the unobserved window is large enough. */
    async maybeBuffer(opts: {
        threadId: string;
        resourceId: string;
        scope?: 'thread' | 'resource';
    }): Promise<ObservationActivationResult> {
        const fraction = this.resolved.bufferFraction;
        if (fraction === false) return { activated: false, notes: [] };
        const unobserved = await this.getUnobserved(opts.threadId);
        if (unobserved.length === 0) return { activated: false, notes: [] };
        const tokens = estimateConversationTokens(unobserved, this.estimator);
        const threshold = this.resolved.messageTokens * fraction;
        if (tokens < threshold) return { activated: false, notes: [] };
        const state = await this.loadState(opts.threadId);
        const result = await this.observeRange(opts, state, unobserved, 'buffer');
        if (!result) return { activated: false, notes: [] };
        state.buffer = [...(state.buffer ?? []), { range: `${opts.threadId}:buffer`, notes: result.notes.join('\n'), tokens }];
        if (result.currentTask) state.currentTask = result.currentTask;
        if (result.suggestedResponse) state.suggestedResponse = result.suggestedResponse;
        if (result.extractedValues && Object.keys(result.extractedValues).length) {
            state.extractions = { ...(state.extractions ?? {}), ...result.extractedValues };
        }
        await this.persistState(opts.threadId, state);
        this.config.onBuffered?.({ threadId: opts.threadId, notes: result.notes, tokens });
        return { activated: false, notes: result.notes };
    }

    /** Force a synchronous observation now (explicit flush / tests). */
    async observeSync(opts: {
        threadId: string;
        resourceId: string;
        scope?: 'thread' | 'resource';
    }): Promise<ObservationActivationResult> {
        const state = await this.loadState(opts.threadId);
        const unobserved = await this.getUnobserved(opts.threadId);
        if (unobserved.length === 0) return { activated: false, notes: [], logTokens: state.logTokens };
        const result = await this.observeRange(opts, state, unobserved, 'activate');
        if (!result) return { activated: false, notes: [], logTokens: state.logTokens };
        state.observedUntilId = unobserved[unobserved.length - 1]?.id;
        await this.commitObservation(opts, state, result.notes, {
            currentTask: result.currentTask,
            suggestedResponse: result.suggestedResponse,
            title: result.title,
            extractedValues: result.extractedValues,
        });
        return { activated: true, notes: result.notes, count: unobserved.length, logTokens: state.logTokens };
    }

    /** Run the Reflector when the observation log exceeds the threshold. */
    async maybeReflect(
        opts: { threadId: string; resourceId: string },
        state?: MutableState,
        force = false,
    ): Promise<{ reflected: boolean; event?: ReflectionEvent }> {
        const s = state ?? (await this.loadState(opts.threadId));
        const log = s.log ?? [];
        const logTokens = estimateObservationTokensArr(log, this.estimator);
        if (!force && logTokens < this.resolved.observationTokens) return { reflected: false };
        const transcript = log.join('\n');
        const response = await this.llmGenerate(
            [
                { role: 'system', content: SYSTEM_REFLECTOR },
                { role: 'user', content: transcript },
            ],
            1600,
        );
        const data = parseJson<{ reflections?: unknown }>(response);
        if (!data || !Array.isArray(data.reflections)) return { reflected: false };
        const newLog = data.reflections
            .filter((x): x is string => typeof x === 'string' && !!x.trim())
            .map((x) => x.trim());
        if (newLog.length === 0) return { reflected: false };
        const extracted = await this.runSchemaExtractors(transcript, opts, log.join('\n'));
        const tokensOut = estimateObservationTokensArr(newLog, this.estimator);
        s.log = newLog;
        s.logTokens = tokensOut;
        await this.persistState(opts.threadId, s);
        const event: ReflectionEvent = {
            threadId: opts.threadId,
            resourceId: opts.resourceId,
            tokensIn: logTokens,
            tokensOut,
            linesIn: log.length,
            linesOut: newLog.length,
            extractedValues: extracted.values,
            extractionFailures: extracted.failures,
        };
        this.config.onReflected?.(event);
        return { reflected: true, event };
    }

    get retrieval(): { vector: boolean; scope: 'thread' | 'resource' } | false {
        return this.resolved.retrieval;
    }

    // ── Internals ───────────────────────────────────────────────────────────

    private async loadState(threadId: string): Promise<MutableState> {
        const thread = await this.store.getThread(threadId).catch(() => null);
        return stateFromThread(thread?.state);
    }

    private async persistState(threadId: string, state: MutableState): Promise<void> {
        await this.store.updateThread(threadId, { state: state as ThreadState });
    }

    private async observeRange(
        opts: { threadId: string; resourceId: string },
        _state: MutableState,
        unobserved: StorageMessageLike[],
        kind: 'activate' | 'buffer',
    ): Promise<
        | {
            notes: string[];
            currentTask?: string;
            suggestedResponse?: string;
            title?: string;
            extractedValues?: Record<string, unknown>;
            extractionFailures?: Array<{ slug: string; error: string }>;
        }
        | undefined
    > {
        if (unobserved.length === 0) return undefined;
        const transcript = this.buildTranscript(unobserved);
        const previousLog = this.previousLogSnippet((await this.loadState(opts.threadId)).log ?? [], this.resolved.previousObserverTokens);
        const state = await this.loadState(opts.threadId);
        const promptLines: string[] = [];
        if (previousLog.length) promptLines.push(`Previous observations:\n${previousLog.join('\n')}\n`);
        if (state.currentTask) promptLines.push(`Previous current-task: ${state.currentTask}\n`);
        if (state.suggestedResponse) promptLines.push(`Previous suggested-response: ${state.suggestedResponse}\n`);
        promptLines.push(`Conversation to observe:\n\n${transcript}`);
        const extractionInstructions = this.buildExtractorInstructions();

        const messages: Message[] = [
            { role: 'system', content: SYSTEM_OBSERVER },
        ];
        if (extractionInstructions) {
            messages.push({
                role: 'system',
                content: `Additionally extract these fields inline (snake_case keys) in the same JSON:\n${extractionInstructions}`,
            });
        }
        messages.push({ role: 'user', content: promptLines.join('\n') });

        const response = await this.llmGenerate(messages, 1200);
        const data = parseJson<{
            observations?: unknown;
            currentTask?: unknown;
            suggestedResponse?: unknown;
            title?: unknown;
            [key: string]: unknown;
        }>(response);

        if (!data) {
            this.config.onError?.(new Error('Observer returned unparseable output; keeping raw history.'));
            return undefined;
        }
        const notes = (Array.isArray(data.observations) ? data.observations : [])
            .filter((x): x is string => typeof x === 'string' && !!x.trim())
            .map((x) => x.trim().slice(0, this.resolved.maxObservationWords * 8));
        if (notes.length === 0) return undefined;

        const extracted: Record<string, unknown> = {};
        const failures: Array<{ slug: string; error: string }> = [];
        const previousExtractions = state.extractions ?? {};
        for (const extractor of this.resolved.extractors) {
            if (extractor.schema) continue;
            const raw = data[extractor.slug];
            if (raw === undefined) continue;
            try {
                let value = raw;
                if (extractor.onExtracted) {
                    value = (await extractor.onExtracted({ current: raw, previous: previousExtractions[extractor.slug] })) ?? raw;
                }
                extracted[extractor.slug] = value;
            } catch (error) {
                failures.push({ slug: extractor.slug, error: error instanceof Error ? error.message : String(error) });
            }
        }
        const schemaValues = await this.runSchemaExtractors(
            Array.isArray(data.observations) ? data.observations.join('\n') : transcript,
            opts,
            Object.keys(previousExtractions).length ? JSON.stringify(previousExtractions) : undefined,
        );
        Object.assign(extracted, schemaValues.values);
        failures.push(...schemaValues.failures);

        const currentTask = typeof data.currentTask === 'string' ? data.currentTask : String(state.currentTask ?? '');
        const suggestedResponse = typeof data.suggestedResponse === 'string' ? data.suggestedResponse : state.suggestedResponse;
        const title = typeof data.title === 'string' ? data.title : undefined;

        this.config.onObserved?.({
            threadId: opts.threadId,
            resourceId: opts.resourceId,
            kind,
            notes,
            messageCount: unobserved.length,
            tokensIn: estimateConversationTokens(unobserved, this.estimator),
            tokensOut: estimateObservationTokensArr(notes, this.estimator),
            extractedValues: extracted,
            extractionFailures: failures,
        });

        return {
            notes,
            extractedValues: extracted,
            extractionFailures: failures,
            ...(currentTask ? { currentTask } : {}),
            ...(suggestedResponse ? { suggestedResponse } : {}),
            ...(title ? { title } : {}),
        };
    }

    /**
     * Persist an observed batch once: append notes to the log, merge extraction
     * values, clear the buffer and (when managing working memory) hand the
     * resolved profile over to the working-memory store.
     */
    private async commitObservation(
        opts: { threadId: string; resourceId: string },
        state: MutableState,
        notes: string[],
        extras: {
            currentTask?: string;
            suggestedResponse?: string;
            title?: string;
            extractedValues?: Record<string, unknown>;
        },
    ): Promise<void> {
        state.log = [...(state.log ?? []), ...notes];
        state.buffer = [];
        if (extras.currentTask) state.currentTask = extras.currentTask;
        if (extras.suggestedResponse) state.suggestedResponse = extras.suggestedResponse;
        if (extras.title && this.resolved.threadTitle) state.title = extras.title;
        if (extras.extractedValues && Object.keys(extras.extractedValues).length) {
            state.extractions = { ...(state.extractions ?? {}), ...extras.extractedValues };
        }
        state.logTokens = estimateObservationTokensArr(state.log, this.estimator);
        state.lastActivityAt = Date.now();
        await this.persistState(opts.threadId, state);

        const profile = extras.extractedValues?.['user-profile'];
        if (this.resolved.manageWorkingMemory && profile !== undefined) {
            const serialized = typeof profile === 'string' ? profile : JSON.stringify(profile);
            await this.workingMemory?.update({
                threadId: opts.threadId,
                resourceId: opts.resourceId,
                scope: 'resource',
                workingMemory: serialized,
            });
        }
    }

    private async runSchemaExtractors(
        transcript: string,
        opts: { threadId: string; resourceId: string },
        previousContext: string | undefined,
    ): Promise<{ values: Record<string, unknown>; failures: Array<{ slug: string; error: string }> }> {
        const values: Record<string, unknown> = {};
        const failures: Array<{ slug: string; error: string }> = [];
        const state = await this.loadState(opts.threadId);
        const previous = state.extractions ?? {};
        for (const extractor of this.resolved.extractors) {
            if (!extractor.schema) continue;
            const content = [
                `Extract: ${extractor.instructions}`,
                extractor.includePreviousExtraction && previous[extractor.slug] !== undefined
                    ? `Previous value:\n${JSON.stringify(previous[extractor.slug])}`
                    : undefined,
                `Source transcript:\n${transcript}`,
                ...(previousContext ? [`Previous context:\n${previousContext}`] : []),
            ]
                .filter((x): x is string => !!x)
                .join('\n\n');
            try {
                const response = await this.llmGenerate(
                    [
                        {
                            role: 'system',
                            content:
                                'Extract structured data from transcripts. Return the extracted value as exactly one JSON value — no prose, no code fences.',
                        },
                        { role: 'user', content },
                    ],
                    600,
                );
                let parsed: unknown;
                try {
                    parsed = JSON.parse(stripCodeFences(response));
                } catch {
                    parsed = response.trim() || undefined;
                }
                let finalValue = parsed;
                const result = safeValidate(extractor.schema, parsed);
                if (!result.success) {
                    failures.push({ slug: extractor.slug, error: result.error.message });
                    continue;
                }
                finalValue = result.data;
                if (extractor.onExtracted) {
                    finalValue = (await extractor.onExtracted({ current: finalValue, previous: previous[extractor.slug] })) ?? finalValue;
                }
                values[extractor.slug] = finalValue;
            } catch (error) {
                failures.push({ slug: extractor.slug, error: error instanceof Error ? error.message : String(error) });
            }
        }
        return { values, failures };
    }

    private buildTranscript(messages: StorageMessageLike[]): string {
        return messages
            .map((message) => `[${message.role === 'tool' ? 'tool-result' : message.role}] ${message.createdAt ?? ''}\n${textOfContent(message.content)}`)
            .join('\n\n');
    }

    private previousLogSnippet(log: string[], tokens: number | false): string[] {
        if (tokens === false) return log.slice(-200);
        if (tokens === 0 || log.length === 0) return [];
        let budget = tokens;
        const out: string[] = [];
        for (let i = log.length - 1; i >= 0; i--) {
            const line = log[i]!;
            budget -= this.estimator(line);
            if (budget < 0) break;
            out.unshift(line);
        }
        return out;
    }

    private buildExtractorInstructions(): string {
        const inline = this.resolved.extractors.filter((e) => !e.schema);
        if (inline.length === 0) return '';
        return inline.map((e) => `- ${e.slug}: ${e.instructions}`).join('\n');
    }

    private buildObservationSystem(
        log: string[],
        logTokens: number,
        threshold: number,
        reflected: boolean,
        title?: string,
    ): string | undefined {
        if (log.length === 0) return undefined;
        const header = ['[Observational Memory]'];
        if (title) header.push(`Thread title: ${title}`);
        header.push(`(${logTokens.toLocaleString()} tokens of observations — ${threshold.toLocaleString()} limit${reflected ? ' · reflected' : ''})`);
        header.push('');
        return [...header, ...log].join('\n');
    }

    private buildContinuation(unobserved: StorageMessageLike[], state: MutableState, activated: boolean): string | undefined {
        const parts: string[] = [];
        if (activated) {
            if (state.suggestedResponse) parts.push(`Suggested next response: ${state.suggestedResponse}`);
            if (state.currentTask) parts.push(`Current task: ${state.currentTask}`);
        }
        if (this.resolved.temporalMarkers && unobserved.length > 0) {
            const last = unobserved[unobserved.length - 1]!;
            const createdAt = last.createdAt ? Date.parse(last.createdAt) : NaN;
            if (Number.isFinite(createdAt) && Date.now() - createdAt >= TEMPORAL_MARKER_MS) {
                parts.push(`[Conversation resumed ${new Date(createdAt).toLocaleString()}]`);
            }
        }
        return parts.length ? parts.join('\n') : undefined;
    }

    private shouldActivateOnIdle(state: MutableState, buffered: unknown[]): boolean {
        const cfg = this.config.activateAfterIdle;
        if (!cfg || buffered.length === 0) return false;
        const ttl = idleTtlMs(cfg);
        const last = state.lastActivityAt ?? Date.now();
        return Date.now() - last >= ttl;
    }

    private keepTail(messages: StorageMessageLike[], tokens: number): StorageMessageLike[] {
        if (tokens <= 0) return [];
        let remaining = tokens;
        const out: StorageMessageLike[] = [];
        for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages[i]!;
            remaining -= this.estimator(textOfContent(message.content as StoredContent)) + 4;
            if (remaining < 0) break;
            out.unshift(message);
        }
        return out;
    }

    private async llmGenerate(messages: Message[], maxTokens: number): Promise<string> {
        const result = await this.llm.generateText(messages, {
            temperature: 0.2,
            maxTokens,
            toolChoice: 'none',
        });
        return result.text ?? '';
    }
}

// ── Profile extractor used for working-memory management ────────────────────

const PROFILE_EXTRACTOR = new Extractor({
    name: 'User profile',
    instructions:
        'Extract a compact user profile (preferred name, location, timezone, communication style, preferences, goals, tools). Keep values short.',
});

function flattenExtractors(...groups: Array<Extractor | Extractor[] | undefined>): Extractor[] {
    const out: Extractor[] = [];
    const seen = new Set<string>();
    for (const group of groups) {
        if (!group) continue;
        for (const extractor of Array.isArray(group) ? group : [group]) {
            if (!extractor || seen.has(extractor.slug)) continue;
            seen.add(extractor.slug);
            out.push(extractor);
        }
    }
    return out;
}

function resolveRetrieval(retrieval: ObservationalMemoryConfig['retrieval']): { vector: boolean; scope: 'thread' | 'resource' } | false {
    if (!retrieval) return false;
    if (retrieval === true) return { vector: false, scope: 'resource' };
    return { vector: retrieval.vector ?? false, scope: retrieval.scope ?? 'resource' };
}

function splitNotes(notes: string): string[] {
    return notes.split('\n').map((l) => l.trim()).filter(Boolean);
}

function estimateObservationTokensArr(lines: string[], estimator: TokenEstimator): number {
    let total = 0;
    for (const line of lines) total += estimator(line) + 1;
    return total;
}

function parseJson<T>(text: string): T | null {
    const cleaned = stripCodeFences(text);
    try {
        const parsed = JSON.parse(cleaned) as unknown;
        return parsed && typeof parsed === 'object' ? (parsed as T) : null;
    } catch {
        const first = cleaned.indexOf('{');
        const last = cleaned.lastIndexOf('}');
        if (first >= 0 && last > first) {
            try {
                const parsed = JSON.parse(cleaned.slice(first, last + 1)) as unknown;
                return parsed && typeof parsed === 'object' ? (parsed as T) : null;
            } catch {
                return null;
            }
        }
        return null;
    }
}

function stripCodeFences(text: string): string {
    return text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
}

function idleTtlMs(value: number | string): number {
    if (typeof value === 'number') return value;
    if (value === 'auto') return 5 * 60 * 1000;
    const match = /^(\d+)\s*(ms|s|m|h|hr|hrs)?$/i.exec(value.trim());
    if (!match) return 5 * 60 * 1000;
    const n = Number(match[1]);
    const unit = (match[2] ?? 'ms').toLowerCase();
    const mult = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' || unit === 'hr' || unit === 'hrs' ? 3_600_000 : 1;
    return n * mult;
}
