/**
 * Runner resilience primitives shared across agent loops.
 *
 * These are pure, dependency-free helpers extracted so every runner enforces
 * identical loop-detection and argument-validation semantics instead of
 * maintaining divergent copies.
 */

/**
 * Repeated-state detector — flags when the agent's *action* (assistant text +
 * tool-call names/args) repeats, indicating a loop or oscillation instead of
 * progress. Compares the trailing `window` signatures against the immediately
 * preceding `window`; when that pair matches `threshold` times, the agent is
 * deemed stuck. Pure — carries rolling state in a closure, O(1) memory.
 */
export function createRepeatDetector(config: { threshold: number; window: number }): (signature: string) => boolean {
    const window    = Math.max(1, config.window);
    const threshold = Math.max(2, config.threshold);
    let seq: string[] = [];
    let repeats = 0;
    return (signature: string): boolean => {
        seq.push(signature);
        if (seq.length < window * 2) return false;
        const current  = seq.slice(seq.length - window);
        const previous = seq.slice(seq.length - window * 2, seq.length - window);
        const equal = current.every((s, i) => s === previous[i]);
        // Bound the buffer so long runs stay O(1) memory regardless of step count.
        if (seq.length > window * 4) seq = seq.slice(seq.length - window * 2);
        if (equal) {
            repeats += 1;
            return repeats >= threshold - 1;
        }
        repeats = 0;
        return false;
    };
}

/** True for a non-null, non-array object. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Lightweight pre-flight validation of a tool call's arguments before execution.
 * Returns a precise, self-correctable error string when the model emitted
 * malformed (`non-object`) arguments or omitted a field marked `required` in the
 * tool's JSON-Schema `parameters`; returns `null` when arguments look well-formed.
 *
 * Deliberately metadata-only (no runtime schema engine) so it adds zero deps and
 * O(1) overhead, while catching the two most common failure modes that would
 * otherwise surface as opaque tool-level exceptions.
 */
export function validateToolArgs(args: unknown, parameters: Record<string, unknown> | undefined): string | null {
    if (!isPlainObject(args)) {
        return `expected an object of arguments, received ${args === null ? 'null' : typeof args}`;
    }
    if (!isPlainObject(parameters)) return null;
    const required = parameters.required;
    if (!Array.isArray(required) || required.length === 0) return null;
    const missing: string[] = [];
    for (const key of required) {
        if (typeof key === 'string' && args[key] === undefined) missing.push(key);
    }
    if (missing.length === 0) return null;
    return `missing required argument${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`;
}
