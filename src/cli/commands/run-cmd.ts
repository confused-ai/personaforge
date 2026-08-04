import type { Command } from 'commander';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { watch } from 'chokidar';

async function runFile(resolved: string, input: string): Promise<void> {
    // Bust module cache by appending a timestamp query param for watch re-runs
    const url = `${pathToFileURL(resolved).href}?t=${Date.now()}`;
    const mod = await import(url);
    if (typeof mod.run === 'function') {
        const out = await (mod.run as (i: string) => Promise<unknown>)(input);
        if (out !== undefined) console.log(out);
        return;
    }
    if (typeof mod.default === 'function') {
        const out = await (mod.default as (i: string) => Promise<unknown>)(input);
        if (out !== undefined) console.log(out);
        return;
    }
    throw new Error(`No runnable export found in ${resolved}. Export 'run(input)' or a default function.`);
}

export function registerRunCommand(program: Command): void {
    program
        .command('run')
        .description('Run an agent file (exports `run` or default function)')
        .argument('<file>', 'Agent file path')
        .option('-i, --input <input>', 'Input prompt', '')
        .option('-w, --watch', 'Re-run on file change', false)
        .action(async (file, options) => {
            const resolved = path.resolve(file);
            const input: string = options.input ?? '';

            if (!options.watch) {
                await runFile(resolved, input);
                return;
            }

            // Watch mode: re-run on change (chokidar — cross-platform, debounces
            // the multi-event storms node:fs.watch produces on macOS/Linux).
            console.log(`Watching ${resolved} for changes…`);
            await runFile(resolved, input).catch((e) => console.error('[error]', e));

            const watcher = watch(resolved, { persistent: true });
            let debounce: ReturnType<typeof setTimeout> | undefined;
            watcher.on('change', () => {
                clearTimeout(debounce);
                debounce = setTimeout(async () => {
                    console.log(`\n[changed] Re-running ${resolved}…`);
                    await runFile(resolved, input).catch((e) => console.error('[error]', e));
                }, 150);
            });

            // Keep process alive
            process.stdin.resume();
            process.on('SIGINT', () => { void watcher.close(); process.exit(0); });
        });
}
