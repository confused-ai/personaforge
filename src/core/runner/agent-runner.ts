/**
 * @personaforge/core — ReAct-style agentic runner facade.
 *
 * Delegates to AgenticRunner: a single production-grade engine powers both
 * core/runner and agentic/runner across the framework, so the two never
 * diverge in loop semantics, retry, or tool-dispatch behaviour.
 */

import type { AgentRunResult } from '../types.js';
import type {
    RunnerConfig,
    RunnerRunConfig,
    RunnerStreamHooks,
    LoadShedDecision,
} from './types.js';
import { AgenticRunner } from '../../agentic/runner.js';
import type { AgenticRunnerConfig } from '../../agentic/types.js';
import type { Tool as AgenticTool, ToolRegistry as AgenticToolRegistry } from '../../agentic/_tool-types.js';
import { LoadShedError } from '../errors.js';

/**
 * Adapt a contracts-level `ToolRegistry` (no `getByName`) to the agentic
 * runner's registry surface. Only `getByName`/`list` are used by the loop; core
 * tools are structurally compatible with the agentic executor at runtime
 * (`execute(input, ctx)`), so this is a thin name-indexing wrapper.
 */
function adaptToolRegistry(registry: RunnerConfig['tools']): AgenticToolRegistry {
    const byName = new Map<string, AgenticTool>();
    for (const t of registry.list()) byName.set(t.name, t as unknown as AgenticTool);
    return {
        getByName: (name: string) => byName.get(name),
        list: () => Array.from(byName.values()),
        has: (id) => byName.has(id as string),
        get: (id) => byName.get(id as string),
        register: () => undefined,
        unregister: () => false,
        listByCategory: () => [],
        search: () => [],
        clear: () => { byName.clear(); },
    };
}

export class AgentRunner {
    private readonly runner: AgenticRunner;

    constructor(private readonly config: RunnerConfig) {
        this.runner = new AgenticRunner({
            name: config.name,
            instructions: config.instructions,
            llm: config.llm,
            tools: adaptToolRegistry(config.tools),
            maxSteps: config.maxSteps,
            timeoutMs: config.timeoutMs,
            retry: config.retry,
            // Core hooks and agentic hooks share the same method shapes; the
            // result-type parametrisation differs (AgentRunResult vs
            // AgenticRunResult), so bridge with an interface cast.
            hooks: config.hooks as unknown as NonNullable<AgenticRunnerConfig['hooks']>,
            guardrails: config.guardrails,
            recorder: config.recorder,
            budgetModelId: config.model,
            loopDetection: config.loopDetection,
            onSoftFailure: config.onSoftFailure,
            validateToolArgs: config.validateToolArgs,
            toolConcurrency: config.toolConcurrency,
            admissionControl: config.admissionControl,
            responseCache: config.responseCache,
        });
    }

    /** Admission-control probe — exposes the underlying decision to gateways. */
    async getLoadShedDecision(): Promise<LoadShedDecision> {
        if (!this.config.admissionControl) return { admit: true };
        return this.config.admissionControl();
    }

    /** Public entry point. Delegated to the canonical AgenticRunner loop. */
    async run(runConfig: RunnerRunConfig, streamHooks?: RunnerStreamHooks): Promise<AgentRunResult> {
        const decision = await this.getLoadShedDecision();
        if (!decision.admit) {
            throw new LoadShedError(decision.reason ?? 'Run rejected by admission control', {
                retryAfterMs: decision.retryAfterMs,
                context: { agent: this.config.name },
            });
        }
        // AgenticRunner wraps the loop in its own span; no nested span here.
        const result = await this.runner.run(
            {
                instructions: runConfig.instructions ?? this.config.instructions,
                prompt: runConfig.prompt,
                messages: runConfig.messages,
                maxSteps: runConfig.maxSteps ?? this.config.maxSteps,
                timeoutMs: runConfig.timeoutMs ?? this.config.timeoutMs,
                runId: runConfig.runId,
                userId: runConfig.userId,
                ragContext: runConfig.ragContext,
                traceId: runConfig.traceId,
                signal: runConfig.signal,
            },
            streamHooks,
        );
        return result as AgentRunResult;
    }
}
