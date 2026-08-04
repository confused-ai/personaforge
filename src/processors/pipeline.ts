/**
 * Processor pipeline runner — invokes input/output/error processors at the
 * correct points in the agentic loop. Imported by the AgenticRunner.
 */

import type { ProcessorContext, Processor, ProcessorSet } from './types.js';
import { TripWireError, emitViolation } from './types.js';
import type {
    ProcessInputArgs,
    ProcessInputStepArgs,
    ProcessInputStepResult,
    ProcessLLMRequestArgs,
    ProcessLLMRequestResult,
    ProcessOutputStepArgs,
    ProcessOutputStepResult,
    StreamOutputPart,
    ProcessAPIErrorResult,
} from './types.js';
import type { Message } from '../core/index.js';

/** Flatten a processor-set value into a list. */
function toList(p: Processor | Processor[] | undefined): Processor[] {
    if (!p) return [];
    return Array.isArray(p) ? p : [p];
}

/** Resolve a ProcessorSet into ordered input/output/error arrays. */
export function resolveProcessorSet(set: ProcessorSet | undefined): {
    input: Processor[];
    output: Processor[];
    error: Processor[];
} {
    return {
        input: toList(set?.input),
        output: toList(set?.output),
        error: toList(set?.error),
    };
}

/** Build a fresh, per-request, per-processor state object. */
export function createProcessorState(): Record<string, unknown> {
    return Object.create(null);
}

async function syncSystemMessages(
    messages: Message[],
    systemMessages: Message[] | undefined,
): Promise<Message[]> {
    const system = systemMessages ?? [];
    if (system.length === 0) return messages;
    return [...system, ...messages.filter((m) => m.role !== 'system')];
}

/** Run input processors once before the agentic loop. Returns the rewritten messages. */
export async function runInputProcessors(
    processors: Processor[],
    messages: Message[],
    context: ProcessorContext,
    state: Record<string, unknown>,
): Promise<Message[]> {
    let current = messages;
    for (const processor of processors) {
        if (!processor.processInput) continue;
        const args: ProcessInputArgs = {
            messages: current,
            context,
            state: (state[processor.id] ??= {}) as Record<string, unknown>,
            abort(reason, options) {
                emitViolation(processor, {
                    processorId: processor.id,
                    message: reason ?? `Blocked by ${processor.id}`,
                    detail: options?.metadata,
                });
                const TWE = TripWireError;
                throw new TWE(processor.id, reason ?? `Blocked by ${processor.id}`, options);
            },
            sendSignal: async (signal) => {
                const ch = signal.contents;
                const attr = signal.attributes
                    ? Object.entries(signal.attributes)
                          .map(([k, v]) => ` ${k}="${String(v)}"`)
                          .join('')
                    : '';
                current = [...current, { role: 'user', content: `<system-reminder${attr}>${ch}</system-reminder>` }];
            },
        };
        const out = await processor.processInput(args);
        if (Array.isArray(out)) {
            current = out;
        } else if (out) {
            current = await syncSystemMessages(out.messages ?? current, out.systemMessages);
        }
    }
    return current;
}

/** Run input-step processors before a single LLM call. Returns per-step overrides. */
export async function runInputStepProcessors(
    processors: Processor[],
    args: { stepNumber: number; messages: Message[]; context: ProcessorContext },
    state: Record<string, unknown>,
): Promise<ProcessInputStepResult> {
    const overrides: ProcessInputStepResult = { signals: [] };
    for (const processor of processors) {
        if (!processor.processInputStep) continue;
        const stepArgs: ProcessInputStepArgs = {
            ...args,
            state: (state[processor.id] ??= {}) as Record<string, unknown>,
            abort(reason, options) {
                emitViolation(processor, {
                    processorId: processor.id,
                    message: reason ?? `Blocked by ${processor.id}`,
                    detail: options?.metadata,
                });
                const TWE = TripWireError;
                throw new TWE(processor.id, reason ?? `Blocked by ${processor.id}`, options);
            },
            sendSignal: async (signal) => {
                const ch = signal.contents;
                const attr = signal.attributes
                    ? Object.entries(signal.attributes)
                          .map(([k, v]) => ` ${k}="${String(v)}"`)
                          .join('')
                    : '';
                overrides.signals = [
                    ...(overrides.signals ?? []),
                    { role: 'user', content: `<system-reminder${attr}>${ch}</system-reminder>` },
                ];
            },
        };
        const out = await processor.processInputStep(stepArgs);
        if (!out) continue;
        if (out.model !== undefined) overrides.model = out.model;
        if (out.toolChoice !== undefined) overrides.toolChoice = out.toolChoice;
        if (out.tools !== undefined) overrides.tools = out.tools;
        if (out.systemMessages !== undefined) overrides.systemMessages = out.systemMessages;
    }
    return overrides;
}

/** Run LLM-request processors (final prompt rewrite + response cache lookup). */
export async function runLLMRequestProcessors(
    processors: Processor[],
    args: { messages: Message[]; model: string; stepNumber: number; steps: number; context: ProcessorContext },
    state: Record<string, unknown>,
): Promise<ProcessLLMRequestResult> {
    let current: ProcessLLMRequestResult = {};
    for (const processor of processors) {
        if (!processor.processLLMRequest) continue;
        const stepArgs: ProcessLLMRequestArgs = {
            ...args,
            state: (state[processor.id] ??= {}) as Record<string, unknown>,
            abort(reason, options) {
                emitViolation(processor, {
                    processorId: processor.id,
                    message: reason ?? `Blocked by ${processor.id}`,
                    detail: options?.metadata,
                });
                const TWE = TripWireError;
                throw new TWE(processor.id, reason ?? `Blocked by ${processor.id}`, options);
            },
        };
        const out = await processor.processLLMRequest(stepArgs);
        if (!out) continue;
        if (out.messages) current.messages = out.messages;
        if (out.cached) current.cached = out.cached;
    }
    return current;
}

/** Run LLM-response processors (side effects after a provider call). */
export async function runLLMResponseProcessors(
    processors: Processor[],
    args: { chunks: string[]; text: string; model: string; stepNumber: number; steps: number; fromCache?: boolean; context: ProcessorContext },
    state: Record<string, unknown>,
): Promise<void> {
    for (const processor of processors) {
        if (!processor.processLLMResponse) continue;
        await processor.processLLMResponse({
            ...args,
            state: (state[processor.id] ??= {}) as Record<string, unknown>,
        });
    }
}

/** Run output-step processors (per-step validation/retry). */
export async function runOutputStepProcessors(
    processors: Processor[],
    args: { text: string; messages: Message[]; retryCount: number; context: ProcessorContext },
    state: Record<string, unknown>,
): Promise<ProcessOutputStepResult> {
    let result: ProcessOutputStepResult = {};
    for (const processor of processors) {
        if (!processor.processOutputStep) continue;
        const stepArgs: ProcessOutputStepArgs = {
            ...args,
            state: (state[processor.id] ??= {}) as Record<string, unknown>,
            abort(reason, options) {
                emitViolation(processor, {
                    processorId: processor.id,
                    message: reason ?? `Blocked by ${processor.id}`,
                    detail: options?.metadata,
                });
                const TWE = TripWireError;
                throw new TWE(processor.id, reason ?? `Blocked by ${processor.id}`, options);
            },
        };
        const out = await processor.processOutputStep(stepArgs);
        if (out?.retry) {
            result.retry = true;
            if (out.feedback) result.feedback = out.feedback;
        }
    }
    return result;
}

/** Run output-result processors (final transform + metadata). */
export async function runOutputResultProcessors(
    processors: Processor[],
    args: { result: { text: string; steps?: number; finishReason?: string; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }; context: ProcessorContext },
    state: Record<string, unknown>,
    messages: Message[],
): Promise<Message[]> {
    let current = messages;
    for (const processor of processors) {
        if (!processor.processOutputResult) continue;
        const out = await processor.processOutputResult({
            ...args,
            messages: current,
            state: (state[processor.id] ??= {}) as Record<string, unknown>,
        });
        if (Array.isArray(out)) current = out;
        else if (out && Array.isArray((out as { messages?: Message[] }).messages)) {
            current = (out as { messages: Message[] }).messages;
        }
    }
    return current;
}

/** Run output-stream processors — return null/undefined to drop the chunk. */
export async function filterOutputStreamPart(
    processors: Processor[],
    part: StreamOutputPart,
    context: ProcessorContext,
    state: Record<string, unknown>,
): Promise<StreamOutputPart | null> {
    let current: StreamOutputPart | null = part;
    for (const processor of processors) {
        if (!processor.processOutputStream) continue;
        if (part.type?.startsWith('data-') && !processor.processDataParts) continue;
        const out = await processor.processOutputStream({
            part: current!,
            context,
            state: (state[processor.id] ??= {}) as Record<string, unknown>,
        });
        if (out === null || out === undefined) {
            current = null;
            break;
        }
        current = out;
    }
    return current;
}

/** Run error processors to recover from provider API rejections. */
export async function runAPIErrorProcessors(
    processors: Processor[],
    args: { error: unknown; messages: Message[]; retryCount: number; context: ProcessorContext },
    state: Record<string, unknown>,
): Promise<ProcessAPIErrorResult> {
    let result: ProcessAPIErrorResult = {};
    for (const processor of processors) {
        if (!processor.processAPIError) continue;
        const out = await processor.processAPIError({
            ...args,
            state: (state[processor.id] ??= {}) as Record<string, unknown>,
        });
        if (out?.retry) result.retry = true;
        if (out?.messages) result.messages = out.messages;
    }
    return result;
}

/** Re-export the TripWireError type guard helper. */
export function isTripWireError(e: unknown): e is TripWireError {
    return !!e && typeof e === 'object' && (e as { name?: string }).name === 'TripWireError';
}
