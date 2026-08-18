/**
 * Graph-of-Thoughts (GoT) Engine
 * ==============================
 * Implements Graph of Thoughts (Besta et al. 2023).
 * Models reasoning as an arbitrary graph of thought nodes connected by
 * non-linear operations — unlike ToT's strict tree, nodes can merge
 * (aggregate) multiple parents and self-loop (refine).
 *
 * Operations per round:
 *   - Generate:  produce new candidate thoughts from the frontier
 *   - Refine:    self-loop — improve an existing thought using its own feedback
 *   - Aggregate: merge top-N frontier thoughts into a single combined thought
 *   - Score:     evaluate every new node; keep the top-K as the next frontier
 *
 * Usage:
 *   const got = new GotEngine({ generate: (msgs) => llm.chat(msgs) });
 *   const result = await got.solve(goal, context);
 *   console.log(result.solution, result.score);
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GotConfig {
    /** LLM callable used to generate/refine/aggregate thoughts */
    generate: (messages: Array<{ role: string; content: string }>) => Promise<string>;
    /** Optional separate evaluator LLM. Defaults to `generate`. */
    evaluate?: (messages: Array<{ role: string; content: string }>) => Promise<string>;
    /** Number of initial candidate thoughts generated. Default: 4 */
    numBranches?: number;
    /** Number of graph refinement rounds. Default: 3 */
    maxIterations?: number;
    /** Top-K nodes retained as frontier after each round. Default: 3 */
    keepBest?: number;
    generationPrompt?: string;
    evaluationPrompt?: string;
    aggregationPrompt?: string;
    refinementPrompt?: string;
}

export interface GotNode {
    id: string;
    thought: string;
    score: number;
    operation: 'generate' | 'aggregate' | 'refine';
    /** Parent node ids — multiple parents for 'aggregate' nodes (graph, not tree) */
    parents: string[];
}

export interface GotEdge {
    from: string;
    to: string;
    operation: 'generate' | 'aggregate' | 'refine';
}

export interface GotResult {
    /** Highest-scoring thought across the whole graph */
    solution: string;
    /** Score of the winning node (0–1) */
    score: number;
    /** All nodes explored */
    nodes: GotNode[];
    /** All edges connecting nodes (captures non-linear graph structure) */
    edges: GotEdge[];
    /** Number of refinement rounds actually run */
    iterations: number;
}

// ── Default prompts ───────────────────────────────────────────────────────────

const DEFAULT_GENERATION_PROMPT = `You are a creative problem-solving assistant using Graph-of-Thought reasoning.
Given a goal, generate ONE concise candidate thought/solution fragment.
Output ONLY the thought as plain text — no JSON, no preamble.`;

const DEFAULT_EVALUATION_PROMPT = `You are a rigorous evaluator of candidate thoughts.
Given a goal and a candidate thought, output a single JSON object:
{ "score": <float 0.0-1.0>, "rationale": "<brief justification>" }`;

const DEFAULT_AGGREGATION_PROMPT = `You merge multiple partial thoughts into one superior, coherent thought.
Combine the strongest elements of each input thought. Resolve contradictions.
Output ONLY the merged thought as plain text.`;

const DEFAULT_REFINEMENT_PROMPT = `You improve a candidate thought by fixing weaknesses and sharpening reasoning.
Output ONLY the improved thought as plain text — no preamble.`;

// ── GotEngine ──────────────────────────────────────────────────────────────────

export class GotEngine {
    private readonly _generate: GotConfig['generate'];
    private readonly _evaluate: NonNullable<GotConfig['evaluate']>;
    private readonly _numBranches: number;
    private readonly _maxIterations: number;
    private readonly _keepBest: number;
    private readonly _generationPrompt: string;
    private readonly _evaluationPrompt: string;
    private readonly _aggregationPrompt: string;
    private readonly _refinementPrompt: string;

    constructor(config: GotConfig) {
        this._generate          = config.generate;
        this._evaluate           = config.evaluate ?? config.generate;
        this._numBranches        = config.numBranches   ?? 4;
        this._maxIterations      = config.maxIterations ?? 3;
        this._keepBest           = config.keepBest      ?? 3;
        this._generationPrompt   = config.generationPrompt   ?? DEFAULT_GENERATION_PROMPT;
        this._evaluationPrompt   = config.evaluationPrompt   ?? DEFAULT_EVALUATION_PROMPT;
        this._aggregationPrompt  = config.aggregationPrompt  ?? DEFAULT_AGGREGATION_PROMPT;
        this._refinementPrompt   = config.refinementPrompt   ?? DEFAULT_REFINEMENT_PROMPT;
    }

    async solve(goal: string, context?: string): Promise<GotResult> {
        const nodes: GotNode[] = [];
        const edges: GotEdge[] = [];
        let nextId = 1;
        const newId = (): string => `N${nextId++}`;

        // ── Round 0: generate initial candidate thoughts (roots) ────────────────
        const rootTexts = await Promise.all(
            Array.from({ length: this._numBranches }, () =>
                this._generate([
                    { role: 'system', content: this._generationPrompt },
                    { role: 'user', content: this._userMsg(goal, context) },
                ]).catch(() => ''),
            ),
        );

        const rootScores = await Promise.all(
            rootTexts.map((t) => (t ? this._scoreThought(goal, t) : Promise.resolve(0))),
        );

        let frontier: GotNode[] = [];
        for (let i = 0; i < rootTexts.length; i++) {
            const thought = rootTexts[i];
            if (!thought) continue;
            const node: GotNode = { id: newId(), thought, score: rootScores[i] ?? 0, operation: 'generate', parents: [] };
            nodes.push(node);
            frontier.push(node);
        }
        frontier = this._topK(frontier, this._keepBest);

        // ── Iterative rounds: refine + aggregate ─────────────────────────────────
        let iterations = 0;
        for (let iter = 0; iter < this._maxIterations; iter++) {
            if (frontier.length === 0) break;
            iterations++;

            // Refine: self-loop improvement on each frontier node (parallel)
            const refinePromises = frontier.map(async (parent) => {
                const refined = await this._generate([
                    { role: 'system', content: this._refinementPrompt },
                    { role: 'user', content: `Goal: ${goal}\n\nThought to improve:\n${parent.thought}` },
                ]).catch(() => '');
                if (!refined) return null;
                const score = await this._scoreThought(goal, refined);
                const node: GotNode = { id: newId(), thought: refined, score, operation: 'refine', parents: [parent.id] };
                return { node, edge: { from: parent.id, to: node.id, operation: 'refine' as const } };
            });

            // Aggregate: merge pairs of adjacent frontier nodes (parallel)
            const aggregatePromises: Promise<{ node: GotNode; edge: GotEdge[] } | null>[] = [];
            for (let i = 0; i + 1 < frontier.length; i += 2) {
                const a = frontier[i]!;
                const b = frontier[i + 1]!;
                aggregatePromises.push(
                    (async () => {
                        const merged = await this._generate([
                            { role: 'system', content: this._aggregationPrompt },
                            { role: 'user', content: `Goal: ${goal}\n\nThought A:\n${a.thought}\n\nThought B:\n${b.thought}` },
                        ]).catch(() => '');
                        if (!merged) return null;
                        const score = await this._scoreThought(goal, merged);
                        const node: GotNode = { id: newId(), thought: merged, score, operation: 'aggregate', parents: [a.id, b.id] };
                        return {
                            node,
                            edge: [
                                { from: a.id, to: node.id, operation: 'aggregate' as const },
                                { from: b.id, to: node.id, operation: 'aggregate' as const },
                            ],
                        };
                    })(),
                );
            }

            const [refineResults, aggregateResults] = await Promise.all([
                Promise.all(refinePromises),
                Promise.all(aggregatePromises),
            ]);

            const roundNodes: GotNode[] = [];
            for (const r of refineResults) {
                if (!r) continue;
                nodes.push(r.node);
                edges.push(r.edge);
                roundNodes.push(r.node);
            }
            for (const r of aggregateResults) {
                if (!r) continue;
                nodes.push(r.node);
                edges.push(...r.edge);
                roundNodes.push(r.node);
            }

            if (roundNodes.length === 0) break;

            // Next frontier: top-K across everything discovered so far (graph memory, not just this round)
            frontier = this._topK([...frontier, ...roundNodes], this._keepBest);
        }

        // ── Select best node across the whole graph ──────────────────────────────
        const best = this._topK(nodes, 1)[0];
        return {
            solution: best?.thought ?? '',
            score: best?.score ?? 0,
            nodes,
            edges,
            iterations,
        };
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private _userMsg(goal: string, context?: string): string {
        return [`Goal: ${goal}`, context ? `Context: ${context}` : ''].filter(Boolean).join('\n\n');
    }

    private _topK(nodes: GotNode[], k: number): GotNode[] {
        return [...nodes].sort((a, b) => b.score - a.score).slice(0, k);
    }

    private async _scoreThought(goal: string, thought: string): Promise<number> {
        const raw = await this._evaluate([
            { role: 'system', content: this._evaluationPrompt },
            { role: 'user', content: `Goal: ${goal}\n\nCandidate thought:\n${thought}` },
        ]).catch(() => '');
        return this._parseScore(raw);
    }

    private _parseScore(raw: string): number {
        try {
            const json = JSON.parse(raw.trim()) as { score?: unknown };
            const s = Number(json.score);
            if (!isNaN(s)) return Math.max(0, Math.min(1, s));
        } catch {
            /* fall through */
        }
        const match = /([0-9]*\.?[0-9]+)/.exec(raw);
        if (match) {
            const s = parseFloat(match[1]!);
            return Math.max(0, Math.min(1, s));
        }
        return 0.5;
    }
}
