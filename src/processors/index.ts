/**
 * @personaforge/processors — Mastra-style inspired processor pipeline.
 *
 * Input/output/error processors transform, validate, and control messages as
 * they pass through an agent. Combined with the built-in guardrail processors
 * they form the security + quality layer of the runtime.
 *
 * ```ts
 * import { agent } from 'personaforge';
 * import { ModerationProcessor, TokenLimiter, PIIDetector } from 'personaforge/processors';
 *
 * const bot = agent({
 *   instructions: '...',
 *   inputProcessors: [
 *     new TokenLimiter(64_000),
 *     new PIIDetector({ strategy: 'redact' }),
 *     new ModerationProcessor({ strategy: 'block' }),
 *   ],
 * });
 * ```
 */

export * from './types.js';
export * from './pipeline.js';
export * from './builtin.js';

// Re-export convenience aliases
export { TokenLimiter as TokenLimiterProcessor } from './builtin.js';
export { UnicodeNormalizer } from './builtin.js';
export { ToolCallFilter } from './builtin.js';
export { PIIDetector } from './builtin.js';
export { PromptInjectionDetector } from './builtin.js';
export { ModerationProcessor } from './builtin.js';
export { CostGuardProcessor } from './builtin.js';
export { LanguageDetector } from './builtin.js';
export { BatchPartsProcessor } from './builtin.js';
export { SystemPromptScrubber } from './builtin.js';
export { ResponseCache } from './builtin.js';
export { EnsureFinalResponse } from './builtin.js';
export { ContextLengthHandler } from './builtin.js';
