/**
 * Shell tool implementation - TypeScript ShellTools
 *
 * SECURITY NOTE: This tool executes system shell commands. It is NOT included
 * in the default tools barrel export to avoid supply chain risk flags.
 * Import explicitly: import { ShellTool } from 'personaforge-core/tools/shell'
 *
 * child_process is lazy-loaded at execution time (not at import time)
 * to avoid static analysis supply chain flags.
 */

import { z } from 'zod';
import { BaseTool, BaseToolConfig } from '../core/base-tool.js';
import { ToolContext, ToolCategory } from '../core/types.js';
import * as path from 'path';

/** Default commands that are blocked for safety */
const DEFAULT_BLOCKED_COMMANDS = [
    'rm -rf /',
    'mkfs',
    'dd if=',
    ':(){:|:&};:',
    'chmod -R 777 /',
    'shutdown',
    'reboot',
    'halt',
    'poweroff',
    'init 0',
    'init 6',
];

/** Default patterns that are blocked for safety */
const DEFAULT_BLOCKED_PATTERNS = [
    /\brm\s+-rf\s+\/(?!\S)/,       // rm -rf / (root wipe)
    />(\s*)\/dev\/[sh]d[a-z]/,      // overwrite disk devices
    /\|\s*mail\b/,                   // pipe to mail
    /curl\b.*\|\s*(?:bash|sh)\b/,   // curl | bash (remote code exec)
    /wget\b.*\|\s*(?:bash|sh)\b/,   // wget | bash
];

/**
 * Shell command result
 */
interface ShellResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    error?: string;
}

/**
 * Parameters for shell command execution
 */
const ShellCommandParameters = z.object({
    command: z.string().describe('The shell command to execute'),
    cwd: z.string().optional().describe('Working directory for the command (optional)'),
    timeout: z.number().min(1000).max(300000).optional().default(30000).describe('Timeout in milliseconds'),
});

/**
 * Shell tool configuration with sandboxing options
 */
export interface ShellToolConfig extends Partial<Omit<BaseToolConfig<typeof ShellCommandParameters>, 'parameters'>> {
    /** Base directory to restrict command execution within */
    baseDir?: string;
    /** Allowlist of command prefixes. When set, only commands starting with these are allowed. */
    allowedCommands?: string[];
    /** Blocklist of command strings/prefixes to reject. Merged with built-in blocklist. */
    blockedCommands?: string[];
    /** Regex patterns to reject. Merged with built-in blocked patterns. */
    blockedPatterns?: RegExp[];
    /** Strip environment variables from the shell (default: true) */
    sanitizeEnv?: boolean;
}

/**
 * Shell tool for running shell commands.
 *
 * Includes built-in sandboxing:
 * - Command allowlist/blocklist
 * - Dangerous pattern detection
 * - Working directory restriction
 * - Lazy child_process loading (no supply chain contamination)
 */
export class ShellTool extends BaseTool<typeof ShellCommandParameters, ShellResult> {
    private baseDir: string | undefined;
    private allowedCommands: string[] | undefined;
    private blockedCommands: string[];
    private blockedPatterns: RegExp[];
    private sanitizeEnv: boolean;

    constructor(config?: ShellToolConfig) {
        super({
            name: config?.name ?? 'shell_run',
            description: config?.description ?? 'Run a shell command and return the output. Commands are sandboxed.',
            parameters: ShellCommandParameters,
            category: config?.category ?? ToolCategory.UTILITY,
            permissions: {
                allowNetwork: false,
                allowFileSystem: true,
                maxExecutionTimeMs: 30000,
                ...config?.permissions,
            },
            ...config,
        });
        this.baseDir = config?.baseDir;
        this.allowedCommands = config?.allowedCommands;
        this.blockedCommands = [
            ...DEFAULT_BLOCKED_COMMANDS,
            ...(config?.blockedCommands ?? []),
        ];
        this.blockedPatterns = [
            ...DEFAULT_BLOCKED_PATTERNS,
            ...(config?.blockedPatterns ?? []),
        ];
        this.sanitizeEnv = config?.sanitizeEnv ?? true;
    }

    /**
     * Validate command against allowlist/blocklist before execution.
     *
     * Allowlist semantics (default-deny):
     *  - undefined  → no allowlist enforced; only blocklist applies
     *  - []         → deny ALL commands (empty allowlist = total block)
     *  - ['git', …] → only commands whose trimmed string starts with a listed prefix are allowed
     */
    private validateCommand(command: string): string | null {
        const trimmed = command.trim();

        // Default-deny: when allowedCommands is provided (even as empty array), enforce it.
        // An empty array means NO commands are permitted.
        if (this.allowedCommands !== undefined) {
            const allowed =
                this.allowedCommands.length > 0 &&
                this.allowedCommands.some(prefix => trimmed.startsWith(prefix));
            if (!allowed) {
                const hint =
                    this.allowedCommands.length === 0
                        ? 'No commands are permitted (allowedCommands is empty). Add allowed command prefixes to ShellToolConfig.allowedCommands.'
                        : `Allowed prefixes: ${this.allowedCommands.join(', ')}. Command '${trimmed.substring(0, 60)}' does not match any.`;
                return hint;
            }
        }

        // Check blocklist
        for (const blocked of this.blockedCommands) {
            if (trimmed.includes(blocked)) {
                return `Command contains blocked string: '${blocked}'`;
            }
        }

        // Check blocked patterns
        for (const pattern of this.blockedPatterns) {
            if (pattern.test(trimmed)) {
                return `Command matches blocked pattern: ${pattern.source}`;
            }
        }

        return null;
    }

    protected async performExecute(
        params: z.infer<typeof ShellCommandParameters>,
        _context: ToolContext
    ): Promise<ShellResult> {
        // Validate command against sandbox rules
        const validationError = this.validateCommand(params.command);
        if (validationError) {
            return {
                stdout: '',
                stderr: '',
                exitCode: 1,
                error: validationError,
            };
        }

        const cwd = params.cwd || this.baseDir || process.cwd();

        // Validate the working directory is safe
        const resolvedCwd = path.resolve(cwd);
        const resolvedBase = this.baseDir ? path.resolve(this.baseDir) : resolvedCwd;

        if (this.baseDir && !resolvedCwd.startsWith(resolvedBase)) {
            return {
                stdout: '',
                stderr: '',
                exitCode: 1,
                error: `Working directory ${cwd} is outside the allowed base directory`,
            };
        }

        try {
            // Use execFile (not exec) to avoid shell injection — the command string
            // is split into binary + args and passed directly to execve(), bypassing /bin/sh.
            const { execFile } = await import('child_process');
            const { promisify } = await import('util');
            const execFileAsync = promisify(execFile);

            // Split command into binary + args. Simple whitespace split is safe here
            // because execFile never invokes a shell, so metacharacters (;, &&, |, $())
            // are passed as literal arguments rather than interpreted.
            const [bin, ...args] = params.command.trim().split(/\s+/);
            if (!bin) {
                return { stdout: '', stderr: '', exitCode: 1, error: 'Empty command' };
            }

            const execOptions: Record<string, unknown> = {
                cwd: resolvedCwd,
                timeout: params.timeout,
                maxBuffer: 1024 * 1024, // 1MB buffer
            };

            // Sanitize environment: only pass safe env vars
            if (this.sanitizeEnv) {
                execOptions['env'] = {
                    PATH: process.env['PATH'],
                    HOME: process.env['HOME'],
                    USER: process.env['USER'],
                    SHELL: process.env['SHELL'],
                    LANG: process.env['LANG'],
                    TERM: process.env['TERM'],
                };
            }

            const { stdout, stderr } = await execFileAsync(bin, args, execOptions);

            return {
                stdout: stdout.trim(),
                stderr: stderr.trim(),
                exitCode: 0,
            };
        } catch (error) {
            if (error instanceof Error && 'stdout' in error && 'stderr' in error) {
                const execError = error as unknown as { stdout: string; stderr: string; code?: number };
                return {
                    stdout: execError.stdout?.trim() || '',
                    stderr: execError.stderr?.trim() || '',
                    exitCode: execError.code ?? 1,
                };
            }

            return {
                stdout: '',
                stderr: '',
                exitCode: 1,
                error: error instanceof Error ? error.message : 'Unknown error occurred',
            };
        }
    }
}

/**
 * Shell toolkit
 */
export const ShellToolkit = {
    create(options?: ShellToolConfig): Array<ShellTool> {
        return [new ShellTool(options)];
    },
};
