/**
 * Apify tools — run actors and retrieve data from Apify platform.
 * API docs: https://docs.apify.com/api/v2
 * API token: https://console.apify.com/account/integrations
 */

import { z } from 'zod';
import { BaseTool } from '../core/base-tool.js';
import { ToolCategory, type ToolContext } from '../core/types.js';

export interface ApifyToolConfig {
    /** Apify API token (or APIFY_API_TOKEN env var) */
    apiToken?: string;
}

function getToken(config: ApifyToolConfig): string {
    const token = config.apiToken ?? process.env['APIFY_API_TOKEN'];
    if (!token) throw new Error('ApifyTools require APIFY_API_TOKEN');
    return token;
}

async function apifyRequest(token: string, method: string, path: string, body?: object, timeoutMs = 30_000): Promise<unknown> {
    const url = `https://api.apify.com/v2${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
    const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`Apify API ${res.status}: ${await res.text()}`);
    return res.json();
}

// ── Schemas ────────────────────────────────────────────────────────────────

const RunActorSchema = z.object({
    actorId: z.string().describe('Actor ID or slug (e.g. "apify/web-scraper", "username/actor-name")'),
    input: z.record(z.string(), z.unknown()).optional().describe('Actor input JSON object'),
    build: z.string().optional().describe('Actor build tag (default: latest)'),
    timeoutSecs: z.number().int().optional().default(300).describe('Maximum run time in seconds'),
    memoryMbytes: z.number().int().optional().describe('Memory limit in MB'),
    waitForFinish: z.number().int().optional().default(60)
        .describe('Seconds to wait for run to finish (0 = return immediately with runId)'),
});

const GetRunSchema = z.object({
    runId: z.string().describe('Apify actor run ID'),
});

const GetDatasetItemsSchema = z.object({
    datasetId: z.string().describe('Apify dataset ID'),
    limit: z.number().int().min(1).max(10000).optional().default(100).describe('Max items to retrieve'),
    offset: z.number().int().optional().default(0).describe('Pagination offset'),
    format: z.enum(['json', 'csv', 'xml']).optional().default('json').describe('Output format'),
});

const RunActorGetDataSchema = z.object({
    actorId: z.string().describe('Actor ID or slug to run'),
    input: z.record(z.string(), z.unknown()).optional().describe('Actor input JSON object'),
    maxItems: z.number().int().optional().default(100).describe('Maximum dataset items to return'),
    timeoutSecs: z.number().int().optional().default(300),
});

// ── Tools ──────────────────────────────────────────────────────────────────

export class ApifyRunActorTool extends BaseTool<typeof RunActorSchema> {
    constructor(private config: ApifyToolConfig = {}) {
        super({
            id: 'apify_run_actor',
            name: 'Apify Run Actor',
            description: 'Run an Apify actor and wait for its completion.',
            category: ToolCategory.WEB,
            parameters: RunActorSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 360000 },
        });
    }

    protected async performExecute(input: z.infer<typeof RunActorSchema>, _ctx: ToolContext) {
        const token = getToken(this.config);
        const queryParams = new URLSearchParams({ token });
        if (input.build) queryParams.set('build', input.build);
        if (input.timeoutSecs) queryParams.set('timeout', String(input.timeoutSecs));
        if (input.memoryMbytes) queryParams.set('memory', String(input.memoryMbytes));
        if (input.waitForFinish) queryParams.set('waitForFinish', String(input.waitForFinish));

        const res = await fetch(
            `https://api.apify.com/v2/acts/${encodeURIComponent(input.actorId)}/runs?${queryParams.toString()}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input.input ?? {}),
                signal: AbortSignal.timeout(360_000),
            }
        );
        if (!res.ok) throw new Error(`Apify API ${res.status}: ${await res.text()}`);
        return res.json();
    }
}

export class ApifyGetRunTool extends BaseTool<typeof GetRunSchema> {
    constructor(private config: ApifyToolConfig = {}) {
        super({
            id: 'apify_get_run',
            name: 'Apify Get Run',
            description: 'Get the status and details of an Apify actor run.',
            category: ToolCategory.WEB,
            parameters: GetRunSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 15000 },
        });
    }

    protected async performExecute(input: z.infer<typeof GetRunSchema>, _ctx: ToolContext) {
        return apifyRequest(getToken(this.config), 'GET', `/actor-runs/${input.runId}`);
    }
}

export class ApifyGetDatasetItemsTool extends BaseTool<typeof GetDatasetItemsSchema> {
    constructor(private config: ApifyToolConfig = {}) {
        super({
            id: 'apify_get_dataset_items',
            name: 'Apify Get Dataset Items',
            description: 'Retrieve items from an Apify dataset.',
            category: ToolCategory.WEB,
            parameters: GetDatasetItemsSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 30000 },
        });
    }

    protected async performExecute(input: z.infer<typeof GetDatasetItemsSchema>, _ctx: ToolContext) {
        const token = getToken(this.config);
        const params = new URLSearchParams({
            token,
            limit: String(input.limit ?? 100),
            offset: String(input.offset ?? 0),
            format: input.format ?? 'json',
        });
        const res = await fetch(
            `https://api.apify.com/v2/datasets/${input.datasetId}/items?${params.toString()}`,
            { signal: AbortSignal.timeout(30_000) }
        );
        if (!res.ok) throw new Error(`Apify API ${res.status}: ${await res.text()}`);
        return res.json();
    }
}

export class ApifyRunActorGetDataTool extends BaseTool<typeof RunActorGetDataSchema> {
    constructor(private config: ApifyToolConfig = {}) {
        super({
            id: 'apify_run_actor_get_data',
            name: 'Apify Run Actor and Get Data',
            description: 'Run an Apify actor and automatically retrieve all output dataset items.',
            category: ToolCategory.WEB,
            parameters: RunActorGetDataSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 360000 },
        });
    }

    protected async performExecute(input: z.infer<typeof RunActorGetDataSchema>, _ctx: ToolContext) {
        const token = getToken(this.config);
        const params = new URLSearchParams({
            token,
            waitForFinish: String(input.timeoutSecs ?? 300),
        });

        const runRes = await fetch(
            `https://api.apify.com/v2/acts/${encodeURIComponent(input.actorId)}/runs?${params.toString()}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(input.input ?? {}),
                signal: AbortSignal.timeout(360_000),
            }
        );
        if (!runRes.ok) throw new Error(`Apify API ${runRes.status}: ${await runRes.text()}`);
        const run = await runRes.json() as { data?: { defaultDatasetId?: string } };
        const datasetId = run.data?.defaultDatasetId;
        if (!datasetId) return run;

        const itemsParams = new URLSearchParams({ token, limit: String(input.maxItems ?? 100), format: 'json' });
        const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?${itemsParams.toString()}`, { signal: AbortSignal.timeout(120_000) });
        if (!itemsRes.ok) throw new Error(`Apify API ${itemsRes.status}: ${await itemsRes.text()}`);
        return { run: run.data, items: await itemsRes.json() };
    }
}

export class ApifyToolkit {
    readonly runActor: ApifyRunActorTool;
    readonly getRun: ApifyGetRunTool;
    readonly getDatasetItems: ApifyGetDatasetItemsTool;
    readonly runActorGetData: ApifyRunActorGetDataTool;

    constructor(config: ApifyToolConfig = {}) {
        this.runActor = new ApifyRunActorTool(config);
        this.getRun = new ApifyGetRunTool(config);
        this.getDatasetItems = new ApifyGetDatasetItemsTool(config);
        this.runActorGetData = new ApifyRunActorGetDataTool(config);
    }

    getTools() {
        return [this.runActor, this.getRun, this.getDatasetItems, this.runActorGetData];
    }
}
