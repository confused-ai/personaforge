#!/usr/bin/env node
/**
 * scripts/check-entry-completeness.mjs
 *
 * Fails (exit 1) when the three shipping surfaces drift apart:
 *   1. every tsup `entry` key must have a matching package.json `exports` key
 *      (`index` → `.`, everything else → `./<key>`);
 *   2. every tsup entry must have a matching `scripts/build-dts.mjs` output
 *      (`dist/<key>.d.ts`), otherwise the subpath ships JS without types;
 *   3. every exports entry must point at `dist/<key>.{d.ts,js,cjs}`.
 *
 * Usage: `node scripts/check-entry-completeness.mjs`
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseTsupEntries() {
  const src = readFileSync(resolve(ROOT, 'tsup.config.ts'), 'utf8');
  const block = src.match(/entry:\s*\{([\s\S]*?)\n    \},/);
  if (!block) throw new Error('check-entry-completeness: could not find tsup entry block');
  const entries = [...block[1].matchAll(/(?:'([^']+)'|([A-Za-z0-9_@./-]+))\s*:\s*'([^']+)'/g)]
    .map((m) => ({ key: m[1] ?? m[2], src: m[3] }));
  if (entries.length === 0) throw new Error('check-entry-completeness: parsed zero tsup entries');
  return entries;
}

function parseDtsOutputs() {
  const src = readFileSync(resolve(ROOT, 'scripts/build-dts.mjs'), 'utf8');
  return new Set([...src.matchAll(/'(dist\/[^']+\.d\.ts)'/g)].map((m) => m[1]));
}

const failures = [];
const tsupEntries = parseTsupEntries();
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const dtsOutputs = parseDtsOutputs();

for (const { key, src } of tsupEntries) {
  const exportKey = key === 'index' ? '.' : `./${key}`;
  if (!pkg.exports?.[exportKey]) {
    failures.push(`tsup entry '${key}' (${src}) has no package.json exports['${exportKey}']`);
  }
  const dts = key === 'index' ? 'dist/index.d.ts' : `dist/${key}.d.ts`;
  if (!dtsOutputs.has(dts)) {
    failures.push(`tsup entry '${key}' (${src}) has no scripts/build-dts.mjs output '${dts}'`);
  }
}

for (const [exportKey, targets] of Object.entries(pkg.exports ?? {})) {
  const base = exportKey === '.' ? 'index' : exportKey.slice(2);
  const want = { types: `./dist/${base}.d.ts`, import: `./dist/${base}.js`, require: `./dist/${base}.cjs` };
  for (const [kind, wantPath] of Object.entries(want)) {
    if (targets[kind] !== wantPath) {
      failures.push(`exports['${exportKey}'].${kind} is '${targets[kind]}', want '${wantPath}'`);
    }
  }
  const tsupKey = exportKey === '.' ? 'index' : exportKey.slice(2);
  if (!tsupEntries.some((e) => e.key === tsupKey)) {
    failures.push(`exports['${exportKey}'] has no matching tsup entry '${tsupKey}'`);
  }
}

if (failures.length > 0) {
  console.error(`check-entry-completeness: ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-entry-completeness: ok (${tsupEntries.length} entries × exports × d.ts)`);
