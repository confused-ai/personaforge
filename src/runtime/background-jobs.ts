/**
 * Background job store — async run tracking.
 *
 * When a client POSTs with `background: true`, the run executes in the background
 * and the client polls `GET /v1/runs/:runId` for the result.  This mirrors the
 * Agno pattern of `POST /agents/<id>/runs?stream=false&background=true`.
 */

export type BackgroundJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface BackgroundJob {
    readonly id: string;
    readonly agentName: string;
    readonly sessionId?: string;
    readonly userId?: string;
    status: BackgroundJobStatus;
    createdAt: string;
    updatedAt: string;
    completedAt?: string;
    /** Only populated when status === 'completed' */
    result?: {
        text: string;
        steps: number;
        finishReason: string;
    };
    /** Only populated when status === 'failed' */
    error?: string;
}

/** In-memory background job store (single-process). Swap for Redis/DB in HA. */
export class InMemoryBackgroundJobStore {
    private readonly jobs = new Map<string, BackgroundJob>();
    /** Maximum number of completed/failed jobs to retain. */
    private readonly maxRetained: number;

    constructor(options: { maxRetained?: number } = {}) {
        this.maxRetained = options.maxRetained ?? 500;
    }

    create(job: Omit<BackgroundJob, 'status' | 'createdAt' | 'updatedAt'>): BackgroundJob {
        const now = new Date().toISOString();
        const entry: BackgroundJob = {
            ...job,
            status: 'pending',
            createdAt: now,
            updatedAt: now,
        };
        this.jobs.set(job.id, entry);
        this._evict();
        return entry;
    }

    get(id: string): BackgroundJob | undefined {
        return this.jobs.get(id);
    }

    markRunning(id: string): void {
        const job = this.jobs.get(id);
        if (job) {
            job.status = 'running';
            job.updatedAt = new Date().toISOString();
        }
    }

    markCompleted(id: string, result: NonNullable<BackgroundJob['result']>): void {
        const job = this.jobs.get(id);
        if (job) {
            const now = new Date().toISOString();
            job.status = 'completed';
            job.result = result;
            job.completedAt = now;
            job.updatedAt = now;
        }
    }

    markFailed(id: string, error: string): void {
        const job = this.jobs.get(id);
        if (job) {
            const now = new Date().toISOString();
            job.status = 'failed';
            job.error = error;
            job.completedAt = now;
            job.updatedAt = now;
        }
    }

    markCancelled(id: string): boolean {
        const job = this.jobs.get(id);
        if (!job) return false;
        if (job.status !== 'pending' && job.status !== 'running') return false;
        job.status = 'cancelled';
        job.updatedAt = new Date().toISOString();
        return true;
    }

    list(filter?: { agentName?: string; userId?: string; status?: BackgroundJobStatus }): BackgroundJob[] {
        let items = Array.from(this.jobs.values());
        if (filter?.agentName) items = items.filter(j => j.agentName === filter.agentName);
        if (filter?.userId) items = items.filter(j => j.userId === filter.userId);
        if (filter?.status) items = items.filter(j => j.status === filter.status);
        return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    private _evict(): void {
        if (this.jobs.size <= this.maxRetained) return;
        // Remove oldest completed/failed entries first
        const terminal = Array.from(this.jobs.entries())
            .filter(([, j]) => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled')
            .sort(([, a], [, b]) => a.createdAt.localeCompare(b.createdAt));
        const toDelete = this.jobs.size - this.maxRetained;
        for (let i = 0; i < toDelete && i < terminal.length; i++) {
            this.jobs.delete(terminal[i]![0]);
        }
    }
}

/**
 * Create the default background job store.
 * Call once at boot — the singleton was removed so callers
 * explicitly wire their own store or accept the in-memory default.
 */
export function createDefaultBackgroundJobStore(): InMemoryBackgroundJobStore {
    return new InMemoryBackgroundJobStore();
}
