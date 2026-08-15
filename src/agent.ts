/**
 * Class-based agent entrypoint.
 *
 * Exports:
 *   - `Agent` (single class, legacy constructor, full fluent API)
 */

import type { SessionStore } from './session/index.js';
import type { Tool, ToolRegistry } from './tools/core/index.js';
import type { CreateAgentOptions, CreateAgentResult, AgentRunOptions } from './create-agent.js';
import { createAgent } from './create-agent.js';
import { InMemoryCheckpointStore } from './execution/state-graph.js';
import { InMemorySessionStore } from './session/index.js';
import { HttpClientTool } from './tools/utils/http.js';
import { BrowserTool } from './tools/utils/browser.js';
import type { AgenticRunResult } from './agentic/index.js';

// ─────────────────────────────────────────────────────────────────────────────
// Agent — single class, legacy constructor, full fluent API
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentOptions extends Omit<CreateAgentOptions, 'name'> {
    /** Agent name (default: 'Agent') */
    name?: string;
    /** System instructions (required) */
    instructions: string;
    /**
     * Shorthand for `sessionStore`. Accepted for backwards compatibility.
     * @deprecated Use `sessionStore` option instead.
     */
    db?: SessionStore;
    /**
     * When `true` and `memoryStore` is provided, enables agentic memory
     * (remember / recall tools). Accepted for backwards compatibility.
     * @deprecated Use `enableAgenticMemory` option instead.
     */
    learning?: boolean;
}

export class Agent {
    protected _opts: CreateAgentOptions;
    protected _delegate?: CreateAgentResult;

    constructor(options: AgentOptions) {
        const {
            name = 'Agent',
            instructions,
            db,
            learning = true,
            sessionStore,
            memoryStore,
            enableAgenticMemory,
            tools,
            ...rest
        } = options;

        const resolvedSession = sessionStore ?? (db ? db as any : new InMemorySessionStore());
        const resolvedMemory = enableAgenticMemory ?? (learning && !!memoryStore) ?? undefined;

        this._opts = {
            name,
            instructions,
            tools: tools ?? [new HttpClientTool(), new BrowserTool()],
            sessionStore: resolvedSession,
            memoryStore,
            ...(resolvedMemory !== undefined ? { enableAgenticMemory: resolvedMemory } : {}),
            ...rest,
        };
    }
    /**
     * Mastra-style static factory. Creates an Agent with declarative config.
     */
    static create(options: AgentOptions): Agent {
        return new Agent(options);
    }


    protected get delegate(): CreateAgentResult {
        if (!this._delegate) this._delegate = createAgent(this._opts);
        return this._delegate;
    }

    protected invalidate(): this {
        this._delegate = undefined;
        return this;
    }

    // ── Identity ─────────────────────────────────────────────────────────────

    /** Set the agent name. */
    withName(name: string): this { this._opts.name = name; return this.invalidate(); }

    /** Override the system instructions. */
    withInstructions(instructions: string): this { this._opts.instructions = instructions; return this.invalidate(); }

    // ── Model ─────────────────────────────────────────────────────────────────

    model(model: string): this { this._opts.model = model; return this.invalidate(); }
    apiKey(key: string): this { this._opts.apiKey = key; return this.invalidate(); }
    baseURL(url: string): this { this._opts.baseURL = url; return this.invalidate(); }
    llm(provider: CreateAgentOptions['llm']): this { this._opts.llm = provider; return this.invalidate(); }
    openRouter(config: NonNullable<CreateAgentOptions['openRouter']>): this { this._opts.openRouter = config; return this.invalidate(); }
    temperature(t: number): this { this._opts.temperature = t; return this.invalidate(); }
    maxTokens(n: number): this { this._opts.maxTokens = n; return this.invalidate(); }

    // ── Tools ─────────────────────────────────────────────────────────────────

    tool(newTool: Tool | any): this {
        const current = this._opts.tools;
        if (Array.isArray(current)) {
            this._opts.tools = [...current, newTool];
        } else if (!current) {
            this._opts.tools = [newTool];
        } else if (current === 'web') {
            this._opts.tools = [new HttpClientTool(), new BrowserTool(), newTool];
        } else {
            (current as ToolRegistry).register(newTool);
        }
        return this.invalidate();
    }
    /**
     * Set all tools. Accepts array or keyed object (Mastra-style `{ toolName: toolDef }`).
     */
    tools(tools: CreateAgentOptions['tools']): this {
        this._opts.tools = tools;
        return this.invalidate();
    }

    toolMiddleware(mw: NonNullable<CreateAgentOptions['toolMiddleware']>[number]): this {
        this._opts.toolMiddleware = [...(this._opts.toolMiddleware ?? []), mw];
        return this.invalidate();
    }
    toolRegistryAdapter(adapter: CreateAgentOptions['toolRegistryAdapter']): this { this._opts.toolRegistryAdapter = adapter; return this.invalidate(); }

    // ── Memory ────────────────────────────────────────────────────────────────

    memory(store: CreateAgentOptions['memoryStore']): this {
        this._opts.memoryStore = store;
        this._opts.enableAgenticMemory = true;
        return this.invalidate();
    }
    withMemoryContext(numMemories = 5): this {
        this._opts.addMemoriesToContext = true;
        this._opts.numMemories = numMemories;
        return this.invalidate();
    }
    memoryAdapter(adapter: CreateAgentOptions['memoryStoreAdapter']): this { this._opts.memoryStoreAdapter = adapter; return this.invalidate(); }

    // ── Knowledgebase (RAG) ───────────────────────────────────────────────────

    knowledgebase(rag: CreateAgentOptions['knowledgebase']): this { this._opts.knowledgebase = rag; return this.invalidate(); }
    ragAdapter(adapter: CreateAgentOptions['ragAdapter']): this { this._opts.ragAdapter = adapter; return this.invalidate(); }

    // ── Session ───────────────────────────────────────────────────────────────

    session(store: CreateAgentOptions['sessionStore']): this { this._opts.sessionStore = store; return this.invalidate(); }
    sessionAdapter(adapter: CreateAgentOptions['sessionStoreAdapter']): this { this._opts.sessionStoreAdapter = adapter; return this.invalidate(); }
    historyRuns(n: number): this { this._opts.numHistoryRuns = n; return this; }
    historyMessages(n: number): this { this._opts.numHistoryMessages = n; return this; }

    // ── Guardrails ────────────────────────────────────────────────────────────

    guardrails(engine: CreateAgentOptions['guardrails']): this { this._opts.guardrails = engine; return this.invalidate(); }
    guardrailAdapter(adapter: CreateAgentOptions['guardrailAdapter']): this { this._opts.guardrailAdapter = adapter; return this.invalidate(); }

    // ── Durable execution ─────────────────────────────────────────────────────

    durable(store?: CreateAgentOptions['checkpointStore']): this {
        if (store) {
            this._opts.checkpointStore = store;
        } else if (!this._opts.checkpointStore) {
            this._opts.checkpointStore = new InMemoryCheckpointStore() as any;
        }
        return this.invalidate();
    }

    // ── Storage ───────────────────────────────────────────────────────────────

    storage(store: CreateAgentOptions['storage']): this { this._opts.storage = store; return this.invalidate(); }

    // ── Budget ────────────────────────────────────────────────────────────────

    budget(config: CreateAgentOptions['budget']): this { this._opts.budget = config; return this.invalidate(); }

    // ── Compression ───────────────────────────────────────────────────────────

    /**
     * Configure context compression (Mastermind pipeline).
     * Enabled by default for all agents — compresses tool outputs, logs, code,
     * and RAG chunks before they reach the LLM (60-95% fewer tokens).
     *
     * @param config  Pass `false` to disable, `true` for defaults, or a config object.
     * @example
     * ```ts
     * // Disable compression
     * agent.compression(false);
     *
     * // Custom budget
     * agent.compression({ contextTokenBudget: 8_000, compressToolResults: true });
     * ```
     */
    compression(config: CreateAgentOptions['mastermind']): this { this._opts.mastermind = config; return this.invalidate(); }

    // ── Hooks ─────────────────────────────────────────────────────────────────

    hooks(hooks: CreateAgentOptions['hooks']): this {
        this._opts.hooks = { ...this._opts.hooks, ...hooks };
        return this.invalidate();
    }

    // ── Adapters ──────────────────────────────────────────────────────────────

    adapters(a: CreateAgentOptions['adapters']): this { this._opts.adapters = a; return this.invalidate(); }
    authAdapter(adapter: CreateAgentOptions['authAdapter']): this { this._opts.authAdapter = adapter; return this.invalidate(); }
    rateLimitAdapter(adapter: CreateAgentOptions['rateLimitAdapter']): this { this._opts.rateLimitAdapter = adapter; return this.invalidate(); }
    auditLogAdapter(adapter: CreateAgentOptions['auditLogAdapter']): this { this._opts.auditLogAdapter = adapter; return this.invalidate(); }

    // ── Retry & limits ────────────────────────────────────────────────────────

    retry(policy: CreateAgentOptions['retry']): this { this._opts.retry = policy; return this.invalidate(); }
    maxSteps(n: number): this { this._opts.maxSteps = n; return this.invalidate(); }
    timeout(ms: number): this { this._opts.timeoutMs = ms; return this.invalidate(); }

    // ── Schemas ───────────────────────────────────────────────────────────────

    inputSchema(schema: CreateAgentOptions['inputSchema']): this { this._opts.inputSchema = schema; return this.invalidate(); }
    outputSchema(schema: CreateAgentOptions['outputSchema']): this { this._opts.outputSchema = schema; return this.invalidate(); }

    // ── Observability ─────────────────────────────────────────────────────────

    dev(enabled = true): this { this._opts.dev = enabled; return this.invalidate(); }
    logger(l: CreateAgentOptions['logger']): this { this._opts.logger = l; return this.invalidate(); }

    // ── Follow-ups ────────────────────────────────────────────────────────────

    followUps(count = 3): this {
        this._opts.followUps = true;
        this._opts.numFollowups = count;
        return this;
    }

    // ── Run ───────────────────────────────────────────────────────────────────

    async run(prompt: string, options?: AgentRunOptions): Promise<AgenticRunResult> {
        return this.delegate.run(prompt, options);
    }
    /** Mastra-style alias for `run()`. */
    async generate(prompt: string, options?: AgentRunOptions): Promise<AgenticRunResult> {
        return this.run(prompt, options);
    }

    stream(prompt: string, options?: Omit<AgentRunOptions, 'onChunk'>): AsyncIterable<string> {
        return this.delegate.stream(prompt, options);
    }
    streamEvents(prompt: string, options?: Omit<AgentRunOptions, 'onChunk'>): AsyncIterable<import('./create-agent.js').StreamChunk> {
        return this.delegate.streamEvents(prompt, options);
    }

    // ── Session helpers ───────────────────────────────────────────────────────

    async createSession(userId?: string): Promise<string> {
        return this.delegate.createSession(userId);
    }
    async getSessionMessages(sessionId: string) {
        return this.delegate.getSessionMessages(sessionId);
    }
    resume(sessionId: string) {
        return this.delegate.resume(sessionId);
    }
    get resolvedAdapters() {
        return this.delegate.adapters;
    }
    // ── Legacy property accessors for compatibility ───────────────────────────
    get name(): string {
        return this._opts.name;
    }
    get instructions(): string {
        return this._opts.instructions;
    }
    get learning(): boolean {
        return this._opts.enableAgenticMemory ?? false;
    }
}
