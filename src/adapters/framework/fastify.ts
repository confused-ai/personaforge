/**
 * @personaforge/adapters/framework/fastify — Fastify plugin adapter.
 *
 * Fastify is loaded lazily — zero cost if unused.
 *
 * Usage:
 *   import Fastify from 'fastify';
 *   import { personaforgePlugin } from 'personaforge/adapters/framework/fastify';
 *   const app = Fastify();
 *   await app.register(personaforgePlugin, { agents: [myAgent] });
 */

import { createRequire } from 'node:module';
import type { Agent } from '../../core/types.js';

const _require = createRequire(import.meta.url);

export interface PersonaForgePluginOptions {
  agents: Agent[];
  apiKey?: string;
  prefix?: string;
}

export async function personaforgePlugin(
  instance: any,
  opts: PersonaForgePluginOptions,
): Promise<void> {
  const fastify = instance;
  const prefix = opts.prefix ?? '';

  // Auth hook
  if (opts.apiKey) {
    fastify.addHook('preHandler', async (req: any, reply: any) => {
      if (req.headers.authorization !== `Bearer ${opts.apiKey}`) {
        reply.status(401).send({ error: 'unauthorized' });
      }
    });
  }

  // POST /chat
  fastify.post(`${prefix}/chat`, async (req: any, reply: any) => {
    const body = req.body ?? {};
    const prompt = body.prompt;
    const agentName = body.agent;
    const sessionId = body.sessionId;
    const stream = body.stream;

    const agent = opts.agents.find((a: any) => a.name === agentName) ?? opts.agents[0];
    if (!agent) return reply.status(404).send({ error: 'no agent found' });

    if (stream) {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      for await (const chunk of agent.stream(prompt)) {
        reply.raw.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
      return;
    }

    const result = await agent.run(prompt, { sessionId });
    return { text: result.text, messages: result.messages };
  });

  // GET /agents
  fastify.get(`${prefix}/agents`, async () => ({
    agents: opts.agents.map(a => ({ name: a.name })),
  }));
}
