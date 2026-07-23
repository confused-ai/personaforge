#!/usr/bin/env tsx
/**
 * Monorepo → single-package migration script.
 *
 * 1. Copies packages/*/src/ into src/<package-name>/
 * 2. Rewrites @personaforge/* imports to relative paths in all src/ files
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'src');

// ── Step 1: Build mapping from package name → src dir ────────────────────────

function findPackages(): Array<{ name: string; srcDir: string; destDir: string }> {
  const results: Array<{ name: string; srcDir: string; destDir: string }> = [];

  function walk(dir: string, depth: number) {
    if (depth > 3) return;
    let entries: string[];
    try { entries = fs.readdirSync(dir); } catch { return; }
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.name?.startsWith('@personaforge/')) {
        const shortName = pkg.name.replace('@personaforge/', '');
        const srcDir = path.join(dir, 'src');
        if (fs.existsSync(srcDir)) {
          results.push({ name: shortName, srcDir, destDir: path.join(SRC, shortName) });
          return; // don't recurse into sub-packages
        }
      }
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        walk(full, depth + 1);
      }
    }
  }

  walk(path.join(ROOT, 'packages'), 0);
  return results;
}

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    const stat = fs.statSync(srcPath);
    if (stat.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

console.log('=== Step 1: Copying package sources into src/ ===');
const packages = findPackages();
console.log(`Found ${packages.length} packages`);

for (const { name, srcDir, destDir } of packages) {
  console.log(`  ${srcDir.replace(ROOT + '/', '')} → ${destDir.replace(ROOT + '/', '')}`);
  copyDir(srcDir, destDir);
}

// ── Step 2: Rewrite @personaforge/* imports ───────────────────────────────────

// Build set of known package names
const packageNames = new Set(packages.map(p => p.name));

function computeRelative(fromFile: string, toDir: string): string {
  const fromDir = path.dirname(fromFile);
  let rel = path.relative(fromDir, toDir);
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}

function rewriteImports(filePath: string): number {
  const content = fs.readFileSync(filePath, 'utf8');
  let updated = content;
  let count = 0;

  // Regex to match:
  //   from '@personaforge/foo'
  //   from '@personaforge/foo/bar/baz'
  //   import('@personaforge/foo')
  //   import('@personaforge/foo/bar')
  const pattern = /(['"])@personaforge\/([\w-]+)((?:\/[\w.-]+)*)\1/g;

  updated = updated.replace(pattern, (match, quote, pkgName, subpath) => {
    const destDir = path.join(SRC, pkgName);

    if (!subpath) {
      // @personaforge/foo → ../foo/index.js
      const rel = computeRelative(filePath, destDir);
      count++;
      return `${quote}${rel}/index.js${quote}`;
    } else {
      // @personaforge/foo/bar/baz → ../foo/bar/baz.js
      // First check if it resolves to a directory with index.ts
      const targetAsDir = path.join(destDir, subpath);
      const targetAsFile = path.join(destDir, subpath + '.ts');
      let rel: string;
      if (fs.existsSync(path.join(targetAsDir, 'index.ts'))) {
        rel = computeRelative(filePath, targetAsDir) + '/index.js';
      } else if (fs.existsSync(targetAsFile)) {
        rel = computeRelative(filePath, path.join(destDir, subpath)) + '.js';
      } else {
        // Best-effort: try as file first
        rel = computeRelative(filePath, path.join(destDir, subpath)) + '.js';
      }
      count++;
      return `${quote}${rel}${quote}`;
    }
  });

  if (updated !== content) {
    fs.writeFileSync(filePath, updated, 'utf8');
  }
  return count;
}

console.log('\n=== Step 2: Rewriting @personaforge/* imports in src/ ===');

function collectTs(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results.push(...collectTs(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      results.push(full);
    }
  }
  return results;
}

const tsFiles = collectTs(SRC);
console.log(`Processing ${tsFiles.length} TypeScript files in src/`);
let totalRewrites = 0;
for (const f of tsFiles) {
  const n = rewriteImports(f);
  if (n > 0) {
    totalRewrites += n;
    console.log(`  [${n}] ${f.replace(ROOT + '/', '')}`);
  }
}
console.log(`\nTotal import rewrites: ${totalRewrites}`);

// ── Step 3: Remove "workspaces" from root package.json ───────────────────────
console.log('\n=== Step 3: Removing workspaces from root package.json ===');
const rootPkgPath = path.join(ROOT, 'package.json');
const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf8'));
if (rootPkg.workspaces) {
  delete rootPkg.workspaces;
  fs.writeFileSync(rootPkgPath, JSON.stringify(rootPkg, null, 2) + '\n', 'utf8');
  console.log('Removed workspaces field');
} else {
  console.log('No workspaces field found (already clean)');
}

console.log('\n✅ Migration complete!');
