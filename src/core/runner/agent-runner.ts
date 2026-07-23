/**
 * @personaforge/core — ReAct-style agentic runner.
 *
 * SOLID principles enforced:
 *   SRP  — AgentRunner owns only the loop. Message building, retry, and
 *           span wrappers live in dedicated pure helpers.
 *   OCP  — Extend behaviour via hooks and LLMProvider/ToolRegistry interfaces;
 *           never modify this class.
 *   LSP  — Any object satisfying LLMProvider or ToolRegistry is drop-in.
 *   ISP  — RunnerStreamHooks and AgentLifecycleHooks are separate, minimal interfaces.
 *   DIP  — Runner depends on abstractions (LLMProvider, ToolRegistry), not concrete classes.
 *
 * Data-structure choices:
 *   - messages[] is a mutable array; items are pushed (O(1) amortised) not spread-copied
 *     (spreading O(n) per step → O(n²) across the loop).
 *   - Tool lookup is O(1) via Map (see MapToolRegistry in index.ts).
 *   - Retry uses exponential back-off with jitter to avoid thundering-herd.
 */

import type { Message, AgentLifecycleHooks, AgentRunResult } from '../types.js';
import type {
    RunnerConfig,
    RunnerRunConfig,
    RunnerStreamHooks,
    LLMToolDefinition,
    GenerateOptions,
    GenerateResult,
    Tool,
    RetryPolicy,
} from './types.js';
import { LLMError } from '../errors.js';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

// ── Built-in fallback resilience (used when @personaforge/guard not installed) ─

/** O(1) sleep — avoids busy-waiting. */
const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exponential back-off retry with full jitter.
 * Time complexity: O(maxRetries) worst case — each attempt is independent.
 */
async function withRetryFallback<T>(fn: () => Promise<T>, policy: RetryPolicy): Promise<T> {
    const maxRetries = policy.maxRetries ?? 2;
    const baseMs     = policy.backoffMs  ?? 1_000;
    const maxMs      = policy.maxBackoffMs ?? 30_000;

    let lastError!: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            // Only retry transient failures (429/5xx/network); 4xx/validation replay identically.
            const transient = guard?.isTransientLLMError?.(err) ?? true;
            if (attempt < maxRetries && transient) {
                // Full-jitter: random in [0, min(base * 2^attempt, maxMs)]
                const cap   = Math.min(baseMs * Math.pow(2, attempt), maxMs);
                const delay = Math.random() * cap;
                await sleep(delay);
            } else {
                break;
            }
        }
    }
    throw lastError;
}

// ── Optional peer-dep integration (@personaforge/guard and @personaforge/observe) ──

type SpanHandle = { setAttribute(key: string, value: unknown): void };
type WithSpanFn = <T>(name: string, attrs: Record<string, unknown>, fn: (span: SpanHandle) => Promise<T>) => Promise<T>;
type WithRetryGuardFn = <T>(fn: () => Promise<T>, policy: Record<string, unknown>) => Promise<T>;
type CreateDeadlineFn = (ms: number, label: string) => { expired: () => boolean };

/** Loaded once at module init — not in the hot path. */
const guard   = tryRequire('../../guard/index.js')   as { withRetry?: WithRetryGuardFn; createDeadline?: CreateDeadlineFn; isTransientLLMError?: (e: unknown) => boolean } | undefined;
const observe = tryRequire('../../observe/index.js') as {
    withSpan?: WithSpanFn;
    genAiAttributes?: (input: { system?: string; model?: string; operation?: string; inputTokens?: number; outputTokens?: number }) => Record<string, unknown>;
} | undefined;

/** GenAI semantic-convention attributes for LLM spans (falls back to a minimal record). */
function genAiAttrs(input: { model?: string; operation?: string; inputTokens?: number; outputTokens?: number }): Record<string, unknown> {
    if (observe?.genAiAttributes) return observe.genAiAttributes(input);
    return { 'gen_ai.operation.name': input.operation ?? 'chat' };
}

function tryRequire(id: string): Record<string, unknown> | undefined {
    try {
        return _require(id) as Record<string, unknown>;
    } catch {
        return undefined;
    }
}

// ── Thin adapter facades (DIP — runner calls these, never the SDKs directly) ─

async function withRetry<T>(fn: () => Promise<T>, policy: RetryPolicy): Promise<T> {
    if (guard?.withRetry) {
        return guard.withRetry(fn, {
            maxAttempts:   (policy.maxRetries ?? 2) + 1,
            initialDelayMs: policy.backoffMs ?? 1_000,
            maxDelayMs:    policy.maxBackoffMs ?? 30_000,
            multiplier:    2,
            jitter:        true,
            // Retry only transient failures (429/5xx/network); never 4xx/validation.
            retryOn:       guard.isTransientLLMError ?? (() => false),
        });
    }
    return withRetryFallback(fn, policy);
}

function createDeadline(ms: number, label: string): { expired(): boolean } {
    if (guard?.createDeadline) return guard.createDeadline(ms, label);
    const end = Date.now() + ms;
    return { expired: () => Date.now() > end };
}

async function withSpan<T>(
    name: string,
    attrs: Record<string, unknown>,
    fn: (span: SpanHandle) => Promise<T>,
): Promise<T> {
    if (observe?.withSpan) return observe.withSpan(name, attrs, fn);
    const noop: SpanHandle = { setAttribute: () => undefined };
    return fn(noop);
}

// ── Pure helpers (SRP — no side effects) ─────────────────────────────────────

/** Build the system prompt once per run. Pure function — no mutation. */
function buildSystemPrompt(instructions: string, ragContext?: string, hook?: AgentLifecycleHooks['buildSystemPrompt']): string {
    if (hook) {
        // Hook is async — caller must await; this overload returns the unwrapped promise
        // (handled in _runLoop). Returned here for the sync fast path.
        return instructions; // placeholder; async path handled below
    }
    return ragContext
        ? `${instructions}\n\n<context>\n${ragContext}\n</context>`
        : instructions;
}

/** Convert ToolRegistry entries → LLM tool definitions. O(n) — done once per run. */
function buildLLMTools(tools: { list(): Tool[] }): LLMToolDefinition[] {
    return tools.list().map((t) => ({
        name:        t.name,
        description: t.description,
        parameters:  t.parameters,
    }));
}

/** Accumulate token usage in place — O(1). */
function accumulateUsage(
    acc: { promptTokens: number; completionTokens: number; totalTokens: number },
    usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number },
): void {
    if (!usage) return;
    acc.promptTokens     += usage.promptTokens     ?? 0;
    acc.completionTokens += usage.completionTokens ?? 0;
    acc.totalTokens      += usage.totalTokens      ?? 0;
}

/** Serialize tool output to string. O(1) for strings, O(k) for objects (k = JSON size). */
function serializeOutput(output: unknown): string {
    return typeof output === 'string' ? output : JSON.stringify(output);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_MAX_STEPS    = 10;
const DEFAULT_TIMEOUT_MS   = 60_000;
const DEFAULT_RETRIES      = 2;
const DEFAULT_BACKOFF_MS   = 1_000;
const DEFAULT_TOOL_TIMEOUT = 30_000;

// ── Runner (SRP — owns only the loop execution) ───────────────────────────────

/**
 * AgentRunner executes the ReAct agentic loop.
 *
 * Stateless between runs — create once, call `run()` many times.
 * Swap any dependency (LLM, tools, hooks) without touching this class (OCP).
 */
export class AgentRunner {
    constructor(private readonly config: RunnerConfig) {}

    /** Public entry point. Wraps the loop in an optional trace span. */
    run(runConfig: RunnerRunConfig, streamHooks?: RunnerStreamHooks): Promise<AgentRunResult> {
        return withSpan(
            'agent.loop',
            { 'agent.name': this.config.name, 'prompt.length': runConfig.prompt.length },
            (span) => this._loop(runConfig, streamHooks, span),
        );
    }

    // ── Private: loop ─────────────────────────────────────────────────────────

    private async _loop(
        runConfig: RunnerRunConfig,
        streamHooks: RunnerStreamHooks | undefined,
        span: SpanHandle,
    ): Promise<AgentRunResult> {
        const {
            maxSteps    = DEFAULT_MAX_STEPS,
            timeoutMs   = DEFAULT_TIMEOUT_MS,
            retry       = { maxRetries: DEFAULT_RETRIES, backoffMs: DEFAULT_BACKOFF_MS },
            toolTimeoutMs = DEFAULT_TOOL_TIMEOUT,
        } = this.config;

        const effectiveMaxSteps  = runConfig.maxSteps  ?? maxSteps;
        const effectiveTimeout   = runConfig.timeoutMs ?? timeoutMs;
        const lifecycle          = this.config.hooks ?? {};

        // Build LLM tool defs once — O(n tools)
        const llmTools = buildLLMTools(this.config.tools);

        // Build system prompt (may be overridden by hook)
        const systemPrompt = lifecycle.buildSystemPrompt
            ? await lifecycle.buildSystemPrompt(runConfig.instructions, runConfig.ragContext)
            : buildSystemPrompt(runConfig.instructions, runConfig.ragContext);

        // Initialise message list — push() is O(1) amortised
        const messages: Message[] = runConfig.messages?.length
            ? [...runConfig.messages]                                   // copy to avoid mutating caller's array
            : [
                  { role: 'system', content: systemPrompt },
                  { role: 'user',   content: runConfig.prompt || '' },
              ];

        // Lifecycle: beforeRun — may rewrite the prompt
        let effectivePrompt = runConfig.prompt;
        if (lifecycle.beforeRun) {
            effectivePrompt = await lifecycle.beforeRun(effectivePrompt, runConfig);
            if (!runConfig.messages?.length) {
                // Replace the last user message in O(1)
                messages[messages.length - 1] = { role: 'user', content: effectivePrompt };
            }
        }

        const deadline     = createDeadline(effectiveTimeout, 'agent.run');
        const usage        = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        let steps          = 0;
        let finishReason: AgentRunResult['finishReason'] = 'stop';
        let finalText      = '';

        // Durable log: record run start (no-op when no recorder configured).
        await this.config.recorder?.agentStart({ agent: this.config.name, prompt: runConfig.prompt });

        // ── ReAct loop ─────────────────────────────────────────────────────
        while (steps < effectiveMaxSteps) {
            if (runConfig.signal?.aborted) { finishReason = 'aborted'; break; }
            if (deadline.expired())        { finishReason = 'timeout'; break; }

            steps++;
            streamHooks?.onStep?.(steps);

            // Lifecycle: beforeStep
            if (lifecycle.beforeStep) {
                const updated = await lifecycle.beforeStep(steps, messages);
                // Replace in-place only if hook returned a different array — O(1)
                if (updated !== messages) {
                    messages.length = 0;
                    messages.push(...updated);
                }
            }

            // LLM call (with retry + span)
            let result: GenerateResult;
            const useStreaming = !!streamHooks?.onChunk && !!this.config.llm.streamText;
            try {
                result = await this._callLLM(messages, llmTools, useStreaming, streamHooks, steps, retry, runConfig.signal);
            } catch (err) {
                finishReason = 'error';
                const error  = err instanceof Error ? err : new Error(String(err));
                if (lifecycle.onError) await lifecycle.onError(error, steps);
                throw new LLMError(`LLM call failed at step ${String(steps)}: ${error.message}`, {
                    context: { step: steps },
                });
            }

            accumulateUsage(usage, result.usage);
            finalText = result.text ?? '';

            // Durable log: record this LLM turn (no-op without a recorder).
            await this.config.recorder?.llmResult({ step: steps, text: finalText, toolCalls: result.toolCalls, finishReason: result.finishReason, usage: result.usage });

            // Push assistant message — O(1)
            messages.push({
                role:    'assistant',
                content: finalText,
                ...(result.toolCalls?.length && {
                    tool_calls: result.toolCalls.map((tc) => ({
                        id:       tc.id,
                        type:     'function' as const,
                        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
                    })),
                }),
            });

            // Lifecycle: afterStep
            if (lifecycle.afterStep) {
                await lifecycle.afterStep(steps, messages, finalText);
            }

            // No tool calls → model is done
            if (!result.toolCalls?.length || result.finishReason === 'stop') break;

            // Dispatch tool calls — O(k tool calls per step)
            await this._dispatchTools(result.toolCalls, messages, lifecycle, streamHooks, steps, toolTimeoutMs, runConfig.signal);
        }

        if (steps >= effectiveMaxSteps && finishReason === 'stop') {
            finishReason = 'max_steps';
        }

        span.setAttribute('agent.steps',        steps);
        span.setAttribute('agent.finish_reason', finishReason);
        span.setAttribute('llm.total_tokens',    usage.totalTokens);

        const runResult: AgentRunResult = {
            text:     finalText,
            markdown: {
                name:     `${this.config.name}-response.md`,
                content:  finalText,
                mimeType: 'text/markdown',
                type:     'markdown',
            },
            messages: [...messages], // snapshot; caller should not mutate
            steps,
            finishReason,
            ...(usage.totalTokens > 0 && { usage }),
            ...(runConfig.runId && { runId: runConfig.runId }),
        };

        // Durable log: record run completion before returning (no-op without a recorder).
        await this.config.recorder?.agentEnd({ text: finalText, steps, finishReason });

        return lifecycle.afterRun
            ? ((await lifecycle.afterRun(runResult)))
            : runResult;
    }

    // ── Private: LLM call (SRP — LLM concerns isolated here) ────────────────

    private _callLLM(
        messages: Message[],
        llmTools: LLMToolDefinition[],
        useStreaming: boolean,
        streamHooks: RunnerStreamHooks | undefined,
        step: number,
        retry: RetryPolicy,
        signal?: AbortSignal,
    ): Promise<GenerateResult> {
        return withSpan(
            'llm.generate',
            { 'agent.step': step, 'llm.stream': useStreaming, ...genAiAttrs({ operation: 'chat' }) },
            () => withRetry(() => {
                const toolChoice: GenerateOptions['toolChoice'] = llmTools.length ? 'auto' : 'none';
                const opts: GenerateOptions = {
                    toolChoice,
                    ...(llmTools.length > 0 && { tools: llmTools }),
                    ...(streamHooks?.onChunk !== undefined && { onChunk: streamHooks.onChunk }),
                    ...(signal && { signal }),
                };
                if (useStreaming && this.config.llm.streamText) {
                    return this.config.llm.streamText(messages, opts);
                }
                return this.config.llm.generateText(messages, opts);
            }, retry),
        );
    }

    // ── Private: tool dispatch (SRP — tool concerns isolated here) ──────────

    private async _dispatchTools(
        toolCalls: NonNullable<GenerateResult['toolCalls']>,
        messages: Message[],
        lifecycle: AgentLifecycleHooks,
        streamHooks: RunnerStreamHooks | undefined,
        step: number,
        toolTimeoutMs: number,
        signal?: AbortSignal,
    ): Promise<void> {
        // Process all tool calls — order must be preserved for message history integrity
        for (const tc of toolCalls) {
            const tool = this.config.tools.get(tc.name);
            if (!tool) {
                messages.push({                                   // O(1)
                    role:         'tool',
                    content:      `Tool "${tc.name}" not found.`,
                    tool_call_id: tc.id,
                    name:         tc.name,
                });
                continue;
            }

            streamHooks?.onToolCall?.(tc.name, tc.arguments);

            let args = tc.arguments;
            if (lifecycle.beforeToolCall) {
                args = await lifecycle.beforeToolCall(tc.name, args, step);
            }

            let output: unknown;
            try {
                if (signal?.aborted) throw new Error(`Tool "${tc.name}" aborted`);
                // Race against per-tool deadline + abort signal — O(1) Promise.race overhead
                let timer: ReturnType<typeof setTimeout> | undefined;
                let onAbort: (() => void) | undefined;
                const timeout = new Promise<never>((_, rej) => {
                    timer = setTimeout(() => { rej(new Error(`Tool "${tc.name}" timed out after ${String(toolTimeoutMs)}ms`)); }, toolTimeoutMs);
                    if (signal) {
                        onAbort = () => { rej(new Error(`Tool "${tc.name}" aborted`)); };
                        signal.addEventListener('abort', onAbort, { once: true });
                    }
                });
                try {
                    output = await Promise.race([tool.execute(args), timeout]);
                } finally {
                    if (timer !== undefined) clearTimeout(timer);
                    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
                }
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                if (lifecycle.onError) await lifecycle.onError(error, step);
                output = `Error: ${error.message}`;
            }

            if (lifecycle.afterToolCall) {
                output = await lifecycle.afterToolCall(tc.name, output, args, step);
            }

            streamHooks?.onToolResult?.(tc.name, output);

            // Durable log: record this tool call (no-op without a recorder).
            await this.config.recorder?.toolResult({ step, name: tc.name, args, output });

            messages.push({                                        // O(1)
                role:         'tool',
                content:      serializeOutput(output),
                tool_call_id: tc.id,
                name:         tc.name,
            });
        }
    }
}
