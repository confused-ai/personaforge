/**
 * @personaforge/adapters/framework/express — Express.js middleware adapter.
 *
 * Wraps personaforge HTTP serving layer as Express router.
 * Express is loaded lazily — zero cost if unused.
 *
 * Usage:
 *   import express from 'express';
 *   import { createPersonaForgeRouter } from 'personaforge/adapters/framework/express';
 *   const app = express();
 *   app.use('/api/agent', createPersonaForgeRouter({ agents: [myAgent] }));
 */

import { createRequire } from 'node:module';
import type { Agent } from '../../core/types.js';

const _require = createRequire(import.meta.url);

export interface PersonaForgeRouterOptions {
  agents: Agent[];
  apiKey?: string;
}

export function createPersonaForgeRouter(opts: PersonaForgeRouterOptions): unknown {
  const express = _require('express');
  const { Router } = express;

  const router = Router({ mergeParams: true });

  // Auth middleware
  if (opts.apiKey) {
    router.use((req: any, res: any, next: any) => {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${opts.apiKey}`) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      next();
    });
  }

  // POST /chat
  router.post('/chat', async (req: any, res: any) => {
    const { prompt, agent: agentName, sessionId, stream } = req.body ?? {};
    const agent = opts.agents.find(a => a.name === agentName) ?? opts.agents[0];
    if (!agent) { res.status(404).json({ error: 'no agent found' }); return; }

    try {
      if (stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        for await (const chunk of agent.stream(prompt)) {
          res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        const result = await agent.run(prompt, { sessionId });
        res.json({ text: result.text, messages: result.messages });
      }
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /agents
  router.get('/agents', (_req: any, res: any) => {
    res.json({ agents: opts.agents.map(a => ({ name: a.name })) });
  });

  return router;
}
