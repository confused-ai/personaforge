/**
 * Plugin Registry — Global system for cross-cutting concerns.
 *
 * Register plugins once; they apply to all agents, tools, and workflows.
 *
 * @example
 * ```ts
 * import { createPluginRegistry, createLoggingPlugin, createRateLimitPlugin } from 'personaforge/plugins';
 *
 * const plugins = createPluginRegistry();
 * plugins.register(createLoggingPlugin());
 * plugins.register(createRateLimitPlugin({ maxRpm: 60 }));
 * ```
 */

import type {
    Plugin,
    PluginContext,
    AgentInput,
    AgentOutput,
    ToolMiddleware,
    ToolMiddlewareObject,
    Logger,
} from '../contracts/index.js';

// ── Plugin Registry ────────────────────────────────────────────────────────

export interface PluginRegistry {
    /** Register a plugin. */
    register(plugin: Plugin): void;
    /** Unregister a plugin by ID. */
    unregister(pluginId: string): boolean;
    /** Get a registered plugin by ID. */
    get(pluginId: string): Plugin | undefined;
    /** List all registered plugins. */
    list(): Plugin[];
    /** Run all beforeRun hooks in order. */
    runBeforeHooks(input: AgentInput, context: PluginContext): Promise<AgentInput>;
    /** Run all afterRun hooks in order. */
    runAfterHooks(output: AgentOutput, context: PluginContext): Promise<AgentOutput>;
    /** Get combined tool middleware from all plugins. */
    getToolMiddleware(): (ToolMiddleware | ToolMiddlewareObject)[];
    /** Run all onError hooks. */
    runErrorHooks(error: Error, context: PluginContext): Promise<void>;
}

/** Create a plugin registry instance. */
export function createPluginRegistry(): PluginRegistry {
    return new PluginRegistryImpl();
}

class PluginRegistryImpl implements PluginRegistry {
    private plugins: Map<string, Plugin> = new Map();

    register(plugin: Plugin): void {
        if (this.plugins.has(plugin.id)) {
            throw new Error(`Plugin '${plugin.id}' is already registered`);
        }
        this.plugins.set(plugin.id, plugin);
    }

    unregister(pluginId: string): boolean {
        return this.plugins.delete(pluginId);
    }

    get(pluginId: string): Plugin | undefined {
        return this.plugins.get(pluginId);
    }

    list(): Plugin[] {
        return [...this.plugins.values()];
    }

    async runBeforeHooks(input: AgentInput, context: PluginContext): Promise<AgentInput> {
        let current = input;
        for (const plugin of this.plugins.values()) {
            if (plugin.beforeRun) {
                current = await plugin.beforeRun(current, context);
            }
        }
        return current;
    }

    async runAfterHooks(output: AgentOutput, context: PluginContext): Promise<AgentOutput> {
        let current = output;
        for (const plugin of this.plugins.values()) {
            if (plugin.afterRun) {
                current = await plugin.afterRun(current, context);
            }
        }
        return current;
    }

    getToolMiddleware(): (ToolMiddleware | ToolMiddlewareObject)[] {
        const middleware: (ToolMiddleware | ToolMiddlewareObject)[] = [];
        for (const plugin of this.plugins.values()) {
            if (plugin.toolMiddleware) {
                middleware.push(plugin.toolMiddleware);
            }
        }
        return middleware;
    }

    async runErrorHooks(error: Error, context: PluginContext): Promise<void> {
        for (const plugin of this.plugins.values()) {
            if (plugin.onError) {
                try {
                    await plugin.onError(error, context);
                } catch {
                    // Plugin error hooks must not throw
                }
            }
        }
    }
}

// ── Built-in Plugins ───────────────────────────────────────────────────────

/** Create a logging plugin that logs all agent runs and tool calls. */
export function createLoggingPlugin(logger?: Logger): Plugin {
    const log = logger ?? {
        debug: (msg: string, ctx?: Record<string, unknown>) => console.debug(`[plugin:logging] ${msg}`, ctx ?? {}),
        info: (msg: string, ctx?: Record<string, unknown>) => console.info(`[plugin:logging] ${msg}`, ctx ?? {}),
        warn: (msg: string, ctx?: Record<string, unknown>) => console.warn(`[plugin:logging] ${msg}`, ctx ?? {}),
        error: (msg: string, ctx?: Record<string, unknown>) => console.error(`[plugin:logging] ${msg}`, ctx ?? {}),
    };

    return {
        id: 'builtin:logging',
        name: 'Logging Plugin',
        version: '1.0.0',

        beforeRun(input, context) {
            log.info('agent.run.start', { agentId: context.agentId, prompt: input.prompt.slice(0, 100) });
            return input;
        },

        afterRun(output, context) {
            log.info('agent.run.complete', {
                agentId: context.agentId,
                state: output.state,
                durationMs: output.metadata.durationMs,
                tokensUsed: output.metadata.tokensUsed,
            });
            return output;
        },

        toolMiddleware: {
            beforeExecute(tool, params) {
                log.debug('tool.call.start', { tool: tool.name, params });
            },
            afterExecute(tool, result, ctx) {
                log.debug('tool.call.complete', {
                    tool: tool.name,
                    success: result.success,
                    executionTimeMs: result.executionTimeMs,
                    agentId: ctx.agentId,
                });
            },
            onError(tool, error, ctx) {
                log.error('tool.call.error', { tool: tool.name, error: error.message, agentId: ctx.agentId });
            },
        },

        onError(error, context) {
            log.error('agent.error', { agentId: context.agentId, error: error.message });
        },
    };
}

/** Rate limit plugin configuration. */
export interface RateLimitPluginConfig {
    /** Max requests per minute per agent. Default: 60. */
    readonly maxRpm?: number;
    /** Max requests per hour per agent. Default: 1000. */
    readonly maxRph?: number;
}

/** Create a rate limit plugin that enforces per-agent rate limits. */
export function createRateLimitPlugin(config: RateLimitPluginConfig = {}): Plugin {
    const maxRpm = config.maxRpm ?? 60;
    const windowMs = 60_000;
    const timestamps: Map<string, number[]> = new Map();

    return {
        id: 'builtin:rate-limit',
        name: 'Rate Limit Plugin',
        version: '1.0.0',

        beforeRun(input, context) {
            const key = context.agentId ?? 'global';
            const now = Date.now();
            const window = timestamps.get(key) ?? [];
            const recent = window.filter(t => now - t < windowMs);

            if (recent.length >= maxRpm) {
                throw new Error(`Rate limit exceeded for agent '${key}': ${maxRpm} requests/minute`);
            }

            recent.push(now);
            timestamps.set(key, recent);
            return input;
        },
    };
}

/** Create a telemetry plugin that tracks metrics. */
export function createTelemetryPlugin(metrics: import('../contracts/index.js').MetricsCollector): Plugin {
    return {
        id: 'builtin:telemetry',
        name: 'Telemetry Plugin',
        version: '1.0.0',

        beforeRun(_input, context) {
            metrics.counter('agent.runs.total', 1, { agent_id: context.agentId ?? 'unknown' });
            return _input;
        },

        afterRun(output, context) {
            if (output.metadata.durationMs) {
                metrics.histogram('agent.run.duration_ms', output.metadata.durationMs, { agent_id: context.agentId ?? 'unknown' });
            }
            if (output.metadata.tokensUsed) {
                metrics.counter('agent.tokens.total', output.metadata.tokensUsed, { agent_id: context.agentId ?? 'unknown' });
            }
            return output;
        },

        toolMiddleware: {
            afterExecute(tool, result) {
                metrics.histogram('tool.execution.duration_ms', result.executionTimeMs, { tool: tool.name });
                metrics.counter('tool.execution.total', 1, { tool: tool.name, success: String(result.success) });
            },
        },
    };
}

// Re-export contract types for convenience
export type { Plugin, PluginContext } from '../contracts/index.js';

// Hooks ↔ Plugin bridge and interception order documentation
export { hooksToPlugin, INTERCEPTION_ORDER, type HooksPluginAdapter } from './hooks-adapter.js';
