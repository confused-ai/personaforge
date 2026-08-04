#!/usr/bin/env node
/**
 * check-docs-claims.mjs
 *
 * Scans docs/**\/*.md for file-path claims that reference source files under
 * packages/ or src/ and verifies each referenced path exists on disk.
 *
 * A "claim" is any occurrence of a path matching:
 *   - `packages/<anything>.ts` or `packages/<anything>.js`  (in backticks or pipe columns)
 *   - `src/<anything>.ts` or `src/<anything>.js`
 *
 * The PHASES.md action-column pattern (`| packages/X/src/Y.ts |`) is a primary
 * source, but the script catches all such references regardless of context.
 *
 * Exit codes:
 *   0 — all referenced files exist (or no claims found)
 *   1 — one or more referenced files do not exist
 *
 * Usage:
 *   node scripts/check-docs-claims.mjs
 *   DOCS_DIR=docs node scripts/check-docs-claims.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT, process.env.DOCS_DIR ?? 'docs');

// Match any path-like token referencing packages/ or src/ TS/JS files.
// Anchored to start of a word boundary so we don't match partial strings.
const PATH_RE = /(?:^|[\s`|"'(,])((packages|src)\/[A-Za-z0-9_\-/.]+\.(?:ts|js))(?:[\s`|"'),]|$)/gm;

// Directories to skip inside docs/
const SKIP_DIRS = new Set(['dist', '.vitepress/dist', 'node_modules']);

// Doc files that contain illustrative user-space code examples or historical task
// descriptions (not claims about what currently exists in the repo).
const SKIP_FILES = new Set([
    'INTEGRATION-BLUEPRINTS.md',
    'COMPETITIVE-ANALYSIS.md',
    'GLOSSARY.md',
    'changelog.md',
    'index.md',
    // PHASES.md describes tasks (many with pre-Phase-7 paths) — it's a roadmap doc,
    // not a claim about currently-existing files.
    'PHASES.md',
    'PROGRESS.md',
    'STRATEGIC-TRANSFORMATION-ROADMAP.md',
    // monorepo-migration.md describes what to do BEFORE paths are resolved (pre-migration)
    'monorepo-migration.md',
    // Audit snapshots written before Phase 7 reorganization (old flat package paths)
    'TECHNICAL-AUDIT-2026-05-08.md',
    'PRODUCTION-READINESS-AUDIT.md',
    // Spec describes historical consolidation — deleted src/models/* paths are intentional
    '2026-07-23-consolidation-and-path-to-1.md',
]);

// Guide/example subdirectories — contain tutorial code samples, not framework claims
const SKIP_SUB_DIRS = new Set(['examples', 'api']);

// Specific paths that are intentionally illustrative / placeholder (skip them)
const KNOWN_PLACEHOLDERS = new Set([
    'packages/X/src/Y.ts',
    'src/index.ts',           // too generic — root re-export, always exists so fine either way
]);

/** Recursively collect all .md files under a directory, excluding SKIP_DIRS. */
async function collectMd(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const rel = path.relative(DOCS_DIR, full);
            if (SKIP_DIRS.has(rel) || SKIP_SUB_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
            results.push(...await collectMd(full));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            if (!SKIP_FILES.has(entry.name)) {
                results.push(full);
            }
        }
    }
    return results;
}

/** Extract all file-path claims from a markdown string. */
function extractClaims(content) {
    const found = new Set();
    let m;
    const re = new RegExp(PATH_RE.source, PATH_RE.flags);
    while ((m = re.exec(content)) !== null) {
        found.add(m[1]);
    }
    return found;
}

async function main() {
    /** @type {Array<{ docFile: string; claim: string }>} */
    const broken = [];
    /** @type {number} */
    let totalClaims = 0;

    const mdFiles = await collectMd(DOCS_DIR);

    for (const mdFile of mdFiles) {
        const content = readFileSync(mdFile, 'utf8');
        const claims = extractClaims(content);

        for (const claim of claims) {
            if (KNOWN_PLACEHOLDERS.has(claim)) continue;
            totalClaims++;

            const absPath = path.join(ROOT, claim);
            if (!existsSync(absPath)) {
                broken.push({ docFile: path.relative(ROOT, mdFile), claim });
            }
        }
    }

    if (broken.length === 0) {
        console.log(`✓ docs-claims: all ${totalClaims} file references exist on disk.`);
        process.exit(0);
    }

    console.error(`\n✗ docs-claims: ${broken.length} broken file reference(s) found:\n`);
    for (const { docFile, claim } of broken) {
        console.error(`  ${docFile}\n    → ${claim}`);
    }
    console.error(`\nFix the docs or create the missing source files before merging.\n`);
    process.exit(1);
}

main().catch((err) => {
    console.error('[check-docs-claims] Fatal error:', err);
    process.exit(1);
});
