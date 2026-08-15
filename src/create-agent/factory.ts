import type { Message } from '../providers/types.js';
import type { AgenticStreamHooks } from '../agentic/index.js';
import { withSpan, genAiAttributes } from '../observe/index.js';
import type { Tool, ToolProvider, ToolResult } from '../tools/core/index.js';
import { agentAsTool } from '../tools/core/agent-as-tool.js';
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
import type { StorageMessage } from '../memory/index.js';
import { storageToMessage } from '../memory/index.js';
import { createDevLogger, createDevToolMiddleware } from '../dx/dev-logger.js';
import { BudgetEnforcer } from '../production/budget.js';
import { Mastermind } from '../compression/mastermind/index.js';
import type { MastermindConfig } from '../compression/mastermind/index.js';
import { z } from 'zod';
import { safeValidate, parse as parseSchema } from '../validation/index.js';
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
import type { ProcessorSet } from '../processors/index.js';
import { DurableRunRegistry, InMemoryServerCache, durableRunId, registryOutput } from '../durable/index.js';
import type { DurableAgentOutput, DurableStreamResult, DurableRunEvent } from '../durable/index.js';
import { InMemoryGoalStore, createSqliteGoalStore, type GoalStore, type ObjectiveRecord } from '../goals/index.js';
import { InMemorySuspendedRunStore, createSqliteSuspendedRunStore, type SuspendedRun, type SuspendedRunStore } from '../approval/index.js';
import type { Memory } from '../memory/index.js';
import type { StructuredOutputConfig, GoalRunConfig } from '../agentic/index.js';
import { createLlmProviderFromModelString } from '../providers/from-model.js';

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
    } else if (typeof toolsOption === 'object' && !('list' in toolsOption)) {
        // Keyed tools object: { toolName: toolDef } — convert to array
        const tools = Object.values(toolsOption).map((tool: any) =>
            isLightweightTool(tool) ? tool.toFrameworkTool() : tool,
        );
        registry = toToolRegistry(tools as ToolProvider);
    } else {
        registry = toToolRegistry(toolsOption as ToolProvider);
    }

    if (extraTools.length === 0) return registry;
    const normalizedExtra = extraTools.map((tool) =>
        isLightweightTool(tool) ? tool.toFrameworkTool() : tool,
    );
    return toToolRegistry([...registry.list(), ...normalizedExtra] as ToolProvider);
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

function toProcList(p: import('../processors/index.js').Processor | import('../processors/index.js').Processor[] | undefined): import('../processors/index.js').Processor[] {
    if (Array.isArray(p)) return p;
    return p ? [p] : [];
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
            return safeValidate(memoryTool.parameters, params).success;
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
 * Wraps a lightweight memory tool definition (from the Mastra-style inspired `Memory`
 * class) into a framework `Tool` for the agent loop.
 */
function wrapMemoryToolDef(tool: {
    name: string;
    description: string;
    parameters: unknown;
    execute: (input: Record<string, unknown>) => Promise<unknown>;
}): AgentTool {
    return {
        id: tool.name,
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as Tool['parameters'],
        permissions: {
            allowNetwork: false,
            allowFileSystem: false,
            maxExecutionTimeMs: 60_000,
        },
        category: ToolCategory.UTILITY,
        version: '1.0.0',
        validate(params: unknown): params is never {
            return safeValidate(tool.parameters as import('../validation/index.js').SchemaInput<unknown, unknown>, params).success;
        },
        async execute(params: never): Promise<ToolResult> {
            const startedAt = new Date();
            const startMs = Date.now();
            try {
                const data = await tool.execute(params as Record<string, unknown>);
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
    };
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
            return safeValidate(schema, params).success;
        },
        async execute(params: Record<string, unknown>): Promise<ToolResult> {
            const startedAt = new Date();
            const startMs = Date.now();
            try {
                const parsed = parseSchema(schema, params);
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

    // ── Mastra-style inspired memory bundle ──────────────────────────────────────────
    const memory: Memory | undefined = options.memory;
    if (memory) {
        // Bind the agent LLM for observational memory / mem0 extraction.
        memory.bindLlm?.(llm as Memory['llm'] | undefined);
        void memory; // processors + tools wired below
    }
    // Bind the agent LLM so OM / mem0 extraction work without extra config, then
    // add the memory agent tools (working memory, OM recall, mem0).
    if (memory) {
        memory.bindLlm(llm);
    }
    const memoryTools: AgentTool[] = memory
        ? memory.getAgentTools().map(wrapMemoryToolDef)
        : agenticMemoryEnabled && effectiveMemoryStore
          ? createFrameworkMemoryTools(effectiveMemoryStore)
          : [];

    // ── Durable stores (goals + suspended runs). Auto-SQLite with AGENT_DB_PATH. ──
    const goalStore: GoalStore = options.goalStore
        ?? (agentDbPath
            ? (() => {
                  try {
                      return createSqliteGoalStore(agentDbPath);
                  } catch {
                      return new InMemoryGoalStore();
                  }
              })()
            : new InMemoryGoalStore());
    const suspendedRunStore: SuspendedRunStore = options.suspendedRunStore
        ?? (agentDbPath
            ? (() => {
                  try {
                      return createSqliteSuspendedRunStore(agentDbPath);
                  } catch {
                      return new InMemorySuspendedRunStore();
                  }
              })()
            : new InMemorySuspendedRunStore());

    // ── Durable-by-default registry (observe / approve / resume) ─────────────
    const durableEnabled = options.durable !== false;
    const durableConfig = typeof options.durable === 'object' && options.durable !== null ? options.durable : {};
    const durableCache = (durableConfig as { cache?: import('../durable/index.js').ServerCache }).cache;
    const durableRegistry = durableEnabled ? new DurableRunRegistry(durableCache ?? new InMemoryServerCache()) : undefined;
    const durableAgentId = (durableConfig as { agentId?: string }).agentId ?? name;
    const capturedRuns = new Map<string, { prompt: string | import('../providers/vision.js').MultiModalInput; options?: AgentRunOptions }>();

    // ── Supervisor agents: expose `agents` as delegation tools ───────────────
    const supervisorTools: AgentTool[] = [];
    if (options.agents && typeof options.agents === 'object') {
        for (const [key, sub] of Object.entries(options.agents)) {
            const subAgent = sub as import('./types.js').CreateAgentResult;
            const desc = (subAgent.description ?? key).slice(0, 500);
            supervisorTools.push(agentAsTool({
                name: key,
                description: desc,
                agent: subAgent as unknown as import('../tools/core/agent-as-tool.js').RunnableAgent,
                parameters: z.object({
                    prompt: z.string().describe(`Task for the ${key} subagent.`),
                }),
                maxDepth: 8,
                beforeExecute: async (params: Record<string, unknown>) => {
                    await options.onDelegation?.onDelegationStart?.({
                        agent: key,
                        prompt: String(params.prompt ?? ''),
                        layer: 1,
                    });
                    return undefined;
                },
                afterExecute: async (result: unknown, params: Record<string, unknown>) => {
                    await options.onDelegation?.onDelegationComplete?.({
                        agent: key,
                        prompt: String((params as Record<string, unknown>).prompt ?? ''),
                        result,
                        layer: 1,
                    });
                },
            }) as unknown as AgentTool);
        }
    }

    const resolveExtraLlm = (modelStr: string): import('../providers/types.js').LLMProvider | undefined =>
        createLlmProviderFromModelString(modelStr);

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

    const tools = resolveTools(options.tools, [...memoryTools, ...ccrTools, ...supervisorTools]);

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
        processors: memory
            ? {
                  input: [
                      ...toProcList(options.processors?.input),
                      ...toProcList(memory.getProcessors().input),
                  ],
                  output: [
                      ...toProcList(options.processors?.output),
                      ...toProcList(memory.getProcessors().output),
                  ],
                  error: toProcList(options.processors?.error),
              } as ProcessorSet
            : (options.processors ?? undefined),
        maxProcessorRetries: options.maxProcessorRetries,
        goalStore: goalStore as any,
        suspendedRunStore: suspendedRunStore as any,
        resolveExtraLlm,
    });

        // ── Durable-by-default surface: observe / approve / resume / goals ────

        const findSuspended = async (runId: string): Promise<SuspendedRun | undefined> => {
            try {
                return (await suspendedRunStore.getByRunId(runId)) ?? undefined;
            } catch {
                return undefined;
            }
        };

        const registryOutputShim = (
            runId: string,
            continuationResult?: Promise<import('./types.js').AgentRunResult>,
        ): DurableAgentOutput => {
            if (!durableRegistry) {
                return {
                    fullStream: (async function* () {})() as AsyncIterable<DurableRunEvent>,
                    textStream: (async function* () {})() as AsyncIterable<string>,
                    object: Promise.resolve(undefined),
                    runResult: (continuationResult ?? Promise.reject(new Error('durability disabled'))) as Promise<import('./types.js').AgentRunResult>,
                };
            }
            return registryOutput(durableRegistry, runId, continuationResult);
        };

        const replayRun = (
            selfObj: import('./types.js').CreateAgentResult,
            runId: string,
            extra: Partial<AgentRunOptions>,
        ): Promise<DurableStreamResult> => {
            const cap = capturedRuns.get(runId);
            if (!cap) {
                return Promise.reject(new Error(`No captured input for durable run "${runId}".`));
            }
            const continuationResult = new Promise<import('./types.js').AgentRunResult>((resolve, reject) => {
                void (async () => {
                    try {
                        for await (const chunk of selfObj.streamEvents(cap.prompt, { ...cap.options, ...extra, ...(runId ? { runId } : {}) })) {
                            if (chunk.type === 'run-finish' && chunk.run) {
                                resolve(chunk.run);
                                return;
                            }
                            if (chunk.type === 'error') {
                                reject(chunk.error ?? new Error('Run error'));
                                return;
                            }
                        }
                        reject(new Error('Run ended without a result.'));
                    } catch (e) {
                        reject(e);
                    }
                })();
            });
            return Promise.resolve({ runId, output: registryOutputShim(runId, continuationResult), cleanup: () => undefined });
        };

        return {
            name,
            ...(options.description !== undefined ? { description: options.description } : {}),
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
            // Mastra-style inspired memory scoping + durable run id.
            const memoryThreadId = runOptions?.memory?.thread ?? runOptions?.threadId;
            const memoryResourceId = runOptions?.memory?.resource ?? runOptions?.resourceId;
            const memoryActive = !!memory && !!memoryThreadId;
            const runId = runOptions?.runId;
            if (runId) capturedRuns.set(runId, { prompt, options: runOptions });

            // Auto-resume `suspend()`-suspended tools from history on the next message.
            let resumePendingTool: import('./types.js').AgentRunOptions['resumePendingTool'];
            const autoResume = pickBoolean(
                runOptions?.autoResumeSuspendedTools,
                options.autoResumeSuspendedTools,
                false,
            );
            if (autoResume && memoryThreadId && !runOptions?.resumePendingTool) {
                const suspendedList = await suspendedRunStore.list({
                    threadId: memoryThreadId,
                    resourceId: memoryResourceId,
                });
                const rec = suspendedList[0];
                const toolCall = rec?.toolCalls[0];
                if (rec && toolCall && !toolCall.requiresApproval) {
                    const trimmed = promptText.trim();
                    let resumeData: unknown = promptText;
                    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                        try {
                            resumeData = JSON.parse(trimmed);
                        } catch {
                            resumeData = promptText;
                        }
                    }
                    resumePendingTool = {
                        toolCall: { id: toolCall.toolCallId, name: toolCall.toolName, arguments: toolCall.args },
                        approved: true,
                        resumeData,
                        step: 0,
                        threadId: memoryThreadId,
                        resourceId: memoryResourceId,
                    };
                    await suspendedRunStore.markResolved(rec.runId).catch(() => undefined);
                }
            }
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
                onApproval: (req) => { runOptions?.onApproval?.(req); },
                onSuspended: (req) => { runOptions?.onSuspended?.(req); },
                onTripwire: (info) => { runOptions?.onTripwire?.(info); },
                onGoal: (evaluation) => { runOptions?.onGoal?.(evaluation); },
                onObject: (obj) => { runOptions?.onObject?.(obj); },
            };

            let messages: Message[] | undefined;
            let fullSessionHistory: Message[] = [];
            let historyMessagesInContext = 0;
            let memorySystemMessages: Message[] = [];
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
            } else if (memoryActive) {
                // Mastra memory thread — history / observational window owned by the Memory bundle.
                const omCtx = await memory!
                    .getObservationalContext({ threadId: memoryThreadId!, resourceId: memoryResourceId ?? memoryThreadId! })
                    .catch(() => null);
                const history: Message[] = omCtx
                    ? omCtx.messages.map((m) => storageToMessage(m as unknown as StorageMessage))
                    : [];
                if (history.length === 0 && !omCtx) {
                    const rows = await memory!.getMessages(memoryThreadId!);
                    history.push(...rows.map((r) => storageToMessage(r as unknown as StorageMessage)));
                }
                fullSessionHistory = history;
                if (omCtx?.system) memorySystemMessages.push({ role: 'system', content: omCtx.system });
                if (omCtx?.continuation) memorySystemMessages.push({ role: 'system', content: `[Continuation]\n${omCtx.continuation}` });
                const wm = await memory.workingMemoryContext(memoryResourceId ?? memoryThreadId!).catch(() => undefined);
                if (wm) memorySystemMessages.push({ role: 'system', content: wm });
                const addHistory = pickBoolean(
                    runOptions?.addHistoryToContext,
                    options.addHistoryToContext,
                    true,
                );
                // OM already returns a bounded window; only trim the non-OM path.
                const selectedHistory = omCtx ? history : addHistory ? selectHistoryForContext(history, runOptions, options) : [];
                historyMessagesInContext = selectedHistory.length;
                messages = [
                    { role: 'system', content: instructions },
                    ...memorySystemMessages,
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
            let ragContext = combineContext(memoryContext.context, knowledgeContext);

            // Semantic recall (cross-thread) — folded into RAG context.
            let recallCount = 0;
            if (memoryActive) {
                const recall = await memory!.recall(memoryThreadId!, memoryResourceId, promptText).catch(() => []);
                recallCount = recall.length;
                if (recall.length) {
                    ragContext = combineContext(ragContext, `[Memory Recall]\n${recall.map((r) => `- ${r}`).join('\n')}`);
                }
            }

            runLogger?.debug('agent.run: start', { agentId: name }, {
                sessionId,
                historyMessages: historyMessagesInContext,
                memoryResults: memoryContext.count,
                knowledgeContext: !!knowledgeContext,
                recallCount,
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

            // Durable goal — the thread's objective gates the loop via the judge.
            let goalRunConfig: GoalRunConfig | undefined;
            if (options.goal && memoryThreadId) {
                const objective = await goalStore.getObjective(memoryThreadId).catch(() => null);
                if (objective && objective.status === 'active') {
                    goalRunConfig = {
                        objective: objective.objective,
                        judge: options.goal.judge,
                        maxRuns: objective.maxRuns ?? options.goal.maxRuns ?? 50,
                        runsUsed: objective.runsUsed,
                        threadId: memoryThreadId,
                        resourceId: memoryResourceId,
                    };
                }
            }
            const requireToolApproval = runOptions?.requireToolApproval ?? options.requireToolApproval;

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
                    ...(runOptions?.processors && { processors: runOptions.processors }),
                    ...((runOptions?.structuredOutput ?? options.structuredOutput) && { structuredOutput: runOptions?.structuredOutput ?? options.structuredOutput as StructuredOutputConfig | undefined }),
                    ...(goalRunConfig && { goal: goalRunConfig }),
                    ...(requireToolApproval !== undefined && { requireToolApproval }),
                    ...(runOptions?.approvedToolCalls && { approvedToolCalls: runOptions.approvedToolCalls }),
                    ...(runOptions?.resumeData !== undefined && { resumeData: runOptions.resumeData }),
                    ...(resumePendingTool && { resumePendingTool }),
                    ...(memoryThreadId && { threadId: memoryThreadId }),
                    ...(memoryResourceId && { resourceId: memoryResourceId }),
                },
                streamHooks
            ) as AgentRunResult;

            // Publish run-finish for direct (non-streaming) durable runs.
            if (durableRegistry && runId && !runOptions?.onChunk) {
                await durableRegistry.publish(runId, { type: 'run-finish', run: result } as import('../create-agent/types.js').StreamChunk);
                if (result.finishReason === 'suspended') await durableRegistry.markStatus(runId, 'suspended');
                else await durableRegistry.markStatus(runId, 'done');
                durableRegistry.close(runId);
            }

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

            if (memoryActive && result.messages?.length) {
                // Persist new turns into the Memory thread.
                const newMessages = messages
                    ? result.messages.slice(inputMessageCount).filter((message: Message) => message.role !== 'system')
                    : result.messages.filter((message: Message) => message.role !== 'system');
                const stamped = await memory!.saveMessages(memoryThreadId!, memoryResourceId, [userMessage, ...newMessages]);
                // Observational memory buffering + mem0 extraction + semantic indexing.
                await memory!.processMemoryAfterRun({
                    threadId: memoryThreadId!,
                    resourceId: memoryResourceId ?? memoryThreadId!,
                    messages: [userMessage, ...newMessages],
                    storedMessages: stamped,
                }).catch(() => undefined);
            } else if (sessionId && sessionStore && result.messages?.length) {
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
        asTool(options) {
            const self = this as import('./types.js').CreateAgentResult;
            return agentAsTool({
                ...options,
                agent: self as unknown as import('../tools/core/agent-as-tool.js').RunnableAgent,
            });
        },
        generate(prompt, options) {
            const self = this as import('./types.js').CreateAgentResult;
            return self.run(prompt, options);
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
            const effectiveRunId = runOptions?.runId ?? (durableRegistry ? durableRunId() : undefined);

            async function* generate(): AsyncGenerator<StreamChunk> {
                const queue: StreamChunk[] = [];
                let notify: (() => void) | null = null;
                let finished = false;
                let runError: unknown;
                let runResult: import('./types.js').AgentRunResult | undefined;
                const publish = (chunk: StreamChunk) => {
                    void durableRegistry?.publish(effectiveRunId!, chunk);
                };

                const runPromise = self.run(prompt, {
                    ...runOptions,
                    ...(effectiveRunId ? { runId: effectiveRunId } : {}),
                    onChunk: (chunk: string) => {
                        const evt: StreamChunk = { type: 'text-delta', delta: chunk };
                        queue.push(evt);
                        publish(evt);
                        notify?.();
                        notify = null;
                    },
                    onToolCall: (toolName: string, input: Record<string, unknown>) => {
                        const evt: StreamChunk = { type: 'tool-call', tool: { name: toolName, input } };
                        queue.push(evt);
                        publish(evt);
                        notify?.();
                        notify = null;
                    },
                    onToolResult: (toolName: string, output: unknown) => {
                        const evt: StreamChunk = { type: 'tool-result', tool: { name: toolName, input: undefined, output } };
                        queue.push(evt);
                        publish(evt);
                        notify?.();
                        notify = null;
                    },
                    onStep: (stepNumber: number) => {
                        const evt: StreamChunk = { type: 'step-finish', stepNumber };
                        queue.push(evt);
                        publish(evt);
                        notify?.();
                        notify = null;
                    },
                    onApproval: (req) => {
                        const evt: StreamChunk = { type: 'tool-call-approval', approval: { ...req, requiresApproval: true } };
                        queue.push(evt);
                        publish(evt);
                        notify?.();
                        notify = null;
                    },
                    onSuspended: (req) => {
                        const evt: StreamChunk = { type: 'tool-call-suspended', suspend: req };
                        queue.push(evt);
                        publish(evt);
                        notify?.();
                        notify = null;
                    },
                    onTripwire: (info) => {
                        const evt: StreamChunk = { type: 'tripwire', tripwire: info };
                        queue.push(evt);
                        publish(evt);
                        notify?.();
                        notify = null;
                    },
                    onGoal: (evaluation) => {
                        const evt: StreamChunk = { type: 'goal', goal: evaluation };
                        queue.push(evt);
                        publish(evt);
                        notify?.();
                        notify = null;
                    },
                    onObject: (obj) => {
                        const evt: StreamChunk = { type: 'object-result', object: obj };
                        queue.push(evt);
                        publish(evt);
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
                            const evt: StreamChunk = { type: 'error', error: runError instanceof Error ? runError : new Error(String(runError)) };
                            yield evt;
                            publish(evt);
                            if (effectiveRunId) await durableRegistry?.markStatus(effectiveRunId, 'error').catch(() => undefined);
                            return;
                        }
                        if (runResult) {
                            const evt: StreamChunk = { type: 'run-finish', run: runResult };
                            yield evt;
                            publish(evt);
                            if (effectiveRunId) {
                                if (runResult.finishReason === 'suspended') {
                                    await durableRegistry?.markStatus(effectiveRunId, 'suspended').catch(() => undefined);
                                } else {
                                    await durableRegistry?.markStatus(effectiveRunId, 'done').catch(() => undefined);
                                }
                            }
                        }
                        if (effectiveRunId) durableRegistry?.close(effectiveRunId);
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

        // ── Durable-by-default surface ─────────────────────────────────────────
        async observe(runId: string) {
            const self = this as import('./types.js').CreateAgentResult;
            void self;
            if (!durableRegistry) throw new Error('Durability is disabled for this agent (durable: false).');
            const handle = durableRegistry.get(runId);
            const output = registryOutputShim(runId, handle?.result);
            let cleaned = false;
            return {
                runId,
                output,
                cleanup() {
                    if (cleaned) return;
                    cleaned = true;
                    if (handle) {
                        handle.closed = true;
                        handle.notify();
                    }
                },
            } as DurableStreamResult;
        },
        async approveToolCall(options: { runId: string; toolCallId?: string }) {
            const self = this as import('./types.js').CreateAgentResult;
            const rec = await findSuspended(options.runId);
            if (!rec) throw new Error(`No suspended run found for "${options.runId}".`);
            const toolCall = rec.toolCalls.find((t) => t.toolCallId === options.toolCallId) ?? rec.toolCalls[0];
            if (!toolCall) throw new Error('Suspended run has no tool calls to answer.');
            await suspendedRunStore.markResolved(options.runId).catch(() => undefined);
            return replayRun(self, options.runId, {
                approvedToolCalls: [toolCall.toolCallId],
                resumePendingTool: {
                    toolCall: { id: toolCall.toolCallId, name: toolCall.toolName, arguments: toolCall.args },
                    approved: true,
                    step: 0,
                    threadId: rec.threadId,
                    resourceId: rec.resourceId,
                },
            });
        },
        async declineToolCall(options: { runId: string; toolCallId?: string }) {
            const self = this as import('./types.js').CreateAgentResult;
            const rec = await findSuspended(options.runId);
            if (!rec) throw new Error(`No suspended run found for "${options.runId}".`);
            const toolCall = rec.toolCalls.find((t) => t.toolCallId === options.toolCallId) ?? rec.toolCalls[0];
            if (!toolCall) throw new Error('Suspended run has no tool calls to answer.');
            await suspendedRunStore.markResolved(options.runId).catch(() => undefined);
            return replayRun(self, options.runId, {
                approvedToolCalls: [toolCall.toolCallId],
                resumePendingTool: {
                    toolCall: { id: toolCall.toolCallId, name: toolCall.toolName, arguments: toolCall.args },
                    approved: false,
                    step: 0,
                    threadId: rec.threadId,
                    resourceId: rec.resourceId,
                },
            });
        },
        async approveToolCallGenerate(options: { runId: string; toolCallId?: string }) {
            const { output } = await (this as import('./types.js').CreateAgentResult).approveToolCall(options);
            return output.runResult;
        },
        async declineToolCallGenerate(options: { runId: string; toolCallId?: string }) {
            const { output } = await (this as import('./types.js').CreateAgentResult).declineToolCall(options);
            return output.runResult;
        },
        async resumeStream(resumeData: unknown, options: { runId?: string; toolCallId?: string } = {}) {
            const self = this as import('./types.js').CreateAgentResult;
            if (!options.runId) throw new Error('resumeStream requires a runId (use listSuspendedRuns to find one).');
            const rec = await findSuspended(options.runId);
            const toolCall = rec?.toolCalls.find((t) => t.toolCallId === options.toolCallId) ?? rec?.toolCalls[0];
            if (!rec || !toolCall) throw new Error(`No suspended run found for "${options.runId}".`);
            await suspendedRunStore.markResolved(options.runId).catch(() => undefined);
            return replayRun(self, options.runId, {
                resumeData,
                resumePendingTool: {
                    toolCall: { id: toolCall.toolCallId, name: toolCall.toolName, arguments: toolCall.args },
                    approved: true,
                    step: 0,
                    threadId: rec.threadId,
                    resourceId: rec.resourceId,
                },
            });
        },
        async listSuspendedRuns(opts: { threadId?: string; resourceId?: string } = {}) {
            const runs = await suspendedRunStore.list({
                agentId: durableAgentId,
                threadId: opts.threadId,
                resourceId: opts.resourceId,
            });
            return { runs };
        },
        async recoverActiveRuns(options: { runId?: string } = {}) {
            const self = this as import('./types.js').CreateAgentResult;
            const candidates = options.runId
                ? [options.runId]
                : Array.from(new Set([...capturedRuns.keys(), ...(durableRegistry ? await durableRegistry.listCachedRunIds() : [])]));
            let recovered = 0;
            let succeeded = 0;
            let failed = 0;
            for (const runId of candidates) {
                const handle = durableRegistry?.get(runId);
                if (handle && handle.status !== 'running' && handle.status !== 'suspended') continue;
                recovered++;
                try {
                    await replayRun(self, runId, {});
                    succeeded++;
                } catch {
                    failed++;
                }
            }
            return { recovered, succeeded, failed };
        },

        // ── Goals (durable thread-scoped objectives) ──────────────────────────
        async setObjective(objective: string, opts: { threadId?: string; resourceId?: string; maxRuns?: number } = {}) {
            if (!opts.threadId) throw new Error('setObjective requires a threadId (use AgentRunOptions.memory.thread).');
            const record: ObjectiveRecord = {
                objective,
                threadId: opts.threadId,
                resourceId: opts.resourceId,
                maxRuns: opts.maxRuns ?? options.goal?.maxRuns,
                runsUsed: 0,
                status: 'active',
                updatedAt: new Date().toISOString(),
            };
            await goalStore.setObjective(record);
            return record;
        },
        async getObjective(opts: { threadId?: string }) {
            if (!opts.threadId) return null;
            return goalStore.getObjective(opts.threadId);
        },
        async updateObjectiveOptions(opts: { threadId?: string; maxRuns?: number; prompt?: string }) {
            if (!opts.threadId) return;
            await goalStore.updateOptions(opts.threadId, {
                ...(opts.maxRuns !== undefined ? { maxRuns: opts.maxRuns } : {}),
                ...(opts.prompt !== undefined ? { prompt: opts.prompt } : {}),
            });
        },
        async clearObjective(opts: { threadId?: string }) {
            if (!opts.threadId) return;
            await goalStore.clear(opts.threadId);
        },
    };
}
