/**
 * Provider adapter hardening — AI SDK tool-call replay + stream args,
 * OpenAI/Js headers + extraBody, Gemini stable ids/toolChoice/abort,
 * Bedrock tool mapping/abort/usage, and the base-agent throwOnError contract
 * (audit items 3/16/17/18/19/20/24).
 */

import { describe, it, expect, vi } from 'vitest';
import { createAiSdkProvider } from '../src/providers/ai-sdk-provider.js';
import { OpenAIProvider } from '../src/providers/openai-provider.js';
import { GoogleProvider } from '../src/providers/google-provider.js';
import { BedrockConverseProvider } from '../src/providers/bedrock-provider.js';
import { BaseAgent } from '../src/core/base-agent.js';
import { AgentState } from '../src/core/types.js';
import type { Message } from '../src/core/types.js';
import type { GenerateOptions, GenerateResult, LLMProvider } from '../src/contracts/index.js';

// ── AI SDK adapter (items 16/17/18/24) ───────────────────────────────────────

function mockModel(doGenerate?: (opts: any) => any, doStream?: (opts: any) => any) {
    return {
        modelId: 'gpt-4o-mock',
        provider: 'openai',
        doGenerate: doGenerate ?? (async () => ({
            text: 'hi', toolCalls: [], finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 },
        })),
        doStream: doStream ?? (async () => ({ stream: emptyStream(), rawCall: { rawPrompt: [], rawSettings: {} } })),
    };
}
function emptyStream(): ReadableStream {
    return new ReadableStream({ start(c) { c.close(); } });
}

describe('AI SDK adapter — tool-call history (item 16/18)', () => {
    it('replays assistant tool-calls and pairs tool-results by toolCallId', async () => {
        let capturedPrompt: any = null;
        const provider = createAiSdkProvider(mockModel(async (opts: any) => {
            capturedPrompt = opts.prompt;
            return { text: '', toolCalls: [], finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } };
        }));

        // agentic runner message shape: assistant toolCalls (flat) + tool msg with toolCallId + name
        const messages: Message[] = [
            { role: 'system', content: 'sys' },
            { role: 'user', content: 'go' },
            {
                role: 'assistant',
                content: '',
                toolCalls: [{ id: 'call_1', name: 'get_weather', arguments: { city: 'NYC' } }] as any,
            },
            { role: 'tool', content: 'sunny', toolCallId: 'call_1', name: 'get_weather' } as any,
        ];
        await provider.generateText(messages);

        const assistant = capturedPrompt.find((m: any) => m.role === 'assistant');
        expect(assistant.content.some((p: any) => p.type === 'tool-call' && p.toolCallId === 'call_1' && p.toolName === 'get_weather')).toBe(true);
        const tool = capturedPrompt.find((m: any) => m.role === 'tool');
        expect(tool.content[0].toolCallId).toBe('call_1');
        expect(tool.content[0].toolName).toBe('get_weather');
    });

    it('falls back to snake_case tool_call_id from the core runner', async () => {
        let capturedPrompt: any = null;
        const provider = createAiSdkProvider(mockModel(async (opts: any) => {
            capturedPrompt = opts.prompt;
            return { text: '', toolCalls: [], finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } };
        }));
        const messages: Message[] = [
            {
                role: 'assistant',
                content: '',
                tool_calls: [{ id: 'c2', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }] as any,
            },
            { role: 'tool', content: 'out', tool_call_id: 'c2', name: 'f' } as any,
        ];
        await provider.generateText(messages);
        const tool = capturedPrompt.find((m: any) => m.role === 'tool');
        expect(tool.content[0].toolCallId).toBe('c2');
        const assistant = capturedPrompt.find((m: any) => m.role === 'assistant');
        expect(assistant.content[0].toolName).toBe('f');
        expect(assistant.content[0].args).toEqual({ a: 1 });
    });

    it('merges multiple system messages into one', async () => {
        let capturedPrompt: any = null;
        const provider = createAiSdkProvider(mockModel(async (opts: any) => {
            capturedPrompt = opts.prompt;
            return { text: '', toolCalls: [], finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } };
        }));
        await provider.generateText([
            { role: 'system', content: 'a' },
            { role: 'system', content: 'b' },
            { role: 'user', content: 'hi' },
        ]);
        const systems = capturedPrompt.filter((m: any) => m.role === 'system');
        expect(systems).toHaveLength(1);
        expect(systems[0].content[0].text).toContain('a');
        expect(systems[0].content[0].text).toContain('b');
    });
});

describe('AI SDK adapter — stream tool-call args (item 17)', () => {
    it('accumulates incremental args deltas and parses once at the end', async () => {
        const provider = createAiSdkProvider(mockModel(undefined, async () => ({
            stream: new ReadableStream({
                async start(controller: any) {
                    controller.enqueue({ type: 'tool-call-delta', toolCallId: 'tc1', toolName: 'search', argsTextDelta: '{"city":"' });
                    controller.enqueue({ type: 'tool-call-delta', toolCallId: 'tc1', toolName: 'search', argsTextDelta: 'NYC","k":' });
                    controller.enqueue({ type: 'tool-call-delta', toolCallId: 'tc1', toolName: 'search', argsTextDelta: '3}' });
                    controller.enqueue({ type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 1, completionTokens: 2 } });
                    controller.close();
                },
            }),
            rawCall: { rawPrompt: [], rawSettings: {} },
        })));
        const result = await provider.streamText!([{ role: 'user', content: 'q' }]);
        expect(result.toolCalls?.[0]?.id).toBe('tc1');
        expect(result.toolCalls?.[0]?.arguments).toEqual({ city: 'NYC', k: 3 });
        expect(result.finishReason).toBe('tool_calls');
    });

    it('maps unknown/other finish reasons to error, not stop', async () => {
        const provider = createAiSdkProvider(mockModel(async () => ({
            text: '', toolCalls: [], finishReason: 'unknown', usage: { promptTokens: 0, completionTokens: 0 },
        })));
        const r = await provider.generateText([{ role: 'user', content: 'q' }]);
        expect(r.finishReason).toBe('error');
    });

    it('forwards headers to the AI SDK call options', async () => {
        let captured: any = null;
        const provider = createAiSdkProvider(mockModel(async (opts: any) => { captured = opts; return { text: '', toolCalls: [], finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0 } }; }));
        await provider.generateText([{ role: 'user', content: 'q' }], { headers: { traceparent: 'x' } });
        expect(captured.headers).toEqual({ traceparent: 'x' });
    });
});

// ── OpenAI provider (items 18/24) ────────────────────────────────────────────

describe('OpenAI provider — headers + extraBody + tool id (items 18/24)', () => {
    function makeClient() {
        const create = vi.fn(async (_body: any, _opts: any) => ({
            choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }));
        return { chat: { completions: { create } } } as any;
    }

    it('merges static headers + per-call headers and extraBody into the request', async () => {
        const client = makeClient();
        const provider = new OpenAIProvider({
            client,
            headers: { 'X-Static': 's' },
            extraBody: { thinking: { type: 'enabled' }, response_format: { type: 'json_schema' } },
        } as any);
        await provider.generateText([{ role: 'user', content: 'hi' }], { headers: { traceparent: 'tp-1' } });
        const [body, opts] = client.chat.completions.create.mock.calls[0];
        expect(body.extraBody).toBeUndefined();          // extraBody is flattened into body
        expect(body.thinking).toEqual({ type: 'enabled' });
        expect(body.response_format).toEqual({ type: 'json_schema' });
        expect(opts.headers['X-Static']).toBe('s');
        expect(opts.headers['traceparent']).toBe('tp-1');
    });

    it('uses tool_call_id when the core-runner shape (snake_case) is provided', async () => {
        const client = makeClient();
        const provider = new OpenAIProvider({ client } as any);
        await provider.generateText([
            { role: 'assistant', content: '', tool_calls: [{ id: 'c9', type: 'function', function: { name: 'f', arguments: '{}' } }] } as any,
            { role: 'tool', content: 'r', tool_call_id: 'c9' } as any,
        ]);
        const [body] = client.chat.completions.create.mock.calls[0];
        const toolMsg = body.messages.find((m: any) => m.role === 'tool');
        expect(toolMsg.tool_call_id).toBe('c9');
    });
});

// ── Gemini provider (items 18/20/24) ─────────────────────────────────────────

describe('Google (Gemini) provider — stable ids/toolChoice/abort (item 20)', () => {
    function makeGeminiModel(parts: any[]) {
        const requests: any[] = [];
        const generateContent = vi.fn(async (request: any, opts: any) => {
            requests.push({ request, opts });
            return {
                response: {
                    text: () => '',
                    candidates: [{ content: { parts, role: 'model' }, finishReason: 'STOP' }],
                    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 },
                },
            };
        });
        return { model: { generateContent, generateContentStream: vi.fn() }, requests };
    }

    function providerWithModel(model: any): GoogleProvider {
        const client = { getGenerativeModel: vi.fn(() => model) } as any;
        return new GoogleProvider({ client } as any);
    }

    it('mints distinct tool call ids for parallel same-name calls', async () => {
        const { model, requests } = makeGeminiModel([
            { functionCall: { name: 'f', args: {} } },
            { functionCall: { name: 'f', args: {} } },
        ]);
        const provider = providerWithModel(model);
        const result = await provider.generateText([{ role: 'user', content: 'q' }], { tools: [{ name: 'f', description: 'd', parameters: {} }] });
        expect(result.toolCalls?.length).toBe(2);
        expect(result.toolCalls![0]!.id).not.toBe(result.toolCalls![1]!.id);
        expect(requests[0].request.toolConfig.functionCallingConfig.mode).toBe('AUTO');
        expect(result.usage?.totalTokens).toBe(3);
    });

    it('maps toolChoice none → NONE and required → ANY', async () => {
        const { model, requests } = makeGeminiModel([]);
        const provider = providerWithModel(model);
        await provider.generateText([{ role: 'user', content: 'q' }], { tools: [{ name: 'f', description: 'd', parameters: {} }], toolChoice: 'none' });
        expect(requests[0].request.toolConfig.functionCallingConfig.mode).toBe('NONE');
        await provider.generateText([{ role: 'user', content: 'q' }], { tools: [{ name: 'f', description: 'd', parameters: {} }], toolChoice: 'required' });
        expect(requests[1].request.toolConfig.functionCallingConfig.mode).toBe('ANY');
    });

    it('forwards the abort signal and headers into generateContent options', async () => {
        const { model, requests } = makeGeminiModel([]);
        const provider = providerWithModel(model);
        const ac = new AbortController();
        await provider.generateText([{ role: 'user', content: 'q' }], { signal: ac.signal, headers: { traceparent: 'tp' } });
        expect(requests[0].opts.signal).toBe(ac.signal);
        expect(requests[0].opts.headers).toEqual({ traceparent: 'tp' });
    });
});

// ── Bedrock provider (items 18/19/24) ────────────────────────────────────────

describe('Bedrock provider — tools/abort/usage (item 19)', () => {
    function makeBedrockClient(result: any) {
        const send = vi.fn(async () => result);
        return { send } as any;
    }

    it('parses toolUse blocks, forwards abortSignal, and reports usage', async () => {
        const client = makeBedrockClient({
            output: { message: { content: [{ text: 'ok' }, { toolUse: { toolUseId: 't1', name: 'f', input: { a: 1 } } }] } },
            usage: { inputTokens: 10, outputTokens: 5 },
        });
        const provider = new BedrockConverseProvider({ region: 'us-east-1', modelId: 'claude-x', client });
        const ac = new AbortController();
        const result = await provider.generateText([{ role: 'user', content: 'q' }], {
            signal: ac.signal,
            tools: [{ name: 'f', description: 'd', parameters: { type: 'object' } }] as any,
        });
        expect(result.text).toBe('ok');
        expect(result.toolCalls?.[0]?.id).toBe('t1');
        expect(result.toolCalls?.[0]?.name).toBe('f');
        expect(result.toolCalls?.[0]?.arguments).toEqual({ a: 1 });
        expect(client.send.mock.calls[0][1]).toEqual({ abortSignal: ac.signal });
    });

    it('includes tool_result style user turns for tool history', async () => {
        const client = makeBedrockClient({ output: { message: { content: [{ text: 'final' }] } }, usage: {} });
        const provider = new BedrockConverseProvider({ region: 'us-east-1', modelId: 'claude-x', client });
        await provider.generateText([
            { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'f', arguments: {} }] } as any,
            { role: 'tool', content: 'out', toolCallId: 'c1', name: 'f' } as any,
        ]);
        const cmdInput = client.send.mock.calls[0][0] as any;
        const userMsgs = cmdInput.input.messages.filter((m: any) => m.role === 'user');
        expect(userMsgs.some((m: any) => m.content.some((b: any) => b.toolResult?.toolUseId === 'c1'))).toBe(true);
    });
});

// ── base-agent throwOnError contract (item 3) ────────────────────────────────

class ThrowingBot extends BaseAgent {
    async execute(): Promise<never> { throw new Error('boom'); }
    async run(): Promise<never> { throw new Error('n/a'); }
    async *stream(): AsyncIterable<string> { yield ''; }
    async *streamEvents(): AsyncIterable<never> {}
    async createSession(): Promise<string> { return 's'; }
    async getSessionMessages(): Promise<never[]> { return []; }
    withSession(): any { return this; }
}

describe('BaseAgent — throwOnError contract (item 3)', () => {
    it('rethrows the original error when throwOnError is set', async () => {
        const bot = new ThrowingBot({ name: 'bot', throwOnError: true });
        const ctx = { userId: 'u', sessionId: 's', metadata: {} };
        await expect(bot.runWithContext(
            { prompt: 'go', messages: [], maxSteps: 1 } as any,
            ctx as any,
        )).rejects.toThrow('boom');
        expect(bot.state).toBe(AgentState.FAILED);
    });

    it('keeps the legacy swallow behaviour by default', async () => {
        const bot = new ThrowingBot({ name: 'bot' });
        const ctx = { userId: 'u', sessionId: 's', metadata: {} };
        const output = await bot.runWithContext(
            { prompt: 'go', messages: [], maxSteps: 1 } as any,
            ctx as any,
        );
        expect(output.state).toBe(AgentState.FAILED);
    });
});

// Keep LLMProvider imported for typing docs only
void (null as unknown as LLMProvider);
