/**
 * DX benchmark — hermetic, no API keys.
 *
 * Measures what "developer experience" costs in practice:
 * import time, model-string resolution, tool definition, and a 3-step
 * workflow run — plus static brevity (user lines of code for hello-world).
 *
 * Usage: `bun benchmarks/dx/run.ts [--save-baseline]`
 * Compares against benchmarks/dx/baseline.json when present.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const baselinePath = join(here, 'baseline.json');
const latestPath = join(here, 'latest.json');

const HELLO_WORLD_SNIPPET = `import { agent } from 'personaforge';

const bot = agent('You are a helpful assistant.');
const { text } = await bot.run('Say hello in one short sentence.');
console.log(text);`;

function userLines(snippet: string): number {
  return snippet.split('\n').filter((l) => l.trim().length > 0).length;
}

async function main(): Promise<void> {
  const save = process.argv.includes('--save-baseline');
  const t0 = performance.now();
  await import('../../src/lite.js');
  const importMs = performance.now() - t0;

  const { resolveModelString } = await import('../../src/providers/model-resolver.js');
  const m0 = performance.now();
  for (let i = 0; i < 100; i++) {
    resolveModelString('openai:gpt-4o');
    resolveModelString('openai/gpt-4o');
  }
  const modelResolveMs = performance.now() - m0;

  const { tool } = await import('../../src/tools/core/tool-helper.js');
  const { z } = await import('zod');
  const d0 = performance.now();
  const weather = tool({
    name: 'getWeather',
    description: 'Get current weather for a location',
    parameters: z.object({ location: z.string() }),
    execute: async ({ location }) => ({ temp: 21, location }),
  });
  const toolDefineMs = performance.now() - d0;

  const { defineStep, defineWorkflow } = await import('../../src/workflow/chain.js');
  const w0 = performance.now();
  const wf = defineWorkflow({ id: 'dx-bench' })
    .then(defineStep({ id: 'a', execute: async ({ inputData }) => (inputData as number) + 1 }))
    .then(defineStep({ id: 'b', execute: async ({ inputData }) => (inputData as number) * 2 }))
    .then(defineStep({ id: 'c', execute: async ({ inputData }) => (inputData as number) - 3 }));
  const result = await wf.createRun().start({ inputData: 20 });
  const workflowMs = performance.now() - w0;

  const metrics = {
    importMs: round(importMs),
    modelResolve200Ms: round(modelResolveMs),
    toolDefineMs: round(toolDefineMs),
    workflow3StepMs: round(workflowMs),
    helloWorldLines: userLines(HELLO_WORLD_SNIPPET),
    toolName: weather.name,
    workflowResult: result.result,
  };

  const at = new Date().toISOString();
  const payload = { at, metrics };
  writeFileSync(latestPath, `${JSON.stringify(payload, null, 2)}\n`);

  let baseline: { metrics: Record<string, number | string | unknown> } | undefined;
  if (existsSync(baselinePath)) {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as typeof baseline;
  }
  if (save || !baseline) {
    writeFileSync(baselinePath, `${JSON.stringify(payload, null, 2)}\n`);
    console.log('dx-bench: baseline saved');
  }

  console.log('dx-bench metrics:', JSON.stringify(metrics, null, 2));
  if (baseline && !save) {
    console.log('dx-bench delta vs baseline:');
    for (const [k, v] of Object.entries(metrics)) {
      const b = (baseline.metrics as Record<string, unknown>)[k];
      if (typeof v === 'number' && typeof b === 'number' && b !== 0) {
        const pct = (((v - b) / b) * 100).toFixed(1);
        console.log(`  ${k}: ${b} -> ${v} (${pct}%)`);
      } else {
        console.log(`  ${k}: ${JSON.stringify(b)} -> ${JSON.stringify(v)}`);
      }
    }
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

await main();
