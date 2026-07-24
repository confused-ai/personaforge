/**
 * @personaforge/adapters/framework/hono — Hono framework adapter.
 *
 * Hono is loaded lazily — zero cost if unused.
 *
 * Usage:
 *   import { Hono } from 'hono';
 *   import { personaforgeRoute } from 'personaforge/adapters/framework/hono';
 *   const app = new Hono();
 *   app.route('/api/agent', personaforgeRoute({ agents: [myAgent] }));
 */

import { createRequire } from 'node:module';
import type { Agent } from '../../core/types.js';

const _require = createRequire(import.meta.url);

export interface PersonaForgeRouteOptions {
  agents: Agent[];
  apiKey?: string;
}

export function personaforgeRoute(opts: PersonaForgeRouteOptions): unknown {
  const { Hono } = _require('hono') as typeof import('hono');
  const app = new Hono();

  // Auth middleware
  if (opts.apiKey) {
    app.use('*', async (c: any, next: any) => {
      if (c.req.header('Authorization') !== `Bearer ${opts.apiKey}`) {
        return c.json({ error: 'unauthorized' }, 401);
      }
      await next();
    });
  }

  // POST /chat
  app.post('/chat', async (c: any) => {
    const body = await c.req.json();
    const prompt = body.prompt;
    const agentName = body.agent;
    const sessionId = body.sessionId;
    const stream = body.stream;

    const agent = opts.agents.find((a: any) => a.name === agentName) ?? opts.agents[0];
    if (!agent) return c.json({ error: 'no agent found' }, 404);

    if (stream) {
      c.header('Content-Type', 'text/event-stream');
      c.header('Cache-Control', 'no-cache');
      c.header('Connection', 'keep-alive');
      return c.newResponse(
        new ReadableStream({
          async start(controller: any) {
            for await (const chunk of agent.stream(prompt)) {
              controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
            }
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
            controller.close();
          },
        }),
      );
    }

    const result = await agent.run(prompt, { sessionId });
    return c.json({ text: result.text, messages: result.messages });
  });

  // GET /agents
  app.get('/agents', (c: any) => c.json({ agents: opts.agents.map((a: any) => ({ name: a.name })) }));

  return app;
}
