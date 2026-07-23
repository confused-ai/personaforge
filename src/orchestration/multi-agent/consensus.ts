/**
 * Consensus Protocol — Multi-agent voting and agreement.
 *
 * Multiple agents independently analyze the same input, then vote
 * on the best answer using configurable consensus strategies.
 *
 * @example
 * ```ts
 * import { createConsensus } from 'personaforge/orchestration';
 *
 * const consensus = createConsensus({
 *   agents: { analyst1, analyst2, analyst3 },
 *   strategy: 'majority-vote',
 *   quorum: 2,
 * });
 *
 * const result = await consensus.decide('Should we approve this loan application?');
 * console.log(result.decision);     // 'approved'
 * console.log(result.confidence);   // 0.67 (2/3 agents agreed)
 * console.log(result.votes);        // individual agent votes
 * ```
 */

import type { AgentOutput, EntityId, Agent as CoreAgent } from '../../core/index.js';
import { AgentState } from '../../core/index.js';
// AgentContext not needed directly in this file

// ── Types ──────────────────────────────────────────────────────────────────

/** Consensus strategy. */
export type ConsensusStrategy = 'majority-vote' | 'unanimous' | 'weighted' | 'best-of-n';

/** Configuration for consensus protocol. */
export interface ConsensusConfig {
    /** Named agents that participate in voting. */
    readonly agents: Record<string, CoreAgent>;
    /** Consensus strategy. Default: 'majority-vote'. */
    readonly strategy?: ConsensusStrategy;
    /** Minimum number of agents that must agree. Default: ceil(n/2). */
    readonly quorum?: number;
    /** Weights per agent (for 'weighted' strategy). */
    readonly weights?: Record<string, number>;
    /** Timeout per agent. Default: 30000ms. */
    readonly agentTimeoutMs?: number;
    /** Whether to run agents in parallel. Default: true. */
    readonly parallel?: boolean;
    /** Custom scoring function for 'best-of-n' strategy. */
    readonly scorer?: (output: AgentOutput) => number;
}

/** A single agent's vote. */
export interface AgentVote {
    readonly agentName: string;
    readonly agentId: EntityId;
    readonly output: AgentOutput;
    readonly text: string;
    readonly score?: number;
    readonly executionTimeMs: number;
    readonly error?: string;
}

/** Result of a consensus decision. */
export interface ConsensusResult {
    readonly decision: string;
    readonly confidence: number; // 0-1
    readonly votes: AgentVote[];
    readonly strategy: ConsensusStrategy;
    readonly quorumMet: boolean;
    readonly totalExecutionTimeMs: number;
    readonly winningAgent: string;
}

// ── Implementation ─────────────────────────────────────────────────────────

export class ConsensusProtocol {
    private readonly config: ConsensusConfig;

    constructor(config: ConsensusConfig) {
        this.config = config;
    }

    /** Run all agents and determine consensus. */
    async decide(prompt: string, context?: Record<string, unknown>): Promise<ConsensusResult> {
        const start = Date.now();
        const strategy = this.config.strategy ?? 'majority-vote';
        const parallel = this.config.parallel ?? true;

        // Collect votes from all agents
        const votes = parallel
            ? await this.collectVotesParallel(prompt, context)
            : await this.collectVotesSequential(prompt, context);

        // Apply consensus strategy
        const result = this.applyStrategy(votes, strategy);

        return {
            ...result,
            votes,
            strategy,
            totalExecutionTimeMs: Date.now() - start,
        };
    }

    private async collectVotesParallel(prompt: string, context?: Record<string, unknown>): Promise<AgentVote[]> {
        const entries = Object.entries(this.config.agents);
        const timeoutMs = this.config.agentTimeoutMs ?? 30_000;

        const promises = entries.map(async ([name, agent]) => {
            const start = Date.now();
            try {
                let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
                const output = await Promise.race([
                    this.runAgent(agent, prompt, context),
                    new Promise<never>((_, reject) => {
                        timeoutTimer = setTimeout(() => reject(new Error('Timeout')), timeoutMs);
                    }),
                ]).finally(() => {
                    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
                });

                return {
                    agentName: name,
                    agentId: agent.id,
                    output,
                    text: String(output.result ?? ''),
                    executionTimeMs: Date.now() - start,
                } as AgentVote;
            } catch (error) {
                return {
                    agentName: name,
                    agentId: agent.id,
                    output: { result: null, state: AgentState.FAILED, metadata: { startTime: new Date(), iterations: 0 } },
                    text: '',
                    executionTimeMs: Date.now() - start,
                    error: error instanceof Error ? error.message : String(error),
                } as AgentVote;
            }
        });

        return Promise.all(promises);
    }

    private async collectVotesSequential(prompt: string, context?: Record<string, unknown>): Promise<AgentVote[]> {
        const votes: AgentVote[] = [];
        for (const [name, agent] of Object.entries(this.config.agents)) {
            const start = Date.now();
            try {
                const output = await this.runAgent(agent, prompt, context);
                votes.push({
                    agentName: name,
                    agentId: agent.id,
                    output,
                    text: String(output.result ?? ''),
                    executionTimeMs: Date.now() - start,
                });
            } catch (error) {
                votes.push({
                    agentName: name,
                    agentId: agent.id,
                    output: { result: null, state: AgentState.FAILED, metadata: { startTime: new Date(), iterations: 0 } },
                    text: '',
                    executionTimeMs: Date.now() - start,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
        return votes;
    }

    private applyStrategy(votes: AgentVote[], strategy: ConsensusStrategy): Omit<ConsensusResult, 'votes' | 'strategy' | 'totalExecutionTimeMs'> {
        const successfulVotes = votes.filter(v => !v.error && v.output.state !== AgentState.FAILED);
        const totalAgents = Object.keys(this.config.agents).length;
        const quorum = this.config.quorum ?? Math.ceil(totalAgents / 2);

        if (successfulVotes.length === 0) {
            return {
                decision: 'No consensus — all agents failed',
                confidence: 0,
                quorumMet: false,
                winningAgent: '',
            };
        }

        switch (strategy) {
            case 'majority-vote':
                return this.majorityVote(successfulVotes, quorum, totalAgents);
            case 'unanimous':
                return this.unanimousVote(successfulVotes, totalAgents);
            case 'weighted':
                return this.weightedVote(successfulVotes, quorum, totalAgents);
            case 'best-of-n':
                return this.bestOfN(successfulVotes);
            default:
                return this.majorityVote(successfulVotes, quorum, totalAgents);
        }
    }

    private majorityVote(votes: AgentVote[], quorum: number, _total: number) {
        // Simple: the most common non-empty response wins
        const textCounts = new Map<string, { count: number; agent: string }>();
        for (const vote of votes) {
            const key = vote.text.trim().toLowerCase().slice(0, 200);
            const existing = textCounts.get(key);
            if (existing) {
                existing.count++;
            } else {
                textCounts.set(key, { count: 1, agent: vote.agentName });
            }
        }

        let winner = votes[0];
        let maxCount = 0;
        for (const [, { count, agent }] of textCounts) {
            if (count > maxCount) {
                maxCount = count;
                winner = votes.find(v => v.agentName === agent)!;
            }
        }

        return {
            decision: winner.text,
            confidence: maxCount / votes.length,
            quorumMet: maxCount >= quorum,
            winningAgent: winner.agentName,
        };
    }

    private unanimousVote(votes: AgentVote[], _total: number) {
        const texts = votes.map(v => v.text.trim().toLowerCase().slice(0, 200));
        const allSame = texts.every(t => t === texts[0]);

        return {
            decision: allSame ? votes[0].text : `No unanimous agreement (${new Set(texts).size} distinct answers)`,
            confidence: allSame ? 1.0 : 0,
            quorumMet: allSame,
            winningAgent: allSame ? votes[0].agentName : '',
        };
    }

    private weightedVote(votes: AgentVote[], quorum: number, _total: number) {
        const weights = this.config.weights ?? {};
        let bestAgent = votes[0];
        let bestWeight = 0;

        for (const vote of votes) {
            const weight = weights[vote.agentName] ?? 1;
            if (weight > bestWeight) {
                bestWeight = weight;
                bestAgent = vote;
            }
        }

        return {
            decision: bestAgent.text,
            confidence: bestWeight / Math.max(...Object.values(weights), 1),
            quorumMet: votes.length >= quorum,
            winningAgent: bestAgent.agentName,
        };
    }

    private bestOfN(votes: AgentVote[]) {
        const scorer = this.config.scorer ?? ((output: AgentOutput) => {
            const text = String(output.result ?? '');
            return text.length; // Simple heuristic: longer is more detailed
        });

        let bestVote = votes[0];
        let bestScore = -Infinity;

        for (const vote of votes) {
            const score = scorer(vote.output);
            if (score > bestScore) {
                bestScore = score;
                bestVote = vote;
            }
        }

        return {
            decision: bestVote.text,
            confidence: bestScore > 0 ? Math.min(bestScore / 100, 1) : 0,
            quorumMet: true,
            winningAgent: bestVote.agentName,
        };
    }

    private async runAgent(agent: CoreAgent, prompt: string, context?: Record<string, unknown>): Promise<AgentOutput> {
        const result = await agent.run(prompt, { ...(context as any) });
        const output: AgentOutput = {
            result: result.text,
            state: AgentState.COMPLETED,
            metadata: {
                startTime: new Date(),
                endTime: new Date(),
                iterations: result.steps,
                tokensUsed: result.usage?.totalTokens,
            },
        };
        return output;
    }
}

/** Create a consensus protocol instance. */
export function createConsensus(config: ConsensusConfig): ConsensusProtocol {
    return new ConsensusProtocol(config);
}
