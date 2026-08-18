/**
 * Tool registry implementation and tool provider helpers.
 */

import { ToolRegistry, Tool, ToolCategory } from './types.js';
import type { EntityId } from '../../core/index.js';
import { ToolNameTrie, NGramIndex } from './trie.js';

/** Pass an array or registry when configuring agents. */
export type ToolProvider = Tool[] | ToolRegistry;

/** Normalize tools to a ToolRegistry (extensible: plug any tools). */
export function toToolRegistry(tools: ToolProvider): ToolRegistry {
    if (Array.isArray(tools)) {
        const reg = new ToolRegistryImpl();
        for (const t of tools) reg.register(t);
        return reg;
    }
    if (tools && typeof tools === "object") {
        const regObj = tools as any;
        if (typeof regObj.getByName !== "function") {
            regObj.getByName = (name: string) => {
                if (typeof regObj.get === "function") {
                    const found = regObj.get(name);
                    if (found) return found;
                }
                if (typeof regObj.list === "function") {
                    return regObj.list().find((t: any) => t.name === name);
                }
                return undefined;
            };
        }
    }
    return tools;
}

/**
 * Implementation of ToolRegistry
 */
export class ToolRegistryImpl implements ToolRegistry {
    private tools: Map<EntityId, Tool> = new Map();
    private nameIndex: Map<string, EntityId> = new Map();
    // Inverted index: category → Set<EntityId> for O(1) listByCategory
    private categoryIndex: Map<ToolCategory, Set<EntityId>> = new Map();
    // Trie for O(k) prefix search by tool name
    private nameTrie = new ToolNameTrie();
    // N-gram index for O(k) substring search across name + description + tags
    private ngramIndex = new NGramIndex(3);

    /**
     * Register a tool
     */
    register(tool: Tool): void {
        if (this.tools.has(tool.id)) {
            throw new Error(`Tool with ID ${tool.id} is already registered`);
        }

        if (this.nameIndex.has(tool.name)) {
            throw new Error(`Tool with name ${tool.name} is already registered`);
        }

        this.tools.set(tool.id, tool);
        this.nameIndex.set(tool.name, tool.id);
        this.nameTrie.insert(tool.name, tool.id);

        // N-gram index: name + description + tags for full-text search
        const indexText = [tool.name, tool.description, ...(tool.tags ?? [])].join(' ');
        this.ngramIndex.add(tool.id, indexText);

        // Update category index
        if (tool.category) {
            const catSet = this.categoryIndex.get(tool.category) ?? new Set<EntityId>();
            catSet.add(tool.id);
            this.categoryIndex.set(tool.category, catSet);
        }
    }

    /**
     * Unregister a tool by ID
     */
    unregister(toolId: EntityId): boolean {
        const tool = this.tools.get(toolId);
        if (!tool) {
            return false;
        }

        this.tools.delete(toolId);
        this.nameIndex.delete(tool.name);
        this.nameTrie.delete(tool.name, toolId);

        // Remove from n-gram index
        const indexText = [tool.name, tool.description, ...(tool.tags ?? [])].join(' ');
        this.ngramIndex.remove(toolId, indexText);

        // Update category index
        if (tool.category) {
            this.categoryIndex.get(tool.category)?.delete(toolId);
        }

        return true;
    }

    /**
     * Get a tool by ID
     */
    get(toolId: EntityId): Tool | undefined {
        return this.tools.get(toolId);
    }

    /**
     * Get a tool by name
     */
    getByName(name: string): Tool | undefined {
        const id = this.nameIndex.get(name);
        if (!id) {
            return undefined;
        }
        return this.tools.get(id);
    }

    /**
     * List all registered tools
     */
    list(): Tool[] {
        return Array.from(this.tools.values());
    }

    /**
     * List tools by category
     */
    listByCategory(category: ToolCategory): Tool[] {
        const ids = this.categoryIndex.get(category);
        if (!ids) return [];
        const result: Tool[] = [];
        for (const id of ids) {
            const tool = this.tools.get(id);
            if (tool) result.push(tool);
        }
        return result;
    }

    /**
     * Search tools by name or description
     */
    /**
     * O(k) prefix search — returns tools whose name starts with the given prefix.
     * Uses Trie index for large-scale registries (10 000+ tools).
     */
    searchByPrefix(prefix: string): Tool[] {
        const ids = this.nameTrie.prefixSearch(prefix);
        const result: Tool[] = [];
        for (const id of ids) {
            const tool = this.tools.get(id);
            if (tool) result.push(tool);
        }
        return result;
    }

    /**
     * Full-text search via n-gram inverted index — O(k) vs O(n·m) linear scan.
     * Falls back to prefix search if the query is shorter than the n-gram size.
     */
    search(query: string): Tool[] {
        if (query.length === 0) return this.list();

        // Short queries: use Trie prefix search
        if (query.length < 3) return this.searchByPrefix(query);

        // Longer queries: n-gram index for substring matching across name/description/tags
        const matchIds = this.ngramIndex.search(query);
        const result: Tool[] = [];
        for (const id of matchIds) {
            const tool = this.tools.get(id);
            if (tool) result.push(tool);
        }
        return result;
    }

    /**
     * Check if a tool is registered
     */
    has(toolId: EntityId): boolean {
        return this.tools.has(toolId);
    }

    /**
     * Check if a tool name is registered
     */
    hasName(name: string): boolean {
        return this.nameIndex.has(name);
    }

    /**
     * Clear all registered tools
     */
    clear(): void {
        this.tools.clear();
        this.nameIndex.clear();
        this.categoryIndex.clear();
        this.nameTrie = new ToolNameTrie();
        this.ngramIndex = new NGramIndex(3);
    }

    /**
     * Get the number of registered tools
     */
    size(): number {
        return this.tools.size;
    }
}