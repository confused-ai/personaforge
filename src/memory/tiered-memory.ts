/**
 * @personaforge/memory — tiered, self-editing memory (Letta / MemGPT-style).
 *
 * Two tiers:
 *   - **Core memory**  — a small set of labelled blocks that are ALWAYS rendered
 *     into the system prompt (persona, human, scratchpad…). Character-limited so
 *     they never blow the context window. The agent edits them with
 *     `core_memory_append` / `core_memory_replace`.
 *   - **Archival memory** — unbounded long-term store, retrieved on demand by
 *     semantic search via `archival_memory_search`. Backed by any `MemoryStore`.
 *
 * The agent manages both tiers itself through the LLM-callable tools returned by
 * {@link createTieredMemoryTools}, exactly as MemGPT/Letta does — no developer
 * intervention per turn. Render core memory into the prompt with
 * {@link TieredMemory.renderCore}.
 *
 * ```ts
 * const tiered = new TieredMemory({
 *   blocks: [
 *     { label: 'persona', value: 'I am a helpful research assistant.' },
 *     { label: 'human',   value: '' },
 *   ],
 *   archival: new InMemoryStore(),
 * });
 *
 * const agent = createAgent({
 *   name: 'Letta',
 *   instructions: `You are an assistant.\n\n${tiered.renderCore()}`,
 *   tools: Object.values(createTieredMemoryTools(tiered)),
 * });
 * ```
 */

import { z } from 'zod';
import type { SchemaInput } from '../validation/index.js';
import type { MemoryStore } from './types.js';
import { MemoryType } from './types.js';

// ── Minimal tool shim (mirrors agent-memory-tools.ts to avoid a circular dep) ──
interface Tool<TInput, TOutput> {
  readonly name: string;
  readonly description: string;
  readonly parameters: SchemaInput<unknown, TInput>;
  execute(input: TInput): Promise<TOutput>;
}
function makeTool<TInput, TOutput>(def: Tool<TInput, TOutput>): Tool<TInput, TOutput> {
  return def;
}

/** Default per-block character ceiling before appends are rejected. */
export const DEFAULT_BLOCK_LIMIT = 2_000;

/** A single core-memory block — always present in the prompt. */
export interface MemoryBlock {
  /** Stable identifier the agent references, e.g. `persona`, `human`. */
  readonly label: string;
  /** Current contents. */
  value: string;
  /** Character limit for this block. Defaults to {@link DEFAULT_BLOCK_LIMIT}. */
  readonly limit?: number;
  /** Optional human description of what belongs here (shown to the LLM). */
  readonly description?: string;
}

export interface TieredMemoryConfig {
  /** Initial core-memory blocks. */
  readonly blocks?: MemoryBlock[];
  /** Backing store for archival (long-term) memory. */
  readonly archival?: MemoryStore;
  /** Default character limit applied to blocks without an explicit `limit`. */
  readonly defaultBlockLimit?: number;
}

/**
 * Holds core blocks (in-context) and an archival store (retrieved on demand).
 * Pure data + small sync/async methods — no LLM calls of its own.
 */
export class TieredMemory {
  private readonly blocks = new Map<string, MemoryBlock>();
  private readonly archival?: MemoryStore;
  private readonly defaultLimit: number;

  constructor(config: TieredMemoryConfig = {}) {
    this.defaultLimit = config.defaultBlockLimit ?? DEFAULT_BLOCK_LIMIT;
    for (const block of config.blocks ?? []) {
      this.blocks.set(block.label, { ...block });
    }
    this.archival = config.archival;
  }

  /** Returns the labels of all core blocks in insertion order. */
  labels(): string[] {
    return [...this.blocks.keys()];
  }

  /** Read a single block's value (undefined if no such block). */
  get(label: string): string | undefined {
    return this.blocks.get(label)?.value;
  }

  /** Effective character limit for a block. */
  limitOf(label: string): number {
    return this.blocks.get(label)?.limit ?? this.defaultLimit;
  }

  /**
   * Render all core blocks as a prompt section. Stable, deterministic format so
   * it can be embedded directly into the system instructions each turn.
   */
  renderCore(): string {
    if (this.blocks.size === 0) return '';
    const sections = [...this.blocks.values()].map((b) => {
      const used = b.value.length;
      const limit = b.limit ?? this.defaultLimit;
      const desc = b.description ? ` — ${b.description}` : '';
      return `<${b.label}${desc} (${used}/${limit} chars)>\n${b.value}\n</${b.label}>`;
    });
    return `[Core Memory]\n${sections.join('\n\n')}`;
  }

  /**
   * Append text to a core block. Returns the new length.
   * @throws if the block is unknown or the append would exceed its limit.
   */
  coreAppend(label: string, text: string): number {
    const block = this.requireBlock(label);
    const sep = block.value.length > 0 ? '\n' : '';
    const next = block.value + sep + text;
    const limit = block.limit ?? this.defaultLimit;
    if (next.length > limit) {
      throw new RangeError(
        `core_memory_append: block "${label}" would exceed its ${limit}-char limit (${next.length}). ` +
          `Replace or summarise existing content, or move detail to archival memory.`,
      );
    }
    block.value = next;
    return block.value.length;
  }

  /**
   * Replace the first occurrence of `oldText` with `newText` in a core block.
   * Pass an empty `oldText` to overwrite the whole block.
   * @throws if the block is unknown, the search text is absent, or the result
   *         exceeds the block limit.
   */
  coreReplace(label: string, oldText: string, newText: string): string {
    const block = this.requireBlock(label);
    let next: string;
    if (oldText === '') {
      next = newText;
    } else {
      if (!block.value.includes(oldText)) {
        throw new Error(`core_memory_replace: text not found in block "${label}".`);
      }
      next = block.value.replace(oldText, newText);
    }
    const limit = block.limit ?? this.defaultLimit;
    if (next.length > limit) {
      throw new RangeError(`core_memory_replace: result exceeds block "${label}" ${limit}-char limit.`);
    }
    block.value = next;
    return block.value;
  }

  /** Insert a fact into archival memory. @throws if no archival store configured. */
  async archivalInsert(text: string, tags?: string[]): Promise<string> {
    const store = this.requireArchival();
    const entry = await store.store({
      type: MemoryType.LONG_TERM,
      content: text,
      metadata: { source: 'agent', ...(tags?.length ? { tags } : {}) },
    });
    return String(entry.id);
  }

  /** Semantic search over archival memory. */
  async archivalSearch(query: string, limit = 5): Promise<string[]> {
    const store = this.requireArchival();
    const results = await store.retrieve({ query, limit, threshold: 0.1 });
    return results.map((r) => r.entry.content);
  }

  private requireBlock(label: string): MemoryBlock {
    const block = this.blocks.get(label);
    if (!block) {
      throw new Error(`Unknown core-memory block "${label}". Known blocks: ${this.labels().join(', ') || '(none)'}.`);
    }
    return block;
  }

  private requireArchival(): MemoryStore {
    if (!this.archival) {
      throw new Error('Archival memory is not configured. Pass `archival` to the TieredMemory constructor.');
    }
    return this.archival;
  }
}

// ── Self-editing tools (Letta tool names) ─────────────────────────────────────

const AppendInput = z.object({
  label: z.string().describe('The core-memory block to append to, e.g. "human" or "persona".'),
  content: z.string().min(1).describe('Text to append to the block.'),
});
const ReplaceInput = z.object({
  label: z.string().describe('The core-memory block to edit.'),
  old_content: z.string().describe('Exact text to replace. Pass "" to overwrite the whole block.'),
  new_content: z.string().describe('Replacement text.'),
});
const ArchivalInsertInput = z.object({
  content: z.string().min(1).describe('The fact to store in long-term archival memory.'),
  tags: z.array(z.string()).optional().describe('Optional topic tags.'),
});
const ArchivalSearchInput = z.object({
  query: z.string().min(1).describe('Natural-language query to search archival memory.'),
  limit: z.number().int().min(1).max(50).optional().describe('Max results (default 5).'),
});

export interface TieredMemoryTools {
  core_memory_append: Tool<z.infer<typeof AppendInput>, { label: string; length: number }>;
  core_memory_replace: Tool<z.infer<typeof ReplaceInput>, { label: string; value: string }>;
  archival_memory_insert: Tool<z.infer<typeof ArchivalInsertInput>, { id: string; stored: true }>;
  archival_memory_search: Tool<z.infer<typeof ArchivalSearchInput>, { results: string[]; count: number }>;
}

/**
 * Create the four LLM-callable tools that let an agent edit its own tiered
 * memory. Register them with `createAgent({ tools: Object.values(tools) })`.
 */
export function createTieredMemoryTools(memory: TieredMemory): TieredMemoryTools {
  return {
    core_memory_append: makeTool({
      name: 'core_memory_append',
      description:
        'Append content to one of your always-visible core memory blocks (e.g. remember a new fact about the user). ' +
        'Core memory is small and always in context — use archival_memory_insert for large or rarely-needed details.',
      parameters: AppendInput,
      async execute({ label, content }) {
        const length = memory.coreAppend(label, content);
        return { label, length };
      },
    }),
    core_memory_replace: makeTool({
      name: 'core_memory_replace',
      description:
        'Replace text within a core memory block to correct or update it. ' +
        'Pass old_content="" to overwrite the entire block.',
      parameters: ReplaceInput,
      async execute({ label, old_content, new_content }) {
        const value = memory.coreReplace(label, old_content, new_content);
        return { label, value };
      },
    }),
    archival_memory_insert: makeTool({
      name: 'archival_memory_insert',
      description:
        'Save a fact to long-term archival memory for later semantic retrieval. ' +
        'Use this for information that does not need to stay in your immediate context.',
      parameters: ArchivalInsertInput,
      async execute({ content, tags }) {
        const id = await memory.archivalInsert(content, tags);
        return { id, stored: true as const };
      },
    }),
    archival_memory_search: makeTool({
      name: 'archival_memory_search',
      description: 'Search your long-term archival memory by natural-language query to recall stored facts.',
      parameters: ArchivalSearchInput,
      async execute({ query, limit = 5 }) {
        const results = await memory.archivalSearch(query, limit);
        return { results, count: results.length };
      },
    }),
  };
}
