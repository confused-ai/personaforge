/**
 * Shared guards for database-backed tools.
 *
 * Agent tools take `input` from the model, so any string interpolated into
 * SQL/Cypher is prompt-injection reachable. Identifiers (tables, columns,
 * labels, property keys) can never be bound parameters — validate them
 * against a strict pattern instead. Values always go through parameters.
 */

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Throw unless `name` is a safe bare identifier (table/column/label/key). */
export function assertIdentifier(name: string, what = 'identifier'): string {
    if (!IDENT.test(name)) {
        throw new Error(`Invalid ${what}: ${JSON.stringify(name)}. Must match /^[A-Za-z_][A-Za-z0-9_]*$/.`);
    }
    return name;
}

/** Quote an already-validated identifier for SQL. */
export function quoteIdent(name: string): string {
    return `"${assertIdentifier(name)}"`;
}

const READ_ONLY = /^(SELECT|WITH|EXPLAIN)\b/i;

/**
 * Throw unless `query` is a single read-only SELECT/WITH/EXPLAIN statement.
 * Strips `--`/`/* *\/` comments first so `-- DELETE` smuggling fails closed.
 */
export function assertSelectOnly(query: string): string {
    const noComments = query
        .replace(/--[^\n]*/g, ' ')
        .replace(/\/\*[\s\S]*?\*\//g, ' ');
    const statements = noComments.split(';').map((s) => s.trim()).filter(Boolean);
    if (statements.length !== 1 || !READ_ONLY.test(statements[0]!)) {
        throw new Error('Only a single read-only SELECT/WITH/EXPLAIN query is allowed.');
    }
    return query;
}
