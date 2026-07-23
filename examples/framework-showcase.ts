/**
 * End-to-end demo: session + tools + guardrails + SDK (`defineAgent`, workflows),
 * core orchestration (pipeline + `Agent` adapter), observability, metrics, health,
 * and optional HTTP runtime — all using this framework.
 *
 * Run: `bun run example:showcase`  or  `bun examples/framework-showcase.ts`
 * HTTP: `bun examples/framework-showcase.ts --http`  →  POST /v1/chat, GET /health, GET /v1/openapi.json
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { z } from 'zod';

import { createAgent, resolveLlmForCreateAgent } from 'personaforge';
import { InMemorySessionStore } from 'personaforge';
import { CalculatorAddTool } from 'personaforge';
import { GuardrailValidator, createSensitiveDataRule } from 'personaforge';
import { ConsoleLogger } from 'personaforge';
import { LogLevel } from 'personaforge';
import { MetricsCollectorImpl } from 'personaforge';
import { InMemoryStore, MemoryType } from 'personaforge';
import { ToolRegistryImpl } from 'personaforge';
import { ClassicalPlanner, PlanningAlgorithm } from 'personaforge';
import {
    defineAgent,
    createWorkflow,
    asOrchestratorAgent,
    type DefinedAgent,
} from 'personaforge';
import { createPipeline } from 'personaforge';
import { AgentContextBuilder } from 'personaforge';
import {
    HealthCheckManager,
    HealthStatus,
    createSessionStoreHealthCheck,
    createCustomHealthCheck,
} from 'personaforge/production';
import { createHttpService, listenService, getRuntimeOpenApiJson } from 'personaforge/serve';
import { VERSION } from 'personaforge';

config({
    path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env'),
    quiet: true,
});

function log(title: string) {
    console.log(`\n${'='.repeat(12)} ${title} ${'='.repeat(12)}\n`);
}

async function sectionHealthAndMetrics(sessionStore: InMemorySessionStore) {
    log('Health + metrics');
    const health = new HealthCheckManager({ version: VERSION });
    health.addComponent(createSessionStoreHealthCheck(sessionStore, 'session'));
    health.addComponent(
        createCustomHealthCheck('showcase', async () => ({
            status: HealthStatus.HEALTHY,
            message: 'ok',
        }))
    );
    const l = health.liveness();
    console.log('Liveness', l.status, 'uptime(s)', l.uptime);
    const full = await health.check();
    console.log('Full check status:', full.status, 'components:', full.components.length);

    const metrics = new MetricsCollectorImpl();
    metrics.counter('showcase_runs', 1, { demo: 'true' });
    metrics.histogram('showcase_ms', 12, {});
    const values = metrics.getMetrics();
    console.log('Metrics samples:', values.length, values[0]?.name, 'type', values[0]?.type);
}

async function sectionCreateAgent(agent: Awaited<ReturnType<typeof createAgent>>) {
    log('createAgent (session, tools, guardrails, logger, stream hooks)');
    const logger = new ConsoleLogger({ minLevel: LogLevel.DEBUG, prefix: '[Showcase]' });
    const sessionId = await agent.createSession('user-showcase-1');
    const chunks: string[] = [];
    const r1 = await agent.run('Remember we are in the showcase demo. What is 40 plus 2? Use the tool.', {
        sessionId,
        onChunk: (t) => chunks.push(t),
        onStep: (s) => logger.debug(`step ${s}`, { agentId: agent.name }, {}),
    });
    console.log('First reply (tool may run):', r1.text?.slice(0, 200));
    console.log('Finish:', r1.finishReason, 'steps:', r1.steps, 'streamed chars:', chunks.join('').length);

    const r2 = await agent.run('What did I just ask you to remember in my first message?', { sessionId });
    console.log('Second turn (session memory):', r2.text?.slice(0, 300));
}

async function sectionSdkWorkflow() {
    log('defineAgent + createWorkflow (sequential + context.results)');

    const PlanSchema = z.object({ goal: z.string() });
    const PlanOut = z.object({ steps: z.array(z.string()) });

    const planAgent = defineAgent({
        name: 'planner',
        inputSchema: PlanSchema,
        outputSchema: PlanOut,
        tools: [new CalculatorAddTool()],
        memory: new InMemoryStore(),
        handler: async (input) => ({
            steps: ['Gather context', `Focus on: ${input.goal}`, 'Ship'],
        }),
    });

    const ComposeSchema = z.object({ goal: z.string() });
    const ComposeOut = z.object({ oneLiner: z.string() });

    const composeAgent = defineAgent({
        name: 'composer',
        inputSchema: ComposeSchema,
        outputSchema: ComposeOut,
        memory: new InMemoryStore(),
        handler: async (input, ctx) => {
            const results = (ctx as Record<string, unknown>).results as Record<string, unknown> | undefined;
            const plan = results?.planner as z.infer<typeof PlanOut> | undefined;
            return {
                oneLiner: plan
                    ? `${input.goal} → ${plan.steps.length} steps: ${plan.steps.join(' | ')}`
                    : 'no prior plan in context',
            };
        },
    });

    const wf = createWorkflow();
    const wfResult = await wf
        .task('planner', planAgent as DefinedAgent<unknown, unknown>)
        .sequential()
        .task('composer', composeAgent as DefinedAgent<unknown, unknown>)
        .execute({ goal: 'Ship a great agent framework example' });
    console.log('Workflow result keys:', Object.keys(wfResult.results));
    console.log('Composer out:', (wfResult.results.composer as { oneLiner: string })?.oneLiner);
}

async function sectionSdkMemoryAndPlanner() {
    log('defineAgent + InMemoryStore + .plan()');

    const mem = new InMemoryStore();
    const reg = new ToolRegistryImpl();
    reg.register(new CalculatorAddTool());

    const specAgent = defineAgent({
        name: 'memory-demo',
        inputSchema: z.object({ label: z.string() }),
        outputSchema: z.object({ stored: z.boolean() }),
        tools: [new CalculatorAddTool()],
        memory: mem,
        planner: new ClassicalPlanner({ algorithm: PlanningAlgorithm.A_STAR }),
        handler: async (input, ctx) => {
            const store = (ctx as { __memoryStore?: InMemoryStore }).__memoryStore;
            if (store) {
                await store.store({
                    type: MemoryType.EPISODIC,
                    content: `Saw label: ${input.label}`,
                    metadata: { source: 'showcase' },
                });
            }
            return { stored: true };
        },
    });

    const out = await specAgent.run({ input: { label: 'framework-showcase' } });
    const plan = await specAgent.plan('add two numbers for the user then summarize');
    console.log('Handler ok:', out.stored, 'Plan tasks:', plan.tasks?.length ?? 'n/a');
}

async function sectionPipeline() {
    log('asOrchestratorAgent + createPipeline');
    const step1 = defineAgent({
        name: 'pipe-a',
        inputSchema: z.object({ topic: z.string() }),
        outputSchema: z.object({ blurb: z.string() }),
        handler: async (i) => ({ blurb: `About ${i.topic}: TS-first agent runtime.` }),
    });
    const step2 = defineAgent({
        name: 'pipe-b',
        inputSchema: z.object({ blurb: z.string() }),
        outputSchema: z.object({ title: z.string() }),
        handler: async (i) => ({ title: i.blurb.split(':')[0]?.trim() ?? 'untitled' }),
    });
    const pipeline = createPipeline({
        name: 'showcase-pipeline',
        description: 'Two DefinedAgents in sequence',
        agents: [asOrchestratorAgent(step1 as never), asOrchestratorAgent(step2 as never)],
    });
    const pctx = new AgentContextBuilder()
        .withAgentId('showcase-pipeline')
        .withMemory(new InMemoryStore())
        .withTools(new ToolRegistryImpl())
        .withPlanner(new ClassicalPlanner({ algorithm: PlanningAlgorithm.HIERARCHICAL }))
        .build();
    const pout = await pipeline.run(
        { prompt: JSON.stringify({ topic: 'personaforge' }) },
        pctx
    );
    console.log('Pipeline state:', pout.state, 'result sample:', JSON.stringify(pout.result).slice(0, 180));
}

async function sectionParallelWorkflow() {
    log('createWorkflow (parallel block)');
    const a = defineAgent({
        name: 'w-a',
        inputSchema: z.object({ x: z.number() }),
        outputSchema: z.object({ y: z.number() }),
        handler: async (i) => ({ y: i.x + 1 }),
    });
    const b = defineAgent({
        name: 'w-b',
        inputSchema: z.object({ x: z.number() }),
        outputSchema: z.object({ y: z.number() }),
        handler: async (i) => ({ y: i.x * 2 }),
    });
    const pr = await createWorkflow()
        .task('f1', a as DefinedAgent<unknown, unknown>)
        .parallel()
        .task('f2', b as DefinedAgent<unknown, unknown>)
        .sequential()
        .execute({ x: 5 });
    console.log('Parallel workflow results:', pr.results);
}

function sectionOpenApi() {
    log('getRuntimeOpenApiJson');
    const spec = getRuntimeOpenApiJson() as { openapi?: string; paths?: Record<string, unknown> };
    console.log('OpenAPI', spec.openapi, 'paths:', Object.keys(spec.paths ?? {}).length);
}

async function sectionHttp(assistant: ReturnType<typeof createAgent>, port: number) {
    log(`HTTP runtime on ${port} (createHttpService + listenService)`);
    const svc = createHttpService(
        { agents: { assist: assistant }, tracing: true, cors: '*' },
        port
    );
    const bound = await listenService(svc, port);
    console.log('Listening. Try:');
    console.log(`  curl -s http://127.0.0.1:${bound.port}/v1/health | jq .`);
    console.log(`  curl -s -X POST http://127.0.0.1:${bound.port}/v1/chat -H 'Content-Type: application/json' -d '{"message":"What is 3+1?","stream":true}'`);
    await new Promise(() => {});
}

async function main() {
    const args = process.argv.slice(2);
    const wantHttp = args.includes('--http');
    const port = Number.parseInt(
        (args.find((a) => a.startsWith('--port='))?.split('=')[1] as string) ?? '8787',
        10
    );

    console.log('personaforge framework showcase | VERSION', VERSION);
    if (!process.env.OPENAI_API_KEY) {
        console.error('Set OPENAI_API_KEY in examples/.env (or the environment) for the LLM sections.');
        process.exit(1);
    }

    const sessionStore = new InMemorySessionStore();

    await sectionHealthAndMetrics(sessionStore);
    const assistant = createAgent({
        name: 'ShowcaseAssistant',
        instructions:
            'You are a helpful assistant. For arithmetic, use calculator_add with a and b. Be concise.',
        sessionStore,
        tools: [new CalculatorAddTool()],
        llm: resolveLlmForCreateAgent(
            { name: '_', instructions: '_' },
            { model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini', apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL }
        ),
        guardrails: new GuardrailValidator({ rules: [createSensitiveDataRule()] }),
        logger: new ConsoleLogger({ minLevel: LogLevel.INFO, prefix: '[ShowcaseAgent]' }),
        maxSteps: 5,
    });

    if (wantHttp) {
        await sectionHttp(assistant, port);
        return;
    }

    await sectionCreateAgent(assistant);
    await sectionSdkWorkflow();
    await sectionSdkMemoryAndPlanner();
    await sectionPipeline();
    await sectionParallelWorkflow();
    sectionOpenApi();

    console.log('\nDone. Run with --http to start the same assistant via createHttpService.\n');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
