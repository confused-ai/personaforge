/**
 * ScenarioRunner — multi-turn conversation replay with assertions.
 *
 * Build a sequence of user messages, attach per-step assertions,
 * and run the entire scenario against any agent. Great for testing
 * conversational flows, session continuity, and tool-call sequences.
 *
 * @example
 * ```ts
 * import { createScenarioRunner, createTestAgent } from 'personaforge/testing';
 *
 * const { agent } = await createTestAgent({ responses: ['Hello!', 'Your name is Alice.'] });
 * const results = await createScenarioRunner(agent)
 *   .send('Hi there')
 *   .expectText('Hello')
 *   .send('My name is Alice. What is my name?')
 *   .expectText('Alice')
 *   .expectSteps(1)
 *   .run();
 *
 * expect(results).toHaveLength(2);
 * ```
 */

import type { AgenticRunResult } from '../agentic/index.js';
import type { CreateAgentResult } from '../create-agent/types.js';

/** A single assertion function applied to a run result. */
export type ScenarioAssertion = (result: AgenticRunResult, stepIndex: number) => void;

/** A step in the scenario: a message to send plus optional assertions. */
export interface ScenarioStep {
    /** The prompt to send to the agent. */
    message: string;
    /** Run options (sessionId, userId, etc.). */
    options?: Record<string, unknown>;
    /** Assertions to run against the result of this step. */
    assertions: ScenarioAssertion[];
}

/**
 * Fluent builder for multi-turn agent test scenarios.
 */
export class ScenarioRunner {
    private readonly steps: ScenarioStep[] = [];

    constructor(private readonly agent: CreateAgentResult) {}

    /**
     * Send a message to the agent as the next step.
     */
    send(message: string, options?: Record<string, unknown>): this {
        this.steps.push({ message, options, assertions: [] });
        return this;
    }

    /**
     * Assert the last step's response text contains the string or matches the regex.
     */
    expectText(pattern: string | RegExp): this {
        const last = this.currentStep();
        last.assertions.push((result, idx) => {
            const match =
                pattern instanceof RegExp
                    ? pattern.test(result.text)
                    : result.text.includes(pattern);
            if (!match) {
                throw new Error(
                    `[Step ${idx}] Expected text matching ${pattern instanceof RegExp ? pattern.source : `"${pattern}"`}, ` +
                    `got: "${result.text.slice(0, 200)}"`
                );
            }
        });
        return this;
    }

    /**
     * Assert the last step's finish reason matches.
     */
    expectFinishReason(reason: AgenticRunResult['finishReason']): this {
        const last = this.currentStep();
        last.assertions.push((result, idx) => {
            if (result.finishReason !== reason) {
                throw new Error(
                    `[Step ${idx}] Expected finishReason "${reason}", got "${result.finishReason}"`
                );
            }
        });
        return this;
    }

    /**
     * Assert the number of steps the agent took.
     */
    expectSteps(count: number): this {
        const last = this.currentStep();
        last.assertions.push((result, idx) => {
            if (result.steps !== count) {
                throw new Error(
                    `[Step ${idx}] Expected ${count} steps, got ${result.steps}`
                );
            }
        });
        return this;
    }

    /**
     * Add a custom assertion for the last step.
     */
    assert(fn: ScenarioAssertion): this {
        const last = this.currentStep();
        last.assertions.push(fn);
        return this;
    }

    /**
     * Execute all steps sequentially and return all results.
     * Throws on the first failed assertion.
     */
    async run(): Promise<AgenticRunResult[]> {
        const results: AgenticRunResult[] = [];

        for (let i = 0; i < this.steps.length; i++) {
            const step = this.steps[i]!;
            const result = await this.agent.run(step.message, step.options);

            for (const assertion of step.assertions) {
                assertion(result, i);
            }

            results.push(result);
        }

        return results;
    }

    // ── Private ────────────────────────────────────────────────────────────

    private currentStep(): ScenarioStep {
        if (this.steps.length === 0) {
            throw new Error('ScenarioRunner: call .send() before adding assertions.');
        }
        return this.steps[this.steps.length - 1]!;
    }
}

/**
 * Create a ScenarioRunner for the given agent.
 *
 * @example
 * ```ts
 * const runner = createScenarioRunner(agent);
 * const results = await runner
 *   .send('Hello')
 *   .expectText('Hi')
 *   .run();
 * ```
 */
export function createScenarioRunner(agent: CreateAgentResult): ScenarioRunner {
    return new ScenarioRunner(agent);
}
