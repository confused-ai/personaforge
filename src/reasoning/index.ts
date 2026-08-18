/**
 * Reasoning module: Chain-of-Thought reasoning, Tree-of-Thought, Reflexion, ReWOO, Graph-of-Thoughts, structured steps, event streaming.
 *
 * @experimental This subsystem is newer and not yet semver-stable — its API
 * (CoT/ToT/Reflexion/ReWOO/GoT engines, config shapes) may change in a minor release.
 */

export * from './types.js';
export { ReasoningManager, REASONING_SYSTEM_PROMPT } from './manager.js';
export { TreeOfThoughtEngine } from './tot.js';
export type { TotConfig, TotNode, TotResult } from './tot.js';

export { ReflexionEngine } from './reflexion.js';
export type { ReflexionConfig, ReflexionStep, ReflexionResult } from './reflexion.js';

export { ReWooEngine } from './rewoo.js';
export type { ReWooConfig, ReWooStep, ReWooResult } from './rewoo.js';

export { GotEngine } from './got.js';
export type { GotConfig, GotNode, GotEdge, GotResult } from './got.js';

// ── Reasoning-as-tools (Agno-style think/analyze) ────────────────────────────
export { ReasoningScratchpad, createReasoningTools } from './reasoning-tools.js';
export type { ReasoningStep, ReasoningToolset } from './reasoning-tools.js';
