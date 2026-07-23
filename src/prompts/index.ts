/**
 * @personaforge/prompts — in-process prompt management & versioning.
 *
 * Closes the "prompt registry" gap that hosted tools (Langfuse, Braintrust)
 * normally cover: register named prompt templates, keep every version, pin a
 * default, render with `{{variable}}` substitution, and A/B-select by weight —
 * all without an external service.
 *
 * ```ts
 * const prompts = new PromptRegistry();
 * prompts.register('greet', 'Hello {{name}}, welcome to {{product}}.');
 * prompts.register('greet', 'Hey {{name}}! Welcome aboard {{product}}.'); // v2
 * prompts.pin('greet', 'v1');
 *
 * prompts.render('greet', { name: 'Sam', product: 'personaforge' });
 * // → "Hello Sam, welcome to personaforge."
 * ```
 */

/** One immutable version of a named prompt. */
export interface PromptVersion {
    readonly name: string;
    readonly version: string;
    readonly template: string;
    readonly labels: readonly string[];
    readonly createdAt: Date;
}

/** Options when registering a prompt version. */
export interface RegisterOptions {
    /** Explicit version id. Auto-assigned as `v1`, `v2`, … when omitted. */
    version?: string;
    /** Labels for selection, e.g. `['production']`, `['candidate']`. */
    labels?: string[];
    /** Make this the pinned default for the name. */
    pin?: boolean;
}

/** Selector for retrieving a specific version. */
export interface VersionSelector {
    version?: string;
    label?: string;
}

interface PromptEntry {
    versions: Map<string, PromptVersion>;
    order: string[];
    defaultVersion: string;
}

const VAR_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/**
 * Render a `{{var}}` template against a variable bag. Unknown placeholders are
 * left intact (so partial rendering is safe and visible).
 */
export function renderTemplate(template: string, vars: Record<string, unknown> = {}): string {
    return template.replace(VAR_RE, (_match, key: string) =>
        key in vars ? String(vars[key]) : `{{${key}}}`,
    );
}

/** In-memory registry of versioned prompt templates. */
export class PromptRegistry {
    private readonly prompts = new Map<string, PromptEntry>();
    private readonly clock: () => Date;

    constructor(opts: { clock?: () => Date } = {}) {
        // Injectable clock keeps tests deterministic.
        this.clock = opts.clock ?? (() => new Date());
    }

    /**
     * Register (or add a new version of) a named prompt. Returns the version id.
     * The first version registered for a name becomes its default unless a later
     * `pin` changes it.
     */
    register(name: string, template: string, opts: RegisterOptions = {}): string {
        let entry = this.prompts.get(name);
        if (!entry) {
            entry = { versions: new Map(), order: [], defaultVersion: '' };
            this.prompts.set(name, entry);
        }
        const version = opts.version ?? `v${entry.order.length + 1}`;
        if (entry.versions.has(version)) {
            throw new Error(`PromptRegistry: version "${version}" already exists for "${name}".`);
        }
        entry.versions.set(version, {
            name,
            version,
            template,
            labels: Object.freeze([...(opts.labels ?? [])]),
            createdAt: this.clock(),
        });
        entry.order.push(version);
        if (entry.defaultVersion === '' || opts.pin) entry.defaultVersion = version;
        return version;
    }

    /** Retrieve a version (default, by `version`, or by `label`). */
    get(name: string, selector: VersionSelector = {}): PromptVersion {
        const entry = this.require(name);
        if (selector.version) {
            const v = entry.versions.get(selector.version);
            if (!v) throw new Error(`PromptRegistry: no version "${selector.version}" for "${name}".`);
            return v;
        }
        if (selector.label) {
            // Latest version carrying the label wins.
            for (let i = entry.order.length - 1; i >= 0; i--) {
                const v = entry.versions.get(entry.order[i]!)!;
                if (v.labels.includes(selector.label)) return v;
            }
            throw new Error(`PromptRegistry: no version labelled "${selector.label}" for "${name}".`);
        }
        return entry.versions.get(entry.defaultVersion)!;
    }

    /** Render a prompt version with variables. */
    render(name: string, vars: Record<string, unknown> = {}, selector: VersionSelector = {}): string {
        return renderTemplate(this.get(name, selector).template, vars);
    }

    /** Pin the default version for a name. */
    pin(name: string, version: string): void {
        const entry = this.require(name);
        if (!entry.versions.has(version)) {
            throw new Error(`PromptRegistry: cannot pin unknown version "${version}" for "${name}".`);
        }
        entry.defaultVersion = version;
    }

    /**
     * Weighted A/B selection across a name's versions. `weights` maps version id
     * to a relative weight; unlisted versions get weight 0. `rand` is injectable
     * for deterministic tests (defaults to Math.random).
     */
    abSelect(name: string, weights: Record<string, number>, rand: () => number = Math.random): PromptVersion {
        const entry = this.require(name);
        const pool = entry.order
            .map((v) => ({ v, w: Math.max(0, weights[v] ?? 0) }))
            .filter((x) => x.w > 0);
        if (pool.length === 0) return entry.versions.get(entry.defaultVersion)!;
        const total = pool.reduce((s, x) => s + x.w, 0);
        let pick = rand() * total;
        for (const x of pool) {
            pick -= x.w;
            if (pick < 0) return entry.versions.get(x.v)!;
        }
        return entry.versions.get(pool[pool.length - 1]!.v)!;
    }

    /** All registered prompt names. */
    names(): string[] {
        return [...this.prompts.keys()];
    }

    /** All version ids for a name, in registration order. */
    versions(name: string): string[] {
        return [...this.require(name).order];
    }

    /** The pinned default version id for a name. */
    defaultVersion(name: string): string {
        return this.require(name).defaultVersion;
    }

    private require(name: string): PromptEntry {
        const entry = this.prompts.get(name);
        if (!entry) throw new Error(`PromptRegistry: unknown prompt "${name}".`);
        return entry;
    }
}
