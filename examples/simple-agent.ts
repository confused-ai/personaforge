/**
 * Minimal agent using the framework.
 *
 * Uses the `agent()` headline API: `import { agent } from "personaforge"`.
 *
 * Requires: OPENAI_API_KEY in `examples/.env` (or your env) — see `resolveLlmForCreateAgent`.
 *
 * Run: `bun run example:simple`  or  `bun examples/simple-agent.ts`
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

/** Load `examples/.env` even when you run from the repo root */
config({
    path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env'),
    quiet: true,
});

import { agent, InMemorySessionStore } from 'personaforge';

async function main() {
    const myAgent = agent({
        name: 'SimpleAssistant',
        instructions: 'You are a helpful assistant. Be concise.',
        /** No tools — chat only. Add HttpClientTool, etc. from `personaforge/tools` when needed. */
        tools: [],
        dev: true,
        sessionStore: new InMemorySessionStore(),
    });

    const prompt = process.argv.slice(2).join(' ') || 'What is 2+2? Reply in one short sentence.';
    const result = await myAgent.run(prompt);

    console.log('\n--- reply ---\n');
    console.log(result.text);
    console.log(`\n(finish: ${result.finishReason}, steps: ${result.steps})`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
