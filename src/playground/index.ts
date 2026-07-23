/**
 * @personaforge/playground — barrel export.
 *
 * @example
 * ```ts
 * import { createPlayground } from './index.js';
 *
 * const svc = await createPlayground(
 *     [{ name: 'assistant', run: async (p) => myAgent.run(p) }],
 *     { port: 4000 },
 * );
 * console.log(`Open http://localhost:${svc.port}`);
 * // Later:
 * await svc.stop();
 * ```
 */
export { createPlayground } from './server.js';
export type { PlaygroundAgent, PlaygroundOptions, PlaygroundServer } from './server.js';
