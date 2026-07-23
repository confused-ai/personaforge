/**
 * Reasoning module: Chain-of-Thought reasoning, Tree-of-Thought, structured steps, event streaming.
 *
 * @experimental This subsystem is newer and not yet semver-stable — its API
 * (CoT/ToT engines, config shapes) may change in a minor release.
 */

export * from './types.js';
export { ReasoningManager, REASONING_SYSTEM_PROMPT } from './manager.js';
export { TreeOfThoughtEngine } from './tot.js';
export type { TotConfig, TotNode, TotResult } from './tot.js';

// ── Reasoning-as-tools (Agno-style think/analyze) ────────────────────────────
export { ReasoningScratchpad, createReasoningTools } from './reasoning-tools.js';
export type { ReasoningStep, ReasoningToolset } from './reasoning-tools.js';
