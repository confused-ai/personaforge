/**
 * LangGraph-style stream modes + control-plane wiring for createSystem.
 */

import { describe, it, expect, vi } from 'vitest';
import http from 'node:http';
import { createSystem } from '../src/system/create-system.js';
import { bridgeChunkToBus, streamAgentEvents } from '../src/system/stream.js';
import { StreamEventBus } from '../src/streaming/index.js';
import type { CreateAgentResult, StreamChunk } from '../src/create-agent/types.js';
import type { AgenticRunResult } from '../src/agentic/types.js';

function mockStreamingAgent(name: string, chunks: StreamChunk[]): CreateAgentResult {
    const result = {
        text: 'final',
        markdown: { name: 'response', content: 'final', mimeType: 'text/markdown' as const, type: 'markdown' as const },
        messages: [],
        steps: 1,
        finishReason: 'stop' as const,
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    } satisfies AgenticRunResult;

    const agent = {
        name,
        description: `${name} specialist`,
        instructions: `You are ${name}`,
        run: vi.fn().mockResolvedValue(result),
        generate: vi.fn(async (p: string, o?: unknown) => agent.run(p, o as never)),
        stream: vi.fn(async function* () {
            for (const c of chunks) {
                if (c.type === 'text-delta' && c.delta) yield c.delta;
            }
        }),
        streamEvents: vi.fn(async function* () {
            for (const c of chunks) yield c;
        }),
        createSession: vi.fn().mockResolvedValue('sess'),
        getSessionMessages: vi.fn().mockResolvedValue([]),
        getCompressionStats: vi.fn(),
        resume: vi.fn(),
        asTool: vi.fn(),
    } as unknown as CreateAgentResult;

    return agent;
}

describe('bridgeChunkToBus', () => {
    it('maps text-delta to token under messages mode', () => {
        const bus = new StreamEventBus(['messages']);
        const seen: string[] = [];
        bus.on((e) => {
            if (e.type === 'token') seen.push(e.data);
        });
        bridgeChunkToBus(bus, { type: 'text-delta', delta: 'hi' }, 'n1');
        expect(seen).toEqual(['hi']);
    });

    it('filters tokens when messages mode is off', () => {
        const bus = new StreamEventBus(['updates']);
        const seen: string[] = [];
        bus.on((e) => seen.push(e.type));
        bridgeChunkToBus(bus, { type: 'text-delta', delta: 'hi' }, 'n1');
        expect(seen).toEqual([]);
    });

    it('emits tool_call + update for tool-call chunks when debug+updates enabled', () => {
        const bus = new StreamEventBus(['debug', 'updates']);
        const seen: string[] = [];
        bus.on((e) => seen.push(e.type));
        bridgeChunkToBus(bus, { type: 'tool-call', tool: { name: 'search', input: { q: 'x' } } }, 'boss');
        expect(seen).toContain('tool_call');
        expect(seen).toContain('update');
    });
});

describe('streamAgentEvents / system.streamEvents', () => {
    it('streams LangGraph events from a coordinator via supervisor', async () => {
        const chunks: StreamChunk[] = [
            { type: 'text-delta', delta: 'Hel' },
            { type: 'text-delta', delta: 'lo' },
            { type: 'tool-call', tool: { name: 'research', input: { prompt: 't' } } },
            { type: 'tool-result', tool: { name: 'research', input: undefined, output: { ok: true } } },
            {
                type: 'run-finish',
                run: {
                    text: 'Hello',
                    markdown: { name: 'response', content: 'Hello', mimeType: 'text/markdown', type: 'markdown' },
                    messages: [],
                    steps: 1,
                    finishReason: 'stop',
                },
            },
        ];

        const coordinator = mockStreamingAgent('studio-supervisor', chunks);
        const research = mockStreamingAgent('research', []);

        const system = createSystem({
            name: 'studio',
            agents: { research: { agent: research, description: 'R' } },
            resilience: false,
        });

        const boss = system.supervisor({
            createCoordinator: () => coordinator,
        });

        const events = [];
        for await (const e of boss.streamEvents('hi', { streamMode: ['messages', 'updates', 'values', 'debug'] })) {
            events.push(e);
        }

        expect(events.some((e) => e.type === 'token' && e.data === 'Hel')).toBe(true);
        expect(events.some((e) => e.type === 'tool_call')).toBe(true);
        expect(events.some((e) => e.type === 'value')).toBe(true);
    });

    it('system.streamEvents delegates to default supervisor', async () => {
        const chunks: StreamChunk[] = [
            { type: 'text-delta', delta: 'x' },
            {
                type: 'run-finish',
                run: {
                    text: 'x',
                    markdown: { name: 'response', content: 'x', mimeType: 'text/markdown', type: 'markdown' },
                    messages: [],
                    steps: 1,
                    finishReason: 'stop',
                },
            },
        ];
        const coordinator = mockStreamingAgent('sys-supervisor', chunks);
        const system = createSystem({
            name: 'sys',
            resilience: false,
        });

        // Patch by building streamEvents through createCoordinator path
        const tokens: string[] = [];
        for await (const e of streamAgentEvents(coordinator, 'p', { streamMode: ['messages'] })) {
            if (e.type === 'token') tokens.push(e.data);
        }
        expect(tokens).toEqual(['x']);

        // Also exercise system.streamEvents with injected coordinator
        const events = [];
        for await (const e of system.streamEvents('p', {
            streamMode: ['messages'],
            supervisor: { createCoordinator: () => coordinator },
        })) {
            events.push(e);
        }
        expect(events.some((e) => e.type === 'token')).toBe(true);
    });
});

describe('createSystem controlPlane wiring', () => {
    it('exposes /api/system snapshot and /api/chat', async () => {
        const research = mockStreamingAgent('research', [
            {
                type: 'run-finish',
                run: {
                    text: 'ok',
                    markdown: { name: 'response', content: 'ok', mimeType: 'text/markdown', type: 'markdown' },
                    messages: [],
                    steps: 1,
                    finishReason: 'stop',
                },
            },
        ]);
        research.run = vi.fn().mockResolvedValue({
            text: 'ok',
            markdown: { name: 'response', content: 'ok', mimeType: 'text/markdown', type: 'markdown' },
            messages: [],
            steps: 1,
            finishReason: 'stop',
        });

        const system = createSystem({
            name: 'wired',
            description: 'Wired system',
            agents: { research: { agent: research, description: 'R' } },
            resilience: false,
        });

        const cp = system.controlPlane({
            supervisor: { createCoordinator: () => mockStreamingAgent('wired-supervisor', []) },
        });

        await cp.start(0);
        // Discover bound port
        const server = (cp as unknown as { /* peek via request */ });
        void server;

        // Start on an ephemeral port by wrapping — createControlPlane needs a known port.
        // Re-bind: stop and use a free port.
        await cp.stop();

        const port = await new Promise<number>((resolve, reject) => {
            const s = http.createServer();
            s.listen(0, '127.0.0.1', () => {
                const addr = s.address();
                if (!addr || typeof addr === 'string') {
                    reject(new Error('no port'));
                    return;
                }
                const p = addr.port;
                s.close(() => resolve(p));
            });
        });

        const live = system.controlPlane({
            supervisor: {
                createCoordinator: () => {
                    const c = mockStreamingAgent('wired-supervisor', [
                        { type: 'text-delta', delta: 'hi' },
                        {
                            type: 'run-finish',
                            run: {
                                text: 'hi',
                                markdown: { name: 'response', content: 'hi', mimeType: 'text/markdown', type: 'markdown' },
                                messages: [],
                                steps: 1,
                                finishReason: 'stop',
                            },
                        },
                    ]);
                    c.run = vi.fn().mockResolvedValue({
                        text: 'hi',
                        markdown: { name: 'response', content: 'hi', mimeType: 'text/markdown', type: 'markdown' },
                        messages: [],
                        steps: 1,
                        finishReason: 'stop',
                    });
                    return c;
                },
            },
        });
        await live.start(port);

        try {
            const sysRes = await fetch(`http://127.0.0.1:${port}/api/system`);
            const sysBody = await sysRes.json() as { system: { name: string; agents: string[] } };
            expect(sysBody.system.name).toBe('wired');
            expect(sysBody.system.agents).toContain('research');

            const agentsRes = await fetch(`http://127.0.0.1:${port}/api/agents`);
            const agentsBody = await agentsRes.json() as { agents: Array<{ name: string }> };
            expect(agentsBody.agents.map((a) => a.name)).toContain('research');
            expect(agentsBody.agents.map((a) => a.name)).toContain('wired-supervisor');

            const chatRes = await fetch(`http://127.0.0.1:${port}/api/chat`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ agent: 'wired-supervisor', prompt: 'hello' }),
            });
            const chatBody = await chatRes.json() as { text: string };
            expect(chatBody.text).toBe('hi');

            const streamRes = await fetch(`http://127.0.0.1:${port}/api/chat/stream`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    agent: 'wired-supervisor',
                    prompt: 'hello',
                    streamMode: ['messages', 'updates', 'values'],
                }),
            });
            const streamText = await streamRes.text();
            expect(streamText).toContain('data: ');
            expect(streamText).toContain('"type":"done"');
        } finally {
            await live.stop();
        }
    });
});
