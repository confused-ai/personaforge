/**
 * personaforge/playground — Interactive agent playground UI.
 *
 * ```ts
 * import { createPlayground } from 'personaforge/playground';
 *
 * const svc = await createPlayground(
 *     [{ name: 'assistant', run: async (prompt) => agent.run(prompt) }],
 *     { port: 4000 },
 * );
 * console.log(`Open http://localhost:${svc.port}`);
 * ```
 */

export { createPlayground } from './playground/index.js';
export type { PlaygroundAgent, PlaygroundOptions, PlaygroundServer } from './playground/index.js';
