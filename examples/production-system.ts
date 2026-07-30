/**
 * Flagship: production multi-agent system that edges Agno / Mastra / LangGraph.
 *
 * Run:
 *   bun examples/production-system.ts
 *
 * With a live model:
 *   OPENAI_API_KEY=... bun examples/production-system.ts
 */

import { z } from 'zod';
import { tool, createSystem, fromHttpTool, fromOpenAITool } from '../src/index.js';

async function main() {
    const echoHttp = fromHttpTool({
        name: 'httpbin_post',
        description: 'Echo payload via httpbin (demo foreign HTTP system)',
        url: 'https://httpbin.org/post',
        method: 'POST',
        parameters: z.object({ topic: z.string() }),
        body: (p) => ({ topic: p['topic'] }),
    });

    const openaiStyle = fromOpenAITool(
        {
            function: {
                name: 'slugify',
                description: 'Make a URL slug from a title',
                parameters: {
                    type: 'object',
                    properties: { title: { type: 'string' } },
                    required: ['title'],
                },
            },
        },
        {
            execute: async (_name, args) => ({
                slug: String(args['title'] ?? '')
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, ''),
            }),
        },
    );

    const localTool = tool({
        name: 'word_count',
        description: 'Count words in text',
        parameters: z.object({ text: z.string() }),
        outputSchema: z.object({ words: z.number() }),
        execute: ({ text }) => ({ words: text.trim().split(/\s+/).filter(Boolean).length }),
    });

    const hasLlm = Boolean(process.env['OPENAI_API_KEY'] || process.env['PF_IT_OPENAI_BASE_URL']);

    if (!hasLlm) {
        console.log('No OPENAI_API_KEY — universal adapter smoke checks:\n');
        console.log('word_count:', (await localTool.execute({ text: 'one two three' })).data);
        console.log('slugify:', (await openaiStyle.execute({ title: 'Hello World!' })).data);
        console.log('\nSystem registry (empty agents — add with OPENAI_API_KEY):');
        const system = createSystem({
            name: 'content-studio',
            description: 'Research → write production system',
            tools: { word_count: localTool, slugify: openaiStyle, httpbin_post: echoHttp },
            resilience: false,
        });
        console.log(JSON.stringify(system.toJSON(), null, 2));
        return;
    }

    const { agent, compose } = await import('../src/index.js');
    const model = process.env['PF_MODEL'] ?? 'gpt-4o-mini';

    const research = agent({
        name: 'research',
        description: 'Finds facts and citations for a topic',
        instructions: 'Research the topic. Return concise bullet points only.',
        model,
    });

    const writer = agent({
        name: 'writer',
        description: 'Turns research bullets into a short paragraph',
        instructions: 'Write one polished paragraph from the research notes.',
        model,
    });

    const pipeline = compose(research, writer);

    const system = createSystem({
        name: 'content-studio',
        description: 'Research → write production system',
        model,
        agents: {
            research: { agent: research, description: 'Deep research specialist' },
            writer: { agent: writer, description: 'Clear technical writer' },
        },
        pipelines: {
            research_write: {
                pipeline,
                description: 'Full research-then-write pipeline',
            },
        },
        tools: {
            word_count: localTool,
            slugify: openaiStyle,
            httpbin_post: echoHttp,
        },
        resilience: {
            rateLimit: { maxRpm: 60 },
            circuitBreaker: { failureThreshold: 5 },
        },
    });

    const supervisor = system.supervisor({
        instructions:
            'You coordinate content production. Prefer the research_write pipeline for full articles. ' +
            'Use word_count and slugify for polishing.',
    });

    console.log('System:', JSON.stringify(system.toJSON(), null, 2));
    console.log('Supervisor tools:', supervisor.tools.map((t) => t.name).join(', '));

    console.log('\nStreaming (messages+updates):');
    for await (const ev of supervisor.streamEvents(
        'Write a 3-sentence brief on TypeScript 5.5 features.',
        { streamMode: ['messages', 'updates'] },
    )) {
        if (ev.type === 'token') process.stdout.write(ev.data);
        else if (ev.type === 'update') console.log('\n[update]', ev.node, ev.data);
    }
    console.log('\n');

    // Control plane: await system.serve(4100);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
