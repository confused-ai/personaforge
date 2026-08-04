/**
 * @personaforge/registry — first-class agent registry, discovery, and
 * marketplace metadata.
 *
 * Register runnable agents once, resolve them by name, search by
 * description/tags, and expose every registered agent to a parent orchestrator
 * as a tool in a single call.
 *
 * ```ts
 * import { createAgentRegistry } from 'personaforge/registry';
 * import { agent } from 'personaforge';
 *
 * const registry = createAgentRegistry();
 * registry.register({
 *   name: 'translator',
 *   description: 'Translate text into another language',
 *   tags: ['language', 'nlp'],
 *   agent: agent('You translate text.'),
 * });
 *
 * const t = registry.get('translator');           // registration handle
 * const matches = registry.search('translate');   // discovery
 * const tools = registry.toTools();               // delegation toolkit
 * ```
 */

import { agentAsTool } from '../tools/core/agent-as-tool.js';
import type { AgentAsToolOptions, RunnableAgent } from '../tools/core/agent-as-tool.js';
import type { LightweightTool, ToolObjectSchemaLike } from '../tools/core/tool-helper.js';
import type { ToolCategory } from '../tools/core/types.js';

// ── Types ──────────────────────────────────────────────────────────────────

/** Agent + discovery metadata stored in an {@link AgentRegistry}. */
export interface AgentRecord {
    /** Unique name — the registry key. */
    readonly name: string;
    /** Human-readable description used by discovery and delegating LLMs. */
    readonly description?: string;
    /** The runnable agent (any object with a `run()` method). */
    readonly agent: RunnableAgent;
    /** Tags for discovery. */
    readonly tags?: string[];
    /** Semantic version (for marketplace/versioning). */
    readonly version?: string;
    /** Author or owner (for marketplace attribution). */
    readonly author?: string;
    /** Extra marketplace metadata. */
    readonly metadata?: Record<string, unknown>;
}

/** A name + registration pairing returned by `list()`. */
export interface AgentRegistryEntry {
    readonly name: string;
    readonly registration: AgentRecord;
}

// ── Implementation ─────────────────────────────────────────────────────────

/**
 * In-memory registry of named, discoverable runnable agents.
 *
 * Lookup is O(1) by name; `search()` matches case-insensitively across name,
 * description, and tags. Agents can be exposed as delegation tools via
 * `asTool()` / `toTools()`.
 */
export class AgentRegistry {
    private readonly entries = new Map<string, AgentRecord>();

    /** Register an agent under `registration.name`. Throws on duplicates. */
    register(registration: AgentRecord): this {
        const name = registration.name.trim();
        if (!name) throw new Error('AgentRegistry.register: "name" is required.');
        if (this.entries.has(name)) {
            throw new Error(`AgentRegistry.register: an agent named "${name}" is already registered.`);
        }
        this.entries.set(name, { ...registration, name });
        return this;
    }

    /** Register multiple agents at once. */
    registerMany(registrations: AgentRecord[]): this {
        for (const r of registrations) this.register(r);
        return this;
    }

    /** Get a registration by name. */
    get(name: string): AgentRecord | undefined {
        return this.entries.get(name);
    }

    /** Resolve the raw runnable agent by name. */
    resolve(name: string): RunnableAgent | undefined {
        return this.entries.get(name)?.agent;
    }

    /** Does an agent exist under this name? */
    has(name: string): boolean {
        return this.entries.has(name);
    }

    /** Remove an agent by name. Returns true when removed. */
    remove(name: string): boolean {
        return this.entries.delete(name);
    }

    /** Remove all agents. */
    clear(): void {
        this.entries.clear();
    }

    /** Number of registered agents. */
    get size(): number {
        return this.entries.size;
    }

    /** All registered names, in registration order. */
    names(): string[] {
        return [...this.entries.keys()];
    }

    /** All registrations, in registration order. */
    list(): AgentRegistryEntry[] {
        return [...this.entries.entries()].map(([name, registration]) => ({
            name,
            registration,
        }));
    }

    /**
     * Discovery: case-insensitive substring match across name, description,
     * tags, author, and version. `query` is split on whitespace and every term
     * must match (AND semantics).
     */
    search(query: string, limit = 50): AgentRecord[] {
        const terms = query
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean);
        if (terms.length === 0) return this.list().map((e) => e.registration).slice(0, limit);

        const hits: AgentRecord[] = [];
        for (const registration of this.entries.values()) {
            const haystack = [
                registration.name,
                registration.description ?? '',
                ...(registration.tags ?? []),
                registration.author ?? '',
                registration.version ?? '',
            ]
                .join(' ')
                .toLowerCase();
            if (terms.every((t) => haystack.includes(t))) hits.push(registration);
            if (hits.length >= limit) break;
        }
        return hits;
    }

    /**
     * Expose one registered agent as a delegation tool so a parent agent can
     * invoke it via function calling (agent-as-tool).
     */
    asTool<TOutput = unknown>(
        name: string,
        options?: Omit<AgentAsToolOptions<unknown, TOutput>, 'name' | 'description' | 'agent'>,
    ): LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, TOutput> {
        const registration = this.get(name);
        if (!registration) {
            throw new Error(`AgentRegistry.asTool: no agent named "${name}" is registered.`);
        }
        return agentAsTool({
            ...(options ?? {}),
            name,
            description: registration.description ?? `Delegate to the "${name}" agent`,
            agent: registration.agent,
        });
    }

    /**
     * Expose every registered agent as a tool array, ready to hand to an
     * orchestrator agent for delegation.
     */
    toTools<TOutput = unknown>(
        options?: Omit<AgentAsToolOptions<unknown, TOutput>, 'name' | 'description' | 'agent'>,
    ): Array<LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, TOutput>> {
        return this.names().map((name) => this.asTool(name, options));
    }

    /**
     * Apply a category to all exported tools (defaults to the agent category).
     * Convenience alias for `toTools` callers that want a consistent category.
     */
    toToolsWithCategory<TOutput = unknown>(
        category: ToolCategory,
    ): Array<LightweightTool<ToolObjectSchemaLike<Record<string, unknown>>, TOutput>> {
        return this.toTools({ category });
    }
}

/**
 * Create a new {@link AgentRegistry}.
 */
export function createAgentRegistry(): AgentRegistry {
    return new AgentRegistry();
}
