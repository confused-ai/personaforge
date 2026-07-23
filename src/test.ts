/**
 * personaforge/test — Testing utilities for agent development.
 *
 * ```ts
 * import { mockAgent, scenario } from 'personaforge/test'
 *
 * const a = mockAgent({ responses: ['Hello!'] })
 * await scenario(a).send('Hi').expect(t => t.includes('Hello')).run()
 * ```
 */

// ── Mock Agent ──────────────────────────────────────────────────────────────
export {
    createMockAgent,
    type MockAgentOptions,
    type MockAgentHandle,
    type MockAgentCall,
} from './testing/mock-agent.js';

// ── Scenario Runner ─────────────────────────────────────────────────────────
export {
    ScenarioRunner,
    createScenarioRunner,
    type ScenarioStep,
    type ScenarioAssertion,
} from './testing/scenario-runner.js';

// ── Convenience aliases ─────────────────────────────────────────────────────
import { createMockAgent, type MockAgentOptions } from './testing/mock-agent.js';
import { createScenarioRunner } from './testing/scenario-runner.js';
import type { CreateAgentResult } from './create-agent/types.js';

/**
 * Shorthand for `createMockAgent()`.
 *
 * @example
 * ```ts
 * const a = mockAgent({ responses: ['Hello!', 'Goodbye!'] })
 * ```
 */
export function mockAgent(options: MockAgentOptions) {
    return createMockAgent(options);
}

/**
 * Shorthand for `createScenarioRunner()`.
 *
 * @example
 * ```ts
 * await scenario(agent)
 *   .send('Hello')
 *   .expectText('Hi')
 *   .run()
 * ```
 */
export function scenario(agent: CreateAgentResult) {
    return createScenarioRunner(agent);
}

// ── All testing utilities (fixtures, mock LLM, etc.) ────────────────────────
export * from './testing/index.js';
