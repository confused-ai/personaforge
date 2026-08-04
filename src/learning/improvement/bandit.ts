/**
 * Bandit-based variant selection.
 *
 * When several candidate policy variants compete, the improvement loop can
 * explore them online with a multi-armed bandit: pull statistically promising
 * arms more often while still sampling the others. Two strategies are provided:
 *
 *  - `epsilon-greedy` — explore a random arm with probability `epsilon`,
 *    otherwise exploit the arm with the highest mean reward so far.
 *  - `ucb1` — Upper Confidence Bound with exploration bonus for under-sampled
 *    arms (works well when reward is noisy).
 *
 * An injectable `rng` keeps selection deterministic for tests and replay.
 */

export type BanditStrategy = 'epsilon-greedy' | 'ucb1';

export interface BanditArm {
    readonly id: string;
    pulls: number;
    totalReward: number;
}

export interface BanditOptions {
    readonly strategy?: BanditStrategy;
    /** Exploration probability for epsilon-greedy. Default 0.1. */
    readonly epsilon?: number;
    /** Deterministic RNG in [0, 1). Default Math.random. */
    readonly rng?: () => number;
}

export class BanditSelector {
    private readonly arms = new Map<string, BanditArm>();
    private readonly strategy: BanditStrategy;
    private readonly epsilon: number;
    private readonly rng: () => number;

    constructor(armIds: readonly string[], opts: BanditOptions = {}) {
        this.strategy = opts.strategy ?? 'ucb1';
        this.epsilon = opts.epsilon ?? 0.1;
        this.rng = opts.rng ?? Math.random;
        for (const id of armIds) this.arms.set(id, { id, pulls: 0, totalReward: 0 });
    }

    get armCount(): number {
        return this.arms.size;
    }

    /** Which arm to pull next. */
    select(): string {
        const ids = [...this.arms.keys()];
        if (ids.length === 0) throw new Error('BanditSelector: no arms registered');
        if (ids.length === 1) return ids[0]!;

        // Ensure every arm is pulled at least once before exploiting.
        const untouched = ids.filter((id) => this.arms.get(id)!.pulls === 0);
        if (untouched.length > 0) return untouched[Math.floor(this.rng() * untouched.length)]!;

        if (this.strategy === 'epsilon-greedy') {
            if (this.rng() < this.epsilon) {
                return ids[Math.floor(this.rng() * ids.length)]!;
            }
            return this._bestByMean(ids);
        }
        return this._bestByUcb1(ids);
    }

    /** Record the reward (0…1) obtained from pulling `armId`. */
    update(armId: string, reward: number): void {
        const arm = this.arms.get(armId);
        if (!arm) return;
        arm.pulls++;
        arm.totalReward += Number.isFinite(reward) ? reward : 0;
    }

    /** Current per-arm pull counts and average reward. Deterministic view. */
    stats(): Record<string, { pulls: number; avgReward: number }> {
        const out: Record<string, { pulls: number; avgReward: number }> = {};
        for (const arm of this.arms.values()) {
            out[arm.id] = { pulls: arm.pulls, avgReward: arm.pulls ? arm.totalReward / arm.pulls : 0 };
        }
        return out;
    }

    private _bestByMean(ids: string[]): string {
        let best = ids[0]!;
        let bestMean = -Infinity;
        for (const id of ids) {
            const arm = this.arms.get(id)!;
            const m = arm.pulls ? arm.totalReward / arm.pulls : -Infinity;
            if (m > bestMean) {
                bestMean = m;
                best = id;
            }
        }
        return best;
    }

    private _bestByUcb1(ids: string[]): string {
        const totalPulls = [...this.arms.values()].reduce((a, b) => a + b.pulls, 0);
        let best = ids[0]!;
        let bestScore = -Infinity;
        for (const id of ids) {
            const arm = this.arms.get(id)!;
            const mean = arm.pulls ? arm.totalReward / arm.pulls : 0;
            const bonus = arm.pulls ? Math.sqrt((2 * Math.log(totalPulls)) / arm.pulls) : Infinity;
            const score = mean + bonus;
            if (score > bestScore) {
                bestScore = score;
                best = id;
            }
        }
        return best;
    }
}
