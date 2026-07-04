import type { Message } from '../providers/types.js';
import type { AgenticStreamHooks } from '../agentic/index.js';
import { withSpan, genAiAttributes } from '../observe/index.js';
import type { Tool, ToolProvider, ToolResult } from '../tools/core/index.js';
import { createAgenticAgent } from '../agentic/index.js';
import { HttpClientTool } from '../tools/utils/http.js';
import { BrowserTool } from '../tools/utils/browser.js';
import { ToolCategory } from '../tools/core/index.js';
import { InMemorySessionStore } from '../session/index.js';
import { ConfigError } from '../shared/index.js';
import { toToolRegistry } from '../tools/core/index.js';
import { isLightweightTool } from '../tools/core/index.js';
import { zodToJsonSchema } from '../tools/core/zod-to-schema.js';
import { createAgentMemoryTools, InMemoryStore } from '../memory/index.js';
import type { MemorySearchResult, MemoryStore } from '../memory/index.js';
import { createDevLogger, createDevToolMiddleware } from '../dx/dev-logger.js';
import { BudgetEnforcer } from '../production/budget.js';
import { Mastermind } from '../compression/mastermind/index.js';
import type { MastermindConfig } from '../compression/mastermind/index.js';
import { z } from 'zod';
import type { CreateAgentOptions, CreateAgentResult, AgentRunOptions, AgentRunResult, StreamChunk } from './types.js';
import type { AdapterRegistry, AdapterBindings } from '../adapters/index.js';
import type { AppConfig } from '../config/index.js';
import {
    resolveLlmForCreateAgent,
    ENV_API_KEY,
    ENV_MODEL,
    ENV_BASE_URL,
} from './resolve-llm.js';
import { isMultiModalInput, multiModalToMessage } from '../providers/vision.js';

/**
 * Resolves the tools option to a ToolRegistry.
 * - omitted (`undefined`) → empty registry (no tools, pure text reasoning)
 * - `false`             → empty registry (no tools)
 * - `[]`               → empty registry
 * - `'web'`            → preset: [HttpClientTool, BrowserTool]
 * - array / registry   → use as-is; LightweightTool instances are auto-converted
 */
type AgentTool = Extract<NonNullable<CreateAgentOptions['tools']>, readonly unknown[]>[number];

function resolveTools(
    toolsOption: CreateAgentOptions['tools'],
    extraTools: AgentTool[] = [],
): ReturnType<typeof toToolRegistry> {
    let registry: ReturnType<typeof toToolRegistry>;
    if (toolsOption === false || toolsOption === undefined) {
        registry = toToolRegistry([]);
    } else if (toolsOption === 'web') {
        registry = toToolRegistry([new HttpClientTool(), new BrowserTool()] as ToolProvider);
    } else if (Array.isArray(toolsOption)) {
        const normalized = toolsOption.map((tool) =>
            isLightweightTool(tool) ? tool.toFrameworkTool() : tool,
        );
        registry = toToolRegistry(normalized as ToolProvider);
    } else {
        registry = toToolRegistry(toolsOption as ToolProvider);
    }

    if (extraTools.length === 0) return registry;
    return toToolRegistry([...registry.list(), ...extraTools] as ToolProvider);
}

function pickBoolean(
    runValue: boolean | undefined,
    agentValue: boolean | undefined,
    fallback: boolean,
): boolean {
    return runValue ?? agentValue ?? fallback;
}

function pickNumber(
    runValue: number | undefined,
    agentValue: number | undefined,
    fallback: number,
): number {
    const value = runValue ?? agentValue ?? fallback;
    if (!Number.isFinite(value)) return fallback;
    return Math.max(0, Math.floor(value));
}

function trimHistoryByRuns(history: Message[], runLimit: number | undefined): Message[] {
    if (runLimit === undefined) return history;
    if (runLimit <= 0) return [];

    let userTurns = 0;
    let startIndex = 0;
    for (let index = history.length - 1; index >= 0; index--) {
        if (history[index]?.role !== 'user') continue;
        userTurns++;
        if (userTurns > runLimit) {
            break;
        }
        startIndex = index;
    }
    return history.slice(startIndex);
}

function trimHistoryByMessages(history: Message[], messageLimit: number | undefined): Message[] {
    if (messageLimit === undefined) return history;
    if (messageLimit <= 0) return [];
    return history.slice(-messageLimit);
}

function selectHistoryForContext(history: Message[], runOptions: AgentRunOptions | undefined, options: CreateAgentOptions): Message[] {
    const runLimit = runOptions?.numHistoryRuns ?? options.numHistoryRuns;
    const messageLimit = runOptions?.numHistoryMessages ?? options.numHistoryMessages;
    return trimHistoryByMessages(trimHistoryByRuns(history, runLimit), messageLimit);
}

function formatMemoryContext(results: MemorySearchResult[]): string | undefined {
    if (results.length === 0) return undefined;
    const lines = results.map((result) => `- ${result.entry.content}`);
    return `[Memory Context]\n${lines.join('\n')}`;
}

async function buildMemoryContext(
    memoryStore: MemoryStore | undefined,
    prompt: string,
    limit: number,
): Promise<{ context?: string; count: number }> {
    if (!memoryStore) return { count: 0 };
    const results = await memoryStore.retrieve({ query: prompt, limit, threshold: 0.1 });
    return { context: formatMemoryContext(results), count: results.length };
}

function combineContext(memoryContext: string | undefined, knowledgeContext: string | undefined): string | undefined {
    const sections = [memoryContext, knowledgeContext].filter((section): section is string => !!section?.trim());
    return sections.length ? sections.join('\n\n') : undefined;
}

function parseFollowups(text: string, limit: number): string[] {
    const withoutFence = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    const candidates: unknown[] = [];

    try {
        const parsed = JSON.parse(withoutFence) as unknown;
        if (Array.isArray(parsed)) candidates.push(...parsed);
        else if (parsed && typeof parsed === 'object') {
            const record = parsed as { followups?: unknown; followUpSuggestions?: unknown };
            const values = Array.isArray(record.followups)
                ? record.followups
                : Array.isArray(record.followUpSuggestions)
                  ? record.followUpSuggestions
                  : [];
            candidates.push(...values);
        }
    } catch {
        const lines = withoutFence
            .split('\n')
            .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
            .filter(Boolean);
        candidates.push(...lines);
    }

    const seen = new Set<string>();
    const followups: string[] = [];
    for (const candidate of candidates) {
        if (typeof candidate !== 'string') continue;
        const value = candidate.trim();
        if (!value || seen.has(value)) continue;
        seen.add(value);
        followups.push(value);
        if (followups.length >= limit) break;
    }
    return followups;
}

async function generateFollowups(
    llm: ReturnType<typeof resolveLlmForCreateAgent>,
    prompt: string,
    answer: string,
    count: number,
): Promise<string[]> {
    if (count <= 0 || !answer.trim()) return [];
    const result = await llm.generateText([
        {
            role: 'system',
            content: `Generate exactly ${count} concise follow-up questions the user may naturally ask next. Return only JSON: {"followups":["..."]}.`,
        },
        {
            role: 'user',
            content: `Original user prompt:\n${prompt}\n\nAssistant answer:\n${answer}`,
        },
    ] as Message[], { temperature: 0.4, maxTokens: 512, toolChoice: 'none' });
    return parseFollowups(result.text ?? '', count);
}

function storageKey(agentName: string, runId: string | undefined): string {
    const safeName = agentName.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'agent';
    return `agent:${safeName}:runs:${runId ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;
}

function createFrameworkMemoryTools(memoryStore: MemoryStore): AgentTool[] {
    const memoryTools = Object.values(createAgentMemoryTools({ store: memoryStore }));
    return memoryTools.map((memoryTool): AgentTool => ({
        id: memoryTool.name,
        name: memoryTool.name,
        description: memoryTool.description,
        parameters: memoryTool.parameters as Tool['parameters'],
        permissions: {
            allowNetwork: false,
            allowFileSystem: false,
            maxExecutionTimeMs: 30_000,
        },
        category: ToolCategory.UTILITY,
        version: '1.0.0',
        validate(params: unknown): params is never {
            return memoryTool.parameters.safeParse(params).success;
        },
        async execute(params: never): Promise<ToolResult> {
            const startedAt = new Date();
            const startMs = Date.now();
            try {
                const data = await memoryTool.execute(params);
                return {
                    success: true,
                    data,
                    executionTimeMs: Date.now() - startMs,
                    metadata: { startTime: startedAt, endTime: new Date(), retries: 0 },
                };
            } catch (error) {
                return {
                    success: false,
                    error: {
                        code: 'MEMORY_TOOL_ERROR',
                        message: error instanceof Error ? error.message : String(error),
                    },
                    executionTimeMs: Date.now() - startMs,
                    metadata: { startTime: startedAt, endTime: new Date(), retries: 0 },
                };
            }
        },
    }));
}

/**
 * Wraps the Mastermind CCR retrieve tool as a framework `Tool` so the agent
 * loop can invoke it. Lets the LLM fetch the original (uncompressed) content
 * for any compressed block via its `ccr_xxxx` handle.
 *
 * Uses `zodToJsonSchema` so the `parameters` field is a proper JSON Schema
 * object — not a raw Zod schema cast, which would cause shape mismatches
 * when the runner serialises tool definitions for the LLM.
 */
// CCR retrieve tool metadata is static — schema built once at module load,
// not per-agent (zodToJsonSchema is the second-largest per-call cost after Mastermind).
const CCR_RETRIEVE_SCHEMA = z.object({
    handle: z.string().describe('The CCR handle printed next to a compressed block, e.g. "ccr_0001".'),
    query: z.string().optional().describe(
        'Optional substring; returns only original lines containing it (case-insensitive).',
    ),
});
const CCR_RETRIEVE_JSON_SCHEMA = zodToJsonSchema(CCR_RETRIEVE_SCHEMA as any);
const CCR_RETRIEVE_NAME = 'mastermind_retrieve';
const CCR_RETRIEVE_DESCRIPTION =
    'Retrieve the original (uncompressed) content for a compressed block. ' +
    'Pass the `handle` value shown in brackets after a compressed section ' +
    '(e.g. `[ccr_0001]`). Returns the full original text, or — with an optional ' +
    '`query` — only the matching lines, to pull just the relevant slice.';

// Takes a lazy getter so the Mastermind instance is not constructed until the
// tool is actually invoked by the LLM (which only happens after compression
// produces a CCR handle — a runtime event, not a per-agent setup cost).
function createCCRRetrieveTool(getMastermind: () => Mastermind | undefined): AgentTool {
    const schema = CCR_RETRIEVE_SCHEMA;
    return {
        id: CCR_RETRIEVE_NAME,
        name: CCR_RETRIEVE_NAME,
        description: CCR_RETRIEVE_DESCRIPTION,
        parameters: CCR_RETRIEVE_JSON_SCHEMA as unknown as Tool['parameters'],
        permissions: {
            allowNetwork: false,
            allowFileSystem: false,
            maxExecutionTimeMs: 5_000,
        },
        category: ToolCategory.UTILITY,
        version: '1.0.0',
        validate(params: unknown): params is Record<string, unknown> {
            return schema.safeParse(params).success;
        },
        async execute(params: Record<string, unknown>): Promise<ToolResult> {
            const startedAt = new Date();
            const startMs = Date.now();
            try {
                const parsed = schema.parse(params);
                const mastermind = getMastermind();
                if (!mastermind) {
                    return {
                        success: false,
                        error: { code: 'CCR_RETRIEVE_ERROR', message: 'Compression pipeline is disabled.' },
                        executionTimeMs: Date.now() - startMs,
                        metadata: { startTime: startedAt, endTime: new Date(), retries: 0 },
                    };
                }
                const data = await mastermind.retrieveTool.execute(parsed);
                return {
                    success: true,
                    data,
                    executionTimeMs: Date.now() - startMs,
                    metadata: { startTime: startedAt, endTime: new Date(), retries: 0 },
                };
            } catch (error) {
                return {
                    success: false,
                    error: {
                        code: 'CCR_RETRIEVE_ERROR',
                        message: error instanceof Error ? error.message : String(error),
                    },
                    executionTimeMs: Date.now() - startMs,
                    metadata: { startTime: startedAt, endTime: new Date(), retries: 0 },
                };
            }
        },
    };
}

/**
 * Determines if `adapters` is an `AdapterRegistry` (has typed resolver methods)
 * or plain `AdapterBindings`.
 */
function isAdapterRegistry(v: AdapterRegistry | AdapterBindings | undefined): v is AdapterRegistry {
    return !!v && typeof (v as AdapterRegistry).resolve === 'function';
}

/**
 * Resolves adapter bindings from either a registry or explicit bindings object,
 * then merges in any convenience adapter fields from `CreateAgentOptions`.
 * Returns `undefined` when nothing is provided (framework uses built-in defaults).
 */
function resolveAdapterBindings(options: CreateAgentOptions): AdapterBindings | undefined {
    const base: AdapterBindings = options.adapters
        ? isAdapterRegistry(options.adapters)
            ? options.adapters.toBindings()
            : (options.adapters as AdapterBindings)
        : {};

    // Merge convenience passthrough fields (explicit fields win over registry auto-select)
    const merged: AdapterBindings = {
        ...base,
        ...(options.sessionStoreAdapter && { sessionStore: options.sessionStoreAdapter }),
        ...(options.memoryStoreAdapter && { memoryStore: options.memoryStoreAdapter }),
        ...(options.guardrailAdapter && { guardrail: options.guardrailAdapter }),
        ...(options.ragAdapter && { rag: options.ragAdapter }),
        ...(options.toolRegistryAdapter && { toolRegistry: options.toolRegistryAdapter }),
        ...(options.authAdapter && { auth: options.authAdapter }),
        ...(options.rateLimitAdapter && { rateLimit: options.rateLimitAdapter }),
        ...(options.auditLogAdapter && { auditLog: options.auditLogAdapter }),
    };

    // Return undefined only if truly empty (nothing configured)
    const isEmpty = Object.values(merged).every((v) => v == null);
    return isEmpty ? undefined : merged;
}

// ── Lazy config singleton ──────────────────────────────────────────────────
// Loaded once on first createAgent call; provides validated fallback defaults.
// Never throws — returns null if config loading fails (e.g. missing env vars).
let _cachedConfig: AppConfig | null | undefined;
function getFrameworkConfig(): AppConfig | null {
    if (_cachedConfig === undefined) {
        try {
            // Dynamic import to avoid circular dependency at module load time
            const { loadConfig } = require('../config/index.js') as typeof import('../config/index.js');
            _cachedConfig = loadConfig();
        } catch {
            _cachedConfig = null;
        }
    }
    return _cachedConfig;
}

/**
 * One-line production agent. Wires LLM (from env or options), tools, session store, and optional guardrails.
 *
 * @deprecated Prefer the `agent()` helper from `confused-ai` — it has the same
 * surface area with a shorter call: `agent('You are helpful.')` or
 * `agent({ instructions: '...', model: 'openai:gpt-4o', tools: [] })`.
 * `createAgent()` will be removed in v2.0.
 *
 * All defaults are explicitly escapable:
 * - `tools: false`        → pure text reasoning (no tools)
 * - `sessionStore: false` → stateless (no session tracking)
 * - `guardrails: false`   → no guardrails
 * - `hooks`               → intercept every stage of the agentic loop
 */
export function createAgent(options: CreateAgentOptions): CreateAgentResult {
    // Load framework config as fallback (explicit options > env vars > config)
    const cfg = getFrameworkConfig();
    const {
        name,
        instructions,
        model = typeof process !== 'undefined' && process.env?.[ENV_MODEL]
            ? process.env[ENV_MODEL]!
            : (cfg?.llm.model || 'gpt-4o'),
        apiKey = typeof process !== 'undefined' && process.env?.[ENV_API_KEY]
            ? process.env[ENV_API_KEY]
            : (cfg?.llm.apiKey || undefined),
        baseURL = typeof process !== 'undefined' && process.env?.[ENV_BASE_URL]
            ? process.env[ENV_BASE_URL]
            : (cfg?.llm.baseUrl || undefined),
        toolMiddleware,
        guardrails: guardrailsOption = false,
        maxSteps = 10,
        timeoutMs = 60_000,
        retry,
        logger,
        dev,
        hooks: agentHooks,
    } = options;

    const agentDebugMode = dev === true || options.debugMode === true;
    const agentDebugLevel = options.debugLevel ?? 1;

    if (!name || typeof name !== 'string' || name.trim() === '') {
        throw new ConfigError('createAgent: name is required and must be a non-empty string', {
            context: { options: { name } },
        });
    }
    if (!instructions || typeof instructions !== 'string' || instructions.trim() === '') {
        throw new ConfigError('createAgent: instructions is required and must be a non-empty string', {
            context: { options: { name } },
        });
    }

    const agenticMemoryEnabled = options.enableAgenticMemory === true;
    const wantsMemoryContext = options.addMemoriesToContext === true;
    const effectiveMemoryStore = options.memoryStore ?? (agenticMemoryEnabled || wantsMemoryContext ? new InMemoryStore({ debug: agentDebugMode }) : undefined);
    const memoryTools = agenticMemoryEnabled && effectiveMemoryStore
        ? createFrameworkMemoryTools(effectiveMemoryStore)
        : [];

    // tools resolved after mastermind is instantiated (CCR retrieve tool added below)
    // Resolve adapter bindings — merges registry / explicit bindings + convenience fields
    const adapterBindings = resolveAdapterBindings(options);

    // sessionStore resolution order:
    //   1. Explicit sessionStore option
    //   2. Adapter binding (cache → session store shim; sql/nosql → future)
    //   3. Auto-SQLite when AGENT_DB_PATH env var is set (durable-default behavior)
    //   4. In-memory default
    const agentDbPath = typeof process !== 'undefined' ? process.env?.['AGENT_DB_PATH'] : undefined;
    const sessionStore =
        options.sessionStore === false
            ? null
            : options.sessionStore
              ? options.sessionStore
              : (adapterBindings?.session as unknown as import('../session/index.js').SessionStore | undefined)
                ?? (agentDbPath
                    ? (() => {
                          try {
                              const { createSqliteStore } = require('../session/index.js') as typeof import('../session/index.js');
                              return createSqliteStore({ path: agentDbPath });
                          } catch {
                              return new InMemorySessionStore();
                          }
                      })()
                    : new InMemorySessionStore());

    const llm = resolveLlmForCreateAgent(options, { model, apiKey, baseURL });

    const guardrails =
        !guardrailsOption
            ? undefined
            : (guardrailsOption as import('../guardrails/index.js').GuardrailEngine);

    // Budget enforcer — instantiated once per agent, reset on each run
    const budgetEnforcer = options.budget ? new BudgetEnforcer(options.budget) : undefined;

    // Mastermind compression pipeline — on by default, disable with mastermind: false
    const mastermindEnabled = options.mastermind !== false;
    const mastermindCfg: MastermindConfig = mastermindEnabled
        ? {
              ...(options.mastermind && typeof options.mastermind === 'object' ? options.mastermind : {}),
              debug: agentDebugMode,
              // Wire the agent LLM as the prose summarisation backend
              generate: async (msgs: Array<{ role: string; content: string }>) => {
                  const r = await llm.generateText(msgs as any, { temperature: 0.1, maxTokens: 1024, toolChoice: 'none' });
                  return r.text ?? '';
              },
          }
        : {};
    // Lazy Mastermind — constructing it eagerly cost ~22µs + ~33KB per agent
    // (98% of createAgent's per-call cost) even when compression never ran.
    // Built on first use: first run() that compresses, or first CCR tool call.
    let _mastermind: Mastermind | undefined;
    const getMastermind = (): Mastermind | undefined => {
        if (!mastermindEnabled) return undefined;
        if (!_mastermind) _mastermind = new Mastermind(mastermindCfg);
        return _mastermind;
    };

    // CCR retrieve tool registered up front (LLM needs the tool definition), but
    // its execute() lazily resolves the Mastermind instance via getMastermind().
    const ccrTools: AgentTool[] = (mastermindEnabled && mastermindCfg.enableCCR !== false)
        ? [createCCRRetrieveTool(getMastermind)]
        : [];

    const tools = resolveTools(options.tools, [...memoryTools, ...ccrTools]);

    const storage = options.storage;
    const effectiveLogger = logger ?? (agentDebugMode ? createDevLogger() : undefined);
    const effectiveToolMiddleware = [...(toolMiddleware ?? []), ...(agentDebugMode ? [createDevToolMiddleware()] : [])];

    if (effectiveLogger?.debug) {
        effectiveLogger.debug('createAgent: initializing', { agentId: name }, { toolsCount: tools.list().length });
    }

    const agent = createAgenticAgent({
        name,
        instructions,
        llm: llm as any,
        tools: tools as any,
        toolMiddleware: effectiveToolMiddleware.length ? effectiveToolMiddleware as any : undefined,
        maxSteps,
        timeoutMs,
        retry,
        guardrails,
        hooks: agentHooks as any,
        checkpointStore: options.checkpointStore,
        budgetEnforcer: budgetEnforcer as any,
        budgetModelId: model,
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        // Per-step compression in the ReAct loop — on by default when mastermind is enabled
        compression: mastermindEnabled
            ? {
                  enabled: true,
                  toolResultsLimit: 2,
                  messageSizeThreshold: 1500,
              }
            : undefined,
        recorder: options.recorder,
    });

    return {
        name,
        instructions,
        adapters: adapterBindings,
        async run(prompt: string | import('../providers/vision.js').MultiModalInput, runOptions?: AgentRunOptions) {
            return withSpan(
                'agent.run',
                {
                    'agent.name': name,
                    'session.id': runOptions?.sessionId ?? 'unknown',
                    'prompt.length': typeof prompt === 'string' ? prompt.length : prompt.text.length,
                },
                async (runSpan) => {
            // Resolve multi-modal input → text + Message
            const isMMI = isMultiModalInput(prompt);
            const promptText: string = isMMI ? prompt.text : prompt;
            const userMessage: Message = isMMI
                ? multiModalToMessage(prompt)
                : { role: 'user', content: promptText };

            const sessionId = runOptions?.sessionId;
            const runDebugMode = pickBoolean(
                runOptions?.debugMode,
                options.debugMode ?? dev,
                agentDebugMode,
            );
            const runDebugLevel = runOptions?.debugLevel ?? agentDebugLevel;
            const runLogger = runDebugMode ? (effectiveLogger ?? createDevLogger()) : undefined;
            const streamHooks: AgenticStreamHooks = {
                onChunk: (text: string) => {
                    if (runDebugMode && runDebugLevel >= 2) {
                        runLogger?.debug('agent.run: chunk', { agentId: name }, { length: text.length });
                    }
                    runOptions?.onChunk?.(text);
                },
                onToolCall: (toolName: string, args: Record<string, unknown>) => {
                    runLogger?.debug('agent.run: tool call', { agentId: name }, { toolName });
                    runOptions?.onToolCall?.(toolName, args);
                },
                onToolResult: (toolName: string, result: unknown) => {
                    runLogger?.debug('agent.run: tool result', { agentId: name }, { toolName });
                    runOptions?.onToolResult?.(toolName, result);
                },
                onStep: (step: number) => {
                    runLogger?.debug('agent.run: step', { agentId: name }, { step });
                    runOptions?.onStep?.(step);
                },
            };

            let messages: Message[] | undefined;
            let fullSessionHistory: Message[] = [];
            let historyMessagesInContext = 0;
            if (runOptions?.messages?.length) {
                const addHistory = pickBoolean(
                    runOptions.addHistoryToContext,
                    options.addHistoryToContext,
                    true,
                );
                const selectedHistory = addHistory ? selectHistoryForContext(runOptions.messages, runOptions, options) : [];
                historyMessagesInContext = selectedHistory.length;
                messages = [
                    { role: 'system', content: instructions },
                    ...selectedHistory,
                    userMessage,
                ];
            } else if (sessionId && sessionStore) {
                const session = await sessionStore.get(sessionId);
                fullSessionHistory = [...(session?.messages ?? [])] as Message[];
                const addHistory = pickBoolean(
                    runOptions?.addHistoryToContext,
                    options.addHistoryToContext,
                    true,
                );
                const selectedHistory = addHistory ? selectHistoryForContext(fullSessionHistory, runOptions, options) : [];
                historyMessagesInContext = selectedHistory.length;
                messages = [
                    { role: 'system', content: instructions },
                    ...selectedHistory,
                    userMessage,
                ];
            } else if (isMMI) {
                // Multi-modal without session: build messages array directly
                messages = [
                    { role: 'system', content: instructions },
                    userMessage,
                ];
            }

            // Reset per-run budget accumulator
            budgetEnforcer?.resetRun();

            const addKnowledgeToContext = pickBoolean(
                runOptions?.addKnowledgeToContext,
                options.addKnowledgeToContext,
                !!options.knowledgebase,
            );
            const knowledgeContext = addKnowledgeToContext && options.knowledgebase?.buildContext
                ? await options.knowledgebase.buildContext(promptText)
                : undefined;

            const addMemoriesToContext = pickBoolean(
                runOptions?.addMemoriesToContext,
                options.addMemoriesToContext,
                !!effectiveMemoryStore && (agenticMemoryEnabled || wantsMemoryContext),
            );
            const memoryLimit = pickNumber(
                runOptions?.numMemories,
                options.numMemories,
                5,
            );
            const memoryContext = addMemoriesToContext
                ? await buildMemoryContext(effectiveMemoryStore, promptText, memoryLimit)
                : { count: 0 };
            const ragContext = combineContext(memoryContext.context, knowledgeContext);

            runLogger?.debug('agent.run: start', { agentId: name }, {
                sessionId,
                historyMessages: historyMessagesInContext,
                memoryResults: memoryContext.count,
                knowledgeContext: !!knowledgeContext,
            });

            // ── Mastermind: always compress messages before sending to LLM ──
            // Previously gated on isOverBudget(); now runs every time so tool
            // outputs, logs, code, and RAG chunks are compressed regardless of
            // total budget — individual large messages still benefit from 60-95%
            // token reduction even when the conversation fits within the window.
            let mastermindStats: import('../compression/mastermind/index.js').MastermindStats | undefined;
            const mastermind = messages ? getMastermind() : undefined;
            if (mastermind && messages) {
                // Deep-clone messages to avoid mutating shared session history refs.
                // Mastermind.compress() writes compressedContent / _ccrHandle in-place.
                const cloned = messages.map(m => ({ ...m }));
                const { messages: compressed, stats } = await mastermind.compress(cloned as any);
                messages = Mastermind.materialize(compressed) as typeof messages;
                mastermindStats = stats;
                if (agentDebugMode) {
                    runLogger?.debug('agent.run: mastermind compression', { agentId: name }, {
                        tokensBefore: stats.totalTokensBefore,
                        tokensAfter:  stats.totalTokensAfter,
                        compressed:   stats.messagesCompressed,
                        ccrEntries:   stats.ccrEntries,
                    });
                }
            }

            // Per-run hooks are passed via runConfig.hooks — the runner merges them with
            // agent-level hooks locally. No shared config mutation; concurrent runs are isolated.
            const inputMessageCount = messages?.length ?? 0;
            let result = await agent.run(
                {
                    prompt: messages ? '' : promptText,
                    instructions,
                    messages,
                    maxSteps,
                    timeoutMs,
                    ragContext,
                    ...(options.outputSchema && { responseModel: options.outputSchema as any }),
                    ...(runOptions?.hooks   && { hooks:  runOptions.hooks }),
                    ...(runOptions?.runId   && { runId:  runOptions.runId }),
                    ...(runOptions?.userId  && { userId: runOptions.userId }),
                    ...(runOptions?.signal  && { signal: runOptions.signal }),
                    ...(runOptions?.allowedTools && { allowedTools: runOptions.allowedTools }),
                },
                streamHooks
            ) as AgentRunResult;

            const followupsEnabled = pickBoolean(
                runOptions?.followUps,
                options.followUps,
                false,
            );
            const followupsCount = pickNumber(
                runOptions?.numFollowups,
                options.numFollowups,
                3,
            );
            const followups = followupsEnabled
                ? await generateFollowups(llm, promptText, result.text, followupsCount)
                : [];

            if (followups.length > 0) {
                result = {
                    ...result,
                    followups,
                    followUpSuggestions: followups,
                };
            }

            let persistedStorageKey: string | undefined;
            if (storage) {
                persistedStorageKey = storageKey(name, runOptions?.runId);
                await storage.set(persistedStorageKey, {
                    agent: name,
                    sessionId,
                    runId: runOptions?.runId,
                    prompt: promptText,
                    text: result.text,
                    usage: result.usage,
                    followups,
                    finishReason: result.finishReason,
                    steps: result.steps,
                    createdAt: new Date().toISOString(),
                });
                result = { ...result, storageKey: persistedStorageKey };
            }

            if (runDebugMode) {
                result = {
                    ...result,
                    debug: {
                        enabled: true,
                        historyMessages: historyMessagesInContext,
                        memoryResults: memoryContext.count,
                        knowledgeContext: !!knowledgeContext,
                        followupsGenerated: followups.length,
                        ...(result.usage && { usage: result.usage }),
                        ...(persistedStorageKey && { storageKey: persistedStorageKey }),
                        ...(mastermindStats && { compression: mastermindStats }),
                    },
                };
            }

            if (sessionId && sessionStore && result.messages?.length) {
                const newMessages = messages
                    ? result.messages.slice(inputMessageCount).filter((message: Message) => message.role !== 'system')
                    : result.messages.filter((message: Message) => message.role !== 'system');
                const persistMessages = [
                    ...fullSessionHistory.filter((message: Message) => message.role !== 'system'),
                    userMessage,
                    ...newMessages,
                ];
                await sessionStore.update(sessionId, {
                    messages: persistMessages as any,
                });
            }

            if (result.usage?.totalTokens !== undefined) {
                runSpan.setAttribute('llm.usage.total_tokens', result.usage.totalTokens);
            }
            // OTel GenAI semantic-convention attributes (gen_ai.*) + legacy llm.* aliases.
            for (const [k, v] of Object.entries(genAiAttributes({
                model,
                operation: 'chat',
                inputTokens: result.usage?.promptTokens,
                outputTokens: result.usage?.completionTokens,
            }))) {
                if (v !== undefined) runSpan.setAttribute(k, v);
            }
            runSpan.setAttribute('agent.finish_reason', result.finishReason ?? 'stop');
            runSpan.setAttribute('agent.followups.count', followups.length);
            runLogger?.debug('agent.run: finish', { agentId: name }, {
                finishReason: result.finishReason,
                steps: result.steps,
                followups: followups.length,
            });
            return result;
                }, // end withSpan callback
            ); // end withSpan
        },
        async createSession(userId?: string) {
            if (!sessionStore) {
                throw new ConfigError('createSession: sessionStore is disabled (sessionStore: false). Enable it or pass a store.', {});
            }
            const session = await sessionStore.create({
                agentId: name,
                userId,
                messages: [],
            });
            return session.id;
        },
        getSessionMessages(sessionId: string) {
            if (!sessionStore) {
                throw new ConfigError('getSessionMessages: sessionStore is disabled.', {});
            }
            return sessionStore.getMessages(sessionId);
        },
        resume(sessionId: string) {
            const self = this as import('./types.js').CreateAgentResult;
            return {
                run(prompt: string | import('../providers/vision.js').MultiModalInput, options?: Omit<import('./types.js').AgentRunOptions, 'sessionId'>) {
                    return self.run(prompt, { ...options, sessionId });
                },
                stream(prompt: string | import('../providers/vision.js').MultiModalInput, options?: Omit<import('./types.js').AgentRunOptions, 'sessionId' | 'onChunk'>) {
                    return self.stream(prompt, { ...options, sessionId });
                },
                streamEvents(prompt: string | import('../providers/vision.js').MultiModalInput, options?: Omit<import('./types.js').AgentRunOptions, 'sessionId' | 'onChunk'>) {
                    return self.streamEvents(prompt, { ...options, sessionId });
                },
            };
        },
        stream(prompt: string | import('../providers/vision.js').MultiModalInput, runOptions?: Omit<AgentRunOptions, 'onChunk'>) {
            // `this` is the CreateAgentResult object — bound at call time via method shorthand
            const self = this as import('./types.js').CreateAgentResult;

            async function* generate(): AsyncGenerator<string> {
                const queue: string[] = [];
                let notify: (() => void) | null = null;
                let finished = false;
                let runError: unknown;

                const runPromise = self.run(prompt, {
                    ...runOptions,
                    onChunk: (chunk: string) => {
                        queue.push(chunk);
                        notify?.();
                        notify = null;
                    },
                }).catch((e: unknown) => { runError = e; }).finally(() => {
                    finished = true;
                    notify?.();
                    notify = null;
                });

                while (true) {
                    // Drain any queued chunks first
                    while (queue.length > 0) {
                        yield queue.shift()!;
                    }
                    if (finished) {
                        // Drain again for chunks that arrived concurrently with completion
                        while (queue.length > 0) yield queue.shift()!;
                        await runPromise; // re-throws if run failed
                        if (runError) throw runError;
                        return;
                    }
                    // Wait for the next chunk or completion signal
                    await new Promise<void>((r) => { notify = r; });
                }
            }

            const iter = generate();
            return {
                [Symbol.asyncIterator]() {
                    return iter;
                },
            };
        },
        streamEvents(prompt: string | import('../providers/vision.js').MultiModalInput, runOptions?: Omit<AgentRunOptions, 'onChunk'>) {
            const self = this as import('./types.js').CreateAgentResult;

            async function* generate(): AsyncGenerator<StreamChunk> {
                const queue: StreamChunk[] = [];
                let notify: (() => void) | null = null;
                let finished = false;
                let runError: unknown;
                let runResult: import('./types.js').AgentRunResult | undefined;

                const runPromise = self.run(prompt, {
                    ...runOptions,
                    onChunk: (chunk: string) => {
                        queue.push({ type: 'text-delta', delta: chunk });
                        notify?.();
                        notify = null;
                    },
                    onToolCall: (toolName: string, input: Record<string, unknown>) => {
                        queue.push({ type: 'tool-call', tool: { name: toolName, input } });
                        notify?.();
                        notify = null;
                    },
                    onToolResult: (toolName: string, output: unknown) => {
                        queue.push({ type: 'tool-result', tool: { name: toolName, input: undefined, output } });
                        notify?.();
                        notify = null;
                    },
                    onStep: (stepNumber: number) => {
                        queue.push({ type: 'step-finish', stepNumber });
                        notify?.();
                        notify = null;
                    },
                }).then((r) => { runResult = r; })
                  .catch((e: unknown) => { runError = e; })
                  .finally(() => {
                    finished = true;
                    notify?.();
                    notify = null;
                });

                while (true) {
                    while (queue.length > 0) {
                        yield queue.shift()!;
                    }
                    if (finished) {
                        while (queue.length > 0) yield queue.shift()!;
                        await runPromise;
                        if (runError) {
                            yield { type: 'error', error: runError instanceof Error ? runError : new Error(String(runError)) };
                            return;
                        }
                        if (runResult) {
                            yield { type: 'run-finish', run: runResult };
                        }
                        return;
                    }
                    await new Promise<void>((r) => { notify = r; });
                }
            }

            const iter = generate();
            return {
                [Symbol.asyncIterator]() {
                    return iter;
                },
            };
        },
        getCompressionStats() {
            // Reads the same lazy Mastermind instance the run loop compresses with,
            // so totals reflect every run so far. undefined when mastermind: false.
            return getMastermind()?.stats();
        },
    };
}
