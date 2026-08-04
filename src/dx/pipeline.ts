/**
 * `pipeline()` — declarative sequential (multi-agent) pipeline.
 *
 * A pipeline feeds each stage's output into the next stage. Stages are
 * `compose()`-style agents; the result is a runnable {@link ComposedAgent}
 * with `.run()` and `.asTool()`.
 *
 * ```ts
 * import { agent, pipeline } from 'personaforge';
 *
 * const research = agent('Research the topic and return raw findings.');
 * const write    = agent('Turn findings into a polished report.');
 *
 * const report = pipeline(research, write);
 * const result = await report.run('TypeScript 5.5 features');
 *
 * // Array form with options:
 * const scoped = pipeline([research, write], { when: (r) => r.text.length > 50 });
 *
 * // As a delegation tool:
 * const reportTool = report.asTool({
 *   name: 'write_report',
 *   description: 'Research and write a report on a topic.',
 * });
 * ```
 */

import { compose, ComposedAgent, ComposeOptions } from './compose.js';
import type { CreateAgentResult } from '../create-agent/types.js';

/**
 * Build a sequential pipeline from two or more agents.
 *
 * Accepts either varargs (`pipeline(a, b, ...)`) or an array
 * (`pipeline([a, b], options?)`).
 */
export function pipeline(...stages: CreateAgentResult[]): ComposedAgent;
export function pipeline(
    stages: CreateAgentResult[],
    options?: ComposeOptions,
): ComposedAgent;
export function pipeline(
    ...args: unknown[]
): ComposedAgent {
    const first = args[0];

    if (Array.isArray(first)) {
        const stages = first as CreateAgentResult[];
        const options = (args[1] as ComposeOptions | undefined) ?? {};
        if (stages.length < 2) {
            throw new Error('pipeline() requires at least 2 agent stages.');
        }
        return compose(...stages, options);
    }

    const stages = args as CreateAgentResult[];
    return compose(...stages);
}
