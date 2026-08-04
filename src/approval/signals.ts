/**
 * Agent approval — human-in-the-loop signals.
 *
 * Two suspension mechanisms:
 * - `ApprovalRequiredSignal`: a tool call is paused BEFORE `execute` runs.
 *   Raised when `requireApproval` is set on the tool or `requireToolApproval`
 *   on the run.
 * - `ToolSuspendedSignal`: a tool self-pauses DURING `execute` by calling
 *   `context.agent.suspend(payload)` to request more input.
 */

import type { ToolCall as LLMToolCall } from '../core/index.js';

export interface ToolApprovalRequest {
    readonly runId?: string;
    readonly toolCallId: string;
    readonly toolName: string;
    readonly args: Record<string, unknown>;
    readonly agentId?: string;
    readonly threadId?: string;
    readonly resourceId?: string;
}

/** Raised before a tool executes when human approval is required. */
export class ApprovalRequiredError extends Error {
    readonly toolCallId: string;
    readonly toolName: string;
    readonly args: Record<string, unknown>;
    readonly toolCall: LLMToolCall;
    readonly step: number;

    constructor(toolCall: LLMToolCall, step: number) {
        super(`Tool "${toolCall.name}" requires approval before execution`);
        this.name = 'ApprovalRequiredError';
        this.toolCall = toolCall;
        this.toolCallId = toolCall.id;
        this.toolName = toolCall.name;
        this.args = toolCall.arguments;
        this.step = step;
    }
}

/** Raised inside a tool's `execute` when it calls `context.agent.suspend(...)`. */
export class ToolSuspendedError extends Error {
    readonly payload: unknown;
    readonly toolCallId?: string;
    readonly toolName: string;

    constructor(payload: unknown, info?: { toolName?: string; toolCallId?: string }) {
        super(`Tool suspended awaiting input${info?.toolName ? ` (${info.toolName})` : ''}`);
        this.name = 'ToolSuspendedError';
        this.payload = payload;
        this.toolName = info?.toolName ?? '';
        this.toolCallId = info?.toolCallId;
    }
}

export function isApprovalRequiredError(e: unknown): e is ApprovalRequiredError {
    return !!e && typeof e === 'object' && (e as { name?: string }).name === 'ApprovalRequiredError';
}

export function isToolSuspendedError(e: unknown): e is ToolSuspendedError {
    return !!e && typeof e === 'object' && (e as { name?: string }).name === 'ToolSuspendedError';
}
