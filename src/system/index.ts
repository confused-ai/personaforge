/**
 * @personaforge/system — Production multi-agent system registry.
 *
 * Edge over Mastra `new Mastra()` and Agno AgentOS:
 *   - Agents + workflows + pipelines + tools in one registry
 *   - Supervisor pattern (Mastra's recommended replacement for networks)
 *   - System-as-tool nesting for multi-system composition
 *   - Production harness defaults (rate limit, circuit breaker, depth limits)
 */

export { createSystem, System, type PersonaForgeSystem } from './create-system.js';
export { buildSupervisor, type SupervisorHandle, type BuildSupervisorInput } from './supervisor.js';
export type {
    SystemConfig,
    SystemAgentRegistration,
    SystemWorkflowRegistration,
    SystemPipelineRegistration,
    SupervisorOptions,
} from './types.js';
