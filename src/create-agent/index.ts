/**
 * `createAgent` — opinionated entry that wires LLM, tools, session, and guardrails.
 */

export type { CreateAgentOptions, AgentRunOptions, AgentRunResult, CreateAgentResult, StreamChunk, ToolsRecord } from './types.js';
export { createAgent } from './factory.js';
export {
    resolveLlmForCreateAgent,
    OPENROUTER_BASE_URL,
    ENV_API_KEY,
    ENV_MODEL,
    ENV_BASE_URL,
    ENV_OPENROUTER_API_KEY,
    ENV_OPENROUTER_MODEL,
} from './resolve-llm.js';
