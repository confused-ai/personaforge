#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const README_FILE = path.join(ROOT, 'README.md');
const PACKAGE_JSON = path.join(ROOT, 'package.json');
const ROOT_TSCONFIG = path.join(ROOT, 'tsconfig.json');
const TSC_BIN = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');

const TS_FENCE_RE = /```(?:ts|tsx|typescript)([^\n]*)\n([\s\S]*?)```/g;
const PUBLIC_IMPORT_RE = /from\s+['"]personaforge(?:\/[^'"]+)?['"]|import\s*\(\s*['"]personaforge(?:\/[^'"]+)?['"]\s*\)/;
const PRIVATE_IMPORT_RE = /from\s+['"]@personaforge(?:\/[^'"]+)?['"]|import\s*\(\s*['"]@personaforge(?:\/[^'"]+)?['"]\s*\)/g;

const SKIP_DIRS = new Set(['.git', '.vitepress', 'dist', 'node_modules', 'public']);
const SKIP_FILES = new Set([
    'ARCHITECTURE-SPECIFICATION.md',
    'COMPETITIVE-ANALYSIS.md',
    'GLOSSARY.md',
    'INTEGRATION-BLUEPRINTS.md',
    'PHASES.md',
    'PRODUCTION-READINESS-AUDIT.md',
    'PROGRESS.md',
    'STRATEGIC-TRANSFORMATION-ROADMAP.md',
    'TECHNICAL-AUDIT-2026-05-08.md',
    'changelog.md',
]);

async function collectMarkdownFiles(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) {
                continue;
            }

            files.push(...await collectMarkdownFiles(fullPath));
            continue;
        }

        if (!entry.isFile() || !entry.name.endsWith('.md')) {
            continue;
        }

        if (SKIP_FILES.has(entry.name)) {
            continue;
        }

        files.push(fullPath);
    }

    return files;
}

function extractSnippets(markdown, docPath) {
    const snippets = [];
    const privateImportViolations = [];
    const skippedSnippets = [];
    let match;
    let index = 0;

    const re = new RegExp(TS_FENCE_RE.source, TS_FENCE_RE.flags);
    while ((match = re.exec(markdown)) !== null) {
        const meta = (match[1] ?? '').trim();
        const code = (match[2] ?? '').trim();
        if (!code || !PUBLIC_IMPORT_RE.test(code)) {
            continue;
        }

        index += 1;

        if (isIllustrativeSnippet(code, meta)) {
            skippedSnippets.push({ docPath, snippetIndex: index });
            continue;
        }

        const privateImports = [...code.matchAll(PRIVATE_IMPORT_RE)].map(([fullMatch]) => fullMatch);
        if (privateImports.length > 0) {
            privateImportViolations.push({
                docPath,
                snippetIndex: index,
                privateImports,
            });
            continue;
        }

        snippets.push({
            code,
            docPath,
            snippetIndex: index,
        });
    }

    return { snippets, privateImportViolations, skippedSnippets };
}

function isIllustrativeSnippet(code, meta) {
    if (/\b(?:no-check|notypecheck|illustrative)\b/i.test(meta)) {
        return true;
    }

    return (
        /(^|[^\w$])\.\.\.([^\w$]|$)/m.test(code) ||
        /^\s*from\s+\w+\s+import\s+/m.test(code) ||
        /^\s*def\s+\w+\s*\(/m.test(code) ||
        /^\s*@\w+\(/m.test(code)
    );
}

function sanitizeDocPath(docPath) {
    return docPath.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rewritePublicImports(code, snippetFilePath, publicPaths) {
    let rewritten = code;
    const mappings = Object.entries(publicPaths)
        .sort(([left], [right]) => right.length - left.length)
        .map(([publicImport, targets]) => {
            const firstTarget = Array.isArray(targets) ? targets[0] : targets;
            const absoluteTarget = path.resolve(ROOT, firstTarget.replace(/^\.\//, ''));
            const relativeTarget = path.relative(path.dirname(snippetFilePath), absoluteTarget).replace(/\\/g, '/');
            const extensionlessTarget = relativeTarget.replace(/\.(?:cts|mts|ts)$/u, '');
            const importTarget = extensionlessTarget.startsWith('.') ? extensionlessTarget : `./${extensionlessTarget}`;
            return [publicImport, importTarget];
        });

    for (const [publicImport, importTarget] of mappings) {
        const specifierPattern = new RegExp(`(['"])${escapeRegExp(publicImport)}\\1`, 'g');
        rewritten = rewritten.replace(specifierPattern, `$1${importTarget}$1`);
    }

    return rewritten;
}

function createSnippetSource(snippet, snippetFilePath, publicPaths) {
    return [
        `// Source: ${snippet.docPath}#snippet-${snippet.snippetIndex}`,
        'export {};',
        rewritePublicImports(snippet.code, snippetFilePath, publicPaths),
        '',
    ].join('\n');
}

function normalizeExportTarget(target) {
    if (!target || typeof target !== 'string') {
        return null;
    }

    const relativeTarget = target.replace(/^\.\//, '');
    if (!relativeTarget.startsWith('dist/')) {
        return null;
    }

    const exportStem = relativeTarget
        .replace(/^dist\//, '')
        .replace(/\.d\.(?:cts|mts|ts)$/u, '')
        .replace(/\.(?:cjs|mjs|js)$/u, '');

    const sourceCandidates = [
        path.join(ROOT, 'src', `${exportStem}.ts`),
        path.join(ROOT, 'src', exportStem, 'index.ts'),
    ];

    for (const candidate of sourceCandidates) {
        if (existsSync(candidate)) {
            return `./${path.relative(ROOT, candidate).replace(/\\/g, '/')}`;
        }
    }

    return null;
}

function buildPublicPaths() {
    const rootTsconfig = JSON.parse(readFileSync(ROOT_TSCONFIG, 'utf8'));
    const inheritedPaths = Object.fromEntries(
        Object.entries(rootTsconfig.compilerOptions?.paths ?? {}).map(([key, values]) => [
            key,
            Array.isArray(values) ? values : [values],
        ]),
    );
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
    const paths = {
        ...inheritedPaths,
        'personaforge': ['./src/index.ts'],
    };

    for (const [exportKey, exportValue] of Object.entries(pkg.exports ?? {})) {
        if (exportKey === '.') {
            continue;
        }

        const publicImport = exportKey.startsWith('./')
            ? `personaforge/${exportKey.slice(2)}`
            : null;

        if (!publicImport || typeof exportValue !== 'object' || Array.isArray(exportValue)) {
            continue;
        }

        const target = normalizeExportTarget(exportValue.types)
            ?? normalizeExportTarget(exportValue.import)
            ?? normalizeExportTarget(exportValue.require);

        if (target) {
            paths[publicImport] = [target];
        }
    }

    return paths;
}

function writeSnippetFixtures(snippets, tempDir, publicPaths) {
    const filePaths = [];

    for (const snippet of snippets) {
        const baseName = `${sanitizeDocPath(snippet.docPath)}-snippet-${snippet.snippetIndex}.ts`;
        const fullPath = path.join(tempDir, baseName);
        writeFileSync(fullPath, createSnippetSource(snippet, fullPath, publicPaths), 'utf8');
        filePaths.push(fullPath);
    }

    return filePaths;
}

function writeTsconfig(tempRoot, includePaths) {
    const tsconfigPath = path.join(tempRoot, 'tsconfig.docs-snippets.json');
    const relativeIncludes = includePaths.map((filePath) => path.relative(tempRoot, filePath));
    const extendsPath = path.relative(tempRoot, path.join(ROOT, 'tsconfig.json')).replace(/\\/g, '/');
    const rootRelative = path.relative(tempRoot, ROOT).replace(/\\/g, '/');
    const config = {
        extends: extendsPath,
        compilerOptions: {
            noEmit: true,
            noUnusedLocals: false,
            noUnusedParameters: false,
            baseUrl: rootRelative,
            rootDir: rootRelative,
            types: ['bun-types', 'node'],
            paths: buildPublicPaths(),
        },
        include: relativeIncludes,
    };

    writeFileSync(tsconfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    return tsconfigPath;
}

function runTypecheck(tsconfigPath) {
    try {
        execFileSync(TSC_BIN, ['-p', tsconfigPath, '--pretty', 'false'], {
            cwd: ROOT,
            stdio: 'pipe',
            encoding: 'utf8',
        });
        return null;
    } catch (error) {
        return error.stdout || error.stderr || String(error);
    }
}

async function main() {
    const docsFiles = [README_FILE, ...await collectMarkdownFiles(DOCS_DIR)];
    const snippets = [];
    const privateImportViolations = [];
    const skippedSnippets = [];

    for (const filePath of docsFiles) {
        const content = readFileSync(filePath, 'utf8');
        const docPath = path.relative(ROOT, filePath);
        const extracted = extractSnippets(content, docPath);
        snippets.push(...extracted.snippets);
        privateImportViolations.push(...extracted.privateImportViolations);
        skippedSnippets.push(...extracted.skippedSnippets);
    }

    if (privateImportViolations.length > 0) {
        console.error('\n✗ docs-snippets: public docs still contain internal @personaforge/* imports.\n');
        for (const violation of privateImportViolations) {
            console.error(`- ${violation.docPath}#snippet-${violation.snippetIndex}: ${violation.privateImports.join(', ')}`);
        }
        process.exit(1);
    }

    if (snippets.length === 0) {
        console.log('✓ docs-snippets: no public TypeScript snippets found to validate.');
        return;
    }

    const tempRoot = mkdtempSync(path.join(ROOT, '.docs-snippets-'));

    try {
        const tempDir = path.join(tempRoot, 'snippets');
        mkdirSync(tempDir, { recursive: true });
        const publicPaths = buildPublicPaths();

        const includePaths = writeSnippetFixtures(snippets, tempDir, publicPaths);
        const tsconfigPath = writeTsconfig(tempRoot, includePaths);
        const output = runTypecheck(tsconfigPath);

        if (output) {
            console.error('\n✗ docs-snippets: one or more public TypeScript snippets do not typecheck.\n');
            console.error(output.trim());
            process.exitCode = 1;
            return;
        }

        const skipSuffix = skippedSnippets.length > 0
            ? ` (${skippedSnippets.length} illustrative snippet(s) skipped)`
            : '';
        console.log(`✓ docs-snippets: ${snippets.length} public TypeScript snippet(s) typecheck${skipSuffix}.`);
    } finally {
        rmSync(tempRoot, { force: true, recursive: true });
    }
}

main().catch((error) => {
    console.error('[check-docs-snippets] Fatal error:', error);
    process.exit(1);
});
