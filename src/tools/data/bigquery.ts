/**
 * Google BigQuery tools — run queries and manage datasets via BigQuery REST API.
 * Docs: https://cloud.google.com/bigquery/docs/reference/rest
 */

import { z } from 'zod';
import { BaseTool } from '../core/base-tool.js';
import { ToolCategory, type ToolContext } from '../core/types.js';

export interface BigQueryToolConfig {
    /** Google OAuth2 access token (or GOOGLE_ACCESS_TOKEN env var) */
    accessToken?: string;
    /** GCP project ID (or GOOGLE_CLOUD_PROJECT env var) */
    projectId?: string;
    /** Default dataset for table operations */
    defaultDataset?: string;
}

function getAuth(config: BigQueryToolConfig): { token: string; projectId: string } {
    const token = config.accessToken ?? process.env['GOOGLE_ACCESS_TOKEN'];
    const projectId = config.projectId ?? process.env['GOOGLE_CLOUD_PROJECT'] ?? process.env['GCLOUD_PROJECT'];
    if (!token) throw new Error('BigQueryTools require GOOGLE_ACCESS_TOKEN');
    if (!projectId) throw new Error('BigQueryTools require GOOGLE_CLOUD_PROJECT');
    return { token, projectId };
}

async function bqRequest(token: string, method: string, url: string, body?: object): Promise<unknown> {
    const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`BigQuery API ${res.status}: ${await res.text()}`);
    return res.json();
}

// ── Schemas ────────────────────────────────────────────────────────────────

const QuerySchema = z.object({
    query: z.string().describe('Standard SQL query to execute'),
    maxResults: z.number().int().min(1).max(10000).optional().default(1000)
        .describe('Maximum number of rows to return'),
    timeoutMs: z.number().int().optional().default(30000).describe('Query timeout in milliseconds'),
    useLegacySql: z.boolean().optional().default(false).describe('Use legacy SQL syntax'),
    location: z.string().optional().default('US').describe('Query location/region'),
    parameters: z.array(z.object({
        name: z.string(),
        parameterType: z.object({ type: z.string() }),
        parameterValue: z.object({ value: z.string() }),
    })).optional().describe('Query parameters for parameterized queries'),
});

const ListDatasetsSchema = z.object({
    maxResults: z.number().int().optional().default(50).describe('Max datasets to list'),
    filter: z.string().optional().describe('Filter expression'),
});

const ListTablesSchema = z.object({
    datasetId: z.string().describe('Dataset ID to list tables from'),
    maxResults: z.number().int().optional().default(50).describe('Max tables to list'),
});

const GetTableSchema = z.object({
    datasetId: z.string().describe('Dataset ID'),
    tableId: z.string().describe('Table ID'),
});

// ── Tools ──────────────────────────────────────────────────────────────────

export class BigQueryQueryTool extends BaseTool<typeof QuerySchema, {
    jobId: string;
    totalRows: string;
    schema?: { fields: Array<{ name: string; type: string; mode: string }> };
    rows: Array<Record<string, unknown>>;
}> {
    constructor(private config: BigQueryToolConfig = {}) {
        super({
            id: 'bigquery_query',
            name: 'BigQuery Query',
            description: 'Execute a SQL query in Google BigQuery and return results.',
            category: ToolCategory.DATABASE,
            parameters: QuerySchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 60000 },
        });
    }

    protected async performExecute(input: z.infer<typeof QuerySchema>, _ctx: ToolContext) {
        const { token, projectId } = getAuth(this.config);
        const body: Record<string, unknown> = {
            kind: 'bigquery#queryRequest',
            query: input.query,
            maxResults: input.maxResults ?? 1000,
            timeoutMs: input.timeoutMs ?? 30000,
            useLegacySql: input.useLegacySql ?? false,
            location: input.location ?? 'US',
        };
        if (input.parameters?.length) {
            body['parameterMode'] = 'NAMED';
            body['queryParameters'] = input.parameters;
        }

        const url = `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/queries`;
        const data = await bqRequest(token, 'POST', url, body) as {
            jobReference?: { jobId?: string };
            totalRows?: string;
            schema?: { fields?: Array<{ name: string; type: string; mode: string }> };
            rows?: Array<{ f?: Array<{ v?: unknown }> }>;
        };

        const schema = data.schema?.fields;
        const rows = (data.rows ?? []).map(row => {
            const record: Record<string, unknown> = {};
            (row.f ?? []).forEach((cell, idx) => {
                const fieldName = schema?.[idx]?.name ?? `field_${idx}`;
                record[fieldName] = cell.v;
            });
            return record;
        });

        return {
            jobId: data.jobReference?.jobId ?? '',
            totalRows: data.totalRows ?? '0',
            ...(schema !== undefined && { schema: { fields: schema } }),
            rows,
        };
    }
}

export class BigQueryListDatasetsTool extends BaseTool<typeof ListDatasetsSchema> {
    constructor(private config: BigQueryToolConfig = {}) {
        super({
            id: 'bigquery_list_datasets',
            name: 'BigQuery List Datasets',
            description: 'List datasets in a Google BigQuery project.',
            category: ToolCategory.DATABASE,
            parameters: ListDatasetsSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 15000 },
        });
    }

    protected async performExecute(input: z.infer<typeof ListDatasetsSchema>, _ctx: ToolContext) {
        const { token, projectId } = getAuth(this.config);
        const params = new URLSearchParams({ maxResults: String(input.maxResults ?? 50) });
        if (input.filter) params.set('filter', input.filter);
        return bqRequest(token, 'GET', `https://bigquery.googleapis.com/bigquery/v2/projects/${projectId}/datasets?${params.toString()}`);
    }
}

export class BigQueryListTablesTool extends BaseTool<typeof ListTablesSchema> {
    constructor(private config: BigQueryToolConfig = {}) {
        super({
            id: 'bigquery_list_tables',
            name: 'BigQuery List Tables',
            description: 'List tables in a BigQuery dataset.',
            category: ToolCategory.DATABASE,
            parameters: ListTablesSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 15000 },
        });
    }

    protected async performExecute(input: z.infer<typeof ListTablesSchema>, _ctx: ToolContext) {
        const { token, projectId } = getAuth(this.config);
        const params = new URLSearchParams({ maxResults: String(input.maxResults ?? 50) });
        return bqRequest(token, 'GET',
            `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(input.datasetId)}/tables?${params.toString()}`);
    }
}

export class BigQueryGetTableTool extends BaseTool<typeof GetTableSchema> {
    constructor(private config: BigQueryToolConfig = {}) {
        super({
            id: 'bigquery_get_table',
            name: 'BigQuery Get Table',
            description: 'Get the schema and metadata for a BigQuery table.',
            category: ToolCategory.DATABASE,
            parameters: GetTableSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 15000 },
        });
    }

    protected async performExecute(input: z.infer<typeof GetTableSchema>, _ctx: ToolContext) {
        const { token, projectId } = getAuth(this.config);
        return bqRequest(token, 'GET',
            `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(input.datasetId)}/tables/${encodeURIComponent(input.tableId)}`);
    }
}

export class BigQueryToolkit {
    readonly query: BigQueryQueryTool;
    readonly listDatasets: BigQueryListDatasetsTool;
    readonly listTables: BigQueryListTablesTool;
    readonly getTable: BigQueryGetTableTool;

    constructor(config: BigQueryToolConfig = {}) {
        this.query = new BigQueryQueryTool(config);
        this.listDatasets = new BigQueryListDatasetsTool(config);
        this.listTables = new BigQueryListTablesTool(config);
        this.getTable = new BigQueryGetTableTool(config);
    }

    getTools() {
        return [this.query, this.listDatasets, this.listTables, this.getTable];
    }
}
