/**
 * CSV tools — parse, filter, select columns, sort, aggregate, convert to JSON.
 * No extra dependencies required (pure TypeScript).
 */

import { z } from 'zod';
import { BaseTool } from '../core/base-tool.js';
import { ToolCategory, type ToolContext } from '../core/types.js';

// ── CSV helpers ────────────────────────────────────────────────────────────

function parseCsv(raw: string, delimiter = ','): Array<Record<string, string>> {
    const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
    if (lines.length === 0) return [];

    const headers = splitLine(lines[0]!, delimiter);
    return lines.slice(1).filter((l) => l.trim()).map((line) => {
        const vals = splitLine(line, delimiter);
        return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']));
    });
}

function splitLine(line: string, delim: string): string[] {
    const result: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {

        const ch = line[i]!;
        if (ch === '"') {
            if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
            else { inQ = !inQ; }
        } else if (ch === delim && !inQ) {
            result.push(cur.trim()); cur = '';
        } else {
            cur += ch;
        }
    }
    result.push(cur.trim());
    return result;
}

function toCsv(rows: Array<Record<string, unknown>>, delim = ','): string {
    if (rows.length === 0) return '';

    const headers = Object.keys(rows[0]!);
    const esc = (v: unknown) => {

        const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
        return s.includes(delim) || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers.map(esc).join(delim), ...rows.map((r) => headers.map((h) => esc(r[h])).join(delim))].join('\n');
}

// ── Schemas ────────────────────────────────────────────────────────────────

const ParseSchema = z.object({
    csv: z.string().max(5_000_000).describe('CSV content (max 5 MB)'),
    delimiter: z.string().max(1).optional().default(',').describe('Column delimiter'),
});

const FilterSchema = z.object({
    csv: z.string().max(5_000_000).describe('CSV content (max 5 MB)'),
    column: z.string().describe('Column name to filter on'),
    operator: z.enum(['eq', 'ne', 'gt', 'lt', 'gte', 'lte', 'contains', 'startsWith', 'endsWith']).describe('Comparison operator'),
    value: z.string().describe('Value to compare against'),
    delimiter: z.string().max(1).optional().default(','),
});

const SelectSchema = z.object({
    csv: z.string().max(5_000_000).describe('CSV content (max 5 MB)'),
    columns: z.array(z.string()).min(1).describe('Column names to keep'),
    delimiter: z.string().max(1).optional().default(','),
});

const SortSchema = z.object({
    csv: z.string().max(5_000_000).describe('CSV content (max 5 MB)'),
    column: z.string().describe('Column to sort by'),
    order: z.enum(['asc', 'desc']).optional().default('asc'),
    delimiter: z.string().max(1).optional().default(','),
});

const AggSchema = z.object({
    csv: z.string().max(5_000_000).describe('CSV content (max 5 MB)'),
    column: z.string().describe('Numeric column name'),
    operation: z.enum(['sum', 'avg', 'min', 'max', 'count']).describe('Aggregation function'),
    delimiter: z.string().max(1).optional().default(','),
});

const ToJsonSchema = z.object({
    csv: z.string().max(5_000_000).describe('CSV content (max 5 MB)'),
    delimiter: z.string().max(1).optional().default(','),
});

// ── Tools ──────────────────────────────────────────────────────────────────

export class CsvParseTool extends BaseTool<typeof ParseSchema, { rows: Array<Record<string, string>>; rowCount: number; columns: string[] }> {
    constructor() {
        super({ id: 'csv_parse', name: 'CSV Parse', description: 'Parse a CSV string into a structured array of row objects.', category: ToolCategory.UTILITY, parameters: ParseSchema });
    }
    protected async performExecute(input: z.infer<typeof ParseSchema>, _ctx: ToolContext) {
        const rows = parseCsv(input.csv, input.delimiter ?? ',');
        return { rows, rowCount: rows.length, columns: rows.length > 0 ? Object.keys(

            rows[0]!) : [] };
    }
}

export class CsvFilterTool extends BaseTool<typeof FilterSchema, { rows: Array<Record<string, string>>; rowCount: number }> {
    constructor() {
        super({ id: 'csv_filter', name: 'CSV Filter', description: 'Filter rows in a CSV by a column condition.', category: ToolCategory.UTILITY, parameters: FilterSchema });
    }
    protected async performExecute(input: z.infer<typeof FilterSchema>, _ctx: ToolContext) {
        const rows = parseCsv(input.csv, input.delimiter ?? ',');
        const filtered = rows.filter((row) => {
            const cell = row[input.column] ?? '';
            const val = input.value;
            const n = parseFloat(cell);
            const nv = parseFloat(val);
            switch (input.operator) {
                case 'eq': return cell === val;
                case 'ne': return cell !== val;
                case 'gt': return !isNaN(n) && !isNaN(nv) ? n > nv : cell > val;
                case 'lt': return !isNaN(n) && !isNaN(nv) ? n < nv : cell < val;
                case 'gte': return !isNaN(n) && !isNaN(nv) ? n >= nv : cell >= val;
                case 'lte': return !isNaN(n) && !isNaN(nv) ? n <= nv : cell <= val;
                case 'contains': return cell.includes(val);
                case 'startsWith': return cell.startsWith(val);
                case 'endsWith': return cell.endsWith(val);
                default: return true;
            }
        });
        return { rows: filtered, rowCount: filtered.length };
    }
}

export class CsvSelectColumnsTool extends BaseTool<typeof SelectSchema, { csv: string; rowCount: number }> {
    constructor() {
        super({ id: 'csv_select_columns', name: 'CSV Select Columns', description: 'Select a subset of columns from a CSV.', category: ToolCategory.UTILITY, parameters: SelectSchema });
    }
    protected async performExecute(input: z.infer<typeof SelectSchema>, _ctx: ToolContext) {
        const rows = parseCsv(input.csv, input.delimiter ?? ',');
        const projected = rows.map((row) => Object.fromEntries(input.columns.map((c) => [c, row[c] ?? ''])));
        return { csv: toCsv(projected, input.delimiter ?? ','), rowCount: projected.length };
    }
}

export class CsvSortTool extends BaseTool<typeof SortSchema, { csv: string; rowCount: number }> {
    constructor() {
        super({ id: 'csv_sort', name: 'CSV Sort', description: 'Sort CSV rows by a column value.', category: ToolCategory.UTILITY, parameters: SortSchema });
    }
    protected async performExecute(input: z.infer<typeof SortSchema>, _ctx: ToolContext) {
        const rows = parseCsv(input.csv, input.delimiter ?? ',');
        rows.sort((a, b) => {
            const av = a[input.column] ?? '';
            const bv = b[input.column] ?? '';
            const an = parseFloat(av);
            const bn = parseFloat(bv);
            const cmp = !isNaN(an) && !isNaN(bn) ? an - bn : av.localeCompare(bv);
            return (input.order ?? 'asc') === 'asc' ? cmp : -cmp;
        });
        return { csv: toCsv(rows, input.delimiter ?? ','), rowCount: rows.length };
    }
}

export class CsvAggregateTool extends BaseTool<typeof AggSchema, { result: number; column: string; operation: string; rowCount: number }> {
    constructor() {
        super({ id: 'csv_aggregate', name: 'CSV Aggregate', description: 'Compute aggregate statistics on a numeric CSV column (sum, avg, min, max, count).', category: ToolCategory.UTILITY, parameters: AggSchema });
    }
    protected async performExecute(input: z.infer<typeof AggSchema>, _ctx: ToolContext) {
        const rows = parseCsv(input.csv, input.delimiter ?? ',');
        const nums = rows.map((r) => parseFloat(r[input.column] ?? '')).filter((n) => !isNaN(n));
        let result: number;
        switch (input.operation) {
            case 'sum': result = nums.reduce((s, n) => s + n, 0); break;
            case 'avg': result = nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0; break;
            case 'min': result = nums.length ? Math.min(...nums) : 0; break;
            case 'max': result = nums.length ? Math.max(...nums) : 0; break;
            case 'count': result = nums.length; break;
            default: result = 0;
        }
        return { result, column: input.column, operation: input.operation, rowCount: rows.length };
    }
}

export class CsvToJsonTool extends BaseTool<typeof ToJsonSchema, { json: string; rowCount: number }> {
    constructor() {
        super({ id: 'csv_to_json', name: 'CSV to JSON', description: 'Convert CSV content to a JSON array string.', category: ToolCategory.UTILITY, parameters: ToJsonSchema });
    }
    protected async performExecute(input: z.infer<typeof ToJsonSchema>, _ctx: ToolContext) {
        const rows = parseCsv(input.csv, input.delimiter ?? ',');
        return { json: JSON.stringify(rows, null, 2), rowCount: rows.length };
    }
}

// ── Toolkit ────────────────────────────────────────────────────────────────

export class CsvToolkit {
    readonly tools: BaseTool[];
    constructor() {
        this.tools = [
            new CsvParseTool(),
            new CsvFilterTool(),
            new CsvSelectColumnsTool(),
            new CsvSortTool(),
            new CsvAggregateTool(),
            new CsvToJsonTool(),
        ];
    }
}
