/**
 * @personaforge/workflow — shared types.
 *
 * Note: Agent is imported as a concrete named interface from @personaforge/core.
 * We re-declare a minimal subset here to avoid cross-package resolution issues
 * in strict mode, and use type-only imports throughout.
 */

export interface AgentRunResult {
  readonly text:         string;
  readonly messages:     unknown[];
  readonly steps:        number;
  readonly finishReason: string;
  readonly usage?:       { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  readonly runId?:       string;
}

export interface WorkflowAgent {
  readonly name:         string;
  readonly instructions: string;
  run(prompt: string): Promise<AgentRunResult>;
}

export interface PipelineStep {
  /** The agent to run for this step. */
  agent: WorkflowAgent;
  /** Transform the previous step's output into this step's prompt. */
  transform?: (prev: AgentRunResult) => string | Promise<string>;
}

export interface SupervisorOptions {
  /** The orchestrating agent that decides which sub-agent to call. */
  supervisor: WorkflowAgent;
  /** Available sub-agents indexed by name for O(1) dispatch. */
  agents: Map<string, WorkflowAgent>;
  /** Max rounds of sub-agent calls per supervisor run. Default: 10. */
  maxRounds?: number;
}

export interface SwarmOptions {
  /** All peer agents. The swarm routes to the most capable one. */
  agents: WorkflowAgent[];
  /** Custom routing function. Default: round-robin O(1). */
  route?: (prompt: string, agents: WorkflowAgent[]) => WorkflowAgent | Promise<WorkflowAgent>;
  /** Max concurrent agent calls. Default: agents.length (all parallel). */
  concurrency?: number;
}
