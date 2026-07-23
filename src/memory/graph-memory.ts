/**
 * @personaforge/memory — graph / entity memory.
 *
 * Complements the vector tier with a structured knowledge graph: typed entities
 * (nodes) and labelled relations (edges). This is the Zep / Mem0 graph-memory
 * pattern — facts the agent can traverse ("who works where", "what depends on
 * what") rather than only fuzzy-match by embedding.
 *
 * The agent maintains it via the self-edit tools from
 * {@link createGraphMemoryTools}; render relevant facts into the prompt with
 * {@link GraphMemory.search} or {@link GraphMemory.toFacts}.
 *
 * ```ts
 * const g = new GraphMemory();
 * g.addRelation('Jordan', 'works_at', 'AcmeCorp');
 * g.addRelation('Jordan', 'lives_in', 'Lisbon');
 * g.search('Jordan'); // → ["Jordan works_at AcmeCorp", "Jordan lives_in Lisbon"]
 * ```
 */

import { z } from 'zod';

// ── Minimal tool shim (mirrors agent-memory-tools.ts; avoids a circular dep) ──
interface Tool<TInput, TOutput> {
  readonly name: string;
  readonly description: string;
  readonly parameters: z.ZodType<TInput>;
  execute(input: TInput): Promise<TOutput>;
}
function makeTool<TInput, TOutput>(def: Tool<TInput, TOutput>): Tool<TInput, TOutput> {
  return def;
}

/** A node in the knowledge graph. */
export interface GraphEntity {
  readonly name: string;
  type?: string;
  props: Record<string, unknown>;
}

/** A directed, labelled edge between two entities. */
export interface GraphRelation {
  readonly from: string;
  readonly relation: string;
  readonly to: string;
}

function relationKey(from: string, relation: string, to: string): string {
  return `${from} ${relation} ${to}`;
}

/** In-memory entity/relation graph with self-edit tooling. */
export class GraphMemory {
  private readonly entities = new Map<string, GraphEntity>();
  private readonly relations = new Map<string, GraphRelation>();

  /** Add or update an entity. Returns the entity. */
  addEntity(name: string, opts: { type?: string; props?: Record<string, unknown> } = {}): GraphEntity {
    const existing = this.entities.get(name);
    if (existing) {
      if (opts.type !== undefined) existing.type = opts.type;
      if (opts.props) existing.props = { ...existing.props, ...opts.props };
      return existing;
    }
    const entity: GraphEntity = { name, type: opts.type, props: opts.props ?? {} };
    this.entities.set(name, entity);
    return entity;
  }

  /**
   * Add a directed relation `from --relation--> to`. Missing endpoints are
   * auto-created as bare entities. Idempotent on identical triples.
   */
  addRelation(from: string, relation: string, to: string): GraphRelation {
    this.addEntity(from);
    this.addEntity(to);
    const key = relationKey(from, relation, to);
    const existing = this.relations.get(key);
    if (existing) return existing;
    const rel: GraphRelation = { from, relation, to };
    this.relations.set(key, rel);
    return rel;
  }

  /** Get a single entity (undefined if absent). */
  getEntity(name: string): GraphEntity | undefined {
    return this.entities.get(name);
  }

  /** All relations touching `name`, as either source or target. */
  relationsOf(name: string): GraphRelation[] {
    return [...this.relations.values()].filter((r) => r.from === name || r.to === name);
  }

  /** Distinct neighbour entity names one hop from `name`. */
  neighbors(name: string): string[] {
    const out = new Set<string>();
    for (const r of this.relations.values()) {
      if (r.from === name) out.add(r.to);
      if (r.to === name) out.add(r.from);
    }
    return [...out];
  }

  /**
   * Human-readable facts about an entity (its 1-hop relations), e.g.
   * `"Jordan works_at AcmeCorp"`. Empty array if the entity is unknown.
   */
  search(name: string): string[] {
    return this.relationsOf(name).map((r) => `${r.from} ${r.relation} ${r.to}`);
  }

  /** Every relation as a fact line — useful for dumping the graph into context. */
  toFacts(): string[] {
    return [...this.relations.values()].map((r) => `${r.from} ${r.relation} ${r.to}`);
  }

  /** All entity names. */
  entityNames(): string[] {
    return [...this.entities.keys()];
  }

  /** All relations. */
  allRelations(): GraphRelation[] {
    return [...this.relations.values()];
  }
}

// ── Self-editing tools ────────────────────────────────────────────────────────

const AddEntityInput = z.object({
  name: z.string().min(1).describe('Entity name, e.g. a person, place, or thing.'),
  type: z.string().optional().describe('Optional entity type, e.g. "person", "company".'),
});
const AddRelationInput = z.object({
  from: z.string().min(1).describe('Source entity name.'),
  relation: z.string().min(1).describe('Relation label, e.g. "works_at", "depends_on".'),
  to: z.string().min(1).describe('Target entity name.'),
});
const SearchGraphInput = z.object({
  name: z.string().min(1).describe('Entity to look up relations for.'),
});

export interface GraphMemoryTools {
  add_entity: Tool<z.infer<typeof AddEntityInput>, { name: string; created: true }>;
  add_relation: Tool<z.infer<typeof AddRelationInput>, { fact: string; stored: true }>;
  search_graph: Tool<z.infer<typeof SearchGraphInput>, { facts: string[]; neighbors: string[] }>;
}

/** Create the three LLM-callable tools that let an agent edit its graph memory. */
export function createGraphMemoryTools(graph: GraphMemory): GraphMemoryTools {
  return {
    add_entity: makeTool({
      name: 'add_entity',
      description: 'Add an entity (person, place, thing, concept) to your structured knowledge graph.',
      parameters: AddEntityInput,
      async execute({ name, type }) {
        graph.addEntity(name, type !== undefined ? { type } : {});
        return { name, created: true as const };
      },
    }),
    add_relation: makeTool({
      name: 'add_relation',
      description:
        'Record a relationship between two entities, e.g. add_relation("Jordan","works_at","AcmeCorp"). ' +
        'Missing entities are created automatically.',
      parameters: AddRelationInput,
      async execute({ from, relation, to }) {
        graph.addRelation(from, relation, to);
        return { fact: `${from} ${relation} ${to}`, stored: true as const };
      },
    }),
    search_graph: makeTool({
      name: 'search_graph',
      description: 'Look up everything you know about an entity — its relations and connected neighbours.',
      parameters: SearchGraphInput,
      async execute({ name }) {
        return { facts: graph.search(name), neighbors: graph.neighbors(name) };
      },
    }),
  };
}
