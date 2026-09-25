/**
 * E2B Code Interpreter tools — run code in secure sandboxes via E2B.
 * API docs: https://e2b.dev/docs
 * API key: https://e2b.dev/dashboard/api-keys
 */

import { z } from 'zod';
import { BaseTool } from '../core/base-tool.js';
import { ToolCategory, type ToolContext } from '../core/types.js';

export interface E2BToolConfig {
    /** E2B API key (or E2B_API_KEY env var) */
    apiKey?: string;
    /** Default sandbox timeout in seconds */
    timeoutSecs?: number;
}

function getKey(config: E2BToolConfig): string {
    const key = config.apiKey ?? process.env['E2B_API_KEY'];
    if (!key) throw new Error('E2BTools require E2B_API_KEY');
    return key;
}

/** Package specifiers for pip (`name[extra]`) and npm (`[@scope/]name`). */
const PACKAGE_NAME = /^(@[A-Za-z0-9_.\-~]+\/)?[A-Za-z0-9_.\-~]+(\[[A-Za-z0-9_.\-,]+\])?$/;

/** Throw unless `pkg` is a plain package specifier (no shell metacharacters). */
function assertPackageName(pkg: string): void {
    if (!PACKAGE_NAME.test(pkg)) {
        throw new Error(`Invalid package name: ${JSON.stringify(pkg)}.`);
    }
}

// ── Schemas ────────────────────────────────────────────────────────────────

const RunCodeSchema = z.object({
    code: z.string().describe('Code to execute in the sandbox'),
    language: z.enum(['python', 'javascript', 'typescript', 'bash']).optional().default('python')
        .describe('Programming language'),
    sandboxTemplate: z.string().optional().default('base')
        .describe('Sandbox template ID (base, code-interpreter-v1, etc.)'),
    timeoutSecs: z.number().int().min(5).max(300).optional().default(60)
        .describe('Execution timeout in seconds'),
    files: z.array(z.object({
        path: z.string().describe('File path in sandbox'),
        content: z.string().describe('File content'),
    })).optional().describe('Files to create in sandbox before executing'),
    envVars: z.record(z.string(), z.string()).optional().describe('Environment variables to set in sandbox'),
});

const InstallPackagesSchema = z.object({
    packages: z.array(z.string()).min(1).describe('Packages to install'),
    language: z.enum(['python', 'javascript']).optional().default('python'),
    sandboxId: z.string().optional().describe('Reuse existing sandbox ID'),
});

const RunNotebookSchema = z.object({
    cells: z.array(z.object({
        source: z.string().describe('Cell source code'),
        cellType: z.enum(['code', 'markdown']).optional().default('code'),
    })).min(1).describe('Notebook cells to execute'),
    sandboxTemplate: z.string().optional().default('code-interpreter-v1'),
    timeoutSecs: z.number().int().optional().default(120),
});

// ── Tools ──────────────────────────────────────────────────────────────────

export class E2BRunCodeTool extends BaseTool<typeof RunCodeSchema, {
    stdout: string;
    stderr: string;
    exitCode: number;
    results: unknown[];
    sandboxId: string;
}> {
    constructor(private config: E2BToolConfig = {}) {
        super({
            id: 'e2b_run_code',
            name: 'E2B Run Code',
            description: 'Execute code in an E2B secure cloud sandbox. Supports Python, JavaScript, TypeScript, and Bash.',
            category: ToolCategory.UTILITY,
            parameters: RunCodeSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 360000 },
        });
    }

    protected async performExecute(input: z.infer<typeof RunCodeSchema>, _ctx: ToolContext) {
        const key = getKey(this.config);
        const timeoutSecs = input.timeoutSecs ?? this.config.timeoutSecs ?? 60;

        // Create sandbox
        const sandboxRes = await fetch('https://api.e2b.dev/sandboxes', {
            method: 'POST',
            headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                templateID: input.sandboxTemplate ?? 'base',
                timeout: timeoutSecs,
            }),
        });
        if (!sandboxRes.ok) throw new Error(`E2B API ${sandboxRes.status}: ${await sandboxRes.text()}`);
        const sandbox = await sandboxRes.json() as { sandboxID: string };
        const sandboxId = sandbox.sandboxID;

        try {
            // Write files if provided
            if (input.files?.length) {
                for (const file of input.files) {
                    await fetch(`https://api.e2b.dev/sandboxes/${sandboxId}/files?path=${encodeURIComponent(file.path)}`, {
                        method: 'POST',
                        headers: { 'X-API-Key': key, 'Content-Type': 'text/plain' },
                        body: file.content,
                    });
                }
            }

            // Execute code
            const execRes = await fetch(`https://api.e2b.dev/sandboxes/${sandboxId}/process`, {
                method: 'POST',
                headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    cmd: input.language === 'python' ? 'python3' : input.language === 'javascript' ? 'node' : input.language === 'typescript' ? 'ts-node' : 'bash',
                    args: ['-c', input.code],
                    envVars: input.envVars ?? {},
                    timeout: timeoutSecs * 1000,
                }),
            });
            if (!execRes.ok) throw new Error(`E2B API ${execRes.status}: ${await execRes.text()}`);
            const result = await execRes.json() as {
                stdout?: string;
                stderr?: string;
                exitCode?: number;
                results?: unknown[];
            };

            return {
                stdout: result.stdout ?? '',
                stderr: result.stderr ?? '',
                exitCode: result.exitCode ?? 0,
                results: result.results ?? [],
                sandboxId,
            };
        } finally {
            // Always close sandbox
            await fetch(`https://api.e2b.dev/sandboxes/${sandboxId}`, {
                method: 'DELETE',
                headers: { 'X-API-Key': key },
            }).catch(() => {});
        }
    }
}

export class E2BInstallPackagesTool extends BaseTool<typeof InstallPackagesSchema> {
    constructor(private config: E2BToolConfig = {}) {
        super({
            id: 'e2b_install_packages',
            name: 'E2B Install Packages',
            description: 'Install Python or JavaScript packages in an E2B sandbox.',
            category: ToolCategory.UTILITY,
            parameters: InstallPackagesSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 120000 },
        });
    }

    protected async performExecute(input: z.infer<typeof InstallPackagesSchema>, _ctx: ToolContext) {
        const key = getKey(this.config);
        for (const pkg of input.packages) assertPackageName(pkg);
        const installCmd = input.language === 'python'
            ? `pip install ${input.packages.join(' ')}`
            : `npm install ${input.packages.join(' ')}`;

        const sandboxRes = await fetch('https://api.e2b.dev/sandboxes', {
            method: 'POST',
            headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ templateID: 'base', timeout: 120 }),
        });
        if (!sandboxRes.ok) throw new Error(`E2B API ${sandboxRes.status}: ${await sandboxRes.text()}`);
        const sandbox = await sandboxRes.json() as { sandboxID: string };

        try {
            const execRes = await fetch(`https://api.e2b.dev/sandboxes/${sandbox.sandboxID}/process`, {
                method: 'POST',
                headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
                body: JSON.stringify({ cmd: 'bash', args: ['-c', installCmd], timeout: 120000 }),
            });
            if (!execRes.ok) throw new Error(`E2B API ${execRes.status}: ${await execRes.text()}`);
            return await execRes.json();
        } finally {
            await fetch(`https://api.e2b.dev/sandboxes/${sandbox.sandboxID}`, {
                method: 'DELETE', headers: { 'X-API-Key': key },
            }).catch(() => {});
        }
    }
}

export class E2BRunNotebookTool extends BaseTool<typeof RunNotebookSchema> {
    constructor(private config: E2BToolConfig = {}) {
        super({
            id: 'e2b_run_notebook',
            name: 'E2B Run Notebook',
            description: 'Execute a Jupyter-style notebook with multiple cells in an E2B sandbox.',
            category: ToolCategory.UTILITY,
            parameters: RunNotebookSchema,
            permissions: { allowNetwork: true, allowFileSystem: false, maxExecutionTimeMs: 360000 },
        });
    }

    protected async performExecute(input: z.infer<typeof RunNotebookSchema>, _ctx: ToolContext) {
        const key = getKey(this.config);
        const sandboxRes = await fetch('https://api.e2b.dev/sandboxes', {
            method: 'POST',
            headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ templateID: input.sandboxTemplate ?? 'code-interpreter-v1', timeout: input.timeoutSecs ?? 120 }),
        });
        if (!sandboxRes.ok) throw new Error(`E2B API ${sandboxRes.status}: ${await sandboxRes.text()}`);
        const sandbox = await sandboxRes.json() as { sandboxID: string };

        try {
            const results = [];
            for (const cell of input.cells) {
                if (cell.cellType === 'markdown') {
                    results.push({ cellType: 'markdown', source: cell.source });
                    continue;
                }
                const execRes = await fetch(`https://api.e2b.dev/sandboxes/${sandbox.sandboxID}/process`, {
                    method: 'POST',
                    headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cmd: 'python3', args: ['-c', cell.source], timeout: (input.timeoutSecs ?? 120) * 1000 }),
                });
                if (!execRes.ok) throw new Error(`E2B API ${execRes.status}: ${await execRes.text()}`);
                results.push({ cellType: 'code', source: cell.source, result: await execRes.json() });
            }
            return { sandboxId: sandbox.sandboxID, cells: results };
        } finally {
            await fetch(`https://api.e2b.dev/sandboxes/${sandbox.sandboxID}`, {
                method: 'DELETE', headers: { 'X-API-Key': key },
            }).catch(() => {});
        }
    }
}

export class E2BToolkit {
    readonly runCode: E2BRunCodeTool;
    readonly installPackages: E2BInstallPackagesTool;
    readonly runNotebook: E2BRunNotebookTool;

    constructor(config: E2BToolConfig = {}) {
        this.runCode = new E2BRunCodeTool(config);
        this.installPackages = new E2BInstallPackagesTool(config);
        this.runNotebook = new E2BRunNotebookTool(config);
    }

    getTools() {
        return [this.runCode, this.installPackages, this.runNotebook];
    }
}
