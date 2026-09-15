import { isReasoningStreamEnabled } from '../streaming/reasoning-accumulator.js';

export type AnthropicThinkingParam =
    | { type: 'adaptive'; display: 'summarized' }
    | { type: 'enabled'; budget_tokens: number };

// New naming: claude-<family>-<major>[-<minor>] (minor is 1-2 digits, never a date).
const NEW_ID = /claude-(?:opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2})(?!\d))?/;
// Legacy naming: claude-<major>[-<minor>]-<family>.
const LEGACY_ID = /claude-(\d+)(?:-(\d{1,2}))?-(?:opus|sonnet|haiku)/;

/** Thinking param for a model, or undefined when thinking must not be sent. */
export function anthropicThinkingConfig(model: string, maxTokens: number): AnthropicThinkingParam | undefined {
    if (!isReasoningStreamEnabled()) return undefined;
    const m = NEW_ID.exec(model) ?? LEGACY_ID.exec(model);
    if (!m) return undefined;
    const major = Number(m[1]);
    const minor = Number(m[2] ?? 0);
    // Opus/Sonnet 4.6+ and 5.x: adaptive only ('enabled' + temperature 400 there).
    if (major >= 5 || (major === 4 && minor >= 6)) return { type: 'adaptive', display: 'summarized' };
    // 3.7 and 4.0–4.5: budget-based extended thinking. 3.5/3.0: none.
    if (major === 4 || (major === 3 && minor === 7)) {
        const budget = Math.min(4096, maxTokens - 1);
        return budget >= 1024 ? { type: 'enabled', budget_tokens: budget } : undefined;
    }
    return undefined;
}
