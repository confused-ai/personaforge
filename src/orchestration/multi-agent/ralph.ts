/**
 * Ralph / RALF Loop Protocol — Read-Act-Loop-Finish autonomous agent execution.
 *
 * Runs an agent iteratively in a loop, utilizing fresh session instances to
 * avoid context bloat, while propagating context state summaries across runs.
 *
 * @example
 * ```ts
 * import { createRalphLoop } from 'personaforge/orchestration';
 *
 * const loop = createRalphLoop({
 *   agent: codingAgent,
 *   maxCycles: 5,
 *   checkComplete: async (ctx) => {
 *     // Check if tests pass
 *     return await runTests();
 *   },
 * });
 *
 * const result = await loop.run('Fix the failing test in src/utils.ts');
 * console.log(result.success);      // true
 * console.log(result.cyclesRun);   // number of loops executed
 * ```
 */

import type { Agent as CoreAgent } from '../../core/index.js';

/** Logging details for each individual loop run. */
export interface RalphLoopLog {
    readonly cycle: number;
    readonly text: string;
    readonly steps: number;
    readonly durationMs: number;
    readonly timestamp: Date;
    readonly usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

/** Context information shared during loop iterations and validation. */
export interface RalphLoopContext {
    readonly cycle: number;
    readonly lastResult: string;
    readonly state: Record<string, any>;
    readonly logs: RalphLoopLog[];
}

/** Configuration interface for the Ralph / RALF Loop. */
export interface RalphLoopConfig {
    /** The agent to execute in the loop. */
    readonly agent: CoreAgent;
    /** Maximum number of iteration cycles. Default is 5. */
    readonly maxCycles?: number;
    /** Validator function to check if the loop is complete. Returns true for success. */
    readonly checkComplete: (context: RalphLoopContext) => Promise<boolean> | boolean;
    /** Initial state variables. */
    readonly initialState?: Record<string, any>;
    /** Custom formatter to construct the prompt for subsequent cycles. */
    readonly promptFormatter?: (prompt: string, context: RalphLoopContext) => string | Promise<string>;
}

/** Final output from the Ralph / RALF Loop run. */
export interface RalphLoopResult {
    readonly success: boolean;
    readonly finalOutput: string;
    readonly cyclesRun: number;
    readonly logs: RalphLoopLog[];
    readonly state: Record<string, any>;
}

export class RalphLoop {
    private readonly config: RalphLoopConfig;
    private readonly state: Record<string, any>;
    private readonly logs: RalphLoopLog[] = [];

    constructor(config: RalphLoopConfig) {
        this.config = config;
        this.state = { ...(config.initialState ?? {}) };
    }

    /** Run the Read-Act-Loop-Finish sequence until completion or maxCycles is hit. */
    async run(prompt: string): Promise<RalphLoopResult> {
        const maxCycles = this.config.maxCycles ?? 5;
        const formatter = this.config.promptFormatter ?? this.defaultPromptFormatter;
        let lastResult = '';
        let cycle = 1;
        let success = false;

        while (cycle <= maxCycles) {
            const context: RalphLoopContext = {
                cycle,
                lastResult,
                state: this.state,
                logs: [...this.logs]
            };

            const formattedPrompt = await formatter(prompt, context);
            const start = Date.now();

            // Create a fresh session for this iteration to avoid context bloat
            const sessionId = await this.config.agent.createSession(`ralph-${Date.now()}-${cycle}`);

            let runResult;
            try {
                runResult = await this.config.agent.run(formattedPrompt, { sessionId });
            } catch (err) {
                const durationMs = Date.now() - start;
                const errorLog: RalphLoopLog = {
                    cycle,
                    text: err instanceof Error ? err.message : String(err),
                    steps: 0,
                    durationMs,
                    timestamp: new Date(),
                };
                this.logs.push(errorLog);
                lastResult = errorLog.text;
                cycle++;
                continue;
            }

            const durationMs = Date.now() - start;
            lastResult = runResult.text;

            const cycleLog: RalphLoopLog = {
                cycle,
                text: runResult.text,
                steps: runResult.steps,
                durationMs,
                timestamp: new Date(),
                usage: runResult.usage,
            };
            this.logs.push(cycleLog);

            const updatedContext: RalphLoopContext = {
                cycle,
                lastResult,
                state: this.state,
                logs: [...this.logs]
            };

            success = await this.config.checkComplete(updatedContext);
            if (success) {
                break;
            }

            cycle++;
        }

        return {
            success,
            finalOutput: lastResult,
            cyclesRun: Math.min(cycle, maxCycles),
            logs: [...this.logs],
            state: this.state,
        };
    }

    private defaultPromptFormatter(prompt: string, context: RalphLoopContext): string {
        if (context.cycle === 1) {
            return prompt;
        }
        return `You are working on the following task: "${prompt}"

This is cycle/iteration #${context.cycle}. The previous attempts were not fully successful.
Here is the output/result from the last attempt:
---
${context.lastResult}
---

Please analyze what went wrong, adapt your approach, modify the files/state accordingly, and output your updated result.
Current environment state variables: ${JSON.stringify(context.state)}`;
    }
}

/** Create a Ralph / RALF Loop protocol instance. */
export function createRalphLoop(config: RalphLoopConfig): RalphLoop {
    return new RalphLoop(config);
}
