/**
 * Agentic runner: ReAct-style loop (reason → tool call → observe → repeat)
 *
 * Architecture:
 * - `run()` is the coordinator — delegates to focused private methods (SRP)
 * - `_buildSystemPrompt()` — builds the effective system prompt
 * - `_buildInitialMessages()` — constructs the initial message array
 * - `_restoreCheckpoint()` — resumes a durable run from checkpoint
 * - `_invokeLlm()` — single LLM call with retry + distributed tracing
 * - `_executeAllTools()` — dispatches all tool calls for a step in parallel
 * - `_executeOneTool()` — single tool execution with guardrails + middleware
 *
 * Key invariants:
 * - Per-run lifecycle hooks arrive via `runConfig.hooks` and are merged locally — no
 *   shared config mutation. Concurrent `run()` calls on the same agent are fully isolated.
 * - Tool calls within a step are executed in parallel (Promise.all). Results are collected
 *   in the original call order so the LLM sees a deterministic message history.
 */

import type { Message, ToolCall as LLMToolCall, LLMToolDefinition, GenerateResult, LLMProvider } from '../core/index.js';
import { newId } from '../contracts/index.js';
import type { Tool, ToolResult, ToolContext } from './_tool-types.js';
import type {
    AgenticRunConfig,
    AgenticRunResult,
    AgenticRunnerConfig,
    AgenticStreamHooks,
    AgenticRetryPolicy,
    AgenticLifecycleHooks,
    StructuredOutputConfig,
    GoalRunConfig,
} from './types.js';

import type { HumanInTheLoopHooks, GuardrailContext } from './_guardrail-types.js';
import type { GuardrailEngine } from './_guardrail-types.js';
import type { Span } from '@opentelemetry/api';
import { LLMError, ToolNotAuthorizedError } from '../shared/index.js';
import { isTransientLLMError } from '../guard/index.js';
import { toolToLLMDef } from './_zod-to-schema.js';
import { validateStructuredOutput, buildStructuredOutputPrompt, extractJson } from './_structured-output.js';
import { withRetry as guardWithRetry, runToolWithTimeout, createDeadline } from '../guard/index.js';
import type { RetryPolicy } from '../guard/index.js';
import { withSpan, Metrics, genAiAttributes, recordLlmUsage } from '../observe/index.js';
import { ReasoningManager, TreeOfThoughtEngine } from '../reasoning/index.js';
import { CompressionManager } from '../compression/index.js';
import {
    resolveProcessorSet,
    createProcessorState,
    runInputProcessors,
    runInputStepProcessors,
    runLLMRequestProcessors,
    runLLMResponseProcessors,
    runOutputStepProcessors,
    runOutputResultProcessors,
    filterOutputStreamPart,
    runAPIErrorProcessors,
} from '../processors/pipeline.js';
import { TripWireError, type ProcessorContext, type Processor } from '../processors/types.js';
import { ApprovalRequiredError, ToolSuspendedError, isApprovalRequiredError, isToolSuspendedError } from '../approval/signals.js';
import { createLlmProviderFromModelString } from '../providers/from-model.js';
import type { GoalEvaluation } from '../goals/store.js';
import { goalJudgeFromModelString } from '../goals/judge.js';
import { StructuredOutputError } from './structured-agent.js';

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_STEPS = 20;
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 1_000;
const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
const DEFAULT_STRUCTURED_RETRIES = 3;

// ── Internal types ────────────────────────────────────────────────────────────

/** Immutable context shared across all helper methods within a single run. */
interface RunContext {
    readonly agentId: string;
    readonly sessionId: string;
    readonly lifecycle: AgenticLifecycleHooks;
    readonly streamHooks: AgenticStreamHooks | undefined;
    readonly toolTimeoutMs: number;
    readonly retry: AgenticRetryPolicy;
    readonly step: number;
    /** Tool allowlist for this run (undefined = no restriction). */
    readonly allowedTools: string[] | undefined;
    /** Per-run abort signal (linked to run signal + deadline) forwarded to LLM + tools. */
    readonly signal: AbortSignal | undefined;
    /** Tool calls already approved (by toolCallId) for this run — skips approval gate. */
    readonly approvedToolCalls: string[];
    /** Resume data for a suspend()-suspended tool (matched by `resumeToolCallId`). */
    readonly resumeData?: unknown;
    /** toolCallId whose execute should receive `resumeData`. */
    readonly resumeToolCallId?: string;
    /** Run-level approval policy (boolean or per-call function). */
    readonly requireToolApproval?: AgenticRunConfig['requireToolApproval'];
}

/** Per-request processor pipeline context. */
interface ProcRun {
    readonly input: Processor[];
    readonly output: Processor[];
    readonly error: Processor[];
    readonly state: Record<string, unknown>;
    readonly context: ProcessorContext;
    /** How many processor-driven retries have been performed this request. */
    retryCount: number;
}

// ── Pure utility functions ────────────────────────────────────────────────────

/** Translate AgenticRetryPolicy → guard RetryPolicy (adds jitter). */
function toGuardRetryPolicy(policy: AgenticRetryPolicy): Partial<RetryPolicy> {
    return {
        maxAttempts: (policy.maxRetries ?? DEFAULT_RETRIES) + 1,
        initialDelayMs: policy.backoffMs ?? DEFAULT_BACKOFF_MS,
        maxDelayMs: policy.maxBackoffMs ?? 30_000,
        multiplier: 2,
        jitter: true,
        // Retry only transient failures (429/5xx/network). Never retry 4xx
        // client/validation errors — they will fail identically on replay.
        retryOn: isTransientLLMError,
    };
}

/**
 * Merges two lifecycle hook objects. `base` runs first; `override` runs after.
 * Returns `undefined` when both are absent.
 */
function mergeLifecycleHooks(
    base?: AgenticLifecycleHooks,
    override?: AgenticLifecycleHooks,
): AgenticLifecycleHooks | undefined {
    if (!base && !override) return undefined;
    if (!base) return override;
    if (!override) return base;

    return {
        beforeRun: async (prompt, config) => {
            const p = base.beforeRun ? await base.beforeRun(prompt, config) : prompt;
            return override.beforeRun ? override.beforeRun(p, config) : p;
        },
        afterRun: async (result) => {
            const r = base.afterRun ? await base.afterRun(result) : result;
            return override.afterRun ? override.afterRun(r) : r;
        },
        beforeStep: async (step, messages) => {
            const m = base.beforeStep ? await base.beforeStep(step, messages) : messages;
            return override.beforeStep ? override.beforeStep(step, m) : m;
        },
        afterStep: async (step, messages, text) => {
            if (base.afterStep) await base.afterStep(step, messages, text);
            if (override.afterStep) await override.afterStep(step, messages, text);
        },
        beforeToolCall: async (name, args, step) => {
            const a = base.beforeToolCall ? await base.beforeToolCall(name, args, step) : args;
            return override.beforeToolCall ? override.beforeToolCall(name, a, step) : a;
        },
        afterToolCall: async (name, result, args, step) => {
            const r = base.afterToolCall ? await base.afterToolCall(name, result, args, step) : result;
            return override.afterToolCall ? override.afterToolCall(name, r, args, step) : r;
        },
        buildSystemPrompt: base.buildSystemPrompt ?? override.buildSystemPrompt,
        onError: async (err, step) => {
            if (base.onError) await base.onError(err, step);
            if (override.onError) await override.onError(err, step);
        },
    };
}

// ── AgenticRunner ─────────────────────────────────────────────────────────────

/**
 * AgenticRunner implements a ReAct-style reasoning loop:
 *   LLM generates → tool calls dispatched in parallel → results fed back → repeat
 *
 * Concurrent runs are fully isolated — no shared mutable state between calls.
 */
export class AgenticRunner {
    private readonly config: AgenticRunnerConfig;
    private humanInTheLoop?: HumanInTheLoopHooks;
    private guardrails?: GuardrailEngine;
    /** Zod → JSON Schema computed once at construction; tools are immutable after creation. */
    private readonly _cachedLlmTools: LLMToolDefinition[];
    /** Optional reasoning manager (CoT) — created lazily when strategy is 'cot' or 'react'. */
    private _reasoningManager?: ReasoningManager;
    /** Optional ToT engine — created lazily when strategy is 'tot'. */
    private _totEngine?: TreeOfThoughtEngine;
    /** Optional compression manager — created lazily when compression is enabled. */
    private _compressionManager?: CompressionManager;
    private readonly _inputProcessors: Processor[];
    private readonly _outputProcessors: Processor[];
    private readonly _errorProcessors: Processor[];
    private readonly _maxProcessorRetries: number;

    constructor(config: AgenticRunnerConfig) {
        this.config = { ...config, toolMiddleware: config.toolMiddleware ?? [] };
        this._cachedLlmTools = config.tools.list().map((t) => toolToLLMDef(t));
        if (config.guardrails) this.guardrails = config.guardrails;
        const sets = resolveProcessorSet(config.processors);
        this._inputProcessors = sets.input;
        this._outputProcessors = sets.output;
        this._errorProcessors = sets.error;
        this._maxProcessorRetries =
            config.maxProcessorRetries ??
            (sets.error.length > 0 || sets.output.length > 0 ? 10 : 0);
    }

    setHumanInTheLoop(hooks: HumanInTheLoopHooks): void {
        this.humanInTheLoop = hooks;
    }

    setGuardrails(engine: GuardrailEngine): void {
        this.guardrails = engine;
    }

    /**
     * Execute the agentic loop.
     *
     * Per-run lifecycle hooks in `runConfig.hooks` are merged with the agent-level hooks at
     * call time. No shared state is mutated, so concurrent invocations are fully isolated.
     */
    async run(runConfig: AgenticRunConfig, streamHooks?: AgenticStreamHooks): Promise<AgenticRunResult> {
        const lifecycle = mergeLifecycleHooks(this.config.hooks, runConfig.hooks) ?? {};

        return withSpan(
            'agent.loop',
            {
                'agent.id': this.config.agentId ?? 'agent',
                'session.id': this.config.sessionId ?? 'unknown',
                'prompt.length': runConfig.prompt.length,
            },
            (span) => this._runCore(runConfig, streamHooks, lifecycle, span),
        );
    }

    // ── Private: core loop ────────────────────────────────────────────────────

    private async _runCore(
        runConfig: AgenticRunConfig,
        streamHooks: AgenticStreamHooks | undefined,
        lifecycle: AgenticLifecycleHooks,
        span: Span,
    ): Promise<AgenticRunResult> {
        const maxSteps  = runConfig.maxSteps  ?? this.config.maxSteps  ?? DEFAULT_MAX_STEPS;
        const timeoutMs = runConfig.timeoutMs ?? this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const retry     = this.config.retry   ?? { maxRetries: DEFAULT_RETRIES, backoffMs: DEFAULT_BACKOFF_MS };
        const agentId   = this.config.agentId  ?? 'agent';
        const sessionId = this.config.sessionId ?? newId('sess');

        const prompt = lifecycle.beforeRun
            ? await lifecycle.beforeRun(runConfig.prompt, runConfig)
            : runConfig.prompt;

        // ── Input guardrail check — runs BEFORE the LLM loop ─────────────────
        if (this.guardrails) {
            const inputCtx: GuardrailContext = { agentId, sessionId, output: prompt };
            const inputResults = await this.guardrails.checkAll(inputCtx);
            const inputViolations = this.guardrails.getViolations(inputResults);
            if (inputViolations.length > 0) {

                if (span.setStatus !== undefined) span.setStatus({ code: 2 /* ERROR */ });
                return this._blockedResult(prompt, agentId, sessionId, runConfig);
            }
        }

        // ── Auto-RAG: if knowledgebase is configured and no ragContext was supplied,
        //   query the knowledge engine to build context for this run.
        let effectiveRagContext = runConfig.ragContext;
        if (!effectiveRagContext && this.config.knowledgebase) {
            effectiveRagContext = await this.config.knowledgebase
                .buildContext(prompt, 5)
                .catch(() => undefined);
        }

        // Override ragContext with auto-fetched context if needed
        const effectiveRunConfig = effectiveRagContext !== runConfig.ragContext
            ? { ...runConfig, ragContext: effectiveRagContext }
            : runConfig;

        const systemPrompt = await this._buildSystemPrompt(effectiveRunConfig, lifecycle);
        let messages = this._buildInitialMessages(effectiveRunConfig, systemPrompt, prompt);

        const checkpointStore = this.config.checkpointStore;
        const runId = runConfig.runId;
        let steps = 0;
        if (checkpointStore && runId) {
            ({ messages, steps } = await this._restoreCheckpoint(checkpointStore, runId, messages, steps));
        }

        // ── Pre-run reasoning enrichment ──────────────────────────────────────
        // Only run on a fresh session (no checkpoint restore) to avoid double-enrichment.
        if (steps === 0 && this.config.reasoning?.enabled) {
            const enriched = await this._applyReasoning(prompt, systemPrompt);
            if (enriched) {
                // Inject as an extra assistant message so the LLM sees its own chain-of-thought
                messages = [
                    { role: 'system', content: systemPrompt },
                    { role: 'user',   content: prompt },
                    { role: 'assistant', content: `[Reasoning]\n${enriched}` },
                ];
            }
        }

        // Inline structured-output prompt — append the schema to the latest user turn.
        if (runConfig.structuredOutput?.jsonPromptInjection === 'inline') {
            const lastUser = [...messages].reverse().find((m) => m.role === 'user');
            if (lastUser && typeof lastUser.content === 'string') {
                const so = runConfig.structuredOutput;
                lastUser.content = `${lastUser.content}\n\n${buildStructuredOutputPrompt({
                    schema: so.schema,
                    description: so.description,
                    strict: true,
                    maxRetries: so.maxRetries,
                })}`;
            }
        }

        // ── Per-run AbortController: aborted on run-signal abort or deadline timeout.
        //   Forwarded into LLM SDK calls and tool execution so in-flight work cancels.
        const runAbort = new AbortController();
        const onExternalAbort = () => runAbort.abort();
        // Cast to a precise abort-like shape: the EventTarget method overloads on
        // AbortSignal resolve inconsistently under this lib config when narrowed
        // from an optional property, so pin the signatures we use.
        const externalSignal = runConfig.signal as undefined | {
            readonly aborted: boolean;
            addEventListener(type: 'abort', cb: () => void, opts?: { once?: boolean }): void;
            removeEventListener(type: 'abort', cb: () => void): void;
        };
        // Only set when we actually attach a listener (i.e. signal not pre-aborted);
        // guards against removing from a pre-aborted or partially-mocked signal.
        let detachAbort: (() => void) | undefined;
        if (externalSignal) {
            if (externalSignal.aborted) {
                runAbort.abort();
            } else {
                externalSignal.addEventListener('abort', onExternalAbort, { once: true });
                detachAbort = () => externalSignal.removeEventListener('abort', onExternalAbort);
            }
        }

        const resumeToolCallId = runConfig.resumePendingTool?.toolCall.id;
        const baseCtx: Omit<RunContext, 'step'> = {
            agentId, sessionId, lifecycle, streamHooks,
            toolTimeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
            retry,
            allowedTools: runConfig.allowedTools,
            signal: runAbort.signal,
            approvedToolCalls: runConfig.approvedToolCalls ?? [],
            resumeData: runConfig.resumeData,
            resumeToolCallId,
            requireToolApproval: runConfig.requireToolApproval,
        };

        // ── Processor pipeline (input/output/error) — Mastra parity ────────
        const procInput: Processor[] = runConfig.processors
            ? resolveProcessorSet(runConfig.processors).input
            : this._inputProcessors;
        const procOutput: Processor[] = runConfig.processors
            ? resolveProcessorSet(runConfig.processors).output
            : this._outputProcessors;
        const procError: Processor[] = runConfig.processors
            ? resolveProcessorSet(runConfig.processors).error
            : this._errorProcessors;

        const procRun: ProcRun = {
            input: procInput,
            output: procOutput,
            error: procError,
            state: createProcessorState(),
            context: {
                agentId,
                sessionId,
                runId: runConfig.runId,
                threadId: runConfig.threadId,
                resourceId: runConfig.resourceId,
                requestContext: runConfig.requestContext,
            },
            retryCount: 0,
        };

        // ── Input processors — run once before the loop on fresh runs ──────
        // (Resumed/suspended runs replay from their snapshot instead.)
        if (!runConfig.resumePendingTool && steps === 0 && procInput.length) {
            try {
                messages = await runInputProcessors(procInput, messages, procRun.context, procRun.state);
            } catch (err) {
                if (err instanceof TripWireError) {
                    await streamHooks?.onTripwire?.({
                        processorId: err.processorId,
                        reason: err.message,
                        metadata: err.metadata,
                    });
                    return this._tripwireResult(runConfig, messages, { ...err, processorId: err.processorId }, agentId, sessionId);
                }
                throw err;
            }
        }

        // ── Resume a durable/suspended run: execute the pending tool, then
        //   continue the loop from the restored step (approval or suspend()).
        if (runConfig.resumePendingTool) {
            const pending = runConfig.resumePendingTool;
            try {
                steps = Math.max(pending.step, steps);
                const execCtx: RunContext = { ...baseCtx, step: steps + 1 };
                const hasAssistant = messages.some((m) =>
                    m.role === 'assistant' &&
                    (m as Message & { toolCalls?: LLMToolCall[] }).toolCalls?.some((tc) => tc.id === pending.toolCall.id),
                );
                if (!hasAssistant) {
                    messages = [
                        ...messages,
                        { role: 'assistant', content: '', toolCalls: [pending.toolCall] } as Message & { toolCalls?: LLMToolCall[] },
                    ];
                }
                const toolMessage = await this._executeOneTool(pending.toolCall, execCtx);
                messages = [...messages, toolMessage];
            } catch (err) {
                if (isApprovalRequiredError(err) || isToolSuspendedError(err)) {
                    const p = this._suspensionPayload(err);
                    if (isApprovalRequiredError(err)) {
                        streamHooks?.onApproval?.({
                            toolCallId: p.toolCallId, toolName: p.toolName, args: p.args, requiresApproval: true,
                        });
                    } else {
                        streamHooks?.onSuspended?.({
                            toolCallId: p.toolCallId, toolName: p.toolName, args: p.args, suspendPayload: p.suspendPayload,
                        });
                    }
                    return this._suspendedResult(runConfig, messages, p, agentId, sessionId);
                }
                throw err;
            }
        }

        let lastText = '';
        let usage: AgenticRunResult['usage'];
        let finishReason: AgenticRunResult['finishReason'] = 'stop';
        let tripwire: AgenticRunResult['tripwire'];
        let suspendPayload: AgenticRunResult['suspendPayload'];
        const startTime = Date.now();
        const deadline   = createDeadline(timeoutMs, 'agent.run');
        const maxProcessorRetries = this._maxProcessorRetries;

        // Durable event log — start of run. ponytail: emitted once the loop is
        // reached; input-guardrail-blocked runs return earlier and log nothing,
        // and an LLM error mid-loop throws before agentEnd (matches core runner).
        await this.config.recorder?.agentStart({ agent: agentId, prompt });

        // ── ReAct loop ────────────────────────────────────────────────────────
        while (steps < maxSteps) {
            if (runConfig.signal?.aborted) { runAbort.abort(); finishReason = 'aborted'; break; }
            if (deadline.expired())         { runAbort.abort(); finishReason = 'timeout'; break; }

            steps++;
            streamHooks?.onStep?.(steps);

            if (lifecycle.beforeStep) {
                messages = await lifecycle.beforeStep(steps, messages);
            }

            // ── Input-step processors — per-step overrides / signals ───────
            let stepOverrides: import('../processors/types.js').ProcessInputStepResult = {};
            if (procInput.length) {
                stepOverrides = await runInputStepProcessors(procInput, {
                    stepNumber: steps,
                    messages,
                    context: { ...procRun.context, step: steps },
                }, procRun.state);
                if (stepOverrides.signals?.length) messages = [...messages, ...stepOverrides.signals];
            }

            // ── LLM call ──────────────────────────────────────────────────
            let result: GenerateResult;
            try {
                const invoked = await this._invokeLlm(messages, { ...baseCtx, step: steps }, {
                    model: stepOverrides.model,
                    toolChoice: stepOverrides.toolChoice,
                    tools: stepOverrides.tools?.length ? stepOverrides.tools.map((n) => {
                        const t = this.config.tools.getByName(n);
                        return t ? toolToLLMDef(t) : undefined;
                    }).filter((t): t is LLMToolDefinition => !!t) : undefined,
                    processorContext: procRun,
                });
                result = invoked.result;
            } catch (err) {
                if (err instanceof TripWireError) {
                    const handled = await this._handleTripwireError(
                        err, procRun, maxProcessorRetries, messages, streamHooks,
                    );
                    if (handled.retry) {
                        messages = [...messages, { role: 'user', content: handled.feedback }];
                        continue;
                    }
                    finishReason = 'aborted';
                    tripwire = { processorId: err.processorId, reason: err.message, metadata: err.metadata };
                    break;
                }
                // ── Error processors — recover from provider rejections ────
                const recovery = procError.length
                    ? await runAPIErrorProcessors(procError, {
                        error: err,
                        messages,
                        retryCount: procRun.retryCount,
                        context: procRun.context,
                    }, procRun.state)
                    : {};
                if (recovery.retry && procRun.retryCount < maxProcessorRetries && !deadline.expired() && !runConfig.signal?.aborted) {
                    procRun.retryCount++;
                    if (recovery.messages) messages = recovery.messages;
                    continue;
                }
                finishReason = 'error';
                const error = err instanceof Error ? err : new Error(String(err));
                await lifecycle.onError?.(error, steps);
                throw err instanceof LLMError ? err : new LLMError(error.message, { cause: error });
            }

            // ── Process LLM output ────────────────────────────────────────

            lastText = result.text ?? '';
            if (result.usage) {
                usage = { ...result.usage };
                this.config.budgetEnforcer?.addStepCost(
                    this.config.budgetModelId ?? 'gpt-4o',
                    result.usage.promptTokens ?? 0,
                    result.usage.completionTokens ?? 0,
                );
                // Record LLM token usage on the bounded `model` label only —
                // never the per-run agentId (cardinality explosion).
                recordLlmUsage({
                    model: this.config.budgetModelId ?? 'unknown',
                    inputTokens: result.usage.promptTokens,
                    outputTokens: result.usage.completionTokens,
                });
                // Record context window utilization when contextWindowSize is configured.
                const promptTokens = result.usage.promptTokens;
                const cwSize = this.config.contextWindowSize;
                if (promptTokens !== undefined && cwSize !== undefined && cwSize > 0) {
                    Metrics.contextWindowUtilization.record(
                        promptTokens / cwSize,
                        { agent_name: agentId, model: this.config.budgetModelId ?? 'unknown' },
                    );
                }
            }

            await this.config.recorder?.llmResult({
                step: steps,
                text: result.text ?? '',
                toolCalls: result.toolCalls?.map((tc) => ({ name: tc.name })),
                finishReason: result.finishReason,
                usage: result.usage,
            });

            const hasToolCalls = !!result.toolCalls?.length;

            // Append a SINGLE assistant message carrying both text and toolCalls.
            // (Previously this pushed text here and a second assistant message with
            //  toolCalls below — duplicating the turn in history.)
            if (result.text || hasToolCalls) {
                messages.push({
                    role: 'assistant',
                    content: result.text ?? '',
                    ...(hasToolCalls && { toolCalls: result.toolCalls }),
                } as Message & { toolCalls?: LLMToolCall[] });
            }
            if (result.text) {
                const hasStreamFilter = procOutput.some((p) => p.processOutputStream);
                const isStreaming = !!streamHooks?.onChunk && !!this.config.llm.streamText && !hasStreamFilter;
                if (!isStreaming) {
                    if (hasStreamFilter) {
                        const part = await filterOutputStreamPart(
                            procOutput,
                            { type: 'text-delta', text: result.text },
                            procRun.context,
                            procRun.state,
                        );
                        if (part?.text) streamHooks?.onChunk?.(part.text);
                    } else {
                        streamHooks?.onChunk?.(result.text);
                    }
                }
            }

            if (lifecycle.afterStep) {
                await lifecycle.afterStep(steps, messages, lastText);
            }

            // ── Output-step processors — validate the response, maybe retry ─
            if (lastText && procOutput.length) {
                let shouldRetry = false;
                let retryFeedback: string | undefined;
                try {
                    const out = await runOutputStepProcessors(procOutput, {
                        text: lastText,
                        messages,
                        retryCount: procRun.retryCount,
                        context: { ...procRun.context, step: steps },
                    }, procRun.state);
                    shouldRetry = !!out?.retry;
                    retryFeedback = out?.feedback;
                } catch (err) {
                    if (err instanceof TripWireError) {
                        if (err.options?.retry && procRun.retryCount < maxProcessorRetries) {
                            shouldRetry = true;
                            retryFeedback = err.message;
                        } else {
                            finishReason = 'aborted';
                            tripwire = { processorId: err.processorId, reason: err.message, metadata: err.metadata };
                            await streamHooks?.onTripwire?.(tripwire);
                            break;
                        }
                    } else {
                        throw err;
                    }
                }
                if (shouldRetry && procRun.retryCount < maxProcessorRetries) {
                    procRun.retryCount++;
                    messages = [
                        ...messages,
                        { role: 'user', content: retryFeedback ?? 'Your previous response did not meet the requirements. Please try again.' },
                    ];
                    continue;
                }
            }

            // ── Terminal state: no tool calls = final answer ───────────────
            if (!hasToolCalls) {
                const guardrailCtx: GuardrailContext = { agentId, sessionId, output: lastText };
                if (this.humanInTheLoop?.beforeFinish) {
                    const approved = await this.humanInTheLoop.beforeFinish(lastText, guardrailCtx);
                    if (!approved) { finishReason = 'human_rejected'; break; }
                }

                // ── Durable goal — keep iterating until the judge passes ───
                if (runConfig.goal && lastText) {
                    const goalRes = await this._evaluateGoal(runConfig.goal, lastText, procRun, streamHooks);
                    if (goalRes.runsUsedReached) { finishReason = 'max_runs'; break; }
                    if (!goalRes.passed) {
                        if (goalRes.feedback && !goalRes.suppressFeedback) {
                            messages = [...messages, { role: 'user', content: goalRes.feedback }];
                            continue;
                        }
                        finishReason = 'max_runs';
                        break;
                    }
                }

                finishReason = 'stop';
                break;
            }

            // ── Tool dispatch (parallel) ───────────────────────────────────
            // (Assistant message with toolCalls was already appended above.)
            let toolMessages: Message[];
            try {
                toolMessages = await this._executeAllTools(result.toolCalls ?? [], { ...baseCtx, step: steps });
            } catch (err) {
                if (isApprovalRequiredError(err) || isToolSuspendedError(err)) {
                    // Suspend the run: persist a snapshot so approve/decline/resume
                    // can replay from this exact point, then emit the event.
                    if (checkpointStore && runId) {
                        await this._saveCheckpoint(checkpointStore, runId, steps, messages, runConfig, startTime)
                            .catch(() => undefined);
                    }
                    const p = this._suspensionPayload(err);
                    if (this.config.suspendedRunStore && runId) {
                        await this.config.suspendedRunStore.save({
                            runId,
                            agentId,
                            threadId: (err as ApprovalRequiredError).step ? runConfig.threadId : runConfig.threadId,
                            resourceId: runConfig.resourceId,
                            status: isApprovalRequiredError(err) ? 'approval' : 'suspended',
                            toolCalls: [{
                                toolCallId: p.toolCallId,
                                toolName: p.toolName,
                                args: p.args,
                                requiresApproval: isApprovalRequiredError(err),
                                suspendPayload: p.suspendPayload,
                            }],
                            createdAt: new Date().toISOString(),
                            updatedAt: new Date().toISOString(),
                        }).catch(() => undefined);
                    }
                    if (isApprovalRequiredError(err)) {
                        streamHooks?.onApproval?.({
                            toolCallId: p.toolCallId, toolName: p.toolName, args: p.args, requiresApproval: true,
                        });
                    } else {
                        streamHooks?.onSuspended?.({
                            toolCallId: p.toolCallId, toolName: p.toolName, args: p.args, suspendPayload: p.suspendPayload,
                        });
                    }
                    suspendPayload = p;
                    finishReason = 'suspended';
                    break;
                }
                throw err;
            }
            messages.push(...toolMessages);

            // Durable event log — one entry per tool call, paired to its result by id.
            if (this.config.recorder) {
                // Index tool-result messages by callId once → O(t) instead of O(t²) per step.
                const byCallId = new Map<string, (typeof toolMessages)[number]>();
                for (const m of toolMessages) {
                    const id = (m as { toolCallId?: string }).toolCallId;
                    if (id !== undefined) byCallId.set(id, m);
                }
                for (const tc of result.toolCalls ?? []) {
                    const msg = byCallId.get(tc.id);
                    await this.config.recorder.toolResult({
                        step: steps,
                        name: tc.name,
                        args: tc.arguments,
                        output: msg?.content,
                    });
                }
            }

            // ── Auto context compression ───────────────────────────────────
            if (this.config.compression?.enabled) {
                await this._maybeCompress(messages);
            }

            if (steps >= maxSteps) finishReason = 'max_steps';

            if (checkpointStore && runId && finishReason !== 'max_steps') {
                await this._saveCheckpoint(checkpointStore, runId, steps, messages, runConfig, startTime);
            }
        }

        // Detach the external-abort listener to avoid leaking it on the caller's signal.
        detachAbort?.();

        // ── Post-loop: structured output, output processors, hooks ─────────
        const structuredOut = await this._resolveStructuredObject(runConfig, lastText, procRun);

        // Output-result processors may transform messages / attach metadata.
        if (procOutput.length && finishReason !== 'suspended') {
            try {
                messages = await runOutputResultProcessors(procOutput, {
                    result: { text: lastText, steps, finishReason, usage },
                    context: procRun.context,
                }, procRun.state, messages);
            } catch (err) {
                if (err instanceof TripWireError) {
                    tripwire = { processorId: err.processorId, reason: err.message, metadata: err.metadata };
                    await streamHooks?.onTripwire?.(tripwire);
                    finishReason = 'aborted';
                } else {
                    throw err;
                }
            }
        }

        const object = structuredOut.object;
        if (object !== undefined) streamHooks?.onObject?.(object);
        const legacyStructured: unknown = structuredOut.legacy !== undefined
            ? structuredOut.legacy
            : runConfig.responseModel
              ? this._validateStructuredOutput(runConfig, lastText)
              : undefined;

        let finalResult: AgenticRunResult = {
            text: lastText,
            markdown: {
                name: `response-${runConfig.runId ?? Date.now()}.md`,
                content: lastText,
                mimeType: 'text/markdown' as const,
                type: 'markdown' as const,
            },
            messages,
            steps,
            finishReason,
            usage,
            ...(runConfig.runId    && { runId:    runConfig.runId }),
            ...(runConfig.traceId  && { traceId:  runConfig.traceId }),
            ...(object !== undefined && { object }),
            ...(legacyStructured !== undefined && { structuredOutput: legacyStructured }),
            ...(tripwire && { tripwire }),
            ...(suspendPayload && { suspendPayload }),
        } as AgenticRunResult;

        if (lifecycle.afterRun) {
            finalResult = await lifecycle.afterRun(finalResult);
        }

        if (this.config.budgetEnforcer) {
            await this.config.budgetEnforcer.recordAndCheck(runConfig.userId);
        }

        if (checkpointStore && runId && (finishReason === 'stop' || finishReason === 'max_steps')) {
            await checkpointStore.delete(runId).catch(() => { /* ignore cleanup errors */ });
        }

        span.setAttribute('agent.steps', steps);
        span.setAttribute('agent.finish_reason', finishReason);
        if (usage?.totalTokens !== undefined) {
            span.setAttribute('llm.usage.total_tokens', usage.totalTokens);
        }

        // Durable event log — end of run.
        await this.config.recorder?.agentEnd({ text: finalResult.text, steps, finishReason });

        return finalResult;
    }

    // ── Private: reasoning pre-pass ──────────────────────────────────────────

    /**
     * Runs a CoT or ToT reasoning pass and returns the enriched reasoning text
     * to prepend to the conversation. Returns `undefined` if reasoning yields nothing.
     */
    private async _applyReasoning(prompt: string, systemPrompt: string): Promise<string | undefined> {
        // reasoning is guaranteed non-null here: _applyReasoning is only called
        // when this.config.reasoning is set (checked by callers).

        const cfg = this.config.reasoning!;
        const strategy = cfg.strategy ?? 'cot';
        const maxSteps  = cfg.maxSteps ?? 6;

        // Build a lightweight generate fn that delegates to the runner's LLM
        const generate = async (msgs: Array<{ role: string; content: string }>): Promise<string> => {
            const result = await this.config.llm.generateText(msgs as Message[]);

            return result.text ?? '';
        };

        if (strategy === 'tot') {
            if (!this._totEngine) {
                this._totEngine = new TreeOfThoughtEngine({
                    generate,
                    beamWidth: cfg.beamWidth ?? 3,
                    maxDepth:  maxSteps,
                });
            }
            const result = await this._totEngine.solve(prompt, systemPrompt).catch(() => null);
            if (!result) return undefined;
            // Summarise the best branch as a reasoning preamble
            return result.nodes
                .filter((n) => n.score > 0.3)
                .map((n, i) => `Thought ${i + 1} (score=${n.score.toFixed(2)}): ${n.thought}`)
                .join('\n');
        }

        // CoT (default) and 'react' both use ReasoningManager
        if (!this._reasoningManager) {
            this._reasoningManager = new ReasoningManager({ generate, maxSteps });
        }
        const result = await this._reasoningManager.run([{ role: 'user', content: prompt }]).catch(() => null);
        if (!result?.steps.length) return undefined;
        return result.steps
            .map((s, i) =>
                `Step ${i + 1}${s.title ? ` — ${s.title}` : ''}: ${s.result ?? s.action ?? ''}`,
            )
            .join('\n');
    }

    // ── Private: context compression ─────────────────────────────────────────

    /**
     * Lazily instantiates `CompressionManager` and compresses messages in-place
     * when the message list grows beyond the configured thresholds.
     */
    private async _maybeCompress(messages: Message[]): Promise<void> {
        if (!this._compressionManager) {
            const generate = async (msgs: Array<{ role: string; content: string }>): Promise<string> => {
                const result = await this.config.llm.generateText(msgs as Message[]);

                return result.text ?? '';
            };
            // compression is guaranteed non-null: _maybeCompress is only called when
            // this.config.compression is set.

            const cfg = this.config.compression!;
            const tokenLimit = cfg.messageSizeThreshold ?? 2000;
            this._compressionManager = new CompressionManager({
                generate,
                compressToolResults:      true,
                compressToolResultsLimit: cfg.toolResultsLimit ?? 3,
                compressTokenLimit:       tokenLimit,
            });
        }

        // CompressibleMessage is structurally compatible with Message (same role/content shape)
        type CM = Parameters<CompressionManager['shouldCompress']>[0];
        const compressible = messages as unknown as CM;
        if (this._compressionManager.shouldCompress(compressible)) {
            await this._compressionManager.acompress(compressible);
        }
    }

    // ── Private: system prompt ────────────────────────────────────────────────

    private async _buildSystemPrompt(
        runConfig: AgenticRunConfig,
        lifecycle: AgenticLifecycleHooks,
    ): Promise<string> {
        if (lifecycle.buildSystemPrompt) {
            return lifecycle.buildSystemPrompt(runConfig.instructions, runConfig.ragContext);
        }

        let prompt = runConfig.instructions;
        if (runConfig.ragContext) {
            prompt += `\n\n[Knowledge Base Context]\n${runConfig.ragContext}`;
        }
        if (runConfig.responseModel) {
            prompt += `\n\n${buildStructuredOutputPrompt({ schema: runConfig.responseModel })}`;
        }
        if (runConfig.structuredOutput) {
            const so = runConfig.structuredOutput;
            const mode = so.jsonPromptInjection ?? 'auto';
            if (mode === 'system' || mode === true) {
                prompt += `\n\n${buildStructuredOutputPrompt({ schema: so.schema, description: so.description, strict: true, maxRetries: so.maxRetries })}`;
            } else if (mode === 'auto') {
                // Native-capable providers get the schema via response_format; the
                // runner-level path always injects for portability across providers.
                prompt += `\n\n${buildStructuredOutputPrompt({ schema: so.schema, description: so.description, strict: true, maxRetries: so.maxRetries })}`;
            }
            // 'inline' or false → no system injection (schema appended to the user turn).
        }
        return prompt;
    }

    // ── Private: message construction ────────────────────────────────────────

    private _buildInitialMessages(
        runConfig: AgenticRunConfig,
        systemPrompt: string,
        prompt: string,
    ): Message[] {
        if (runConfig.messages?.length) {
            return [...runConfig.messages];
        }
        return [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: prompt },
        ];
    }

    // ── Private: checkpoint ───────────────────────────────────────────────────

    private async _restoreCheckpoint(
        store: NonNullable<AgenticRunnerConfig['checkpointStore']>,
        runId: string,
        initialMessages: Message[],
        initialSteps: number,
    ): Promise<{ messages: Message[]; steps: number }> {
        const checkpoint = await store.load(runId);
        if (!checkpoint) return { messages: initialMessages, steps: initialSteps };
        return {
            messages: [...checkpoint.state.messages],
            steps: checkpoint.step,
        };
    }

    private async _saveCheckpoint(
        store: NonNullable<AgenticRunnerConfig['checkpointStore']>,
        runId: string,
        steps: number,
        messages: Message[],
        runConfig: AgenticRunConfig,
        startTime: number,
    ): Promise<void> {
        const agentName = this.config.agentId ?? 'agent';
        await store.save(runId, steps, {
            messages: [...messages],
            step: steps,
            agentName,
            prompt: runConfig.prompt,
            startedAt: new Date(startTime).toISOString(),
            checkpointAt: new Date().toISOString(),
        });
    }

    // ── Private: LLM call ─────────────────────────────────────────────────────

    private async _invokeLlm(
        messages: Message[],
        ctx: RunContext,
        overrides?: {
            model?: string;
            toolChoice?: import('../core/index.js').GenerateOptions['toolChoice'];
            tools?: LLMToolDefinition[];
            processorContext?: ProcRun;
        },
    ): Promise<{ result: GenerateResult; fromCache?: boolean }> {
        const procRun = overrides?.processorContext;

        // ── LLM-request processors: transient prompt rewrite + response cache ──
        let llmMessages = messages;
        let cached: { text: string; usage?: GenerateResult['usage'] } | undefined;
        if (procRun && procRun.input.length) {
            const req = await runLLMRequestProcessors(procRun.input, {
                messages,
                model: this.config.budgetModelId ?? 'unknown',
                stepNumber: ctx.step,
                steps: ctx.step,
                context: procRun.context,
            }, procRun.state);
            if (req.cached) cached = req.cached;
            if (req.messages) llmMessages = req.messages;
        }

        // ── Runtime model switch (per-step overrides) ─────────────────────────
        let provider = this.config.llm;
        if (overrides?.model) {
            const extra = this.config.resolveExtraLlm
                ? this.config.resolveExtraLlm(overrides.model)
                : createLlmProviderFromModelString(overrides.model);
            if (extra) provider = extra;
        }

        let llmTools = overrides?.tools !== undefined ? overrides.tools : this._cachedLlmTools;
        const toolChoice: import('../core/index.js').GenerateOptions['toolChoice'] =
            overrides?.toolChoice ?? (llmTools.length ? 'auto' : 'none');

        // ── Response cache hit: short-circuit the provider call ───────────────
        if (cached) {
            return {
                result: { text: cached.text, usage: cached.usage, finishReason: 'stop' },
                fromCache: true,
            };
        }

        // When output-stream filter processors are configured, fall back to
        // generateText so chunks pass through the filters in the correct order.
        const hasStreamFilter = !!procRun?.output.some((p) => p.processOutputStream);
        const useStreaming = !hasStreamFilter && !!ctx.streamHooks?.onChunk && !!provider.streamText;

        const runLlm = () => {
            if (useStreaming) {
                // streamText is confirmed defined when useStreaming is true (checked by callers)

                return provider.streamText!(llmMessages, {
                    temperature: this.config.temperature ?? 0.7,
                    maxTokens: this.config.maxTokens ?? 4096,
                    tools: llmTools.length ? llmTools : undefined,
                    toolChoice,
                    ...(ctx.signal && { signal: ctx.signal }),
                    onChunk: (chunk: string | { type: string; text: string }) => {
                        const text = typeof chunk === 'string' ? chunk : chunk.text;
                        ctx.streamHooks!.onChunk!(text);
                    },
                });
            }
            return provider.generateText(llmMessages, {
                temperature: this.config.temperature ?? 0.7,
                maxTokens: this.config.maxTokens ?? 4096,
                tools: llmTools.length ? llmTools : undefined,
                toolChoice,
                ...(ctx.signal && { signal: ctx.signal }),
            });
        };

        const result = await withSpan(
            'llm.generate',
            {
                'agent.step': ctx.step,
                'llm.stream': useStreaming,
                ...genAiAttributes({ model: this.config.budgetModelId, operation: 'chat' }),
            },
            () => guardWithRetry(runLlm, toGuardRetryPolicy(ctx.retry)),
        );

        // ── LLM-response processors: side effects (cache write, cost) ─────────
        if (procRun && procRun.input.length) {
            await runLLMResponseProcessors(procRun.input, {
                chunks: result.text ? [result.text] : [],
                text: result.text ?? '',
                model: this.config.budgetModelId ?? 'unknown',
                stepNumber: ctx.step,
                steps: ctx.step,
                context: procRun.context,
            }, procRun.state);
        }

        return { result };
    }

    // ── Private: tool dispatch ────────────────────────────────────────────────

    private async _executeAllTools(toolCalls: LLMToolCall[], ctx: RunContext): Promise<Message[]> {
        const concurrency = Math.min(this.config.toolConcurrency ?? 8, 32); // Cap at 32 to prevent abuse
        if (toolCalls.length === 0) return [];

        const results = new Array<Message>(toolCalls.length);
        const queue = toolCalls.map((tc, i) => ({ tc, i }));

        // Semaphore pattern: spawn N workers that consume tasks from the queue
        const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
            while (queue.length > 0) {
                const task = queue.shift();
                if (!task) break;
                try {
                    results[task.i] = await this._executeOneTool(task.tc, ctx);
                } catch (err) {
                    // Approval / suspend signals bubble up so the run can pause.
                    if (isApprovalRequiredError(err) || isToolSuspendedError(err)) throw err;
                    // Ensure all results are valid messages even on error
                    results[task.i] = this._toolErrorMessage(task.tc.id, err instanceof Error ? err.message : String(err));
                }
            }
        });

        await Promise.all(workers);
        return results;
    }

    private async _executeOneTool(tc: LLMToolCall, ctx: RunContext): Promise<Message> {
        const { agentId, sessionId, lifecycle, streamHooks, toolTimeoutMs, step } = ctx;

        const tool = this.config.tools.getByName(tc.name);
        if (!tool) {
            return this._toolErrorMessage(tc.id, `Unknown tool: ${tc.name}`);
        }

        // Tool authorization: if allowedTools is set, reject tools not in the list.
        if (ctx.allowedTools !== undefined && !ctx.allowedTools.includes(tc.name)) {
            throw new ToolNotAuthorizedError(tc.name);
        }

        const guardrailCtx: GuardrailContext = {
            agentId, sessionId, toolName: tc.name, toolArgs: tc.arguments,
        };

        // ── Agent approval: pause BEFORE execute (requireApproval / requireToolApproval) ──
        const requiresApproval = await this._requiresApproval(tc, ctx);
        if (requiresApproval && !ctx.approvedToolCalls.includes(tc.id)) {
            throw new ApprovalRequiredError(tc, step);
        }

        if (this.guardrails) {
            const blocked = await this._checkInputGuardrails(tc, guardrailCtx);
            if (blocked) return blocked;
        }

        if (this.humanInTheLoop?.beforeToolCall) {
            const approved = await this.humanInTheLoop.beforeToolCall(tc.name, tc.arguments, guardrailCtx);
            if (!approved) return this._toolErrorMessage(tc.id, 'Tool call rejected by human');
        }

        const effectiveArgs = lifecycle.beforeToolCall
            ? await lifecycle.beforeToolCall(tc.name, tc.arguments, step)
            : tc.arguments;

        streamHooks?.onToolCall?.(tc.name, effectiveArgs);

        const toolContext = this._buildToolContext(tool, agentId, sessionId, ctx, tc.id);
        // toolMiddleware is initialised to [] in the constructor; the ! is safe.

        const middleware = this.config.toolMiddleware!;

        for (const m of middleware) {
            if (m.beforeExecute) await m.beforeExecute(tool, effectiveArgs, toolContext);
        }

        let toolResult: unknown;
        let toolResultObj: ToolResult | undefined;
        const _toolStart = Date.now();
        try {
            const out = await withSpan(
                'tool.call',
                { 'tool.name': tc.name, 'agent.step': step },
                () => runToolWithTimeout(
                    () => tool.execute(effectiveArgs, toolContext),
                    toolTimeoutMs,
                    tc.name,
                    ctx.signal,
                ),
            );
            Metrics.toolDurationMs.record(Date.now() - _toolStart, {
                tool_name: tc.name, agent_name: agentId,
            });
            toolResultObj = out;
            toolResult = out.success ? out.data : (out.error ? { error: out.error.message } : out);
        } catch (err) {
            // A tool self-suspended via context.agent.suspend() — bubble up.
            if (isToolSuspendedError(err)) throw err;
            Metrics.toolDurationMs.record(Date.now() - _toolStart, {
                tool_name: tc.name, agent_name: agentId,
            });
            const error = err instanceof Error ? err : new Error(String(err));
            for (const m of middleware) {
                if (m.onError) await m.onError(tool, error, toolContext);
            }
            await lifecycle.onError?.(error, step);
            return this._toolErrorMessage(tc.id, error.message);
        }


        if (toolResultObj !== undefined) {
            for (const m of middleware) {
                if (m.afterExecute !== undefined) await m.afterExecute(tool, toolResultObj, toolContext);
            }
        }

        if (lifecycle.afterToolCall) {
            toolResult = await lifecycle.afterToolCall(tc.name, toolResult, effectiveArgs, step);
        }

        if (this.guardrails && toolResult !== undefined) {
            toolResult = await this._checkOutputGuardrails(toolResult, guardrailCtx);
        }

        streamHooks?.onToolResult?.(tc.name, toolResult);

        const content = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
        return { role: 'tool', content, toolCallId: tc.id } as Message & { toolCallId: string };
    }

    // ── Private: guardrail helpers ────────────────────────────────────────────

    private async _checkInputGuardrails(
        tc: LLMToolCall,
        ctx: GuardrailContext,
    ): Promise<(Message & { toolCallId: string }) | null> {
        // guardrails is checked by all callers of this method before calling it

        const results = await this.guardrails!.checkToolCall(tc.name, tc.arguments, ctx);

        const violations = this.guardrails!.getViolations(results);
        if (!violations.length) return null;

        const msg = `Guardrail violation: ${violations.map((v) => v.message).join(', ')}`;
        if (this.humanInTheLoop?.onViolation) {
            for (const v of violations) await this.humanInTheLoop.onViolation(v, ctx);
        }
        return this._toolErrorMessage(tc.id, msg);
    }

    private async _checkOutputGuardrails(result: unknown, ctx: GuardrailContext): Promise<unknown> {
        const outputCtx: GuardrailContext = { ...ctx, output: result };

        const results = await this.guardrails!.validateOutput(result, outputCtx);

        const violations = this.guardrails!.getViolations(results);
        if (!violations.length) return result;

        const msg = `Output guardrail violation: ${violations.map((v) => v.message).join(', ')}`;
        if (this.humanInTheLoop?.onViolation) {
            for (const v of violations) await this.humanInTheLoop.onViolation(v, outputCtx);
        }
        return { error: msg };
    }

    // ── Private: structured output ────────────────────────────────────────────

    private _validateStructuredOutput(
        runConfig: AgenticRunConfig,
        text: string,
    ): unknown {
        if (!runConfig.responseModel || !text) return undefined;

        const validation = validateStructuredOutput(text, {
            schema: runConfig.responseModel,
            strict: true,
        });

        if (validation.validated) return validation.data;
        if (validation.errors.length > 0) {
            console.warn('[AgenticRunner] Structured output validation failed:', validation.errors);
        }
        return undefined;
    }

    // ── Private: small builders ───────────────────────────────────────────────

    private async _requiresApproval(tc: LLMToolCall, ctx: RunContext): Promise<boolean> {
        const tool = this.config.tools.getByName(tc.name);
        if (tool?.requireApproval) return true;

        const policy = ctx.requireToolApproval;
        if (!policy) return false;
        try {
            if (policy === true) return true;
            if (typeof policy === 'function') {
                return await policy({
                    toolName: tc.name,
                    args: tc.arguments,
                    agentId: ctx.agentId,
                    sessionId: ctx.sessionId,
                });
            }
            return false;
        } catch {
            return true; // fails closed
        }
    }

    /**
     * Handle a processor tripwire. Returns `{ retry, feedback }` — when the
     * tripwire requested a retry and we still have budget, replay the step.
     */
    private async _handleTripwireError(
        err: TripWireError,
        procRun: ProcRun,
        maxRetries: number,
        messages: Message[],
        streamHooks: AgenticStreamHooks | undefined,
    ): Promise<{ retry: boolean; feedback: string }> {
        await streamHooks?.onTripwire?.({ processorId: err.processorId, reason: err.message, metadata: err.metadata });
        void messages;
        if (err.options?.retry && procRun.retryCount < maxRetries) {
            procRun.retryCount++;
            return { retry: true, feedback: err.message };
        }
        return { retry: false, feedback: err.message };
    }

    // ── Private: goal evaluation ───────────────────────────────────────────────

    private async _evaluateGoal(
        config: GoalRunConfig,
        text: string,
        procRun: ProcRun,
        streamHooks: AgenticStreamHooks | undefined,
    ): Promise<{ passed: boolean; feedback?: string; runsUsedReached: boolean; suppressFeedback?: boolean }> {
        type GoalState = { runsUsed: number; judge?: import('../goals/judge.js').TaskJudge };
        const state = (procRun.state.goal ??= { runsUsed: config.runsUsed ?? 0 }) as GoalState;
        const maxRuns = config.maxRuns ?? 0;

        if (maxRuns > 0 && state.runsUsed >= maxRuns) {
            return { passed: false, runsUsedReached: true };
        }

        const judge = this._resolveGoalJudge(config, state);
        if (!judge) {
            // No judge = activation switch off — the goal step is a no-op.
            return { passed: true, runsUsedReached: false, suppressFeedback: true };
        }

        const verdict = await judge.evaluate(text);
        state.runsUsed += 1;
        const runsUsedReached = maxRuns > 0 && state.runsUsed >= maxRuns;

        const evaluation: GoalEvaluation = {
            objective: config.objective,
            iteration: state.runsUsed,
            maxRuns,
            passed: verdict.passed,
            status: verdict.passed ? 'done' : runsUsedReached ? 'paused' : 'active',
            reason: verdict.reason,
            maxRunsReached: runsUsedReached,
        };
        streamHooks?.onGoal?.(evaluation);

        if (this.config.goalStore && config.threadId) {
            await this.config.goalStore.setObjective({
                objective: config.objective,
                threadId: config.threadId,
                resourceId: config.resourceId,
                maxRuns: maxRuns || undefined,
                runsUsed: state.runsUsed,
                status: evaluation.status,
                updatedAt: new Date().toISOString(),
            }).catch(() => undefined);
        }

        return {
            passed: verdict.passed,
            feedback:
                verdict.passed
                    ? undefined
                    : `Your objective is: "${config.objective}". It is not yet complete${verdict.reason ? `: ${verdict.reason}` : '.'} Continue working toward it.`,
            runsUsedReached,
            suppressFeedback: config.suppressFeedback,
        };
    }

    private _resolveGoalJudge(
        config: GoalRunConfig,
        state: { judge?: import('../goals/judge.js').TaskJudge },
    ): import('../goals/judge.js').TaskJudge | undefined {
        if (state.judge) return state.judge;
        const judge = config.judge;
        if (!judge) return undefined;
        if (typeof judge === 'string') {
            state.judge = goalJudgeFromModelString(judge);
        } else if (typeof judge === 'function') {
            state.judge = { evaluate: (t) => Promise.resolve(judge(t)) };
        } else if (typeof (judge as { evaluate?: unknown }).evaluate === 'function') {
            state.judge = judge as import('../goals/judge.js').TaskJudge;
        }
        return state.judge;
    }

    // ── Private: structured output (Mastra parity) ─────────────────────────────

    private async _resolveStructuredObject(
        runConfig: AgenticRunConfig,
        text: string,
        procRun: ProcRun,
    ): Promise<{ object?: unknown; legacy?: unknown }> {
        const config: StructuredOutputConfig | undefined = runConfig.structuredOutput;
        void procRun;
        if (!config) return {};
        const schema = config.schema;
        const attempts = config.maxRetries ?? DEFAULT_STRUCTURED_RETRIES;
        const errors: string[] = [];

        if (!text) {
            if (config.errorStrategy === 'fallback') return { object: config.fallbackValue, legacy: config.fallbackValue };
            if (config.errorStrategy === 'strict') {
                throw new StructuredOutputError('Structured output requested but the agent produced no text.', errors);
            }
            return {};
        }

        // 1. The agent's own output.
        const first = validateStructuredOutput(text, { schema, strict: true });
        if (first.validated) return { object: first.data, legacy: first.data };
        errors.push(...first.errors);

        // 2. Separate structuring model (extracts JSON from the natural-language output).
        const structuringProvider =
            typeof config.model === 'string'
                ? (this.config.resolveExtraLlm
                      ? this.config.resolveExtraLlm(config.model)
                      : createLlmProviderFromModelString(config.model))
                : (config.model as LLMProvider | undefined);
        if (structuringProvider) {
            const extraction = await this._extractWithProvider(structuringProvider, text, schema, config.description);
            if (extraction.validated) return { object: extraction.data, legacy: extraction.data };
            errors.push(...extraction.errors);
        }

        // 3. Correction loop — feed the errors back into the main LLM.
        let current = text;
        for (let i = 0; i < attempts; i++) {
            const correction = await this._extractWithProvider(this.config.llm, current, schema, config.description, i);
            if (correction.validated) return { object: correction.data, legacy: correction.data };
            errors.push(...correction.errors);
            current = correction.rawText ?? current;
        }

        if (config.errorStrategy === 'fallback') return { object: config.fallbackValue, legacy: config.fallbackValue };
        if (config.errorStrategy === 'strict') {
            throw new StructuredOutputError(
                `Structured output validation failed after ${attempts + 1} attempts: ${errors.slice(0, 3).join('; ')}`,
                errors,
            );
        }
        console.warn('[AgenticRunner] structuredOutput validation failed:', errors.slice(0, 3));
        return {};
    }

    private async _extractWithProvider(
        provider: LLMProvider,
        text: string,
        schema: import('../validation/index.js').SchemaInput,
        description?: string,
        attempt?: number,
    ): Promise<{ data?: unknown; rawText?: string; validated: boolean; errors: string[] }> {
        const system = buildStructuredOutputPrompt({ schema, description, strict: true, maxRetries: 1 });
        const feedback = attempt && attempt > 0
            ? `\n\nYour previous attempt failed schema validation. Return ONLY valid JSON matching the schema.`
            : '';
        const result = await provider.generateText(
            [
                { role: 'system', content: system },
                { role: 'user', content: `${text}${feedback}` },
            ] as Message[],
            { temperature: 0, maxTokens: 2048, toolChoice: 'none' },
        );
        const out = validateStructuredOutput(result.text ?? '', { schema, strict: true });
        // Fall back to a raw JSON extraction when the provider wrapped the JSON
        // in prose or a code fence that the strict validator could not parse.
        if (!out.validated && out.rawText) {
            try {
                const json = extractJson(out.rawText);
                const retry = validateStructuredOutput(JSON.stringify(json), { schema, strict: true });
                if (retry.validated) return { data: retry.data, rawText: retry.rawText, validated: true, errors: [] };
            } catch {
                // keep the original error list — extraction failure is already recorded
            }
        }
        return { data: out.data, rawText: out.rawText, validated: out.validated, errors: out.errors };
    }

    // ── Private: suspension / tripwire payload builders ───────────────────────

    private _suspensionPayload(err: unknown): NonNullable<AgenticRunResult['suspendPayload']> {
        if (isApprovalRequiredError(err)) {
            return { toolCallId: err.toolCallId, toolName: err.toolName, args: err.args, requiresApproval: true };
        }
        if (isToolSuspendedError(err)) {
            return {
                toolCallId: err.toolCallId ?? '',
                toolName: err.toolName,
                args: {},
                requiresApproval: false,
                suspendPayload: err.payload,
            };
        }
        return { toolCallId: '', toolName: '', args: {}, requiresApproval: false };
    }

    private _tripwireResult(
        runConfig: AgenticRunConfig,
        messages: Message[],
        tw: { processorId?: string; reason?: string; metadata?: unknown },
        agentId: string,
        sessionId: string,
    ): AgenticRunResult {
        const runName = `response-${runConfig.runId ?? Date.now()}.md`;
        void agentId; void sessionId;
        return {
            text: '',
            markdown: { name: runName, content: '', mimeType: 'text/markdown', type: 'markdown' },
            messages,
            steps: 0,
            finishReason: 'aborted',
            tripwire: { processorId: tw.processorId, reason: tw.reason, metadata: tw.metadata },
            ...(runConfig.runId   && { runId:   runConfig.runId }),
            ...(runConfig.traceId && { traceId: runConfig.traceId }),
        };
    }

    private _suspendedResult(
        runConfig: AgenticRunConfig,
        messages: Message[],
        sp: NonNullable<AgenticRunResult['suspendPayload']>,
        agentId: string,
        sessionId: string,
    ): AgenticRunResult {
        const runName = `response-${runConfig.runId ?? Date.now()}.md`;
        void agentId; void sessionId;
        return {
            text: '',
            markdown: { name: runName, content: '', mimeType: 'text/markdown', type: 'markdown' },
            messages,
            steps: 0,
            finishReason: 'suspended',
            suspendPayload: sp,
            ...(runConfig.runId   && { runId:   runConfig.runId }),
            ...(runConfig.traceId && { traceId: runConfig.traceId }),
        };
    }

    // ── Private: small builders ───────────────────────────────────────────────

    private _buildToolContext(
        tool: Tool,
        agentId: string,
        sessionId: string,
        ctx: RunContext,
        toolCallId: string,
    ): ToolContext {
        const resumeApplicable = ctx.resumeToolCallId === toolCallId;
        return {
            toolId: tool.id,
            agentId,
            sessionId,
            timeoutMs: DEFAULT_TOOL_TIMEOUT_MS,
            permissions: tool.permissions,
            ...(ctx.signal && { signal: ctx.signal }),
            ...(resumeApplicable ? { resumeData: ctx.resumeData } : {}),
            agent: {
                suspend: (payload: unknown) => {
                    throw new ToolSuspendedError(payload, { toolName: tool.name, toolCallId });
                },
            },
        };
    }

    private _toolErrorMessage(toolCallId: string, message: string): Message & { toolCallId: string } {
        return {
            role: 'tool',
            content: JSON.stringify({ error: message }),
            toolCallId,
        };
    }

    /** Construct a short-circuit AgenticRunResult for a blocked (guardrail-rejected) input. */
    private _blockedResult(
        prompt: string,
        agentId: string,
        sessionId: string,
        runConfig: AgenticRunConfig,
    ): AgenticRunResult {
        const runName = `response-${runConfig.runId ?? Date.now()}.md`;
        return {
            text: '',
            markdown: { name: runName, content: '', mimeType: 'text/markdown', type: 'markdown' },
            messages: [{ role: 'user', content: prompt }],
            steps: 0,
            finishReason: 'human_rejected',
            ...(runConfig.runId    && { runId:    runConfig.runId }),
            ...(runConfig.traceId  && { traceId:  runConfig.traceId }),
        };
        void agentId; void sessionId; // referenced for future hook plumbing
    }
}
