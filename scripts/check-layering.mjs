#!/usr/bin/env node
/**
 * scripts/check-layering.mjs
 *
 * `src/core` must not gain new runtime dependencies on leaf modules —
 * core should depend on abstractions (type-only imports are fine).
 * Two sanctioned exceptions exist (documented at their sites):
 *   - src/core/runner/agent-runner.ts → the single-engine facade over
 *     agentic/runner.js (canonical loop lives in agentic/).
 *   - src/core/context-builder.ts → default store/registry construction
 *     (composition-root defaults; override via .withMemory()/.withTools()).
 *
 * Usage: `node scripts/check-layering.mjs`
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = join(ROOT, 'src', 'core');

// file (repo-relative) → allowed value-import targets (resolved repo-relative, no ext)
const ALLOWLIST = new Map([
  ['src/core/runner/agent-runner.ts', new Set(['src/agentic/runner.js'])],
  ['src/core/context-builder.ts', new Set(['src/memory/in-memory-store.js', 'src/tools/core/registry.js'])],
]);

// Leaf modules core must not depend on at runtime. Foundation modules
// (shared, contracts, validation-adjacent) are intentionally unrestricted.
const LEAF_TOPS = new Set([
  'agentic', 'memory', 'tools', 'providers', 'plugins', 'adapters',
  'orchestration', 'serve', 'gateway', 'dx', 'sdk', 'cli',
]);
const LEAF_RE = /from\s*['"]\.\.?\//;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (name.endsWith('.ts')) yield p;
  }
}

const failures = [];
for (const file of walk(CORE)) {
  const rel = file.slice(ROOT.length + 1);
  const allowed = ALLOWLIST.get(rel) ?? new Set();
  const lines = readFileSync(file, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('import')) continue;
    if (trimmed.startsWith('import type')) continue;
    const m = trimmed.match(LEAF_RE) && trimmed.match(/from\s*['"]([^'"]+)['"]/);
    if (!m) continue;
    const target = m[1];
    // Within-core and type-only-adjacent parent imports of pure types stay free;
    // only runtime imports escaping src/core/* are policed.
    if (!target.startsWith('.')) continue;
    const resolved = resolve(dirname(file), target).slice(ROOT.length + 1).replace(/\\/g, '/');
    if (resolved.startsWith('src/core/')) continue;
    const top = resolved.startsWith('src/') ? resolved.slice(4).split('/')[0] : '';
    if (!LEAF_TOPS.has(top)) continue;
    const normalized = resolved.endsWith('.js') ? resolved : `${resolved}`;
    const key = normalized.startsWith('src/') ? normalized : `src/${normalized}`;
    if (!allowed.has(key) && ![...allowed].some((a) => key === a || key === a.replace(/\.js$/, ''))) {
      failures.push(`${rel} runtime-imports ${target} (not on the layering allowlist)`);
    }
  }
}

if (failures.length > 0) {
  console.error(`check-layering: ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('check-layering: ok (core runtime boundary holds)');
