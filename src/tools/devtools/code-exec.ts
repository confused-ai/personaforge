/**
 * Code execution tools — run JS in a vm sandbox, Python in a subprocess,
 * or whitelisted shell commands. No extra dependencies required.
 */

import { z } from 'zod';
import { BaseTool } from '../core/base-tool.js';
import { ToolCategory, type ToolContext } from '../core/types.js';

export interface CodeExecToolConfig {
    /** Execution timeout in milliseconds (default: 5000) */
    timeoutMs?: number;
    /** Whitelisted shell commands for ShellCommandTool */
    allowedCommands?: string[];
}

export interface CodeExecResult {
    stdout: string;
    stderr: string;
    returnValue: unknown;
    executionMs: number;
    success: boolean;
    error?: string;
}

// ── Output cap ─────────────────────────────────────────────────────────────

/** Max captured bytes per stream — runaway output can't OOM the host. */
const MAX_STREAM_BYTES = 1_000_000;

/** Append a chunk, truncating with a marker once over the cap. */
function appendCapped(current: string, chunk: string): string {
    if (current.length >= MAX_STREAM_BYTES) return current;
    const next = current + chunk;
    return next.length > MAX_STREAM_BYTES
        ? `${next.slice(0, MAX_STREAM_BYTES)}\n…[truncated at 1 MB]`
        : next;
}

// ── Schemas ────────────────────────────────────────────────────────────────

const JsSchema = z.object({
    code: z.string().describe('JavaScript code to execute'),
});

const PySchema = z.object({
    code: z.string().describe('Python 3 code to execute'),
});

const ShellSchema = z.object({
    command: z.string().describe('Command to run (must be on the allowlist)'),
    args: z.array(z.string()).optional().describe('Command arguments'),
});

// ── JavaScript sandbox ─────────────────────────────────────────────────────

export class JavaScriptExecTool extends BaseTool<typeof JsSchema, CodeExecResult> {
    constructor(private config: CodeExecToolConfig = {}) {
        super({
            id: 'js_exec',
            name: 'JavaScript Exec',
            description: 'Execute a JavaScript snippet in a vm context with a timeout. node:vm is NOT a security boundary — run only trusted code, never untrusted model output. Use console.log() to capture output.',
            category: ToolCategory.UTILITY,
            parameters: JsSchema,
        });
    }

    protected async performExecute(input: z.infer<typeof JsSchema>, _ctx: ToolContext): Promise<CodeExecResult> {
        const vm = await import('node:vm');
        const timeoutMs = this.config.timeoutMs ?? 5000;
        const start = Date.now();
        const logs: string[] = [];
        const errors: string[] = [];
        // Bounded capture: a `while(true) console.log()` loop can't OOM the host.
        const pushCapped = (arr: string[], line: string): void => {
            if (arr.length >= 10_000) {
                if (arr[arr.length - 1] !== '…[truncated at 10,000 lines]') arr.push('…[truncated at 10,000 lines]');
                return;
            }
            arr.push(line.length > 10_000 ? `${line.slice(0, 10_000)}…[truncated]` : line);
        };

        const sandbox = {
            console: {
                log: (...a: unknown[]) => pushCapped(logs, a.map(String).join(' ')),
                error: (...a: unknown[]) => pushCapped(errors, a.map(String).join(' ')),
                warn: (...a: unknown[]) => pushCapped(errors, '[warn] ' + a.map(String).join(' ')),
                info: (...a: unknown[]) => pushCapped(logs, '[info] ' + a.map(String).join(' ')),
            },
            Math, JSON, Date, Array, Object, String, Number, Boolean,
            parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
        };

        try {
            const ctx = vm.createContext(sandbox);
            const script = new vm.Script(input.code);
            const returnValue: unknown = script.runInContext(ctx, { timeout: timeoutMs });
            return {
                stdout: logs.join('\n'), stderr: errors.join('\n'),
                returnValue: returnValue === undefined ? null : returnValue,
                executionMs: Date.now() - start, success: true,
            };
        } catch (err) {
            return {
                stdout: logs.join('\n'), stderr: errors.join('\n'),
                returnValue: null, executionMs: Date.now() - start, success: false,
                error: err instanceof Error ? err.message : String(err),
            };
        }
    }
}

// ── Python subprocess ──────────────────────────────────────────────────────

export class PythonExecTool extends BaseTool<typeof PySchema, CodeExecResult> {
    constructor(private config: CodeExecToolConfig = {}) {
        super({
            id: 'python_exec',
            name: 'Python Exec',
            description: 'Execute a Python 3 snippet in a subprocess. Requires python3 on PATH. Use print() to capture output.',
            category: ToolCategory.UTILITY,
            parameters: PySchema,
        });
    }

    protected async performExecute(input: z.infer<typeof PySchema>, _ctx: ToolContext): Promise<CodeExecResult> {
        const { spawn } = await import('node:child_process');
        const timeoutMs = this.config.timeoutMs ?? 10_000;
        const start = Date.now();

        return new Promise((resolve) => {
            const proc = spawn('python3', ['-c', input.code], {
                timeout: timeoutMs,
                env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin' },
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (d: Buffer) => { stdout = appendCapped(stdout, d.toString()); });
            proc.stderr.on('data', (d: Buffer) => { stderr = appendCapped(stderr, d.toString()); });
            proc.on('close', (code) => {
                resolve({
                    stdout: stdout.trim(), stderr: stderr.trim(), returnValue: null,
                    executionMs: Date.now() - start, success: code === 0,
                    ...(code !== 0 && { error: `Process exited with code ${code}` }),
                });
            });
            proc.on('error', (err) => {
                resolve({ stdout, stderr, returnValue: null, executionMs: Date.now() - start, success: false, error: err.message });
            });
        });
    }
}

// ── Shell command (allowlisted) ────────────────────────────────────────────

export class ShellCommandTool extends BaseTool<typeof ShellSchema, CodeExecResult> {
    private allowedCommands: Set<string>;

    constructor(private config: CodeExecToolConfig = {}) {
        super({
            id: 'shell_command',
            name: 'Shell Command',
            description: 'Run a whitelisted shell command. Only pre-approved commands are permitted.',
            category: ToolCategory.UTILITY,
            parameters: ShellSchema,
        });
        this.allowedCommands = new Set(
            config.allowedCommands ?? ['ls', 'cat', 'echo', 'pwd', 'date', 'wc', 'grep', 'sort', 'uniq', 'head', 'tail'],
        );
    }

    protected async performExecute(input: z.infer<typeof ShellSchema>, _ctx: ToolContext): Promise<CodeExecResult> {
        if (!this.allowedCommands.has(input.command)) {
            return {
                stdout: '', stderr: '', returnValue: null, executionMs: 0, success: false,
                error: `Command "${input.command}" is not in the allowed list.`,
            };
        }
        const { spawn } = await import('node:child_process');
        const start = Date.now();
        return new Promise((resolve) => {
            const proc = spawn(input.command, input.args ?? [], { timeout: this.config.timeoutMs ?? 10_000 });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', (d: Buffer) => { stdout = appendCapped(stdout, d.toString()); });
            proc.stderr.on('data', (d: Buffer) => { stderr = appendCapped(stderr, d.toString()); });
            proc.on('close', (code) => {
                resolve({
                    stdout: stdout.trim(), stderr: stderr.trim(), returnValue: null,
                    executionMs: Date.now() - start, success: code === 0,
                    ...(code !== 0 && { error: `Exited with code ${code}` }),
                });
            });
            proc.on('error', (err) => {
                resolve({ stdout, stderr, returnValue: null, executionMs: Date.now() - start, success: false, error: err.message });
            });
        });
    }
}

// ── Toolkit ────────────────────────────────────────────────────────────────

export class CodeExecToolkit {
    readonly tools: BaseTool[];
    constructor(config: CodeExecToolConfig = {}) {
        this.tools = [
            new JavaScriptExecTool(config),
            new PythonExecTool(config),
            new ShellCommandTool(config),
        ];
    }
}
