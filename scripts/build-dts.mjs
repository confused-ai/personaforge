/**
 * build-dts.mjs — Generate self-contained .d.ts files for all entry points.
 *
 * Uses dts-bundle-generator to inline all transitive types so that
 * @confused-ai/* workspace packages are NOT needed by consumers.
 *
 * Speed strategy:
 *   1. Worker threads  — generateDtsBundle is synchronous/CPU-bound; Promise.all
 *      on the main thread gives no parallelism. Each entry runs in its own thread.
 *   2. Mtime cache     — skip entries whose source file is older than the existing
 *      dist output (set FORCE_DTS=1 to bypass).
 */

import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { cpus } from 'os';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');
const tsconfig = resolve(root, 'tsconfig.build.json');

// ── Entry list ────────────────────────────────────────────────────────────────
// [source entry, output flat .d.ts path]
const entries = [
  // Root flat files
  ['src/index.ts',          'dist/index.d.ts'],
  ['src/lite.ts',           'dist/lite.d.ts'],
  ['src/model.ts',          'dist/model.d.ts'],
  ['src/tool.ts',           'dist/tool.d.ts'],
  ['src/workflow.ts',       'dist/workflow.d.ts'],
  ['src/guard.ts',          'dist/guard.d.ts'],
  ['src/serve.ts',          'dist/serve.d.ts'],
  ['src/observe.ts',        'dist/observe.d.ts'],
  ['src/test.ts',           'dist/test.d.ts'],
  ['src/create-agent.ts',   'dist/create-agent.d.ts'],
  ['src/playground.ts',     'dist/playground.d.ts'],
  // Directory index files
  ['src/core/index.ts',           'dist/core.d.ts'],
  ['src/memory/index.ts',         'dist/memory.d.ts'],
  ['src/providers/index.ts',      'dist/providers.d.ts'],
  ['src/tools/index.ts',          'dist/tools.d.ts'],
  ['src/planner/index.ts',        'dist/planner.d.ts'],
  ['src/execution/index.ts',      'dist/execution.d.ts'],
  ['src/orchestration/index.ts',  'dist/orchestration.d.ts'],
  ['src/observability/index.ts',  'dist/observability.d.ts'],
  ['src/agentic/index.ts',        'dist/agentic.d.ts'],
  ['src/session/index.ts',        'dist/session.d.ts'],
  ['src/guardrails/index.ts',     'dist/guardrails.d.ts'],
  ['src/knowledge/index.ts',      'dist/knowledge.d.ts'],
  ['src/storage/index.ts',        'dist/storage.d.ts'],
  ['src/production/index.ts',     'dist/production.d.ts'],
  ['src/artifacts/index.ts',      'dist/artifacts.d.ts'],
  ['src/voice/index.ts',          'dist/voice.d.ts'],
  ['src/runtime/index.ts',        'dist/runtime.d.ts'],
  ['src/shared/index.ts',         'dist/shared.d.ts'],
  ['src/contracts/index.ts',      'dist/contracts.d.ts'],
  ['src/interfaces.ts',           'dist/interfaces.d.ts'],
  ['src/plugins/index.ts',        'dist/plugins.d.ts'],
  ['src/adapters/index.ts',       'dist/adapters.d.ts'],
  ['src/background/index.ts',     'dist/background.d.ts'],
  ['src/testing/index.ts',        'dist/testing.d.ts'],
  ['src/learning/index.ts',       'dist/learning.d.ts'],
  ['src/video/index.ts',          'dist/video.d.ts'],
  ['src/config/index.ts',         'dist/config.d.ts'],
  ['src/dx/index.ts',             'dist/dx.d.ts'],
  ['src/sdk/index.ts',            'dist/sdk.d.ts'],
  ['src/graph/index.ts',          'dist/graph.d.ts'],
  ['src/simulation/index.ts',     'dist/simulation.d.ts'],
  ['src/cli/index.ts',            'dist/cli.d.ts'],
  ['src/create-agent/index.ts',   'dist/create-agent/index.d.ts'],
  // tools/* sub-entries
  ['src/tools/utils/shell-entry.ts',      'dist/tools/shell.d.ts'],
  ['src/tools/core/index.ts',             'dist/tools/core.d.ts'],
  ['src/tools/mcp/index.ts',              'dist/tools/mcp.d.ts'],
  ['src/tools/utils/index.ts',            'dist/tools/utils.d.ts'],
  ['src/tools/communication/index.ts',    'dist/tools/communication.d.ts'],
  ['src/tools/productivity/index.ts',     'dist/tools/productivity.d.ts'],
  ['src/tools/devtools/index.ts',         'dist/tools/devtools.d.ts'],
  ['src/tools/crm/index.ts',             'dist/tools/crm.d.ts'],
  ['src/tools/search/index.ts',           'dist/tools/search.d.ts'],
  ['src/tools/scraping/index.ts',         'dist/tools/scraping.d.ts'],
  ['src/tools/media/index.ts',            'dist/tools/media.d.ts'],
  ['src/tools/memory/index.ts',           'dist/tools/memory.d.ts'],
  ['src/tools/ai/index.ts',               'dist/tools/ai.d.ts'],
  ['src/tools/data/index.ts',             'dist/tools/data.d.ts'],
  ['src/tools/finance/index.ts',          'dist/tools/finance.d.ts'],
  ['src/tools/social/index.ts',           'dist/tools/social.d.ts'],
  // missing entries
  ['src/adapter-redis/index.ts',          'dist/adapter-redis.d.ts'],
  ['src/compression/index.ts',            'dist/compression.d.ts'],
  ['src/context/index.ts',               'dist/context.d.ts'],
  ['src/db/index.ts',                    'dist/db.d.ts'],
  ['src/eval/index.ts',                  'dist/eval.d.ts'],
  ['src/models/index.ts',               'dist/models.d.ts'],
  ['src/reasoning/index.ts',            'dist/reasoning.d.ts'],
  ['src/router/index.ts',               'dist/router.d.ts'],
  ['src/scheduler/index.ts',            'dist/scheduler.d.ts'],
  ['src/skills/index.ts',               'dist/skills.d.ts'],
  ['src/test-utils/index.ts',           'dist/test-utils.d.ts'],
  ['src/test-utils/conformance.ts',     'dist/test-utils/conformance.d.ts'],
];

// ── Worker body (runs in each thread) ────────────────────────────────────────
if (!isMainThread) {
  const { entry, outputs, tsconfig: tsc } = workerData;
  const startMs = Date.now();
  try {
    const { generateDtsBundle } = await import('dts-bundle-generator');
    const [content] = generateDtsBundle(
      [{ filePath: entry, output: { noBanner: true } }],
      { preferredConfigPath: tsc },
    );
    for (const out of outputs) {
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, content, 'utf8');
    }
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    const label = outputs.map(o => o.replace(root + '/', '')).join(', ');
    parentPort.postMessage({ status: 'pass', label, elapsed, kb: (content.length / 1024).toFixed(0) });
  } catch (err) {
    parentPort.postMessage({ status: 'fail', label: entry.replace(root + '/', ''), error: err.message });
  }
  process.exit(0);
}

// ── Main thread ───────────────────────────────────────────────────────────────

const CONCURRENCY = cpus().length; // use ALL cores — no artificial cap
const FORCE = process.env.FORCE_DTS === '1';

/**
 * Returns true if all dist outputs exist and are newer than the source entry
 * file and its immediate siblings in the same directory.
 */
function isCacheHit(srcRel, outputs) {
  if (FORCE) return false;
  const srcAbs = resolve(root, srcRel);
  if (!existsSync(srcAbs)) return false;
  if (!outputs.every(o => existsSync(o))) return false;
  try {
    const oldestDist = Math.min(...outputs.map(o => statSync(o).mtimeMs));
    // Check mtime of the entry file itself
    let newestSrc = statSync(srcAbs).mtimeMs;
    // Also check siblings in the same directory
    const srcDir = dirname(srcAbs);
    for (const f of readdirSync(srcDir)) {
      try { const t = statSync(`${srcDir}/${f}`).mtimeMs; if (t > newestSrc) newestSrc = t; } catch { /* ignore */ }
    }
    return oldestDist > newestSrc;
  } catch {
    return false;
  }
}

function spawnWorker(srcRel, outputs) {
  return new Promise((res) => {
    const w = new Worker(new URL(import.meta.url), {
      workerData: { entry: resolve(root, srcRel), outputs, tsconfig },
    });
    w.once('message', res);
    w.once('error', (err) => res({ status: 'fail', label: srcRel, error: err.message }));
  });
}

async function run() {
  // Deduplicate: multiple output paths for same source → generate once, write to all
  const sourceToOutputs = new Map();
  for (const [src, out] of entries) {
    if (!sourceToOutputs.has(src)) sourceToOutputs.set(src, []);
    sourceToOutputs.get(src).push(resolve(root, out));
  }

  const toProcess = [];
  const skipped = [];

  for (const [src, outputs] of sourceToOutputs) {
    if (!existsSync(resolve(root, src))) continue; // skip missing entries silently
    if (isCacheHit(src, outputs)) {
      skipped.push(src);
    } else {
      toProcess.push([src, outputs]);
    }
  }

  if (skipped.length) {
    console.log(`⚡ Skipped ${skipped.length} unchanged entries (use FORCE_DTS=1 to rebuild all)\n`);
  }

  if (toProcess.length === 0) {
    console.log('✓ All .d.ts files are up to date.');
    return;
  }

  console.log(`Generating ${toProcess.length} .d.ts files (${CONCURRENCY} workers)...\n`);
  const overallStart = Date.now();
  let passed = 0;
  let failed = 0;

  // Work-stealing pool: always keep CONCURRENCY workers busy
  const queue = [...toProcess];
  const inFlight = new Map(); // promise → true

  function fill() {
    while (inFlight.size < CONCURRENCY && queue.length > 0) {
      const [src, outputs] = queue.shift();
      const p = spawnWorker(src, outputs).then((msg) => {
        inFlight.delete(p);
        if (msg.status === 'pass') {
          console.log(`✓ ${msg.label} (${msg.elapsed}s, ${msg.kb}KB)`);
          passed++;
        } else {
          console.error(`✗ ${msg.label} — ${msg.error}`);
          failed++;
        }
        fill();
      });
      inFlight.set(p, true);
    }
  }

  fill();
  while (inFlight.size > 0) await Promise.race([...inFlight.keys()]);

  const total = ((Date.now() - overallStart) / 1000).toFixed(1);
  console.log(`\n${passed} passed, ${failed} failed, ${skipped.length} skipped — ${total}s total`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => { console.error(err); process.exit(1); });
