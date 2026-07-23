/**
 * @personaforge/agentic — ReAct-style agentic loop with tool dispatch, guardrails, and HITL
 */

export * from './types.js';
export { AgenticRunner } from './runner.js';
export type { Tool, ToolResult, ToolRegistry, ToolMiddleware, ToolContext, ToolPermissions, ToolProvider } from './_tool-types.js';
export { ToolCategory, toToolRegistry } from './_tool-types.js';
export type { GuardrailEngine, HumanInTheLoopHooks, GuardrailContext, GuardrailViolation, GuardrailResult } from './_guardrail-types.js';
export { createStructuredAgent, StructuredOutputError } from './structured-agent.js';
export type { StructuredAgentResult, StructuredAgentConfig } from './structured-agent.js';

import type { LLMProvider } from '../core/index.js';
import type { Message } from '../core/index.js';
import type { ToolMiddleware, ToolProvider } from './_tool-types.js';
import { toToolRegistry } from './_tool-types.js';
import type { AgenticRunConfig, AgenticRunResult, AgenticStreamHooks, AgenticLifecycleHooks, AgenticRetryPolicy } from './types.js';
import type { HumanInTheLoopHooks, GuardrailEngine } from './_guardrail-types.js';
import { AgenticRunner } from './runner.js';

/**
 * Create a production-style agentic agent (ReAct loop with LLM + tools).
 */
export function createAgenticAgent(config: {
    name: string;
    instructions: string;
    llm: LLMProvider;
    tools: ToolProvider;
    maxSteps?: number;
    timeoutMs?: number;
    retry?: AgenticRetryPolicy;
    humanInTheLoop?: HumanInTheLoopHooks;
    guardrails?: GuardrailEngine;
    toolMiddleware?: ToolMiddleware[];
    hooks?: AgenticLifecycleHooks;
    checkpointStore?: import('../production/index.js').AgentCheckpointStore;
    budgetEnforcer?: import('../production/index.js').BudgetEnforcer;
    budgetModelId?: string;
    knowledgebase?: import('../knowledge/index.js').RAGEngine;
    temperature?: number;
    maxTokens?: number;
    /** Per-step auto context-compression config — wired from Mastermind defaults */
    compression?: {
        enabled: boolean;
        toolResultsLimit?: number;
        messageSizeThreshold?: number;
    };
    /** Optional durable event recorder — append-only, replayable run log. */
    recorder?: import('../core/runner/types.js').EventRecorder;
}): {
    name: string;
    instructions: string;
    run(
        runConfig: {
            prompt: string;
            instructions?: string;
            messages?: Message[];
            maxSteps?: number;
            timeoutMs?: number;
            runId?: string;
            traceId?: string;
            userId?: string;
            signal?: AgenticRunConfig['signal'];
            responseModel?: AgenticRunConfig['responseModel'];
            ragContext?: string;
            hooks?: AgenticLifecycleHooks;
            allowedTools?: string[];
        },
        hooks?: AgenticStreamHooks,
    ): Promise<AgenticRunResult>;
} {
    const toolRegistry = toToolRegistry(config.tools);

    const runner = new AgenticRunner({
        llm: config.llm,
        tools: toolRegistry,
        maxSteps: config.maxSteps ?? 10,
        timeoutMs: config.timeoutMs ?? 60_000,
        retry: config.retry,
        toolMiddleware: config.toolMiddleware,
        hooks: config.hooks,
        checkpointStore: config.checkpointStore,
        budgetEnforcer: config.budgetEnforcer,
        budgetModelId: config.budgetModelId,
        knowledgebase: config.knowledgebase,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        compression: config.compression,
        recorder: config.recorder,
    });

    if (config.humanInTheLoop) runner.setHumanInTheLoop(config.humanInTheLoop);
    if (config.guardrails) runner.setGuardrails(config.guardrails);

    return {
        name: config.name,
        instructions: config.instructions,
        async run(runConfig, hooks) {
            const instructions = runConfig.instructions ?? config.instructions;
            const cfg: AgenticRunConfig = {
                instructions,
                prompt: runConfig.prompt,
                messages: runConfig.messages,
                maxSteps: runConfig.maxSteps,
                timeoutMs: runConfig.timeoutMs,
                ragContext: runConfig.ragContext,
                signal: runConfig.signal,
                responseModel: runConfig.responseModel,
                hooks: runConfig.hooks,
                allowedTools: runConfig.allowedTools,
                ...(runConfig.runId && { runId: runConfig.runId }),
                ...(runConfig.traceId && { traceId: runConfig.traceId }),
                ...(runConfig.userId && { userId: runConfig.userId }),
            };
            return runner.run(cfg, hooks);
        },
    };
}
