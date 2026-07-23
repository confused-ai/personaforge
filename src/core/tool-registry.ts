/**
 * @personaforge/core — Map-backed ToolRegistry.
 *
 * SRP  — registry owns only storage + retrieval of tools.
 * DIP  — depends on the Tool interface, not any concrete tool class.
 * DS   — uses Map<string, Tool> for O(1) get() and O(1) amortised set().
 *         list() returns a cached array rebuilt only on mutation (lazy copy-on-write).
 */

import type { Tool, ToolRegistry } from '../contracts/index.js';

/**
 * MapToolRegistry
 *
 * Time complexity:
 *   register(tool)  → O(1) amortised (Map.set + invalidates cache)
 *   get(name)       → O(1) (Map.get)
 *   list()          → O(n) first call after a mutation; O(1) thereafter (cached)
 *   size            → O(1)
 *
 * Space: O(n tools)
 */
export class MapToolRegistry implements ToolRegistry {
    private readonly _map: Map<string, Tool>;
    private _listCache: Tool[] | null = null;

    constructor(tools: Tool[] = []) {
        this._map = new Map(tools.map((t) => [t.name, t]));
    }

    /** O(1) amortised — invalidates the list cache on mutation. */
    register(tool: Tool): this {
        this._map.set(tool.name, tool);
        this._listCache = null; // invalidate
        return this;
    }

    /** O(1) — direct Map lookup. */
    get(name: string): Tool | undefined {
        return this._map.get(name);
    }

    /**
     * O(n) on first call after any mutation; O(1) on subsequent calls.
     * Returns a frozen snapshot — mutations to the returned array don't affect the registry.
     */
    list(): Tool[] {
        if (!this._listCache) {
            this._listCache = Array.from(this._map.values());
        }
        return this._listCache;
    }

    /** O(1). */
    get size(): number {
        return this._map.size;
    }

    /** O(1) — checks for key existence. */
    has(name: string): boolean {
        return this._map.has(name);
    }

    /** O(1) — removes a tool by name. */
    unregister(name: string): void {
        if (this._map.delete(name)) {
            this._listCache = null; // invalidate
        }
    }

    /** O(n) — clears all tools. */
    clear(): void {
        this._map.clear();
        this._listCache = null;
    }
}

/** Factory — builds a MapToolRegistry from a tool array. O(n). */
export function createToolRegistry(tools: Tool[]): MapToolRegistry {
    return new MapToolRegistry(tools);
}
