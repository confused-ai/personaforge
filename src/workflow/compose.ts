/**
 * @personaforge/workflow — compose() pipeline.
 * O(n steps) time, O(1) space — only last result kept.
 */

import type { AgentRunResult, PipelineStep } from './types.js';

export function compose(...steps: PipelineStep[]): { run(prompt: string): Promise<AgentRunResult> } {
  if (steps.length === 0) {
    throw new Error('[compose] At least one step is required.');
  }
  return {
    async run(initialPrompt: string): Promise<AgentRunResult> {
      let prompt = initialPrompt;
      let result!: AgentRunResult;
      for (const step of steps) {
        result = await step.agent.run(prompt);
        prompt = step.transform ? await step.transform(result) : result.text;
      }
      return result;
    },
  };
}
