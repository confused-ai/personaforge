/**
 * Code-mode sandboxes — the execution boundary for model-authored code.
 *
 * `createCodeMode()` runs model-written scripts in a sandbox. Only the
 * user-provided tools are reachable (as `external_*` functions), bridged back to
 * the host. Two sandboxes ship:
 *
 * - `LocalSandbox` — spawns an isolated `node` child process (default). The
 *   script has no filesystem/network/module access beyond bridged tool calls.
 * - `VMSandbox` — runs in-process inside a `node:vm` context. Cheaper, but vm
 *   is not a hard security boundary; prefer `LocalSandbox` for untrusted input.
 */

import { spawn } from 'node:child_process';
import * as nodeVm from 'node:vm';

export type ExternalCall = (args: unknown) => Promise<unknown>;

export type SandboxRunResult =
    | { ok: true; result: unknown; stdout: string; executionMs: number }
    | { ok: false; error: { message: string; stack?: string }; stdout: string; executionMs: number };

export interface SandboxRunOptions {
    timeoutMs?: number;
    /** Cap on accumulated stdout/stderr captured by the sandbox. Default 1 MiB. */
    maxOutputBytes?: number;
}

export interface Sandbox {
    readonly name: string;
    run(code: string, externals: Record<string, ExternalCall>, options?: SandboxRunOptions): Promise<SandboxRunResult>;
}

// ── LocalSandbox — isolated child process over JSON-lines IPC ────────────────

const RUNTIME_SOURCE = String.raw`
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = new Map();
let nextId = 1;
let callTimeoutMs = 60000;
function call(name, args) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    process.stdout.write(JSON.stringify({ id, name, args }) + '\n');
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); reject(new Error('external call timed out')); }
    }, callTimeoutMs);
  });
}
rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg && typeof msg.id === 'number' && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(String(msg.error)));
      else p.resolve(msg.result);
    }
  } catch (e) { /* ignore malformed control lines */ }
});
rl.once('line', async (init) => {
  let cfg;
  try { cfg = JSON.parse(init); } catch (e) { process.stderr.write('bad init\\n'); process.exit(1); }
  if (typeof cfg.externalTimeoutMs === 'number') callTimeoutMs = cfg.externalTimeoutMs;
  const externals = Object.create(null);
  for (const name of (cfg.externals || [])) {
    externals['external_' + name] = (args) => call(name, args);
  }
  const names = Object.keys(externals);
  const fn = new Function(...names, 'return (async () => {' + cfg.code + '\n})();');
  const emit = (msg) => process.stdout.write(JSON.stringify(msg) + '\n', () => process.exit(0));
  try {
    const result = await fn(...names.map((n) => externals[n]));
    emit({ id: -1, done: true, result: result === undefined ? null : result });
  } catch (e) {
    emit({ id: -1, done: true, error: { message: String((e && e.message) || e), stack: e && e.stack } });
  }
});
`;

export class LocalSandbox implements Sandbox {
    readonly name = 'local';
    constructor(private readonly nodePath: string = process.execPath) {}

    run(
        code: string,
        externals: Record<string, ExternalCall>,
        options?: SandboxRunOptions,
    ): Promise<SandboxRunResult> {
        return new Promise((resolve) => {
            const started = Date.now();
            const maxOutputBytes = options?.maxOutputBytes ?? 1_048_576;
            let stdout = '';
            let stderr = '';
            let settled = false;
            const child = spawn(this.nodePath, ['-e', RUNTIME_SOURCE], { stdio: ['pipe', 'pipe', 'pipe'] });

            const cap = (s: string): string => (s.length > maxOutputBytes ? s.slice(-maxOutputBytes) : s);

            const finish = (result: SandboxRunResult) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                child.kill('SIGKILL');
                resolve(result);
            };

            const timer = setTimeout(() => {
                finish({ ok: false, error: { message: `Code execution timed out after ${options?.timeoutMs ?? 60_000}ms`, stack: undefined }, stdout: cap(stdout), executionMs: Date.now() - started });
            }, options?.timeoutMs ?? 60_000);

            child.stderr.setEncoding('utf8');
            child.stderr.on('data', (d: Buffer | string) => {
                stderr = cap(stderr + String(d));
            });

            child.stdout.setEncoding('utf8');
            let buffer = '';
            child.stdout.on('data', (chunk: string) => {
                buffer = cap(buffer + chunk);
                let idx = buffer.indexOf('\n');
                while (idx >= 0) {
                    const line = buffer.slice(0, idx).trim();
                    buffer = buffer.slice(idx + 1);
                    idx = buffer.indexOf('\n');
                    if (!line) continue;
                    let msg: { id?: number; done?: boolean; result?: unknown; error?: { message?: string; stack?: string }; name?: string; args?: unknown };
                    try {
                        msg = JSON.parse(line);
                    } catch {
                        stdout = cap(stdout + line + '\n');
                        continue;
                    }
                    if (!msg) continue;
                    if (msg.id !== undefined && msg.id > 0) {
                        // External request from the script → call the host tool.
                        const ext = externals[msg.name ?? ''];
                        if (!ext) {
                            child.stdin.write(JSON.stringify({ id: msg.id, error: `Unknown external function: ${msg.name}` }) + '\n');
                        } else {
                            Promise.resolve()
                                .then(() => ext(msg.args))
                                .then((result) => child.stdin.write(JSON.stringify({ id: msg.id, result }) + '\n'))
                                .catch((e) => child.stdin.write(JSON.stringify({ id: msg.id, error: e instanceof Error ? e.message : String(e) }) + '\n'));
                        }
                    } else if (msg.done) {
                        if (msg.error) {
                            finish({ ok: false, error: { message: msg.error.message ?? 'Script error', stack: msg.error.stack }, stdout: cap(stdout), executionMs: Date.now() - started });
                        } else {
                            finish({ ok: true, result: msg.result, stdout: cap(stdout), executionMs: Date.now() - started });
                        }
                    }
                }
            });

            child.on('error', (err) => {
                finish({ ok: false, error: { message: `Failed to start sandbox: ${err.message}` }, stdout: cap(stdout), executionMs: Date.now() - started });
            });
            child.on('exit', (code) => {
                if (!settled) {
                    finish({ ok: false, error: { message: `Sandbox exited early (code ${code ?? 'null'})${stderr ? `: ${stderr.slice(0, 300)}` : ''}` }, stdout: cap(stdout), executionMs: Date.now() - started });
                }
            });

            child.stdin.write(JSON.stringify({ code, externals: Object.keys(externals), externalTimeoutMs: options?.timeoutMs ?? 60_000 }) + '\n');
        });
    }
}

// ── VMSandbox — in-process node:vm context ───────────────────────────────────

export class VMSandbox implements Sandbox {
    readonly name = 'vm';

    async run(
        code: string,
        externals: Record<string, ExternalCall>,
        options?: SandboxRunOptions,
    ): Promise<SandboxRunResult> {
        const started = Date.now();
        const maxOutputBytes = options?.maxOutputBytes ?? 1_048_576;
        let stdout = '';
        const cap = (s: string): string => (s.length > maxOutputBytes ? s.slice(-maxOutputBytes) : s);
        const context: Record<string, unknown> = {
            console: {
                log: (...args: unknown[]) => { stdout = cap(stdout + args.map(String).join(' ') + '\n'); },
                error: (...args: unknown[]) => { stdout = cap(stdout + args.map(String).join(' ') + '\n'); },
            },
            Promise, JSON, Object, Array, Math, Date, Number, String, Boolean,
            parseFloat, parseInt, isNaN, isFinite,
            encodeURI, encodeURIComponent, decodeURI, decodeURIComponent,
            Reflect, Symbol,
        };
        for (const name of Object.keys(externals)) {
            context[`external_${name}`] = (args: unknown) => externals[name](args);
        }
        nodeVm.createContext(context);
        try {
            const promise = nodeVm.runInContext(`(async () => { ${code}\n })()`, context, {
                timeout: options?.timeoutMs ?? 60_000,
            }) as Promise<unknown>;
            const result = await promise;
            return { ok: true, result: result ?? null, stdout, executionMs: Date.now() - started };
        } catch (err) {
            return {
                ok: false,
                error: { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined },
                stdout,
                executionMs: Date.now() - started,
            };
        }
    }
}

/** Create a sandbox by name (testing convenience). */
export function createSandbox(name: 'local' | 'vm' = 'local'): Sandbox {
    return name === 'vm' ? new VMSandbox() : new LocalSandbox();
}
