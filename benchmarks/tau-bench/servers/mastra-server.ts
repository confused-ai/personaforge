/**
 * Mastra reference server for the cross-framework τ-bench protocol.
 * See benchmarks/tau-bench/PROTOCOL.md.
 *
 * Setup:
 *   npm i @mastra/core @ai-sdk/openai zod
 *   OPENAI_API_KEY=... bun benchmarks/tau-bench/servers/mastra-server.ts
 *
 * Endpoint: POST /tau-bench/run  (listens on PF_BENCH_PORT or 8814)
 *
 * NOTE: import paths follow Mastra's public API as of writing; pin versions in
 * your own environment. This file is a reference, not a dependency of
 * personaforge — it is only run when you want Mastra in the comparison matrix.
 */

import { serve } from 'bun';
// @ts-expect-error — optional peer, only installed when benchmarking Mastra
import { Agent } from '@mastra/core/agent';
// @ts-expect-error — optional peer
import { createTool } from '@mastra/core/tools';
// @ts-expect-error — optional peer
import { openai } from '@ai-sdk/openai';
import { z } from 'zod/v3';

const PORT = Number(process.env['PF_BENCH_PORT'] ?? 8814);
const MODEL = process.env['PF_IT_OPENAI_MODEL'] ?? 'gpt-4o-mini';

interface ProtocolTool {
    name: string;
    description: string;
    parameters?: { properties?: Record<string, { type?: string }> };
}
interface RunReq { instruction: string; tools: ProtocolTool[]; maxSteps?: number }

serve({
    port: PORT,
    fetch: async (req) => {
        const url = new URL(req.url);
        if (url.pathname !== '/tau-bench/run' || req.method !== 'POST') {
            return new Response('not found', { status: 404 });
        }
        try {
            const body = (await req.json()) as RunReq;
            const recorded: Array<{ name: string; arguments: Record<string, unknown>; result: unknown }> = [];
            const tools: Record<string, unknown> = {};
            for (const d of body.tools) {
                const shape: Record<string, z.ZodTypeAny> = {};
                for (const [k, v] of Object.entries(d.parameters?.properties ?? {})) {
                    shape[k] = v.type === 'number' ? z.number().optional() : z.string().optional();
                }
                tools[d.name] = createTool({
                    id: d.name,
                    description: d.description,
                    inputSchema: z.object(shape),
                    execute: async ({ context }: { context: Record<string, unknown> }) => {
                        recorded.push({ name: d.name, arguments: context, result: { ok: true } });
                        return { ok: true, echoed: context };
                    },
                });
            }
            const agent = new Agent({
                name: 'benchmark',
                instructions: 'Use the tools to satisfy the request with correct arguments.',
                model: openai(MODEL),
                tools,
            });
            const started = performance.now();
            const res = await agent.generate(body.instruction, { maxSteps: body.maxSteps ?? 8 });
            return Response.json({
                framework: 'mastra',
                text: res.text ?? '',
                toolCalls: recorded,
                steps: res.steps?.length ?? recorded.length + 1,
                finishReason: res.finishReason ?? 'stop',
                durationMs: performance.now() - started,
            });
        } catch (err) {
            return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
        }
    },
});
// eslint-disable-next-line no-console
console.log(`mastra τ-bench server on http://localhost:${PORT}`);
