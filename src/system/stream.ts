/**
 * Bridge agent StreamChunks → LangGraph-style StreamEvents for createSystem / supervisor.
 */

import {
    StreamEventBus,
    type StreamEvent,
    type StreamMode,
} from '../streaming/index.js';
import type { StreamChunk, AgentRunOptions, CreateAgentResult } from '../create-agent/types.js';

export const DEFAULT_SYSTEM_STREAM_MODES: StreamMode[] = ['updates', 'messages'];

export interface SystemStreamOptions extends Omit<AgentRunOptions, 'onChunk' | 'onToolCall' | 'onToolResult' | 'onStep'> {
    /**
     * LangGraph-compatible stream modes (combinable).
     * Default: `['updates', 'messages']`.
     */
    readonly streamMode?: readonly StreamMode[];
    /** Node / actor label on emitted events. Default: agent name. */
    readonly node?: string;
}

/**
 * Map a single agent StreamChunk onto a StreamEventBus (mode-filtered).
 * Returns true when a terminal chunk was handled (`run-finish` / `error`).
 */
export function bridgeChunkToBus(
    bus: StreamEventBus,
    chunk: StreamChunk,
    node: string,
): boolean {
    const ts = Date.now();

    switch (chunk.type) {
        case 'text-delta': {
            if (chunk.delta) {
                bus.emit({ type: 'token', data: chunk.delta, node, timestamp: ts });
            }
            return false;
        }
        case 'tool-call': {
            bus.emit({
                type: 'tool_call',
                data: {
                    name: chunk.tool?.name ?? 'unknown',
                    arguments: (chunk.tool?.input as Record<string, unknown>) ?? {},
                },
                node,
                timestamp: ts,
            });
            bus.emit({
                type: 'update',
                data: { kind: 'tool-call', tool: chunk.tool?.name, input: chunk.tool?.input },
                node,
                timestamp: ts,
            });
            return false;
        }
        case 'tool-result': {
            bus.emit({
                type: 'tool_call',
                data: {
                    name: chunk.tool?.name ?? 'unknown',
                    arguments: (chunk.tool?.input as Record<string, unknown>) ?? {},
                    result: chunk.tool?.output,
                },
                node,
                timestamp: ts,
            });
            bus.emit({
                type: 'update',
                data: { kind: 'tool-result', tool: chunk.tool?.name, output: chunk.tool?.output },
                node,
                timestamp: ts,
            });
            return false;
        }
        case 'step-finish': {
            bus.emit({
                type: 'update',
                data: { kind: 'step', stepNumber: chunk.stepNumber },
                node,
                timestamp: ts,
            });
            bus.emit({
                type: 'debug',
                data: { stepNumber: chunk.stepNumber, node },
                timestamp: ts,
            });
            return false;
        }
        case 'run-finish': {
            const run = chunk.run;
            bus.emit({
                type: 'value',
                data: {
                    text: run?.text,
                    finishReason: run?.finishReason,
                    steps: run?.steps,
                    usage: run?.usage,
                },
                node,
                timestamp: ts,
            });
            bus.emit({
                type: 'update',
                data: { kind: 'run-finish', text: run?.text, finishReason: run?.finishReason },
                node,
                timestamp: ts,
            });
            return true;
        }
        case 'error': {
            bus.emit({
                type: 'debug',
                data: {
                    error: chunk.error?.message ?? String(chunk.error),
                    node,
                },
                timestamp: ts,
            });
            bus.emit({
                type: 'update',
                data: { kind: 'error', error: chunk.error?.message ?? String(chunk.error) },
                node,
                timestamp: ts,
            });
            return true;
        }
        default:
            return false;
    }
}

/**
 * Stream LangGraph-style events from any agent that implements `streamEvents`.
 */
export function streamAgentEvents(
    agent: Pick<CreateAgentResult, 'streamEvents' | 'name'>,
    prompt: string,
    options: SystemStreamOptions = {},
): AsyncIterable<StreamEvent> {
    const modes = [...(options.streamMode ?? DEFAULT_SYSTEM_STREAM_MODES)];
    const node = options.node ?? agent.name ?? 'agent';
    const bus = new StreamEventBus(modes);
    const ac = new AbortController();

    const externalSignal = options.signal;
    if (externalSignal?.aborted) {
        ac.abort();
    } else if (externalSignal?.addEventListener) {
        externalSignal.addEventListener('abort', () => { ac.abort(); });
    }

    const { streamMode: _sm, node: _n, signal: _sig, ...runOptions } = options;

    const run = (async () => {
        try {
            for await (const chunk of agent.streamEvents(prompt, {
                ...runOptions,
                ...(options.signal ? { signal: options.signal } : {}),
            })) {
                if (ac.signal.aborted) break;
                bridgeChunkToBus(bus, chunk, node);
            }
        } catch (err) {
            bridgeChunkToBus(
                bus,
                {
                    type: 'error',
                    error: err instanceof Error ? err : new Error(String(err)),
                },
                node,
            );
            throw err;
        } finally {
            bus.close();
            ac.abort();
        }
    })();

    // Attach rejection handler so unhandled rejection does not fire if
    // the consumer only iterates events (errors also surface as debug/update).
    void run.catch(() => undefined);

    return bus.events(ac.signal);
}

/**
 * Text-only stream (messages mode tokens as strings).
 */
export async function* streamAgentText(
    agent: Pick<CreateAgentResult, 'stream' | 'name'>,
    prompt: string,
    options: Omit<SystemStreamOptions, 'streamMode'> = {},
): AsyncGenerator<string> {
    const { streamMode: _sm, node: _n, ...runOptions } = options as SystemStreamOptions;
    for await (const chunk of agent.stream(prompt, runOptions)) {
        yield chunk;
    }
}
