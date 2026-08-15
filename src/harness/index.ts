/**
 * @personaforge/harness — Production agent harness.
 *
 * One entrypoint to harden an agent for production and expose it as a tool:
 *   - resilience (circuit breaker, rate limit, health)
 *   - nesting-safe agent/workflow/pipeline-as-tool adapters
 *   - unified lifecycle hooks
 *   - depth limits and default timeouts
 *
 * ```ts
 * import { createHarness } from 'personaforge/harness';
 * import { agent } from 'personaforge';
 *
 * const specialist = agent('You extract structured facts.');
 * const harness = createHarness({
 *   agent: specialist,
 *   resilience: { rateLimit: { maxRpm: 60 } },
 *   nesting: { maxDepth: 4 },
 * });
 *
 * const tool = harness.asTool({
 *   name: 'extract_facts',
 *   description: 'Extract facts from text',
 * });
 * ```
 */

export { createHarness, type AgentHarness, type HarnessConfig, type HarnessAsToolOptions, type HarnessRunOptions } from './create-harness.js';
export {
    createOrchestrator,
    multiAgentTool,
    type OrchestratorConfig,
    type Orchestrator,
    type OrchestratorSpecialist,
} from './orchestrator.js';

// ── Evaluation harness (the "best harness engine" single command) ──────────
export { evaluate, formatHarnessReport } from './evaluate.js';
export type {
    EvaluateOptions,
    HarnessVariant,
    HarnessUsageSummary,
    HarnessVariantResult,
    HarnessMetricComparison,
    HarnessReport,
    HarnessReportJson,
} from './evaluate.js';
export {
    toHarnessRunner,
    fromAgent,
    fromTask,
    fromWorkflow,
    fromFn,
} from './subject.js';
export type { HarnessSubject, HarnessRunnerOptions, RunOutcome } from './subject.js';
