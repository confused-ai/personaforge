import type { Command } from 'commander';

const TEMPLATES = [
    { name: 'basic', description: 'Minimal agent with one LLM call' },
    { name: 'http', description: 'Agent exposed as an HTTP API (JSON + SSE)' },
];

export function registerListTemplatesCommand(program: Command): void {
    program
        .command('list-templates')
        .description('List available project templates')
        .action(() => {
            console.log('\nAvailable templates:\n');
            for (const t of TEMPLATES) {
                console.log(`  ${t.name.padEnd(16)} ${t.description}`);
            }
            console.log('\nUsage: personaforge create <name> --template <name>\n');
        });
}
