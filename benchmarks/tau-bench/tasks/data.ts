/**
 * τ-bench data domain tasks — query / aggregate / ETL style multi-step tool
 * use over a small in-memory dataset. Verifiers check argument-level intent,
 * not prose, so scores are stable across model versions.
 */

import { z } from 'zod/v3';
import { tool } from '../../../src/tools/core/tool-helper.js';
import type { AgentTask, RecordedCall } from '../harness.js';
import type { Tool } from '../../../src/core/index.js';

// ── Deterministic dataset ───────────────────────────────────────────────────
interface Row { region: string; product: string; units: number; revenue: number }
const SALES: Row[] = [
    { region: 'emea', product: 'widget', units: 10, revenue: 100 },
    { region: 'emea', product: 'gadget', units: 5, revenue: 250 },
    { region: 'apac', product: 'widget', units: 20, revenue: 200 },
    { region: 'apac', product: 'gadget', units: 2, revenue: 100 },
    { region: 'amer', product: 'widget', units: 7, revenue: 70 },
];

const queryRows = tool({
    name: 'query_rows',
    description: 'Return sales rows optionally filtered by region and/or product.',
    parameters: z.object({
        region: z.string().optional(),
        product: z.string().optional(),
    }),
    execute: ({ region, product }) => ({
        rows: SALES.filter(
            (r) => (region ? r.region === region : true) && (product ? r.product === product : true),
        ),
    }),
}) as unknown as Tool;

const aggregate = tool({
    name: 'aggregate',
    description: 'Aggregate a numeric column with sum/avg/max/min over the provided rows.',
    parameters: z.object({
        column: z.enum(['units', 'revenue']),
        op: z.enum(['sum', 'avg', 'max', 'min']),
        rows: z.array(z.object({
            region: z.string(), product: z.string(), units: z.number(), revenue: z.number(),
        })),
    }),
    execute: ({ column, op, rows }) => {
        const vals = rows.map((r) => (r as Record<string, number>)[column]!);
        if (vals.length === 0) return { result: 0 };
        const sum = vals.reduce((a, b) => a + b, 0);
        const result =
            op === 'sum' ? sum :
            op === 'avg' ? sum / vals.length :
            op === 'max' ? Math.max(...vals) :
            Math.min(...vals);
        return { result };
    },
}) as unknown as Tool;

const listRegions = tool({
    name: 'list_regions',
    description: 'List the distinct regions present in the dataset.',
    parameters: z.object({}),
    execute: () => ({ regions: [...new Set(SALES.map((r) => r.region))] }),
}) as unknown as Tool;

const DATA_TOOLS = [queryRows, aggregate, listRegions];

function calls(list: readonly RecordedCall[], name: string): RecordedCall[] {
    return list.filter((c) => c.name === name);
}

export const DATA_TASKS: AgentTask[] = [
    {
        id: 'data-01-filter-region',
        domain: 'data',
        instruction: 'How many sales rows are there for the "apac" region? Query the data.',
        tools: DATA_TOOLS,
        verify: (list) => {
            const q = calls(list, 'query_rows').find((c) => c.arguments['region'] === 'apac');
            return { passed: !!q, reason: q ? 'ok' : 'did not query_rows for region=apac' };
        },
    },
    {
        id: 'data-02-sum-revenue',
        domain: 'data',
        instruction: 'What is the total revenue across all sales? Query all rows then aggregate.',
        tools: DATA_TOOLS,
        maxSteps: 6,
        verify: (list) => {
            const q = calls(list, 'query_rows');
            const agg = calls(list, 'aggregate').find(
                (c) => c.arguments['column'] === 'revenue' && c.arguments['op'] === 'sum',
            );
            if (q.length === 0) return { passed: false, reason: 'did not query rows' };
            return { passed: !!agg, reason: agg ? 'ok' : 'did not aggregate sum(revenue)' };
        },
    },
    {
        id: 'data-03-avg-units-widget',
        domain: 'data',
        instruction: 'What is the average number of units per sale for the "widget" product? Filter then aggregate.',
        tools: DATA_TOOLS,
        maxSteps: 6,
        verify: (list) => {
            const q = calls(list, 'query_rows').find((c) => c.arguments['product'] === 'widget');
            const agg = calls(list, 'aggregate').find(
                (c) => c.arguments['column'] === 'units' && c.arguments['op'] === 'avg',
            );
            if (!q) return { passed: false, reason: 'did not filter product=widget' };
            return { passed: !!agg, reason: agg ? 'ok' : 'did not aggregate avg(units)' };
        },
    },
    {
        id: 'data-04-list-regions',
        domain: 'data',
        instruction: 'Which regions appear in the dataset? List them.',
        tools: DATA_TOOLS,
        verify: (list, text) => {
            const c = calls(list, 'list_regions');
            if (c.length === 0) return { passed: false, reason: 'did not call list_regions' };
            const mentionsOne = /emea|apac|amer/i.test(text);
            return { passed: mentionsOne, reason: mentionsOne ? 'ok' : 'final text did not name a region' };
        },
    },
    {
        id: 'data-05-max-revenue-region',
        domain: 'data',
        instruction: 'Find the single highest-revenue sale in the "emea" region. Filter to emea, then get the max revenue.',
        tools: DATA_TOOLS,
        maxSteps: 6,
        verify: (list) => {
            const q = calls(list, 'query_rows').find((c) => c.arguments['region'] === 'emea');
            const agg = calls(list, 'aggregate').find(
                (c) => c.arguments['column'] === 'revenue' && c.arguments['op'] === 'max',
            );
            if (!q) return { passed: false, reason: 'did not filter region=emea' };
            return { passed: !!agg, reason: agg ? 'ok' : 'did not aggregate max(revenue)' };
        },
    },
];
