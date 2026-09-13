/**
 * Neo4j tools — run Cypher queries and manage graph data.
 * Uses the Neo4j HTTP API (no native driver dependency).
 * Bolt/HTTP endpoint: https://neo4j.com/docs/http-api/
 */

import { z } from 'zod';
import { BaseTool } from '../core/base-tool.js';
import { ToolCategory, type ToolContext } from '../core/types.js';
import { assertIdentifier } from './sql-guard.js';

export interface Neo4jToolConfig {
    /** Neo4j HTTP endpoint (or NEO4J_URL env var, default: http://localhost:7474) */
    url?: string;
    /** Neo4j username (or NEO4J_USERNAME env var, default: neo4j) */
    username?: string;
    /** Neo4j password (or NEO4J_PASSWORD env var) */
    password?: string;
    /** Database name (or NEO4J_DATABASE env var, default: neo4j) */
    database?: string;
}

interface Neo4jCreds { url: string; auth: string; database: string }

function getCreds(config: Neo4jToolConfig): Neo4jCreds {
    const url = (config.url ?? process.env['NEO4J_URL'] ?? 'http://localhost:7474').replace(/\/$/, '');
    const username = config.username ?? process.env['NEO4J_USERNAME'] ?? 'neo4j';
    const password = config.password ?? process.env['NEO4J_PASSWORD'];
    if (!password) throw new Error('Neo4jTools require NEO4J_PASSWORD');
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    const database = config.database ?? process.env['NEO4J_DATABASE'] ?? 'neo4j';
    return { url, auth, database };
}

async function neo4jQuery(creds: Neo4jCreds, cypher: string, parameters: Record<string, unknown> = {}): Promise<unknown> {
    const res = await fetch(`${creds.url}/db/${creds.database}/tx/commit`, {
        method: 'POST',
        headers: {
            Authorization: `Basic ${creds.auth}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({ statements: [{ statement: cypher, parameters }] }),
    });
    if (!res.ok) throw new Error(`Neo4j API ${res.status}: ${await res.text()}`);
    const data = await res.json() as {
        results: Array<{ columns: string[]; data: Array<{ row: unknown[] }> }>;
        errors: Array<{ code: string; message: string }>;
    };
    if (data.errors?.length) throw new Error(`Neo4j error: ${data.errors[0]?.message ?? 'Unknown error'}`);
    return data.results;
}

function parseResults(results: Array<{ columns: string[]; data: Array<{ row: unknown[] }> }>): Array<Record<string, unknown>> {
    const result = results[0];
    if (!result) return [];
    return result.data.map((row) =>
        Object.fromEntries(result.columns.map((col, i) => [col, row.row[i]])),
    );
}

// ── Schemas ────────────────────────────────────────────────────────────────

const RunCypherSchema = z.object({
    cypher: z.string().describe('Cypher query to execute'),
    parameters: z.record(z.string(), z.unknown()).optional().default({}).describe('Query parameters (use $param in Cypher)'),
});

const CreateNodeSchema = z.object({
    labels: z.array(z.string()).min(1).describe('Node labels (e.g. ["Person", "Employee"])'),
    properties: z.record(z.string(), z.unknown()).describe('Node properties'),
});

const CreateRelationshipSchema = z.object({
    fromNodeId: z.string().describe('Internal Neo4j ID or match criteria of source node'),
    toNodeId: z.string().describe('Internal Neo4j ID or match criteria of target node'),
    type: z.string().describe('Relationship type (e.g. KNOWS, WORKS_AT)'),
    properties: z.record(z.string(), z.unknown()).optional().default({}),
    matchByProperty: z.object({
        label: z.string(),
        property: z.string(),
    }).optional().describe('Match nodes by a specific label+property instead of ID'),
});

const FindNodesSchema = z.object({
    label: z.string().describe('Node label to search for'),
    properties: z.record(z.string(), z.unknown()).optional().describe('Property filters (all must match)'),
    limit: z.number().int().min(1).max(1000).optional().default(25),
    skip: z.number().int().min(0).optional().default(0),
});

const DeleteNodeSchema = z.object({
    label: z.string().describe('Node label'),
    property: z.string().describe('Property name to match on'),
    value: z.unknown().describe('Property value to match'),
    detach: z.boolean().optional().default(true).describe('Also delete relationships (DETACH DELETE)'),
});

const GetSchemaSchema = z.object({});

// ── Tools ──────────────────────────────────────────────────────────────────

export class Neo4jRunCypherTool extends BaseTool<typeof RunCypherSchema, { rows: Array<Record<string, unknown>>; count: number }> {
    constructor(private config: Neo4jToolConfig = {}) {
        super({
            id: 'neo4j_run_cypher',
            name: 'Neo4j Run Cypher',
            description: 'Execute an arbitrary Cypher query against Neo4j and return results as a list of row objects.',
            category: ToolCategory.DATABASE,
            parameters: RunCypherSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 30000 },
        });
    }

    protected async performExecute(input: z.infer<typeof RunCypherSchema>, _ctx: ToolContext) {
        const results = await neo4jQuery(getCreds(this.config), input.cypher, input.parameters ?? {}) as Array<{ columns: string[]; data: Array<{ row: unknown[] }> }>;
        const rows = parseResults(results);
        return { rows, count: rows.length };
    }
}

export class Neo4jCreateNodeTool extends BaseTool<typeof CreateNodeSchema, { id: unknown; labels: string[]; properties: Record<string, unknown> }> {
    constructor(private config: Neo4jToolConfig = {}) {
        super({
            id: 'neo4j_create_node',
            name: 'Neo4j Create Node',
            description: 'Create a new node in Neo4j with given labels and properties.',
            category: ToolCategory.DATABASE,
            parameters: CreateNodeSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 15000 },
        });
    }

    protected async performExecute(input: z.infer<typeof CreateNodeSchema>, _ctx: ToolContext) {
        const labelStr = input.labels.map((l) => `:${assertIdentifier(l, 'label')}`).join('');
        const cypher = `CREATE (n${labelStr} $props) RETURN id(n) as id, labels(n) as labels, properties(n) as props`;
        const results = await neo4jQuery(getCreds(this.config), cypher, { props: input.properties }) as Array<{ columns: string[]; data: Array<{ row: unknown[] }> }>;
        const rows = parseResults(results);
        const row = rows[0] ?? {};
        return { id: row['id'], labels: row['labels'] as string[], properties: row['props'] as Record<string, unknown> };
    }
}

export class Neo4jCreateRelationshipTool extends BaseTool<typeof CreateRelationshipSchema, { type: string; properties: Record<string, unknown> }> {
    constructor(private config: Neo4jToolConfig = {}) {
        super({
            id: 'neo4j_create_relationship',
            name: 'Neo4j Create Relationship',
            description: 'Create a relationship between two Neo4j nodes.',
            category: ToolCategory.DATABASE,
            parameters: CreateRelationshipSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 15000 },
        });
    }

    protected async performExecute(input: z.infer<typeof CreateRelationshipSchema>, _ctx: ToolContext) {
        let cypher: string;
        let params: Record<string, unknown>;
        const relType = assertIdentifier(input.type, 'relationship type');
        if (input.matchByProperty) {
            const label = assertIdentifier(input.matchByProperty.label, 'label');
            const property = assertIdentifier(input.matchByProperty.property, 'property');
            cypher = `MATCH (a:${label} {${property}: $fromId}), (b:${label} {${property}: $toId}) CREATE (a)-[r:${relType} $props]->(b) RETURN type(r) as type, properties(r) as props`;
            params = { fromId: input.fromNodeId, toId: input.toNodeId, props: input.properties ?? {} };
        } else {
            cypher = `MATCH (a), (b) WHERE id(a) = $fromId AND id(b) = $toId CREATE (a)-[r:${relType} $props]->(b) RETURN type(r) as type, properties(r) as props`;
            params = { fromId: Number(input.fromNodeId), toId: Number(input.toNodeId), props: input.properties ?? {} };
        }
        const results = await neo4jQuery(getCreds(this.config), cypher, params) as Array<{ columns: string[]; data: Array<{ row: unknown[] }> }>;
        const rows = parseResults(results);
        const row = rows[0] ?? {};
        return { type: row['type'] as string ?? input['type'], properties: row['props'] as Record<string, unknown> ?? {} };
    }
}

export class Neo4jFindNodesTool extends BaseTool<typeof FindNodesSchema, { nodes: Array<Record<string, unknown>>; count: number }> {
    constructor(private config: Neo4jToolConfig = {}) {
        super({
            id: 'neo4j_find_nodes',
            name: 'Neo4j Find Nodes',
            description: 'Find Neo4j nodes by label and optional property filters.',
            category: ToolCategory.DATABASE,
            parameters: FindNodesSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 15000 },
        });
    }

    protected async performExecute(input: z.infer<typeof FindNodesSchema>, _ctx: ToolContext) {
        const props = input.properties ?? {};
        const whereClauses = Object.keys(props).map((k) => {
            const key = assertIdentifier(k, 'property');
            return `n.${key} = $${key}`;
        });
        const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
        const cypher = `MATCH (n:${assertIdentifier(input.label, 'label')}) ${where} RETURN id(n) as id, labels(n) as labels, properties(n) as props SKIP ${input.skip ?? 0} LIMIT ${input.limit ?? 25}`;
        const results = await neo4jQuery(getCreds(this.config), cypher, props) as Array<{ columns: string[]; data: Array<{ row: unknown[] }> }>;
        const rows = parseResults(results);
        const nodes = rows.map((r) => ({ id: r['id'], labels: r['labels'], ...(r['props'] as Record<string, unknown>) }));
        return { nodes, count: nodes.length };
    }
}

export class Neo4jDeleteNodeTool extends BaseTool<typeof DeleteNodeSchema, { deleted: number }> {
    constructor(private config: Neo4jToolConfig = {}) {
        super({
            id: 'neo4j_delete_node',
            name: 'Neo4j Delete Node',
            description: 'Delete Neo4j nodes matching a label and property value.',
            category: ToolCategory.DATABASE,
            parameters: DeleteNodeSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 15000 },
        });
    }

    protected async performExecute(input: z.infer<typeof DeleteNodeSchema>, _ctx: ToolContext) {
        const deleteClause = input.detach ? 'DETACH DELETE n' : 'DELETE n';
        const cypher = `MATCH (n:${assertIdentifier(input.label, 'label')} {${assertIdentifier(input.property, 'property')}: $value}) ${deleteClause} RETURN count(*) as deleted`;
        const results = await neo4jQuery(getCreds(this.config), cypher, { value: input.value }) as Array<{ columns: string[]; data: Array<{ row: unknown[] }> }>;
        const rows = parseResults(results);
        return { deleted: rows[0]?.['deleted'] as number ?? 0 };
    }
}

export class Neo4jGetSchemaTool extends BaseTool<typeof GetSchemaSchema, {
    labels: string[];
    relationshipTypes: string[];
    propertyKeys: string[];
}> {
    constructor(private config: Neo4jToolConfig = {}) {
        super({
            id: 'neo4j_get_schema',
            name: 'Neo4j Get Schema',
            description: 'Retrieve the database schema — all node labels, relationship types, and property keys.',
            category: ToolCategory.DATABASE,
            parameters: GetSchemaSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 10000 },
        });
    }

    protected async performExecute(_input: z.infer<typeof GetSchemaSchema>, _ctx: ToolContext) {
        const creds = getCreds(this.config);
        const [labelsRes, relsRes, propsRes] = await Promise.all([
            neo4jQuery(creds, 'CALL db.labels() YIELD label RETURN collect(label) as labels'),
            neo4jQuery(creds, 'CALL db.relationshipTypes() YIELD relationshipType RETURN collect(relationshipType) as types'),
            neo4jQuery(creds, 'CALL db.propertyKeys() YIELD propertyKey RETURN collect(propertyKey) as keys'),
        ]) as Array<Array<{ columns: string[]; data: Array<{ row: unknown[] }> }>>;

        const labelsRows = parseResults(labelsRes ?? []);
        const relsRows = parseResults(relsRes ?? []);
        const propsRows = parseResults(propsRes ?? []);

        return {
            labels: labelsRows[0]?.['labels'] as string[] ?? [],
            relationshipTypes: relsRows[0]?.['types'] as string[] ?? [],
            propertyKeys: propsRows[0]?.['keys'] as string[] ?? [],
        };
    }
}

export class Neo4jToolkit {
    readonly tools: BaseTool[];
    constructor(config: Neo4jToolConfig = {}) {
        this.tools = [
            new Neo4jRunCypherTool(config),
            new Neo4jCreateNodeTool(config),
            new Neo4jCreateRelationshipTool(config),
            new Neo4jFindNodesTool(config),
            new Neo4jDeleteNodeTool(config),
            new Neo4jGetSchemaTool(config),
        ];
    }
}
