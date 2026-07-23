/**
 * `personaforge chat` — interactive single-agent REPL
 *
 * Usage:
 *   personaforge chat
 *   personaforge chat --system "You are a Rust expert."
 *   personaforge chat --model "openai:gpt-4o"
 *
 * The session ID is preserved across turns so the agent retains context for the
 * full conversation. Press Ctrl-C or type "/exit" to quit.
 */

import type { Command } from 'commander';
import readline from 'node:readline';
import { generateEntityId } from '../../core/index.js';
import { defineAgent } from '../../sdk/index.js';
import { InMemoryStore } from '../../memory/index.js';

/** Strip ANSI escape codes for clean stdout length estimation. */
function printLine(msg: string): void {
    process.stdout.write(msg + '\n');
}

const QUIT_COMMANDS = new Set(['/exit', '/quit', '/q', 'exit', 'quit']);

export function registerChatCommand(program: Command): void {
    program
        .command('chat')
        .description('Start an interactive agent REPL with persistent session context')
        .option('-s, --system <text>', 'System instructions for the agent', 'You are a helpful AI assistant.')
        .option('-m, --model <ref>', 'Model reference (e.g. openai:gpt-4o)', '')
        .option('--session-id <id>', 'Resume an existing session by ID')
        .action(async (options: { system: string; model: string; sessionId?: string }) => {
            const sessionId: string = options.sessionId ?? generateEntityId();

            // Build the agent (no LLM provider wired by default — callers provide one via
            // the handler override when integrating; in standalone mode we echo responses)
            const builderBase = defineAgent('chat-agent')
                .instructions(options.system)
                .memory(new InMemoryStore());

            const agent = (options.model
                ? builderBase.model(options.model as `${string}:${string}`)
                : builderBase
            ).build();

            const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
                terminal: true,
                prompt: '> ',
            });

            printLine('');
            printLine(`  personaforge chat  (session: ${sessionId})`);
            printLine(`  System: ${options.system}`);
            printLine(`  Type "/exit" or press Ctrl-C to quit.\n`);

            rl.prompt();

            rl.on('line', async (line: string) => {
                const input = line.trim();
                if (!input) {
                    rl.prompt();
                    return;
                }

                if (QUIT_COMMANDS.has(input.toLowerCase())) {
                    printLine('\nGoodbye!');
                    rl.close();
                    process.exit(0);
                }

                rl.pause();

                try {
                    const result = await agent.run(input, { sessionId });

                    // The default agent (no handler/LLM) echoes validated input as output.
                    // When a real LLM provider is configured the result will contain `text`.
                    const text = (typeof result === 'object' && result !== null && 'text' in result)
                        ? String((result as { text: unknown }).text)
                        : typeof result === 'string'
                            ? result
                            : JSON.stringify(result, null, 2);

                    printLine(`\nAssistant: ${text}\n`);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    printLine(`\n[error] ${msg}\n`);
                } finally {
                    rl.resume();
                    rl.prompt();
                }
            });

            rl.on('close', () => {
                printLine('\nSession ended.');
                process.exit(0);
            });

            // Ctrl-C: print newline before exiting for clean terminal state
            rl.on('SIGINT', () => {
                printLine('\n\nGoodbye! (Ctrl-C)');
                rl.close();
                process.exit(0);
            });
        });
}
