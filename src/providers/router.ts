/**
 * Intelligent LLM Router
 *
 * Routes each request to the optimal LLM provider based on:
 *   - Task type  (coding, reasoning, creative, simple, long-context, …)
 *   - Complexity (low / medium / high)
 *   - Routing strategy (quality | cost | speed | balanced)
 *   - Context-window requirements
 *   - User-defined override rules
 *   - Provider health / automatic fallback
 *
 * The router implements `LLMProvider`, so it is a transparent drop-in for any
 * provider slot in the framework.
 *
 * @example
 * ```ts
 * // Recommended: adaptive multi-criteria selection
 * const smart = createSmartRouter([
 *   { provider: openaiProvider, model: 'gpt-4.1-nano', capabilities: ['simple'], costTier: 'nano', speedTier: 'fast', contextWindow: 8_000 },
 *   { provider: openaiProvider, model: 'gpt-4o-mini', capabilities: ['simple','coding'], costTier: 'small', speedTier: 'fast', contextWindow: 128_000 },
 *   // …
 * ]);
 *
 * // Or explicit table + strategy
 * const router = new LLMRouter({
 *   strategy: 'balanced',
 *   entries: [
 *     { provider: openaiProvider,    model: 'gpt-4.1-nano',    capabilities: ['simple'],             costTier: 'nano', speedTier: 'fast',   contextWindow: 8_000  },
 *     { provider: openaiProvider,    model: 'gpt-4o-mini',     capabilities: ['simple','coding'],    costTier: 'small', speedTier: 'fast',  contextWindow: 128_000 },
 *     { provider: openaiProvider,    model: 'gpt-4.1',         capabilities: ['coding','creative'],  costTier: 'medium', speedTier: 'medium', contextWindow: 128_000 },
 *     { provider: anthropicProvider, model: 'claude-sonnet-4', capabilities: ['coding','reasoning'], costTier: 'large',  speedTier: 'medium', contextWindow: 200_000 },
 *     { provider: anthropicProvider, model: 'claude-opus-4',   capabilities: ['reasoning'],          costTier: 'frontier', speedTier: 'slow', contextWindow: 200_000 },
 *   ],
 * });
 * ```
 */

import type { LLMProvider, Message, GenerateResult, GenerateOptions, StreamOptions } from './types.js';
import { LLMError } from '../shared/index.js';
import { estimateTokenCount } from './context-window-manager.js';

// ── Task classification ────────────────────────────────────────────────────

/**
 * Broad categories of LLM tasks.
 * The router detects these from the prompt without any extra LLM calls.
 */
export type TaskType =
    | 'simple'        // factual Q&A, short conversational replies
    | 'coding'        // code generation, debugging, code review, CLI scripts
    | 'reasoning'     // multi-step logic, math, analysis, research
    | 'creative'      // stories, marketing copy, brainstorming
    | 'tool_use'      // requests that supply tools / function-calling
    | 'long_context'  // large prompt inputs (RAG, document analysis)
    | 'multimodal';   // prompts containing image / audio / video content

/**
 * Coarse complexity buckets used to rank candidates within a task type.
 */
export type Complexity = 'low' | 'medium' | 'high';

/** Cost tier (cheap → expensive). */
export type CostTier = 'nano' | 'small' | 'medium' | 'large' | 'frontier';

/** Latency tier. */
export type SpeedTier = 'fast' | 'medium' | 'slow';

// ── Router entry ───────────────────────────────────────────────────────────

/**
 * A single entry in the router table — a provider instance paired with
 * metadata that the router uses to select the right model.
 */
export interface RouterEntry {
    /** The underlying LLM provider instance. */
    provider: LLMProvider;

    /** Human-readable model name used in route decisions and logs. */
    model: string;

    /**
     * Task types this model handles well.
     * The router only considers entries whose capabilities overlap with
     * the detected task type.
     */
    capabilities: TaskType[];

    /**
     * Cost tier — used by the `cost` and `balanced` strategies.
     * @default 'medium'
     */
    costTier?: CostTier;

    /**
     * Speed tier — used by the `speed` strategy.
     * @default 'medium'
     */
    speedTier?: SpeedTier;

    /**
     * Maximum context window in tokens.
     * Requests that exceed this value won't be routed here.
     * @default 128_000
     */
    contextWindow?: number;

    /**
     * Numeric quality score 0–10 (higher = better quality).
     * Inferred from costTier when omitted.
     */
    qualityScore?: number;
}

// ── Routing rules ──────────────────────────────────────────────────────────

/**
 * An optional override rule evaluated before any strategy logic.
 * When `match` returns `true`, the router immediately uses this entry.
 */
export interface RouterRule {
    name: string;
    /** Return true if this rule should take effect for the given context. */
    match: (ctx: RouteContext) => boolean;
    /**
     * Index into `LLMRouterConfig.entries` to use when the rule matches,
     * OR a provider factory that returns a fresh provider.
     */
    useEntry: number | (() => LLMProvider);
}

// ── Route context ──────────────────────────────────────────────────────────

/**
 * Rich context passed to rule matchers and emitted with route decisions.
 */
export interface RouteContext {
    messages: Message[];
    options?: GenerateOptions;
    detectedTask: TaskType;
    detectedComplexity: Complexity;
    estimatedTokens: number;
    hasTools: boolean;
    hasMultimodal: boolean;
}

// ── Route decision ─────────────────────────────────────────────────────────

/**
 * The decision the router made for a single request.
 * Accessible via `router.getLastRouteDecision()`.
 */
export interface RouteDecision {
    model: string;
    entryIndex: number;
    detectedTask: TaskType;
    detectedComplexity: Complexity;
    strategy: RoutingStrategy;
    reason: string;
    estimatedTokens: number;
    ruleMatched?: string;
}

// ── Config ─────────────────────────────────────────────────────────────────

/**
 * - `adaptive` — multi-criteria score (quality, cost, speed, task fit); best default for mixed traffic.
 * - `balanced` — capability filter + min-quality gate + cheapest viable (legacy, predictable).
 */
export type RoutingStrategy = 'quality' | 'cost' | 'speed' | 'balanced' | 'adaptive';

/** Weights for {@link RoutingStrategy} `adaptive` (higher = stronger preference along that axis). */
export interface AdaptiveWeights {
    /** Emphasize higher `qualityScore` / cost-tier quality. Default `0.35`. */
    quality?: number;
    /** Emphasize cheaper `costTier`. Default `0.28`. */
    cost?: number;
    /** Emphasize faster `speedTier`. Default `0.27`. */
    speed?: number;
    /** Emphasize entries whose `capabilities` match the detected task. Default `0.25`. */
    capabilityFit?: number;
}

const DEFAULT_ADAPTIVE_WEIGHTS: Required<AdaptiveWeights> = {
    quality: 0.35,
    cost: 0.28,
    speed: 0.27,
    capabilityFit: 0.25,
};

export interface LLMRouterConfig {
    /** Ordered list of router entries. Order matters for tie-breaking. */
    entries: RouterEntry[];

    /**
     * Routing strategy.
     * - `quality`  — always picks the highest quality (frontier/large first)
     * - `cost`     — picks the cheapest capable model
     * - `speed`    — picks the fastest capable model
     * - `balanced` — cost-aware but bumps up quality for hard tasks (default)
     * - `adaptive` — weighted score across quality, cost, speed, and task fit (see {@link createSmartRouter})
     */
    strategy?: RoutingStrategy;

    /** Only for `strategy: 'adaptive'`. Merges with built-in defaults. */
    adaptiveWeights?: AdaptiveWeights;

    /** Optional override for complexity detection (after task is known). */
    classifyComplexity?: (ctx: RouteContext) => Complexity;

    /** Optional override rules evaluated before strategy logic. */
    rules?: RouterRule[];

    /**
     * Fallback entry index to use when no entry matches.
     * Defaults to the last entry in the list.
     */
    fallbackEntryIndex?: number;

    /** Emit routing decisions to console. */
    debug?: boolean;

    /**
     * Custom task classifier.
     * When provided, overrides the built-in heuristic classifier.
     */
    classifyTask?: (ctx: RouteContext) => TaskType;
}

// ── Cost / quality tier maps ───────────────────────────────────────────────

const COST_TIER_ORDER: CostTier[] = ['nano', 'small', 'medium', 'large', 'frontier'];

const QUALITY_FROM_COST: Record<CostTier, number> = {
    nano: 3,
    small: 5,
    medium: 7,
    large: 8.5,
    frontier: 10,
};

const SPEED_ORDER: SpeedTier[] = ['fast', 'medium', 'slow'];

function qualityScore(e: RouterEntry): number {
    if (e.qualityScore !== undefined) return e.qualityScore;
    return QUALITY_FROM_COST[e.costTier ?? 'medium'];
}

function costRank(e: RouterEntry): number {
    return COST_TIER_ORDER.indexOf(e.costTier ?? 'medium');
}

function speedRank(e: RouterEntry): number {
    return SPEED_ORDER.indexOf(e.speedTier ?? 'medium');
}

// ── Built-in task classifier ───────────────────────────────────────────────

const CODING_PATTERNS = [
    /\b(function|class|const|let|var|import|export|return|async|await|interface|type)\b/,
    /\b(python|javascript|typescript|rust|golang|java|c\+\+|kotlin|swift)\b/i,
    /\b(debug|refactor|implement|unit test|api endpoint|algorithm|sql|query|regex)\b/i,
    /```[\w]*\n/,
    /\b(git|docker|kubernetes|ci\/cd|npm|pip|cargo)\b/i,
];

const REASONING_PATTERNS = [
    /\b(step[- ]by[- ]step|explain why|analyze|analysis|reason|reasoning|evaluate|compare)\b/i,
    /\b(pros and cons|tradeoffs?|implications?|consequences?|hypothes[ie]s|argument)\b/i,
    /\b(math|calculus|algebra|statistics|probability|formula|equation|theorem|proof)\b/i,
    /\b(research|literature|academic|peer[- ]review|methodology|systematic)\b/i,
];

const CREATIVE_PATTERNS = [
    /\b(write|compose|draft|create|generate)\b.{0,40}\b(story|poem|blog|essay|ad|slogan|script|lyrics|email|letter)\b/i,
    /\b(creative|fiction|narrative|character|plot|scene|dialogue|marketing)\b/i,
    /\b(brainstorm|ideate|come up with|suggest ideas)\b/i,
];

/** Minimum model quality (0–10) per (task, complexity) — used by `balanced` and `adaptive`. */
const MIN_QUALITY_BY_TASK: Record<TaskType, Record<Complexity, number>> = {
    simple:       { low: 0,  medium: 3, high: 5  },
    coding:       { low: 5,  medium: 7, high: 8  },
    reasoning:    { low: 7,  medium: 8, high: 10 },
    creative:     { low: 5,  medium: 6, high: 8  },
    tool_use:     { low: 5,  medium: 7, high: 8  },
    long_context: { low: 5,  medium: 6, high: 8  },
    multimodal:   { low: 5,  medium: 7, high: 8  },
};

function extractUserMessagesText(messages: Message[]): string {
    return messages
        .filter((m) => m.role === 'user')
        .map((m) =>
            typeof m.content === 'string'
                ? m.content
                : m.content
                    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                    .map((p) => p.text)
                    .join(' ')
        )
        .join('\n');
}

/**
 * Multi-signal task scores (higher = better match). Used instead of first-regex-wins.
 * Exported for tests and custom telemetry.
 */
export function scoreTaskTypesForRouting(text: string, ctx: RouteContext): Record<TaskType, number> {
    const scores: Record<TaskType, number> = {
        simple: 0.5,
        coding: 0,
        reasoning: 0,
        creative: 0,
        tool_use: 0,
        long_context: 0,
        multimodal: 0,
    };

    const t = text.trim();
    if (!t) {
        return scores;
    }

    const tok = ctx.estimatedTokens;
    if (tok > 24_000) scores.long_context += 12;
    else if (tok > 12_000) scores.long_context += 8;
    else if (tok > 6_000) scores.long_context += 5;
    else if (tok > 3_000) scores.long_context += 2;

    for (const p of CODING_PATTERNS) {
        if (p.test(t)) scores.coding += 2.5;
    }
    for (const p of REASONING_PATTERNS) {
        if (p.test(t)) scores.reasoning += 2.5;
    }
    for (const p of CREATIVE_PATTERNS) {
        if (p.test(t)) scores.creative += 2.5;
    }

    if (/\b(json|yaml|xml|openapi|graphql|protobuf|grpc|sql schema|typescript|eslint|prettier)\b/i.test(t)) {
        scores.coding += 2;
    }
    if (/\b(summarize|summary|tldr|tl;dr|executive summary|key takeaways)\b/i.test(t)) {
        scores.reasoning += 2;
    }
    if (/\b(prove|theorem|lemma|qed|inductive proof|formal proof)\b/i.test(t)) {
        scores.reasoning += 4;
    }
    if (/\b(translate|translation|locale|i18n)\b/i.test(t)) {
        scores.simple += 1.5;
    }

    const strongest = Math.max(scores.coding, scores.reasoning, scores.creative, scores.long_context);
    if (strongest < 1.5) {
        scores.simple += 2;
    }

    return scores;
}

function pickDominantTask(scores: Record<TaskType, number>): TaskType {
    let best: TaskType = 'simple';
    let bestV = -1;
    const keys: TaskType[] = [
        'simple',
        'coding',
        'reasoning',
        'creative',
        'long_context',
        'tool_use',
        'multimodal',
    ];
    for (const k of keys) {
        const v = scores[k];
        if (v > bestV) {
            bestV = v;
            best = k;
        }
    }
    return best;
}

/**
 * Estimate the number of tokens in a set of messages.
 * Delegates to the shared {@link estimateTokenCount} BPE-aware estimator
 * (accurate within ±3% of tiktoken cl100k_base) so routing token counts stay
 * consistent with the context-window manager and stream budgets.
 */
function estimateMessageTokens(messages: Message[]): number {
    return estimateTokenCount(messages);
}

/**
 * Detect multimodal content in messages.
 */
function hasMultimodalContent(messages: Message[]): boolean {
    for (const m of messages) {
        if (Array.isArray(m.content)) {
            for (const part of m.content) {
                if (part.type !== 'text') return true;
            }
        }
    }
    return false;
}

/**
 * Built-in heuristic task classifier.
 * Multi-signal scoring over user text + token estimate (no network calls).
 */
function classifyTaskHeuristic(ctx: RouteContext): TaskType {
    if (ctx.hasMultimodal) return 'multimodal';
    if (ctx.hasTools) return 'tool_use';

    const text = extractUserMessagesText(ctx.messages);
    const scores = scoreTaskTypesForRouting(text, ctx);
    return pickDominantTask(scores);
}

/**
 * Estimate complexity from token count and content signals.
 */
function classifyComplexity(ctx: RouteContext): Complexity {
    const tokens = ctx.estimatedTokens;
    const text = ctx.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join(' ');

    const isLong = tokens > 3_000;
    const isMultiStep = /\b(step \d|first|second|third|finally|lastly|1\.|2\.|3\.)\b/i.test(text);
    const isTechnical =
        ctx.detectedTask === 'reasoning' ||
        ctx.detectedTask === 'coding' ||
        ctx.detectedTask === 'long_context';

    if (isLong && (isMultiStep || isTechnical)) return 'high';
    if (isLong || isMultiStep || isTechnical) return 'medium';
    return 'low';
}

// ── Strategy selectors ─────────────────────────────────────────────────────

function selectByQuality(candidates: Array<RouterEntry & { index: number }>): RouterEntry & { index: number } {
    return candidates.reduce((best, c) => (qualityScore(c) >= qualityScore(best) ? c : best));
}

function selectByCost(candidates: Array<RouterEntry & { index: number }>): RouterEntry & { index: number } {
    return candidates.reduce((best, c) => (costRank(c) <= costRank(best) ? c : best));
}

function selectBySpeed(candidates: Array<RouterEntry & { index: number }>): RouterEntry & { index: number } {
    return candidates.reduce((best, c) => (speedRank(c) <= speedRank(best) ? c : best));
}

/**
 * Balanced strategy — cheap for low-complexity tasks, bumps to higher quality
 * for demanding ones.
 */
function selectBalanced(
    candidates: Array<RouterEntry & { index: number }>,
    task: TaskType,
    complexity: Complexity,
): RouterEntry & { index: number } {
    const threshold = MIN_QUALITY_BY_TASK[task][complexity];
    const viable = candidates.filter((c) => qualityScore(c) >= threshold);
    const pool = viable.length > 0 ? viable : candidates;

    // Among viable, pick cheapest
    return selectByCost(pool);
}

function clamp01(x: number): number {
    return Math.max(0, Math.min(1, x));
}

function normalizeLinear(value: number, min: number, max: number): number {
    if (max <= min) return 0.5;
    return clamp01((value - min) / (max - min));
}

/**
 * Pick the candidate with the highest weighted score (quality, cost, speed, task fit),
 * respecting a minimum quality floor for the detected (task, complexity).
 */
function selectAdaptive(
    candidates: Array<RouterEntry & { index: number }>,
    task: TaskType,
    complexity: Complexity,
    weightsIn?: AdaptiveWeights,
): RouterEntry & { index: number } {
    const w = { ...DEFAULT_ADAPTIVE_WEIGHTS, ...weightsIn };
    const minQ = MIN_QUALITY_BY_TASK[task][complexity];

    const qs = candidates.map((c) => qualityScore(c));
    const qLo = Math.min(...qs);
    const qHi = Math.max(...qs);

    const costR = candidates.map((c) => costRank(c));
    const crLo = Math.min(...costR);
    const crHi = Math.max(...costR);

    const speedR = candidates.map((c) => speedRank(c));
    const srLo = Math.min(...speedR);
    const srHi = Math.max(...speedR);

    function fitScore(e: RouterEntry & { index: number }): number {
        if (e.capabilities.includes(task)) return 1;
        if (task !== 'simple' && e.capabilities.includes('simple')) return 0.55;
        return 0.35;
    }

    const scored = candidates.map((e, idx) => {
        const qNorm = normalizeLinear(qualityScore(e), qLo, qHi);
        const cheapNorm = 1 - normalizeLinear(costR[idx]!, crLo, crHi);
        const fastNorm = 1 - normalizeLinear(speedR[idx]!, srLo, srHi);
        const fit = fitScore(e);
        let s =
            w.quality * qNorm +
            w.cost * cheapNorm +
            w.speed * fastNorm +
            w.capabilityFit * fit;
        if (qualityScore(e) < minQ) {
            s -= 0.45;
        }
        return { e, s };
    });

    let viable = scored.filter((x) => qualityScore(x.e) >= minQ);
    if (viable.length === 0) {
        viable = scored;
    }

    return viable.reduce((best, cur) => (cur.s > best.s ? cur : best)).e;
}

// ── Main router class ──────────────────────────────────────────────────────

/**
 * Intelligent LLM Router.
 *
 * Implements `LLMProvider`, making it a transparent drop-in replacement
 * for any provider in the framework.
 */
export class LLMRouter implements LLMProvider {
    private readonly entries: Array<RouterEntry & { index: number }>;
    private readonly strategy: RoutingStrategy;
    private readonly rules: RouterRule[];
    private readonly fallbackIndex: number;
    private readonly debug: boolean;
    private readonly customClassifier?: (ctx: RouteContext) => TaskType;
    private readonly customComplexity?: (ctx: RouteContext) => Complexity;
    private readonly adaptiveWeights?: AdaptiveWeights;

    private lastDecision: RouteDecision | null = null;
    private decisionHistory: RouteDecision[] = [];

    constructor(config: LLMRouterConfig) {
        if (config.entries.length === 0) {
            throw new Error('LLMRouter requires at least one entry');
        }

        this.entries = config.entries.map((e, i) => ({ ...e, index: i }));
        this.strategy = config.strategy ?? 'balanced';
        this.rules = config.rules ?? [];
        this.fallbackIndex = config.fallbackEntryIndex ?? config.entries.length - 1;
        this.debug = config.debug ?? false;
        this.customClassifier = config.classifyTask;
        this.customComplexity = config.classifyComplexity;
        this.adaptiveWeights = config.adaptiveWeights;
    }

    // ── Public API ─────────────────────────────────────────────────────────

    getName(): string {
        return `LLMRouter(${this.strategy}, ${this.entries.length} entries)`;
    }

    async generateText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
        const { entry, decision } = this.route(messages, options);
        this.recordDecision(decision);

        try {
            return await entry.provider.generateText(messages, options);
        } catch (err) {
            return this.handleFailure(err, messages, options, decision, 'generateText');
        }
    }

    async streamText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult> {
        const { entry, decision } = this.route(messages, options as any);
        this.recordDecision(decision);

        const provider = entry.provider;
        const streamFn: (msgs: Message[], opts?: any) => Promise<GenerateResult> = provider.streamText?.bind(provider) ?? provider.generateText.bind(provider);

        try {
            return await streamFn(messages, options);
        } catch (err) {
            return this.handleFailure(err, messages, options, decision, 'streamText');
        }
    }

    /** The routing decision made for the most recent request. */
    getLastRouteDecision(): RouteDecision | null {
        return this.lastDecision;
    }

    /** Full history of all routing decisions (newest last). */
    getDecisionHistory(): RouteDecision[] {
        return [...this.decisionHistory];
    }

    /** Clear the decision history. */
    clearHistory(): void {
        this.decisionHistory = [];
        this.lastDecision = null;
    }

    // ── Core routing logic ─────────────────────────────────────────────────

    private route(
        messages: Message[],
        options?: GenerateOptions,
    ): { entry: RouterEntry & { index: number }; decision: RouteDecision } {
        const estimatedTokens = estimateMessageTokens(messages);
        const hasTools = Boolean(options?.tools && options.tools.length > 0);
        const hasMultimodal = hasMultimodalContent(messages);

        // Build partial context (task + complexity filled in next)
        const partialCtx: RouteContext = {
            messages,
            options,
            detectedTask: 'simple',
            detectedComplexity: 'low',
            estimatedTokens,
            hasTools,
            hasMultimodal,
        };

        // Detect task
        const detectedTask = this.customClassifier
            ? this.customClassifier({ ...partialCtx })
            : classifyTaskHeuristic({ ...partialCtx });

        // Detect complexity
        const ctxWithTask = { ...partialCtx, detectedTask };
        const detectedComplexity = this.customComplexity
            ? this.customComplexity(ctxWithTask)
            : classifyComplexity(ctxWithTask);

        const ctx: RouteContext = { ...ctxWithTask, detectedComplexity };

        // 1. Check override rules first
        for (const rule of this.rules) {
            if (rule.match(ctx)) {
                if (typeof rule.useEntry === 'number') {
                    const entry = this.entries[rule.useEntry];
                    if (entry) {
                        const decision = this.makeDecision(entry, ctx, `rule:${rule.name}`);
                        this.log(`Rule '${rule.name}' matched → ${entry.model}`);
                        return { entry, decision };
                    }
                } else {
                    // Dynamic provider factory — wrap in a synthetic entry
                    const provider = rule.useEntry();
                    const syntheticEntry = {
                        provider,
                        model: `rule:${rule.name}`,
                        capabilities: [detectedTask],
                        index: -1,
                    } as RouterEntry & { index: number };
                    const decision = this.makeDecision(syntheticEntry, ctx, `rule:${rule.name}`);
                    this.log(`Rule '${rule.name}' matched → synthetic provider`);
                    return { entry: syntheticEntry, decision };
                }
            }
        }

        // 2. Filter by context window
        const windowFit = this.entries.filter(
            (e) => estimatedTokens <= (e.contextWindow ?? 128_000),
        );
        const pool = windowFit.length > 0 ? windowFit : this.entries;

        // 3. Filter by capability — single pass, partitioning task-capable vs 'simple'-capable.
        const capable: (RouterEntry & { index: number })[] = [];
        const simpleCapable: (RouterEntry & { index: number })[] = [];
        for (const e of pool) {
            if (e.capabilities.includes(detectedTask)) capable.push(e);
            else if (e.capabilities.includes('simple')) simpleCapable.push(e);
        }
        // If nothing matches the specific task, fall back to 'simple'-capable models
        const candidates = capable.length > 0 ? capable : simpleCapable.length > 0 ? simpleCapable : pool;

        // 4. Select by strategy
        let selected: RouterEntry & { index: number };
        switch (this.strategy) {
            case 'quality':
                selected = selectByQuality(candidates);
                break;
            case 'cost':
                selected = selectByCost(candidates);
                break;
            case 'speed':
                selected = selectBySpeed(candidates);
                break;
            case 'adaptive':
                selected = selectAdaptive(candidates, detectedTask, detectedComplexity, this.adaptiveWeights);
                break;
            case 'balanced':
            default:
                selected = selectBalanced(candidates, detectedTask, detectedComplexity);
        }

        const reason = [
            `task=${detectedTask}`,
            `complexity=${detectedComplexity}`,
            `strategy=${this.strategy}`,
            `tokens≈${estimatedTokens}`,
        ].join(', ');

        const decision = this.makeDecision(selected, ctx, reason);
        this.log(`Routing → ${selected.model} (${reason})`);
        return { entry: selected, decision };
    }

    private makeDecision(
        entry: RouterEntry & { index: number },
        ctx: RouteContext,
        reason: string,
    ): RouteDecision {
        return {
            model: entry.model,
            entryIndex: entry.index,
            detectedTask: ctx.detectedTask,
            detectedComplexity: ctx.detectedComplexity,
            strategy: this.strategy,
            reason,
            estimatedTokens: ctx.estimatedTokens,
            ...(reason.startsWith('rule:') ? { ruleMatched: reason.slice(5) } : {}),
        };
    }

    private recordDecision(decision: RouteDecision): void {
        this.lastDecision = decision;
        this.decisionHistory.push(decision);
        // Cap to prevent unbounded growth in long-running processes
        if (this.decisionHistory.length > 1000) {
            this.decisionHistory = this.decisionHistory.slice(-1000);
        }
    }

    /**
     * On failure, fall back to the configured fallback entry (if different from
     * the one that just failed), otherwise rethrow.
     */
    private async handleFailure(
        err: unknown,
        messages: Message[],
        options: GenerateOptions | StreamOptions | undefined,
        decision: RouteDecision,
        method: 'generateText' | 'streamText',
    ): Promise<GenerateResult> {
        // Only fall back on transient failures (rate-limit / 5xx / network). A
        // 4xx (bad request / auth / validation) fails identically on another
        // provider — re-sending wastes a call and money.
        const ee = err as { status?: number; statusCode?: number; code?: string; name?: string } | null;
        const status = ee?.status ?? ee?.statusCode;
        const transient =
            (typeof status === 'number' && (status === 429 || (status >= 500 && status <= 599))) ||
            /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|FETCH|NETWORK|ABORT/i.test(
                String(ee?.code ?? ee?.name ?? ''),
            );
        const fallback = transient ? this.entries[this.fallbackIndex] : undefined;
        if (fallback && fallback.index !== decision.entryIndex) {
            this.log(
                `Provider '${decision.model}' failed, falling back to '${fallback.model}'`,
                true,
            );
            if (method === 'streamText') {
                const fn: (msgs: Message[], opts?: any) => Promise<GenerateResult> = fallback.provider.streamText?.bind(fallback.provider) ?? fallback.provider.generateText.bind(fallback.provider);
                return fn(messages, options as unknown as GenerateOptions);
            }
            return fallback.provider.generateText(messages, options as unknown as GenerateOptions);
        }

        throw err instanceof Error
            ? new LLMError(`LLMRouter: ${err.message}`, { cause: err })
            : err;
    }

    private log(msg: string, warn = false): void {
        if (!this.debug) return;
        const prefix = '[LLMRouter]';
        if (warn) console.warn(prefix, msg);
        else console.log(prefix, msg);
    }
}

// ── Preset router factories ────────────────────────────────────────────────

/**
 * Build a cost-optimized router.
 *
 * Tries the cheapest capable model first, only escalating when the task
 * requires higher quality.
 */
export function createCostOptimizedRouter(entries: RouterEntry[], debug?: boolean): LLMRouter {
    return new LLMRouter({ entries, strategy: 'cost', debug });
}

/**
 * Build a quality-first router.
 *
 * Always picks the highest quality model that can handle the task and fits
 * within the context window.
 */
export function createQualityFirstRouter(entries: RouterEntry[], debug?: boolean): LLMRouter {
    return new LLMRouter({ entries, strategy: 'quality', debug });
}

/**
 * Build a speed-optimized router.
 *
 * Picks the fastest model capable of handling the request.
 */
export function createSpeedOptimizedRouter(entries: RouterEntry[], debug?: boolean): LLMRouter {
    return new LLMRouter({ entries, strategy: 'speed', debug });
}

/**
 * Build a balanced router (default).
 *
 * Uses cheap / fast models for simple tasks and automatically escalates to
 * more powerful models when complexity or task type demands it.
 */
export function createBalancedRouter(
    entries: RouterEntry[],
    options?: { rules?: RouterRule[]; debug?: boolean },
): LLMRouter {
    return new LLMRouter({ entries, strategy: 'balanced', ...options });
}

/**
 * **Recommended** smart router: `adaptive` strategy with tuned default weights.
 * Combines quality, cost, speed, and task-capability fit in one score (no extra LLM calls).
 */
export function createSmartRouter(
    entries: RouterEntry[],
    options?: {
        rules?: RouterRule[];
        debug?: boolean;
        adaptiveWeights?: AdaptiveWeights;
        classifyTask?: (ctx: RouteContext) => TaskType;
        classifyComplexity?: (ctx: RouteContext) => Complexity;
    },
): LLMRouter {
    return new LLMRouter({
        entries,
        strategy: 'adaptive',
        rules: options?.rules,
        debug: options?.debug,
        adaptiveWeights: options?.adaptiveWeights,
        classifyTask: options?.classifyTask,
        classifyComplexity: options?.classifyComplexity,
    });
}
