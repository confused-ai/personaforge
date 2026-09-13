/**
 * Mem0 — Long-term AI memory service
 *
 * API docs: https://docs.mem0.ai/api-reference
 * Env vars: MEM0_API_KEY
 */

import { z } from 'zod';
import { BaseTool, type BaseToolConfig } from '../core/base-tool.js';
import { ToolCategory } from '../core/types.js';

// ── Config ─────────────────────────────────────────────────────────────────

export interface Mem0Config {
    apiKey?: string;
    baseUrl?: string;
}

const BASE = 'https://api.mem0.ai/v1';

function getKey(config?: Mem0Config): string {
    const key = config?.apiKey ?? process.env['MEM0_API_KEY'];
    if (!key) throw new Error('Mem0: MEM0_API_KEY is required');
    return key;
}

// ── Add memory ─────────────────────────────────────────────────────────────

const AddMemorySchema = z.object({
    messages: z.array(z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
    })).describe('Conversation messages to store as memory'),
    agent_id: z.string().optional().describe('Agent identifier to associate memory with'),
    user_id: z.string().optional().describe('User identifier to associate memory with'),
    run_id: z.string().optional().describe('Run/session identifier'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Extra metadata'),
});

type AddMemoryInput = z.infer<typeof AddMemorySchema>;

export class Mem0AddMemoryTool extends BaseTool<typeof AddMemorySchema, string> {
    private readonly config: Mem0Config;
    constructor(config?: Mem0Config) {
        const cfg: BaseToolConfig<typeof AddMemorySchema> = {
            name: 'mem0_add_memory',
            description: 'Add a conversation or message to Mem0 long-term memory',
            parameters: AddMemorySchema,
            category: ToolCategory.AI,
        };
        super(cfg);
        this.config = config ?? {};
    }

    protected async performExecute(input: AddMemoryInput): Promise<string> {
        const key = getKey(this.config);
        const url = `${this.config.baseUrl ?? BASE}/memories/`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Token ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: input.messages,
                agent_id: input.agent_id,
                user_id: input.user_id,
                run_id: input.run_id,
                metadata: input.metadata,
            }),
        });
        if (!res.ok) throw new Error(`Mem0 add memory error ${res.status}: ${await res.text()}`);
        const data = await res.json();
        return JSON.stringify(data);
    }
}

// ── Search memory ──────────────────────────────────────────────────────────

const SearchMemorySchema = z.object({
    query: z.string().describe('Natural-language query to search memories'),
    user_id: z.string().optional().describe('Filter by user identifier'),
    agent_id: z.string().optional().describe('Filter by agent identifier'),
    run_id: z.string().optional().describe('Filter by run identifier'),
    limit: z.number().int().min(1).max(100).default(10).describe('Maximum results'),
    filters: z.record(z.string(), z.unknown()).optional().describe('Additional metadata filters'),
});

type SearchMemoryInput = z.infer<typeof SearchMemorySchema>;

export class Mem0SearchMemoryTool extends BaseTool<typeof SearchMemorySchema, string> {
    private readonly config: Mem0Config;
    constructor(config?: Mem0Config) {
        const cfg: BaseToolConfig<typeof SearchMemorySchema> = {
            name: 'mem0_search_memory',
            description: 'Search Mem0 memories using semantic similarity',
            parameters: SearchMemorySchema,
            category: ToolCategory.AI,
        };
        super(cfg);
        this.config = config ?? {};
    }

    protected async performExecute(input: SearchMemoryInput): Promise<string> {
        const key = getKey(this.config);
        const url = `${this.config.baseUrl ?? BASE}/memories/search/`;
        const body: Record<string, unknown> = { query: input.query, limit: input.limit };
        if (input.user_id) body['user_id'] = input.user_id;
        if (input.agent_id) body['agent_id'] = input.agent_id;
        if (input.run_id) body['run_id'] = input.run_id;
        if (input.filters) body['filters'] = input.filters;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Token ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Mem0 search error ${res.status}: ${await res.text()}`);
        const data = await res.json() as { results?: unknown[] };
        const results = data.results ?? [];
        return JSON.stringify(results);
    }
}

// ── Get all memories ───────────────────────────────────────────────────────

const GetMemoriesSchema = z.object({
    user_id: z.string().optional().describe('Filter memories for this user'),
    agent_id: z.string().optional().describe('Filter memories for this agent'),
    run_id: z.string().optional().describe('Filter memories for this run'),
    limit: z.number().int().min(1).max(100).default(20).describe('Max memories to return'),
    page: z.number().int().min(1).default(1).describe('Page number'),
});

type GetMemoriesInput = z.infer<typeof GetMemoriesSchema>;

export class Mem0GetMemoriesTool extends BaseTool<typeof GetMemoriesSchema, string> {
    private readonly config: Mem0Config;
    constructor(config?: Mem0Config) {
        const cfg: BaseToolConfig<typeof GetMemoriesSchema> = {
            name: 'mem0_get_memories',
            description: 'Retrieve all memories for a user, agent, or run from Mem0',
            parameters: GetMemoriesSchema,
            category: ToolCategory.AI,
        };
        super(cfg);
        this.config = config ?? {};
    }

    protected async performExecute(input: GetMemoriesInput): Promise<string> {
        const key = getKey(this.config);
        const base = this.config.baseUrl ?? BASE;
        const qs = new URLSearchParams();
        if (input.user_id) qs.set('user_id', input.user_id);
        if (input.agent_id) qs.set('agent_id', input.agent_id);
        if (input.run_id) qs.set('run_id', input.run_id);
        qs.set('limit', String(input.limit));
        qs.set('page', String(input.page));
        const res = await fetch(`${base}/memories/?${qs.toString()}`, {
            headers: { 'Authorization': `Token ${key}` },
        });
        if (!res.ok) throw new Error(`Mem0 get memories error ${res.status}: ${await res.text()}`);
        const data = await res.json();
        return JSON.stringify(data);
    }
}

// ── Get single memory ──────────────────────────────────────────────────────

const GetSingleMemorySchema = z.object({
    memory_id: z.string().describe('Unique memory ID to retrieve'),
});

type GetSingleMemoryInput = z.infer<typeof GetSingleMemorySchema>;

export class Mem0GetMemoryTool extends BaseTool<typeof GetSingleMemorySchema, string> {
    private readonly config: Mem0Config;
    constructor(config?: Mem0Config) {
        const cfg: BaseToolConfig<typeof GetSingleMemorySchema> = {
            name: 'mem0_get_memory',
            description: 'Retrieve a single memory by ID from Mem0',
            parameters: GetSingleMemorySchema,
            category: ToolCategory.AI,
        };
        super(cfg);
        this.config = config ?? {};
    }

    protected async performExecute(input: GetSingleMemoryInput): Promise<string> {
        const key = getKey(this.config);
        const res = await fetch(`${this.config.baseUrl ?? BASE}/memories/${input.memory_id}/`, {
            headers: { 'Authorization': `Token ${key}` },
        });
        if (!res.ok) throw new Error(`Mem0 get memory error ${res.status}: ${await res.text()}`);
        const data = await res.json();
        return JSON.stringify(data);
    }
}

// ── Update memory ──────────────────────────────────────────────────────────

const UpdateMemorySchema = z.object({
    memory_id: z.string().describe('Memory ID to update'),
    data: z.string().describe('New content for the memory'),
});

type UpdateMemoryInput = z.infer<typeof UpdateMemorySchema>;

export class Mem0UpdateMemoryTool extends BaseTool<typeof UpdateMemorySchema, string> {
    private readonly config: Mem0Config;
    constructor(config?: Mem0Config) {
        const cfg: BaseToolConfig<typeof UpdateMemorySchema> = {
            name: 'mem0_update_memory',
            description: 'Update the content of an existing Mem0 memory',
            parameters: UpdateMemorySchema,
            category: ToolCategory.AI,
        };
        super(cfg);
        this.config = config ?? {};
    }

    protected async performExecute(input: UpdateMemoryInput): Promise<string> {
        const key = getKey(this.config);
        const res = await fetch(`${this.config.baseUrl ?? BASE}/memories/${input.memory_id}/`, {
            method: 'PUT',
            headers: { 'Authorization': `Token ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: input.data }),
        });
        if (!res.ok) throw new Error(`Mem0 update memory error ${res.status}: ${await res.text()}`);
        const data = await res.json();
        return JSON.stringify(data);
    }
}

// ── Delete memory ──────────────────────────────────────────────────────────

const DeleteMemorySchema = z.object({
    memory_id: z.string().describe('Memory ID to delete'),
});

type DeleteMemoryInput = z.infer<typeof DeleteMemorySchema>;

export class Mem0DeleteMemoryTool extends BaseTool<typeof DeleteMemorySchema, string> {
    private readonly config: Mem0Config;
    constructor(config?: Mem0Config) {
        const cfg: BaseToolConfig<typeof DeleteMemorySchema> = {
            name: 'mem0_delete_memory',
            description: 'Delete a specific memory from Mem0',
            parameters: DeleteMemorySchema,
            category: ToolCategory.AI,
        };
        super(cfg);
        this.config = config ?? {};
    }

    protected async performExecute(input: DeleteMemoryInput): Promise<string> {
        const key = getKey(this.config);
        const res = await fetch(`${this.config.baseUrl ?? BASE}/memories/${input.memory_id}/`, {
            method: 'DELETE',
            headers: { 'Authorization': `Token ${key}` },
        });
        if (!res.ok) throw new Error(`Mem0 delete memory error ${res.status}: ${await res.text()}`);
        return `Memory ${input.memory_id} deleted`;
    }
}

// ── Delete all memories ────────────────────────────────────────────────────

const DeleteAllMemoriesSchema = z.object({
    user_id: z.string().optional().describe('Delete all memories for this user'),
    agent_id: z.string().optional().describe('Delete all memories for this agent'),
    run_id: z.string().optional().describe('Delete all memories for this run'),
});

type DeleteAllMemoriesInput = z.infer<typeof DeleteAllMemoriesSchema>;

export class Mem0DeleteAllMemoriesTool extends BaseTool<typeof DeleteAllMemoriesSchema, string> {
    private readonly config: Mem0Config;
    constructor(config?: Mem0Config) {
        const cfg: BaseToolConfig<typeof DeleteAllMemoriesSchema> = {
            name: 'mem0_delete_all_memories',
            description: 'Delete all memories for a user, agent, or run in Mem0',
            parameters: DeleteAllMemoriesSchema,
            category: ToolCategory.AI,
        };
        super(cfg);
        this.config = config ?? {};
    }

    protected async performExecute(input: DeleteAllMemoriesInput): Promise<string> {
        // Unscoped DELETE wipes every memory — require an explicit scope
        // before touching config/credentials.
        if (!input.user_id && !input.agent_id && !input.run_id) {
            throw new Error('mem0_delete_all_memories requires at least one of user_id, agent_id, or run_id.');
        }
        const key = getKey(this.config);
        const qs = new URLSearchParams();
        if (input.user_id) qs.set('user_id', input.user_id);
        if (input.agent_id) qs.set('agent_id', input.agent_id);
        if (input.run_id) qs.set('run_id', input.run_id);
        const res = await fetch(`${this.config.baseUrl ?? BASE}/memories/?${qs.toString()}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Token ${key}` },
        });
        if (!res.ok) throw new Error(`Mem0 delete all error ${res.status}: ${await res.text()}`);
        return 'All matching memories deleted';
    }
}

// ── Memory history ─────────────────────────────────────────────────────────

const GetMemoryHistorySchema = z.object({
    memory_id: z.string().describe('Memory ID to get history for'),
});

type GetMemoryHistoryInput = z.infer<typeof GetMemoryHistorySchema>;

export class Mem0GetMemoryHistoryTool extends BaseTool<typeof GetMemoryHistorySchema, string> {
    private readonly config: Mem0Config;
    constructor(config?: Mem0Config) {
        const cfg: BaseToolConfig<typeof GetMemoryHistorySchema> = {
            name: 'mem0_get_memory_history',
            description: 'Get the edit history of a specific Mem0 memory',
            parameters: GetMemoryHistorySchema,
            category: ToolCategory.AI,
        };
        super(cfg);
        this.config = config ?? {};
    }

    protected async performExecute(input: GetMemoryHistoryInput): Promise<string> {
        const key = getKey(this.config);
        const res = await fetch(`${this.config.baseUrl ?? BASE}/memories/${input.memory_id}/history/`, {
            headers: { 'Authorization': `Token ${key}` },
        });
        if (!res.ok) throw new Error(`Mem0 history error ${res.status}: ${await res.text()}`);
        const data = await res.json();
        return JSON.stringify(data);
    }
}

// ── Toolkit ────────────────────────────────────────────────────────────────

export class Mem0Toolkit {
    private readonly config: Mem0Config;
    constructor(config?: Mem0Config) {
        this.config = config ?? {};
    }

    getTools() {
        return [
            new Mem0AddMemoryTool(this.config),
            new Mem0SearchMemoryTool(this.config),
            new Mem0GetMemoriesTool(this.config),
            new Mem0GetMemoryTool(this.config),
            new Mem0UpdateMemoryTool(this.config),
            new Mem0DeleteMemoryTool(this.config),
            new Mem0DeleteAllMemoriesTool(this.config),
            new Mem0GetMemoryHistoryTool(this.config),
        ];
    }
}
