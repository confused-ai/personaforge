/**
 * Tests for createHarness, createOrchestrator, pipelineAsTool, and asTool ergonomics.
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { createHarness } from '../src/harness/create-harness.js';
import { createOrchestrator } from '../src/harness/orchestrator.js';
import { pipelineAsTool } from '../src/tools/core/pipeline-as-tool.js';
import { agentAsTool, multiAgentTool } from '../src/tools/core/agent-as-tool.js';
import type { RunnableAgent } from '../src/tools/core/agent-as-tool.js';
import type { RunnablePipeline } from '../src/tools/core/pipeline-as-tool.js';
import type { RunnableWorkflow } from '../src/tools/core/workflow-as-tool.js';

describe('createHarness()', () => {
    it('runs the underlying agent', async () => {
        const agent: RunnableAgent = {
            run: vi.fn().mockResolvedValue({ text: 'ok' }),
        };
        const harness = createHarness({ agent, resilience: false });
        const result = await harness.run({ prompt: 'hi' }, { sessionId: 's1' });
        expect(result).toEqual({ text: 'ok' });
        expect(agent.run).toHaveBeenCalled();
    });

    it('exposes asTool with outputSchema validation', async () => {
        const agent: RunnableAgent = {
            run: vi.fn().mockResolvedValue({ answer: 42 }),
        };
        const harness = createHarness({ agent, resilience: false, nesting: { maxDepth: 3 } });
        const t = harness.asTool({
            name: 'specialist',
            description: 'A specialist',
            outputSchema: z.object({ answer: z.number() }),
        });
        const result = await t.execute({ prompt: 'q' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ answer: 42 });
        expect(harness.maxDepth).toBe(3);
    });

    it('enforces nesting depth on asTool', async () => {
        const agent: RunnableAgent = {
            run: vi.fn().mockResolvedValue({ text: 'x' }),
        };
        const harness = createHarness({ agent, resilience: false, nesting: { maxDepth: 0 } });
        const t = harness.asTool({ name: 'nested', description: 'nested' });
        const result = await t.execute({ prompt: 'q' });
        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('nesting depth');
    });
});

describe('pipelineAsTool()', () => {
    it('runs a pipeline and returns its result', async () => {
        const pipeline: RunnablePipeline = {
            run: vi.fn().mockResolvedValue({ text: 'piped' }),
        };
        const t = pipelineAsTool({
            name: 'pipe',
            description: 'A pipeline',
            pipeline,
            parameters: z.object({ prompt: z.string() }),
        });
        const result = await t.execute({ prompt: 'go' }, { sessionId: 'sess' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ text: 'piped' });
        expect(pipeline.run).toHaveBeenCalledWith('go', { sessionId: 'sess' });
    });

    it('supports mapInput and transformOutput', async () => {
        const pipeline: RunnablePipeline = {
            run: vi.fn().mockResolvedValue({ text: 'raw' }),
        };
        const t = pipelineAsTool({
            name: 'pipe',
            description: 'A pipeline',
            pipeline,
            parameters: z.object({ topic: z.string() }),
            mapInput: (p) => `Topic: ${(p as { topic: string }).topic}`,
            transformOutput: (out) => ({ ...(out as object), ok: true }),
        });
        const result = await t.execute({ topic: 'AI' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ text: 'raw', ok: true });
        expect(pipeline.run).toHaveBeenCalledWith('Topic: AI', expect.any(Object));
    });
});

describe('createOrchestrator()', () => {
    it('wires agent, workflow, and pipeline specialists as tools', async () => {
        const specialist: RunnableAgent = {
            run: vi.fn().mockResolvedValue({ text: 'specialist-done' }),
        };
        const workflow: RunnableWorkflow = {
            execute: vi.fn().mockResolvedValue({ status: 'completed', results: { done: true } }),
        };
        const pipeline: RunnablePipeline = {
            run: vi.fn().mockResolvedValue({ text: 'pipeline-done' }),
        };

        const receivedTools: string[] = [];
        const coordinator: RunnableAgent & { name: string; instructions: string } = {
            name: 'coord',
            instructions: 'coordinate',
            run: vi.fn().mockImplementation(async () => ({ text: 'final' })),
        };

        const orch = createOrchestrator({
            createCoordinator: (tools) => {
                receivedTools.push(...tools.map((t) => t.name));
                return coordinator;
            },
            specialists: [
                { name: 'research', description: 'Research', agent: specialist },
                { name: 'pipeline_wf', description: 'WF', workflow },
                { name: 'compose_pipe', description: 'Pipe', pipeline },
            ],
            harness: { resilience: false },
        });

        expect(receivedTools).toEqual(['research', 'pipeline_wf', 'compose_pipe']);
        expect(orch.tools).toHaveLength(3);

        const researchResult = await orch.tools[0]!.execute({ prompt: 'q' });
        expect(researchResult.success).toBe(true);

        const wfResult = await orch.tools[1]!.execute({ topic: 'x', input: {} });
        expect(wfResult.success).toBe(true);
        expect(wfResult.data).toEqual({ done: true });

        const pipeResult = await orch.tools[2]!.execute({ prompt: 'q' });
        expect(pipeResult.success).toBe(true);

        const final = await orch.run({ prompt: 'go' });
        expect(final).toEqual({ text: 'final' });
    });

    it('exposes the orchestrator itself as a tool', async () => {
        const coordinator: RunnableAgent & { name: string; instructions: string } = {
            name: 'coord',
            instructions: 'coordinate',
            run: vi.fn().mockResolvedValue({ text: 'final' }),
        };
        const orch = createOrchestrator({
            createCoordinator: () => coordinator,
            specialists: [],
            harness: { resilience: false },
        });
        const t = orch.asTool({ name: 'orch', description: 'Full orchestrator' });
        const result = await t.execute({ prompt: 'go' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ text: 'final' });
    });
});

describe('multiAgentTool()', () => {
    it('creates one tool per named agent', async () => {
        const a: RunnableAgent = { run: vi.fn().mockResolvedValue({ text: 'a' }) };
        const b: RunnableAgent = { run: vi.fn().mockResolvedValue({ text: 'b' }) };
        const tools = multiAgentTool({
            agents: { alpha: a, beta: b },
            descriptions: { alpha: 'Alpha agent', beta: 'Beta agent' },
        });
        expect(tools).toHaveLength(2);
        expect(tools[0]!.name).toBe('alpha');
        expect(tools[1]!.name).toBe('beta');
        const r = await tools[0]!.execute({ prompt: 'x' });
        expect(r.success).toBe(true);
        expect(r.data).toEqual({ text: 'a' });
    });
});

describe('agentAsTool CreateAgentResult adapter', () => {
    it('stringifies object input for CreateAgentResult-like agents', async () => {
        const run = vi.fn().mockResolvedValue({ text: 'translated' });
        const createAgentLike = {
            name: 'translator',
            instructions: 'Translate',
            createSession: vi.fn(),
            run,
        };
        const t = agentAsTool({
            name: 'translate',
            description: 'Translate',
            agent: createAgentLike as unknown as RunnableAgent,
            parameters: z.object({ prompt: z.string() }),
        });
        const result = await t.execute({ prompt: 'hello' });
        expect(result.success).toBe(true);
        expect(run).toHaveBeenCalledWith('hello', { sessionId: 'unknown' });
    });
});

describe('agentAsTool nesting depth (ALS)', () => {
    it('allows nested calls within maxDepth and blocks beyond', async () => {
        const leaf: RunnableAgent = {
            run: vi.fn().mockResolvedValue({ text: 'leaf' }),
        };

        // maxDepth: 1 — parent may run, but a nested agent-tool call is blocked
        const leafTool = agentAsTool({
            name: 'leaf',
            description: 'leaf',
            agent: leaf,
            maxDepth: 1,
        });

        const mid: RunnableAgent = {
            run: async () => {
                const r = await leafTool.execute({ prompt: 'from-mid' });
                if (!r.success) throw new Error(r.error?.message ?? 'mid failed');
                return r.data;
            },
        };
        const midTool = agentAsTool({
            name: 'mid',
            description: 'mid',
            agent: mid,
            maxDepth: 1,
        });

        // depth 0 -> mid enters at 1; leaf sees depth 1 >= maxDepth 1 → blocked
        const blocked = await midTool.execute({ prompt: 'go' });
        expect(blocked.success).toBe(false);
        expect(blocked.error?.message).toContain('nesting depth');

        // With higher limit, nested call succeeds
        const leaf2 = agentAsTool({
            name: 'leaf2',
            description: 'leaf2',
            agent: leaf,
            maxDepth: 5,
        });
        const mid2: RunnableAgent = {
            run: async () => {
                const r = await leaf2.execute({ prompt: 'from-mid' });
                if (!r.success) throw new Error(r.error?.message ?? 'fail');
                return r.data;
            },
        };
        const midTool2 = agentAsTool({
            name: 'mid2',
            description: 'mid2',
            agent: mid2,
            maxDepth: 5,
        });
        const ok = await midTool2.execute({ prompt: 'go' });
        expect(ok.success).toBe(true);
        expect(ok.data).toEqual({ text: 'leaf' });
    });
});
