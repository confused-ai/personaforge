/**
 * Dev-mode logger: tool calls, steps, and agent lifecycle for best DX.
 */

import type { Logger } from '../observability/types.js';

const P = '[PersonaForge]';

function formatMeta(meta?: Record<string, unknown>): string {
    if (!meta || Object.keys(meta).length === 0) return '';
    return ' ' + JSON.stringify(meta);
}

/**
 * Logger that prints tool calls, steps, and debug info in development.
 * Use with createAgent({ dev: true }) or defineAgent().dev().build().
 */
export function createDevLogger(): Logger {
    return {
        debug(message: string, _context?: Partial<Record<string, unknown>>, metadata?: Record<string, unknown>) {
            console.debug(`${P} ${message}${formatMeta(metadata)}`);
        },
        info(message: string, _context?: Partial<Record<string, unknown>>, metadata?: Record<string, unknown>) {
            console.info(`${P} ${message}${formatMeta(metadata)}`);
        },
        warn(message: string, _context?: Partial<Record<string, unknown>>, metadata?: Record<string, unknown>) {
            console.warn(`${P} ${message}${formatMeta(metadata)}`);
        },
        error(message: string, _context?: Partial<Record<string, unknown>>, metadata?: Record<string, unknown>) {
            console.error(`${P} ${message}${formatMeta(metadata)}`);
        },
        fatal(message: string, _context?: Partial<Record<string, unknown>>, metadata?: Record<string, unknown>) {
            console.error(`${P} [FATAL] ${message}${formatMeta(metadata)}`);
        },
        child(_additionalContext: Partial<Record<string, unknown>>) {
            return createDevLogger();
        },
    };
}

/**
 * Create tool middleware that logs every tool call/result in dev (best DX).
 */
export function createDevToolMiddleware(): import('../tools/index.js').ToolMiddleware {
    return {
        beforeExecute(tool, params) {
            console.debug(`${P} 🔧 tool.call ${tool.name}`, params);
        },
        afterExecute(tool, result, _ctx) {
            const preview = result.success ? JSON.stringify(result.data).slice(0, 80) : result.error?.message ?? 'error';
            console.debug(`${P} 🔧 tool.done ${tool.name} (${result.executionTimeMs}ms)`, preview);
        },
        onError(tool, err, _ctx) {
            console.debug(`${P} 🔧 tool.error ${tool.name}`, err.message);
        },
    };
}
