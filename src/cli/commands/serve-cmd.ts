import type { Command } from 'commander';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * `personaforge serve <file>` — import an agent file and start an HTTP service.
 *
 * The agent file must export one of:
 *   - `export const agent = createAgent(...)` — a CreateAgentResult
 *   - `export default createAgent(...)` — same as above
 *   - `export const agents = { name: createAgent(...), ... }` — named agents
 *
 * @example
 * personaforge serve ./my-agent.ts --port 3000
 * personaforge serve ./my-agent.ts --port 3000 --cors '*' --websocket
 */
export function registerServeCommand(program: Command): void {
    program
        .command('serve')
        .description('Start an HTTP service from an agent file')
        .argument('<file>', 'Agent file exporting agent(s)')
        .option('-p, --port <port>', 'HTTP port', '8787')
        .option('--cors <origin>', 'CORS allow-origin header (e.g. * or https://example.com)')
        .option('--websocket', 'Enable WebSocket transport', false)
        .option('--admin', 'Enable admin API (requires ADMIN_TOKEN env var)', false)
        .option('--no-tracing', 'Disable request tracing', false)
        .action(async (file, options) => {
            const resolved = path.resolve(file);
            const url = pathToFileURL(resolved).href;

            let mod: Record<string, unknown>;
            try {
                mod = await import(url) as Record<string, unknown>;
            } catch (err) {
                console.error(`Failed to import ${resolved}:`, err);
                process.exit(1);
                return;
            }

            // Resolve agents from module exports
            type AgentLike = { name?: string; run: (...args: unknown[]) => unknown };
            let agentMap: Record<string, AgentLike>;

            if (mod['agents'] && typeof mod['agents'] === 'object') {
                agentMap = mod['agents'] as Record<string, AgentLike>;
            } else if (mod['agent'] && typeof (mod['agent'] as AgentLike)?.run === 'function') {
                const a = mod['agent'] as AgentLike;
                agentMap = { [(a.name as string | undefined) ?? 'agent']: a };
            } else if (mod['default'] && typeof (mod['default'] as AgentLike)?.run === 'function') {
                const a = mod['default'] as AgentLike;
                agentMap = { [(a.name as string | undefined) ?? 'agent']: a };
            } else {
                console.error(
                    `No agent found in ${resolved}.\n` +
                    `Export one of:\n` +
                    `  export const agent = createAgent(...)\n` +
                    `  export default createAgent(...)\n` +
                    `  export const agents = { name: createAgent(...) }`
                );
                process.exit(1);
                return;
            }

            const { createHttpService, listenService } = await import('../../runtime/index.js') as typeof import('../../runtime/index.js');

            const serviceOptions = {
                agents: agentMap as Parameters<typeof createHttpService>[0]['agents'],
                ...(typeof options.cors === 'string' && { cors: options.cors }),
                websocket: Boolean(options.websocket),
                tracing: options.tracing !== false,
                ...(options.admin ? { adminApi: { enabled: true, bearerToken: process.env['ADMIN_TOKEN'] ?? '' } } : {}),
            };

            const svc = createHttpService(
                serviceOptions,
                parseInt(options.port as string, 10)
            );

            const listening = await listenService(svc, parseInt(options.port as string, 10));
            const names = Object.keys(agentMap).join(', ');
            console.log(`\n🤖  Confused-AI serving: ${names}`);
            console.log(`   http://127.0.0.1:${listening.port}/v1/health`);
            console.log(`   http://127.0.0.1:${listening.port}/v1/chat`);
            if (options.websocket) console.log(`   ws://127.0.0.1:${listening.port}/v1/ws`);
            console.log('\nPress Ctrl+C to stop.\n');

            process.on('SIGINT', async () => {
                await listening.close();
                process.exit(0);
            });
            process.on('SIGTERM', async () => {
                await listening.close();
                process.exit(0);
            });
        });
}
