/**
 * Component Registry — Agent versioning, draft/publish/rollback.
 *
 * Agno calls these "Components": agents, teams, and workflows can be versioned.
 * Each publish creates a new version. Rollback restores a previous version.
 * Drafts exist until explicitly published.
 *
 * API surface (wired into the HTTP server):
 *   GET    /v1/components            → List all components with their versions
 *   GET    /v1/components/:id        → Get a specific component + version history
 *   POST   /v1/components            → Register a new component (creates v1 draft)
 *   POST   /v1/components/:id/publish → Publish the current draft
 *   POST   /v1/components/:id/rollback → Roll back to a previous version
 *   DELETE /v1/components/:id        → Delete a component
 *
 * @example
 * ```ts
 * import { ComponentRegistry } from 'personaforge/production';
 *
 * const registry = new ComponentRegistry();
 * const id = registry.register({ name: 'assistant', type: 'agent', config: agentConfig });
 * registry.publish(id);                        // v1 is live
 * registry.update(id, { config: newConfig });  // creates draft v2
 * registry.publish(id);                        // v2 is live
 * registry.rollback(id, 1);                    // back to v1
 * ```
 */

export type ComponentType = 'agent' | 'team' | 'workflow';
export type ComponentStatus = 'draft' | 'published' | 'archived';

export interface ComponentVersion {
    readonly version: number;
    readonly config: unknown;
    readonly publishedAt?: string;
    readonly notes?: string;
}

export interface Component {
    readonly id: string;
    name: string;
    readonly type: ComponentType;
    status: ComponentStatus;
    /** Currently live version (undefined until first publish) */
    activeVersion?: number;
    /** Draft config (set by update, cleared on publish) */
    draftConfig?: unknown;
    readonly versions: ComponentVersion[];
    readonly createdAt: string;
    updatedAt: string;
}

export interface RegisterComponentInput {
    name: string;
    type: ComponentType;
    config: unknown;
    notes?: string;
}

export class ComponentRegistry {
    private readonly components = new Map<string, Component>();

    /**
     * Register a new component. Creates it in `draft` state with version 1.
     * Returns the component ID.
     */
    register(input: RegisterComponentInput): string {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const component: Component = {
            id,
            name: input.name,
            type: input.type,
            status: 'draft',
            activeVersion: undefined,
            draftConfig: input.config,
            versions: [],
            createdAt: now,
            updatedAt: now,
        };
        this.components.set(id, component);
        return id;
    }

    get(id: string): Component | undefined {
        return this.components.get(id);
    }

    list(filter?: { type?: ComponentType; status?: ComponentStatus }): Component[] {
        let items = Array.from(this.components.values());
        if (filter?.type) items = items.filter(c => c.type === filter.type);
        if (filter?.status) items = items.filter(c => c.status === filter.status);
        return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    /**
     * Update the draft config.  If published, creates a new draft on top of the
     * active version.
     */
    update(id: string, updates: { config?: unknown; name?: string; notes?: string }): void {
        const component = this.components.get(id);
        if (!component) throw new Error(`Component '${id}' not found`);
        const mutable = component as Mutable<Component>;
        if (updates.config !== undefined) mutable.draftConfig = updates.config;
        if (updates.name !== undefined) mutable.name = updates.name;
        mutable.status = 'draft';
        mutable.updatedAt = new Date().toISOString();
    }

    /**
     * Publish the current draft.  Bumps the version number and sets `activeVersion`.
     * Returns the new version number.
     */
    publish(id: string, notes?: string): number {
        const component = this.components.get(id);
        if (!component) throw new Error(`Component '${id}' not found`);
        if (component.draftConfig === undefined) throw new Error(`Component '${id}' has no draft to publish`);
        const mutable = component as Mutable<Component>;
        const nextVersion = (component.versions.at(-1)?.version ?? 0) + 1;
        const now = new Date().toISOString();
        (mutable.versions as ComponentVersion[]).push({
            version: nextVersion,
            config: component.draftConfig,
            publishedAt: now,
            notes,
        });
        mutable.activeVersion = nextVersion;
        mutable.draftConfig = undefined;
        mutable.status = 'published';
        mutable.updatedAt = now;
        return nextVersion;
    }

    /**
     * Roll back the active version to a specific version number.
     * Makes that version active immediately (no draft step).
     */
    rollback(id: string, toVersion: number): void {
        const component = this.components.get(id);
        if (!component) throw new Error(`Component '${id}' not found`);
        const target = component.versions.find(v => v.version === toVersion);
        if (!target) throw new Error(`Component '${id}' has no version ${toVersion}`);
        const mutable = component as Mutable<Component>;
        mutable.activeVersion = toVersion;
        mutable.draftConfig = undefined;
        mutable.status = 'published';
        mutable.updatedAt = new Date().toISOString();
    }

    /** Archive a component (soft delete). */
    archive(id: string): void {
        const component = this.components.get(id);
        if (!component) throw new Error(`Component '${id}' not found`);
        const mutable = component as Mutable<Component>;
        mutable.status = 'archived';
        mutable.updatedAt = new Date().toISOString();
    }

    delete(id: string): boolean {
        return this.components.delete(id);
    }

    /** Get the active config for a component (the currently published version). */
    getActiveConfig(id: string): unknown {
        const component = this.components.get(id);
        if (!component) throw new Error(`Component '${id}' not found`);
        if (component.activeVersion === undefined) {
            throw new Error(`Component '${id}' has no published version`);
        }
        return component.versions.find(v => v.version === component.activeVersion)?.config;
    }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Singleton default registry (convenience export). */
export const defaultComponentRegistry = new ComponentRegistry();
