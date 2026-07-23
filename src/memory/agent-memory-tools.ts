/**
 * @personaforge/memory — agent-driven memory tools.
 *
 * Provides two LLM-callable tools that let an agent manage its own long-term
 * memory across sessions without developer intervention:
 *
 *   - `remember(fact, tags?)` — persist a fact to the memory store
 *   - `recall(query, limit?)` — retrieve relevant facts by semantic similarity
 *
 * Usage:
 * ```ts
 * import { createAgentMemoryTools } from './index.js';
 * import { InMemoryStore }          from './index.js';
 *
 * const store = new InMemoryStore();
 * const { remember, recall } = createAgentMemoryTools({ store });
 *
 * const agent = createAgent({
 *   name:  'ResearchBot',
 *   tools: [remember, recall],
 * });
 * ```
 *
 * The agent decides when to call these tools based on context — just as it
 * decides when to use any other tool. No special wiring is required.
 */

import { z } from 'zod';
import type { MemoryStore } from './types.js';
import { MemoryType }       from './types.js';

// ── Minimal defineTool shim ───────────────────────────────────────────────────
// Avoid importing from @personaforge/tools to prevent a circular dep.
// The shape is identical to what defineTool produces.

interface Tool<TInput, TOutput> {
  readonly name: string;
  readonly description: string;
  readonly parameters: z.ZodType<TInput>;
  execute(input: TInput): Promise<TOutput>;
}

function makeTool<TInput, TOutput>(def: {
  name: string;
  description: string;
  parameters: z.ZodType<TInput>;
  execute(input: TInput): Promise<TOutput>;
}): Tool<TInput, TOutput> {
  return def;
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const RememberInput = z.object({
  /** The fact or piece of information to store. */
  fact: z.string().min(1).max(10_000).describe('The fact to remember.'),
  /** Optional topic tags for retrieval filtering. */
  tags: z.array(z.string()).optional().describe('Optional topic tags, e.g. ["user-pref", "project-x"].'),
});

const RecallInput = z.object({
  /** Natural-language query used to find relevant facts. */
  query: z.string().min(1).max(2_000).describe('Natural-language query to find relevant facts.'),
  /** Maximum number of results to return. Defaults to 5. */
  limit: z.number().int().min(1).max(50).optional().describe('Max results (default 5).'),
});

// ── Public API ────────────────────────────────────────────────────────────────

export interface AgentMemoryToolsOptions {
  /** Memory store to read from / write to. */
  store: MemoryStore;
  /**
   * Default memory type for new entries.
   * @default MemoryType.LONG_TERM
   */
  defaultType?: MemoryType;
  /**
   * Minimum similarity score threshold for recall results.
   * @default 0.1
   */
  recallThreshold?: number;
}

export interface AgentMemoryTools {
  /** Tool for the agent to persist a fact. */
  remember: Tool<z.infer<typeof RememberInput>, { id: string; stored: true }>;
  /** Tool for the agent to retrieve relevant facts. */
  recall: Tool<z.infer<typeof RecallInput>, { facts: string[]; count: number }>;
}

/**
 * Create `remember` and `recall` tools backed by a `MemoryStore`.
 *
 * Both tools are safe to register directly with `createAgent({ tools: [...] })`.
 */
export function createAgentMemoryTools(opts: AgentMemoryToolsOptions): AgentMemoryTools {
  const { store, defaultType = MemoryType.LONG_TERM, recallThreshold = 0.1 } = opts;

  const remember = makeTool({
    name:        'remember',
    description: 'Persist a fact or piece of information to long-term memory for future recall. Call this when you learn something important that should be retained across conversations.',
    parameters:  RememberInput,
    async execute({ fact, tags }) {
      const entry = await store.store({
        type:    defaultType,
        content: fact,
        metadata: {
          source: 'agent',
          ...(tags !== undefined && tags.length > 0 && { tags }),
        },
      });
      return { id: String(entry.id), stored: true as const };
    },
  });

  const recall = makeTool({
    name:        'recall',
    description: 'Retrieve relevant facts from long-term memory by natural-language query. Use this to look up information you might have stored in a previous conversation.',
    parameters:  RecallInput,
    async execute({ query, limit = 5 }) {
      const results = await store.retrieve({
        query,
        limit,
        threshold: recallThreshold,
      });
      return {
        facts: results.map(r => r.entry.content),
        count: results.length,
      };
    },
  });

  return { remember, recall };
}
