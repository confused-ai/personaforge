/**
 * Best DX for creating agents in TypeScript.
 *
 * `personaforge/dx` is the minimal-ceremony surface (`agent()`, `bare()`, `compose()`,
 * `definePersona()`, dev logger / tool middleware). `personaforge/sdk` is the
 * builder-style API on top (`defineAgent().instructions().model().build()`,
 * workflows, typed agents). Both are supported entry points — pick the shape
 * that matches how you like to write TypeScript.
 *
 * - agent(instructions) or agent({ instructions, model, dev }) — minimal, one call
 * - bare({ llm }) — zero defaults, bring your own everything
 * - defineAgent().instructions('...').model('...').use(mw).hooks({...}).dev().build() — fluent, discoverable
 * - compose(agentA, agentB) — sequential pipeline
 * - pipe(agentA).then(agentB).then(agentC).run(prompt) — stepwise pipeline builder
 * - createDevLogger() / createDevToolMiddleware() — dev-mode visibility
 */

export { agent, type AgentMinimalOptions } from './agent.js';
export { bare, type BareAgentOptions } from './bare.js';
export { defineAgent, type DefineAgentOptions } from './define-agent.js';
export { compose, pipe, type ComposeOptions, type ComposedAgent } from './compose.js';
export { definePersona, buildPersonaInstructions, type AgentPersona } from './persona-builder.js';
export { createDevLogger, createDevToolMiddleware } from './dev-logger.js';
