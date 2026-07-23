/**
 * @personaforge/tools — shell execution tool.
 *
 * SRP  — this file owns only the shell tool.
 * DIP  — uses defineTool abstraction; no class inheritance.
 *
 * ⚠  Security: NOT re-exported from the package barrel by default.
 *    Import explicitly: import { createShellTool } from './shell.js'
 *
 * Default-deny allowlist:
 *    createShellTool()                          → DENY ALL (safe default)
 *    createShellTool({ allowedCommands: [] })   → DENY ALL (explicit, same as default)
 *    createShellTool({ allowedCommands: ['git', 'npm'] }) → only those prefixes allowed
 *    createShellTool({ allowedCommands: null }) → unrestricted (dev/test ONLY)
 *
 * Uses node:child_process.execFile — no shell expansion (no injection risk).
 * child_process is a Node built-in — zero external dependencies.
 */

import { z }          from 'zod';
import { execFile }   from 'node:child_process';
import { promisify }  from 'node:util';
import { defineTool } from './types.js';

const execFileAsync = promisify(execFile);

const ShellInputSchema = z.object({
  /** Command binary — e.g. "git", "npm". Never shell-expanded. */
  command: z.string().min(1),
  /** Positional args — passed directly to execFile (no shell injection risk). */
  args:    z.array(z.string()).default([]),
  /** Working directory. Defaults to process.cwd(). */
  cwd:     z.string().optional(),
  /** Timeout in ms. Default 30 000. Max 300 000 (5 min). */
  timeout: z.number().int().positive().max(300_000).default(30_000),
});

export interface ShellToolOptions {
  /**
   * Allowlist of command prefixes (the binary name or path prefix).
   *
   * - `[]` (default) — **deny all**; no commands are permitted. (**Production-safe default.**)
   * - `['git', 'npm']` — only commands whose binary starts with a listed prefix are allowed.
   * - `null` — explicitly opt in to unrestricted mode (trusted/dev environments ONLY).
   *
   * Always supply an explicit allowlist. Never use `null` in production.
   */
  allowedCommands?: string[] | null;
}

/**
 * Create a shell execution tool with an optional command allowlist.
 *
 * **Default posture is deny-all** (`allowedCommands: []`). You must explicitly
 * configure an allowlist to enable any commands. This prevents accidental
 * exposure of shell execution to untrusted LLM-controlled agents.
 *
 * @example
 * // Explicit allowlist — only git and npm are permitted
 * const sh = createShellTool({ allowedCommands: ['git', 'npm', 'node'] });
 *
 * @example
 * // Unrestricted — trusted/dev environments ONLY. Never use in production.
 * const sh = createShellTool({ allowedCommands: null });
 *
 * @example
 * // Default (deny all) — equivalent to createShellTool({ allowedCommands: [] })
 * const sh = createShellTool();
 */
export function createShellTool(options?: ShellToolOptions) {
  // Default-deny: empty array blocks everything. `null` = explicit opt-out (unrestricted).
  const allowedCommands = options?.allowedCommands === null ? undefined : (options?.allowedCommands ?? []);

  return defineTool({
    name:        'shell',
    description: 'Execute a shell command with arguments. Returns stdout and stderr. No shell expansion — args are passed directly to execFile.',
    parameters:  ShellInputSchema,

    async execute({ command, args, cwd, timeout }) {
      // Default-deny enforcement. `allowedCommands` is undefined only when explicitly set to null.
      if (allowedCommands !== undefined) {
        const permitted =
          allowedCommands.length > 0 &&
          allowedCommands.some(prefix => command.startsWith(prefix));
        if (!permitted) {
          const hint =
            allowedCommands.length === 0
              ? `Shell command "${command}" blocked: no commands are permitted. Configure allowedCommands to enable specific commands.`
              : `Shell command "${command}" is not in the allowed list: [${allowedCommands.join(', ')}].`;
          return { success: false, stdout: '', stderr: hint, exitCode: 1 };
        }
      }

      try {
        const { stdout, stderr } = await execFileAsync(command, args, {
          cwd:       cwd ?? process.cwd(),
          timeout,
          maxBuffer: 10 * 1024 * 1024, // 10 MB output cap
        });
        return {
          success:  true,
          stdout:   stdout.trim(),
          stderr:   stderr.trim(),
          exitCode: 0,
        };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; code?: number; message: string };
        return {
          success:  false,
          stdout:   e.stdout?.trim() ?? '',
          stderr:   e.stderr?.trim() ?? e.message,
          exitCode: e.code ?? 1,
        };
      }
    },
  });
}

/**
 * Pre-built shell tool with **no command restrictions** — all commands are permitted.
 *
 * This export exists only for convenience in trusted local scripts and tests.
 * **Never expose this tool to an LLM in a production environment.**
 * Use `createShellTool({ allowedCommands: [...] })` with an explicit allowlist instead.
 *
 * @deprecated Use `createShellTool({ allowedCommands: [...] })` for any production use.
 */
export const shell = createShellTool({ allowedCommands: null });
