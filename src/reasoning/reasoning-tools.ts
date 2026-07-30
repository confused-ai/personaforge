/**
 * @personaforge/reasoning — reasoning-as-tools.
 *
 * Agno-style `think` / `analyze` tool pair. The agent writes reasoning steps
 * to a scratchpad and can query them later. Lifts non-reasoning models by
 * making step-by-step thinking an explicit tool call rather than free-form
 * chain-of-thought.
 *
 * ```ts
 * const scratchpad = new ReasoningScratchpad();
 * const tools = createReasoningTools(scratchpad);
 * const agent = agent({ tools: [...tools, ...otherTools] });
 * ```
 */

import { z } from 'zod';
import type { SchemaInput } from '../validation/index.js';

// ── Scratchpad ────────────────────────────────────────────────────────────────

export interface ReasoningStep {
  id: number;
  title: string;
  thought: string;
  createdAt: number;
}

/** Per-run reasoning scratchpad. Not thread-safe across runs on purpose. */
export class ReasoningScratchpad {
  private readonly steps: ReasoningStep[] = [];

  add(title: string, thought: string): ReasoningStep {
    const step: ReasoningStep = { id: this.steps.length + 1, title, thought, createdAt: Date.now() };
    this.steps.push(step);
    return step;
  }

  all(): readonly ReasoningStep[] { return this.steps; }
  count(): number { return this.steps.length; }
  clear(): void { this.steps.length = 0; }

  /** Naive substring search over titles and thoughts. */
  search(query: string): ReasoningStep[] {
    const q = query.toLowerCase();
    return this.steps.filter((s) =>
      s.title.toLowerCase().includes(q) || s.thought.toLowerCase().includes(q),
    );
  }

  /** Concatenated summary suitable for injection into a prompt. */
  render(): string {
    return this.steps.map((s) => `Step ${String(s.id)} — ${s.title}\n${s.thought}`).join('\n\n');
  }
}

// ── Tool shape (minimal, matches src/memory shim) ─────────────────────────────

interface Tool<TInput, TOutput> {
  readonly name: string;
  readonly description: string;
  readonly parameters: SchemaInput<unknown, TInput>;
  execute(input: TInput): Promise<TOutput>;
}

// ── createReasoningTools ──────────────────────────────────────────────────────

export interface ReasoningToolset {
  think: Tool<{ title: string; thought: string }, { stepId: number; totalSteps: number }>;
  analyze: Tool<{ query?: string }, { steps: ReasoningStep[] }>;
}

/**
 * Create the `think` and `analyze` tools bound to a scratchpad.
 *
 * - `think(title, thought)` — record a reasoning step
 * - `analyze(query?)` — return all steps (or those matching the query)
 */
export function createReasoningTools(scratchpad: ReasoningScratchpad): ReasoningToolset {
  const think: ReasoningToolset['think'] = {
    name: 'think',
    description:
      'Record a step of your reasoning to your private scratchpad. Use this whenever you need to break a problem into parts, plan next actions, or reflect on prior tool results.',
    parameters: z.object({
      title: z.string().describe('Short label for the reasoning step'),
      thought: z.string().describe('The actual reasoning content'),
    }),
    async execute({ title, thought }) {
      const step = scratchpad.add(title, thought);
      return { stepId: step.id, totalSteps: scratchpad.count() };
    },
  };

  const analyze: ReasoningToolset['analyze'] = {
    name: 'analyze',
    description:
      'Review previously recorded reasoning steps. Pass an optional query to filter; leave empty to review the full scratchpad.',
    parameters: z.object({
      query: z.string().optional().describe('Optional filter substring'),
    }),
    async execute({ query }) {
      const steps = query ? scratchpad.search(query) : [...scratchpad.all()];
      return { steps };
    },
  };

  return { think, analyze };
}
