/**
 * Hermetic coverage for data tools (CSV, Neo4j).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
    CsvParseTool,
    CsvFilterTool,
    CsvSelectColumnsTool,
    CsvSortTool,
    CsvAggregateTool,
    CsvToJsonTool,
    CsvToolkit,
} from '../src/tools/data/csv.js';
import {
    Neo4jRunCypherTool,
    Neo4jCreateNodeTool,
    Neo4jCreateRelationshipTool,
    Neo4jFindNodesTool,
    Neo4jDeleteNodeTool,
    Neo4jGetSchemaTool,
    Neo4jToolkit,
} from '../src/tools/data/neo4j.js';
import type { ToolContext } from '../src/tools/core/types.js';

function ctx(over: Partial<ToolContext> = {}): ToolContext {
    return {
        toolId: 'tool_test',
        agentId: 'agent_test',
        sessionId: 'sess_test',
        permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 30_000 },
        ...over,
    };
}

const SAMPLE_CSV = 'name,age,city\nAlice,30,NYC\nBob,25,LA\nCarol,30,"San, Francisco"\n';

describe('CsvToolkit', () => {
    it('exposes 6 tools', () => {
        expect(new CsvToolkit().tools).toHaveLength(6);
    });

    it('parses CSV including quoted fields and empty input', async () => {
        const parsed = await new CsvParseTool().execute({ csv: SAMPLE_CSV }, ctx());
        expect(parsed.success).toBe(true);
        expect(parsed.data?.rowCount).toBe(3);
        expect(parsed.data?.columns).toEqual(['name', 'age', 'city']);
        expect(parsed.data?.rows[2]?.city).toBe('San, Francisco');

        const empty = await new CsvParseTool().execute({ csv: '   ' }, ctx());
        expect(empty.data?.rowCount).toBe(0);
        expect(empty.data?.columns).toEqual([]);

        const quoted = await new CsvParseTool().execute({
            csv: 'a,b\n"he""llo",x\n',
        }, ctx());
        expect(quoted.data?.rows[0]?.a).toBe('he"llo');
    });

    it('filters with all operators', async () => {
        const tool = new CsvFilterTool();
        const base = { csv: SAMPLE_CSV };
        expect((await tool.execute({ ...base, column: 'name', operator: 'eq', value: 'Alice' }, ctx())).data?.rowCount).toBe(1);
        expect((await tool.execute({ ...base, column: 'name', operator: 'ne', value: 'Alice' }, ctx())).data?.rowCount).toBe(2);
        expect((await tool.execute({ ...base, column: 'age', operator: 'gt', value: '25' }, ctx())).data?.rowCount).toBe(2);
        expect((await tool.execute({ ...base, column: 'age', operator: 'lt', value: '30' }, ctx())).data?.rowCount).toBe(1);
        expect((await tool.execute({ ...base, column: 'age', operator: 'gte', value: '30' }, ctx())).data?.rowCount).toBe(2);
        expect((await tool.execute({ ...base, column: 'age', operator: 'lte', value: '25' }, ctx())).data?.rowCount).toBe(1);
        expect((await tool.execute({ ...base, column: 'city', operator: 'contains', value: 'San' }, ctx())).data?.rowCount).toBe(1);
        expect((await tool.execute({ ...base, column: 'name', operator: 'startsWith', value: 'A' }, ctx())).data?.rowCount).toBe(1);
        expect((await tool.execute({ ...base, column: 'name', operator: 'endsWith', value: 'e' }, ctx())).data?.rowCount).toBe(1);
        // lexical compare when non-numeric
        expect((await tool.execute({ ...base, column: 'name', operator: 'gt', value: 'B' }, ctx())).data?.rowCount).toBeGreaterThan(0);
    });

    it('selects, sorts, aggregates, converts to JSON', async () => {
        const sel = await new CsvSelectColumnsTool().execute({ csv: SAMPLE_CSV, columns: ['name', 'age'] }, ctx());
        expect(sel.success).toBe(true);
        expect(sel.data?.csv).toMatch(/name,age/);
        expect(sel.data?.rowCount).toBe(3);

        const asc = await new CsvSortTool().execute({ csv: SAMPLE_CSV, column: 'age', order: 'asc' }, ctx());
        expect(asc.data?.csv.split('\n')[1]).toMatch(/^Bob/);
        const desc = await new CsvSortTool().execute({ csv: SAMPLE_CSV, column: 'name', order: 'desc' }, ctx());
        expect(desc.data?.csv).toBeTruthy();

        const sum = await new CsvAggregateTool().execute({ csv: SAMPLE_CSV, column: 'age', operation: 'sum' }, ctx());
        expect(sum.data?.result).toBe(85);
        expect((await new CsvAggregateTool().execute({ csv: SAMPLE_CSV, column: 'age', operation: 'avg' }, ctx())).data?.result).toBeCloseTo(85 / 3);
        expect((await new CsvAggregateTool().execute({ csv: SAMPLE_CSV, column: 'age', operation: 'min' }, ctx())).data?.result).toBe(25);
        expect((await new CsvAggregateTool().execute({ csv: SAMPLE_CSV, column: 'age', operation: 'max' }, ctx())).data?.result).toBe(30);
        expect((await new CsvAggregateTool().execute({ csv: SAMPLE_CSV, column: 'age', operation: 'count' }, ctx())).data?.result).toBe(3);

        const emptyAgg = await new CsvAggregateTool().execute({ csv: 'x\n', column: 'x', operation: 'avg' }, ctx());
        expect(emptyAgg.data?.result).toBe(0);

        const json = await new CsvToJsonTool().execute({ csv: SAMPLE_CSV }, ctx());
        expect(JSON.parse(json.data!.json)).toHaveLength(3);

        // toCsv escaping: select produces escaped values when needed
        const withComma = await new CsvSelectColumnsTool().execute({
            csv: 'a\n"x,y"\n',
            columns: ['a'],
        }, ctx());
        expect(withComma.data?.csv).toContain('"');
    });
});

describe('Neo4jToolkit', () => {
    const originalFetch = globalThis.fetch;
    const cfg = { url: 'http://neo4j.test', username: 'neo4j', password: 'secret', database: 'neo4j' };

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    function okResults(columns: string[], rows: unknown[][]) {
        return {
            results: [{ columns, data: rows.map((row) => ({ row })) }],
            errors: [],
        };
    }

    it('requires password', async () => {
        const prev = process.env['NEO4J_PASSWORD'];
        delete process.env['NEO4J_PASSWORD'];
        const r = await new Neo4jRunCypherTool({ url: 'http://x' }).execute({ cypher: 'RETURN 1' }, ctx());
        expect(r.success).toBe(false);
        expect(r.error?.message).toMatch(/NEO4J_PASSWORD/);
        if (prev !== undefined) process.env['NEO4J_PASSWORD'] = prev;
    });

    it('toolkit has 6 tools', () => {
        expect(new Neo4jToolkit(cfg).tools).toHaveLength(6);
    });

    it('run cypher + error paths', async () => {
        globalThis.fetch = vi.fn(async () =>
            new Response(JSON.stringify(okResults(['n'], [[1]])), { status: 200 }),
        ) as typeof fetch;
        const ok = await new Neo4jRunCypherTool(cfg).execute({ cypher: 'RETURN 1 as n', parameters: {} }, ctx());
        expect(ok.success).toBe(true);
        expect(ok.data?.rows).toEqual([{ n: 1 }]);
        expect(ok.data?.count).toBe(1);

        globalThis.fetch = vi.fn(async () => new Response('boom', { status: 500 })) as typeof fetch;
        const bad = await new Neo4jRunCypherTool(cfg).execute({ cypher: 'X' }, ctx());
        expect(bad.success).toBe(false);

        globalThis.fetch = vi.fn(async () =>
            new Response(JSON.stringify({ results: [], errors: [{ code: 'Neo.ClientError', message: 'bad cypher' }] }), { status: 200 }),
        ) as typeof fetch;
        const err = await new Neo4jRunCypherTool(cfg).execute({ cypher: 'X' }, ctx());
        expect(err.success).toBe(false);
        expect(err.error?.message).toMatch(/bad cypher/);
    });

    it('create node, relationship (id + property match), find, delete, schema', async () => {
        globalThis.fetch = vi.fn(async () =>
            new Response(JSON.stringify(okResults(['id', 'labels', 'props'], [[42, ['Person'], { name: 'Ada' }]])), { status: 200 }),
        ) as typeof fetch;
        const node = await new Neo4jCreateNodeTool(cfg).execute({
            labels: ['Person'],
            properties: { name: 'Ada' },
        }, ctx());
        expect(node.data?.id).toBe(42);
        expect(node.data?.labels).toEqual(['Person']);

        globalThis.fetch = vi.fn(async () =>
            new Response(JSON.stringify(okResults(['type', 'props'], [['KNOWS', { since: 1 }]])), { status: 200 }),
        ) as typeof fetch;
        const relId = await new Neo4jCreateRelationshipTool(cfg).execute({
            fromNodeId: '1',
            toNodeId: '2',
            type: 'KNOWS',
            properties: { since: 1 },
        }, ctx());
        expect(relId.data?.type).toBe('KNOWS');

        const relProp = await new Neo4jCreateRelationshipTool(cfg).execute({
            fromNodeId: 'a',
            toNodeId: 'b',
            type: 'KNOWS',
            matchByProperty: { label: 'Person', property: 'name' },
        }, ctx());
        expect(relProp.success).toBe(true);

        globalThis.fetch = vi.fn(async () =>
            new Response(JSON.stringify(okResults(['id', 'labels', 'props'], [[1, ['Person'], { name: 'Ada' }]])), { status: 200 }),
        ) as typeof fetch;
        const found = await new Neo4jFindNodesTool(cfg).execute({
            label: 'Person',
            properties: { name: 'Ada' },
            limit: 10,
            skip: 0,
        }, ctx());
        expect(found.data?.count).toBe(1);

        const foundAll = await new Neo4jFindNodesTool(cfg).execute({ label: 'Person' }, ctx());
        expect(foundAll.success).toBe(true);

        globalThis.fetch = vi.fn(async () =>
            new Response(JSON.stringify(okResults(['deleted'], [[1]])), { status: 200 }),
        ) as typeof fetch;
        const del = await new Neo4jDeleteNodeTool(cfg).execute({
            label: 'Person',
            property: 'name',
            value: 'Ada',
            detach: true,
        }, ctx());
        expect(del.data?.deleted).toBe(1);

        const delNoDetach = await new Neo4jDeleteNodeTool(cfg).execute({
            label: 'Person',
            property: 'name',
            value: 'Ada',
            detach: false,
        }, ctx());
        expect(delNoDetach.success).toBe(true);

        globalThis.fetch = vi.fn(async () =>
            new Response(JSON.stringify(okResults(['labels'], [[['Person', 'Company']]])), { status: 200 }),
        ) as typeof fetch;
        // schema makes 3 parallel calls — each returns same mock shape with different column
        let call = 0;
        globalThis.fetch = vi.fn(async () => {
            call++;
            if (call === 1) return new Response(JSON.stringify(okResults(['labels'], [[['Person']]])), { status: 200 });
            if (call === 2) return new Response(JSON.stringify(okResults(['types'], [[['KNOWS']]])), { status: 200 });
            return new Response(JSON.stringify(okResults(['keys'], [[['name']]])), { status: 200 });
        }) as typeof fetch;
        const schema = await new Neo4jGetSchemaTool(cfg).execute({}, ctx());
        expect(schema.data?.labels).toEqual(['Person']);
        expect(schema.data?.relationshipTypes).toEqual(['KNOWS']);
        expect(schema.data?.propertyKeys).toEqual(['name']);
    });
});
