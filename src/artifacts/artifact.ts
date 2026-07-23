/**
 * Structured artifacts, versioning, and storage interfaces
 *
 * Implements production-grade artifact management:
 * - Typed artifacts (files, images, audio, code, data)
 * - Versioned storage with metadata
 * - Agent-produced outputs that persist across sessions
 * - Media artifact support (images, audio, video)
 */

// Inline minimal metrics types to avoid dependency on @personaforge/observe
// (artifacts is a leaf package with no external deps)
import { newId } from '../contracts/index.js';

export enum MetricType {
    COUNTER = 'counter',
    GAUGE = 'gauge',
    HISTOGRAM = 'histogram',
    SUMMARY = 'summary',
}

export interface MetricValue {
    readonly name: string;
    readonly type: MetricType;
    readonly value: number;
    readonly labels: Record<string, string>;
    readonly timestamp: Date;
}

export interface MetricsCollector {
    counter(name: string, value?: number, labels?: Record<string, string>): void;
    gauge(name: string, value: number, labels?: Record<string, string>): void;
    histogram(name: string, value: number, labels?: Record<string, string>): void;
    getMetrics(): MetricValue[];
    clear(): void;
}

/** High-level artifact categories */
export type ArtifactType =
    | 'file'
    | 'image'
    | 'audio'
    | 'video'
    | 'code'
    | 'data'
    | 'document'
    | 'markdown'
    | 'json'
    | 'reasoning'
    | 'plan'
    | 'report';

/** Base artifact metadata */
export interface ArtifactMetadata {
    /** Unique artifact ID */
    readonly id: string;
    /** Human-readable name */
    readonly name: string;
    /** Artifact type */
    readonly type: ArtifactType;
    /** MIME type (e.g., image/png) */
    readonly mimeType?: string;
    /** Size in bytes */
    readonly sizeBytes?: number;
    /** Creation timestamp */
    readonly createdAt: Date;
    /** Last modified timestamp */
    readonly updatedAt: Date;
    /** Version number (for versioning) */
    readonly version: number;
    /** Tags for categorization */
    readonly tags?: string[];
    /** Custom metadata */
    readonly metadata?: Record<string, unknown>;
    /** Agent that created this artifact */
    readonly createdBy?: string;
    /** Session ID when created */
    readonly sessionId?: string;
}

/** Full artifact with content */
export interface Artifact<T = unknown> extends ArtifactMetadata {
    /** Artifact content (type depends on artifact type) */
    readonly content: T;
}

/** Text-based artifact */
export interface TextArtifact extends Artifact<string> {
    type: 'file' | 'code' | 'markdown' | 'document';
}

/** JSON data artifact */
export interface DataArtifact<T = Record<string, unknown>> extends Artifact<T> {
    type: 'data' | 'json';
}

/** Binary artifact (images, audio, video) */
export interface BinaryArtifact extends Artifact<Uint8Array | ArrayBuffer | string> {
    type: 'image' | 'audio' | 'video';
    /** URL if stored externally */
    readonly url?: string;
    /** Base64 encoded if inline */
    readonly base64?: string;
}

/** Reasoning artifact (agent thought process) */
export interface ReasoningArtifact extends Artifact<{
    thoughts: string[];
    conclusion: string;
    confidence: number;
}> {
    type: 'reasoning';
}

/** Plan artifact (agent action plan) */
export interface PlanArtifact extends Artifact<{
    goal: string;
    steps: Array<{
        id: string;
        description: string;
        status: 'pending' | 'in_progress' | 'completed' | 'failed';
        result?: string;
    }>;
    status: 'draft' | 'executing' | 'completed' | 'failed';
}> {
    type: 'plan';
}

/** Report artifact */
export interface ReportArtifact extends Artifact<{
    title: string;
    sections: Array<{
        heading: string;
        content: string;
    }>;
    summary?: string;
}> {
    type: 'report';
}

// --- Artifact Storage ---

/** Storage configuration */
export interface ArtifactStorageConfig {
    /** Base path for file storage */
    readonly basePath?: string;
    /** Maximum artifact size in bytes (default: 100MB) */
    readonly maxSizeBytes?: number;
    /** Enable versioning (default: true) */
    readonly versioning?: boolean;
    /** TTL for artifacts in ms (default: no expiration) */
    readonly ttlMs?: number;
    /** Metrics collector */
    readonly metrics?: MetricsCollector;
}

/** Artifact storage interface */
export interface ArtifactStorage {
    /** Save an artifact */
    save<T>(artifact: Omit<Artifact<T>, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Promise<Artifact<T>>;

    /** Get an artifact by ID */
    get<T>(id: string): Promise<Artifact<T> | null>;

    /** Get a specific version of an artifact */
    getVersion<T>(id: string, version: number): Promise<Artifact<T> | null>;

    /** List all versions of an artifact */
    listVersions(id: string): Promise<ArtifactMetadata[]>;

    /** Update an artifact (creates new version) */
    update<T>(id: string, updates: Partial<Omit<Artifact<T>, 'id' | 'createdAt' | 'version'>>): Promise<Artifact<T>>;

    /** Delete an artifact (all versions) */
    delete(id: string): Promise<boolean>;

    /** List artifacts with optional filters */
    list(filters?: {
        type?: ArtifactType;
        tags?: string[];
        createdBy?: string;
        sessionId?: string;
        limit?: number;
        offset?: number;
    }): Promise<ArtifactMetadata[]>;

    /** Search artifacts by name or content */
    search(query: string, limit?: number): Promise<ArtifactMetadata[]>;
}

/**
 * In-Memory Artifact Storage - for development and testing.
 */
export class InMemoryArtifactStorage implements ArtifactStorage {
    private readonly artifacts = new Map<string, Artifact<unknown>[]>();
    private readonly config: Required<Omit<ArtifactStorageConfig, 'metrics' | 'basePath'>> &
        Pick<ArtifactStorageConfig, 'metrics' | 'basePath'>;

    constructor(config: ArtifactStorageConfig = {}) {
        this.config = {
            basePath: config.basePath,
            maxSizeBytes: config.maxSizeBytes ?? 100 * 1024 * 1024, // 100MB
            versioning: config.versioning ?? true,
            ttlMs: config.ttlMs ?? 0,
            metrics: config.metrics,
        };
    }

    async save<T>(artifact: Omit<Artifact<T>, 'id' | 'createdAt' | 'updatedAt' | 'version'>): Promise<Artifact<T>> {
        const id = this.generateId();
        const now = new Date();

        const fullArtifact: Artifact<T> = {
            ...artifact,
            id,
            createdAt: now,
            updatedAt: now,
            version: 1,
        } as Artifact<T>;

        this.artifacts.set(id, [fullArtifact as Artifact<unknown>]);
        this.recordMetric('artifact_saved', 1);

        return fullArtifact;
    }

    async get<T>(id: string): Promise<Artifact<T> | null> {
        const versions = this.artifacts.get(id);
        if (!versions || versions.length === 0) {
            return null;
        }

        // Return latest version
        return versions[versions.length - 1] as Artifact<T>;
    }

    async getVersion<T>(id: string, version: number): Promise<Artifact<T> | null> {
        const versions = this.artifacts.get(id);
        if (!versions) return null;

        const artifact = versions.find(v => v.version === version);
        return artifact as Artifact<T> | null;
    }

    async listVersions(id: string): Promise<ArtifactMetadata[]> {
        const versions = this.artifacts.get(id);
        if (!versions) return [];

        return versions.map(({ content, ...meta }) => meta);
    }

    async update<T>(
        id: string,
        updates: Partial<Omit<Artifact<T>, 'id' | 'createdAt' | 'version'>>
    ): Promise<Artifact<T>> {
        const current = await this.get<T>(id);
        if (!current) {
            throw new Error(`Artifact not found: ${id}`);
        }

        const newVersion: Artifact<T> = {
            ...current,
            ...updates,
            updatedAt: new Date(),
            version: current.version + 1,
        };

        if (this.config.versioning) {
            this.artifacts.get(id)!.push(newVersion as Artifact<unknown>);
        } else {
            this.artifacts.set(id, [newVersion as Artifact<unknown>]);
        }

        this.recordMetric('artifact_updated', 1);
        return newVersion;
    }

    async delete(id: string): Promise<boolean> {
        const deleted = this.artifacts.delete(id);
        if (deleted) {
            this.recordMetric('artifact_deleted', 1);
        }
        return deleted;
    }

    async list(filters?: {
        type?: ArtifactType;
        tags?: string[];
        createdBy?: string;
        sessionId?: string;
        limit?: number;
        offset?: number;
    }): Promise<ArtifactMetadata[]> {
        const allArtifacts: ArtifactMetadata[] = [];

        for (const versions of this.artifacts.values()) {
            const latest = versions[versions.length - 1];
            const { content, ...meta } = latest;
            allArtifacts.push(meta);
        }

        let filtered = allArtifacts;

        if (filters?.type) {
            filtered = filtered.filter(a => a.type === filters.type);
        }
        if (filters?.tags?.length) {
            filtered = filtered.filter(a =>
                filters.tags!.some(tag => a.tags?.includes(tag))
            );
        }
        if (filters?.createdBy) {
            filtered = filtered.filter(a => a.createdBy === filters.createdBy);
        }
        if (filters?.sessionId) {
            filtered = filtered.filter(a => a.sessionId === filters.sessionId);
        }

        const offset = filters?.offset ?? 0;
        const limit = filters?.limit ?? filtered.length;

        return filtered.slice(offset, offset + limit);
    }

    async search(query: string, limit = 10): Promise<ArtifactMetadata[]> {
        const results: ArtifactMetadata[] = [];
        const lowerQuery = query.toLowerCase();

        for (const versions of this.artifacts.values()) {
            const latest = versions[versions.length - 1];
            if (latest.name.toLowerCase().includes(lowerQuery)) {
                const { content, ...meta } = latest;
                results.push(meta);
            }
            if (results.length >= limit) break;
        }

        return results;
    }

    // --- Private ---

    private generateId(): string {
        return newId('art');
    }

    private recordMetric(name: string, value: number): void {
        this.config.metrics?.counter(`artifact.${name}`, value);
    }
}

// --- Helper Functions ---

/**
 * Create a text artifact
 */
export function createTextArtifact(
    name: string,
    content: string,
    options?: Partial<Omit<TextArtifact, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'content' | 'name'>>
): Omit<TextArtifact, 'id' | 'createdAt' | 'updatedAt' | 'version'> {
    return {
        name,
        type: options?.type ?? 'file',
        content,
        mimeType: options?.mimeType ?? 'text/plain',
        ...options,
    };
}

/**
 * Create a markdown artifact
 */
export function createMarkdownArtifact(
    name: string,
    content: string,
    tags?: string[]
): Omit<TextArtifact, 'id' | 'createdAt' | 'updatedAt' | 'version'> {
    return {
        name,
        type: 'markdown',
        content,
        mimeType: 'text/markdown',
        tags,
    };
}

/**
 * Create a JSON data artifact
 */
export function createDataArtifact<T extends Record<string, unknown>>(
    name: string,
    data: T,
    tags?: string[]
): Omit<DataArtifact<T>, 'id' | 'createdAt' | 'updatedAt' | 'version'> {
    return {
        name,
        type: 'data',
        content: data,
        mimeType: 'application/json',
        tags,
    };
}

/**
 * Create a reasoning artifact
 */
export function createReasoningArtifact(
    name: string,
    thoughts: string[],
    conclusion: string,
    confidence: number
): Omit<ReasoningArtifact, 'id' | 'createdAt' | 'updatedAt' | 'version'> {
    return {
        name,
        type: 'reasoning',
        content: { thoughts, conclusion, confidence },
    };
}

/**
 * Create a plan artifact
 */
export function createPlanArtifact(
    name: string,
    goal: string,
    steps: Array<{ description: string }>
): Omit<PlanArtifact, 'id' | 'createdAt' | 'updatedAt' | 'version'> {
    return {
        name,
        type: 'plan',
        content: {
            goal,
            steps: steps.map((s, i) => ({
                id: `step_${i + 1}`,
                description: s.description,
                status: 'pending' as const,
            })),
            status: 'draft',
        },
    };
}
