/**
 * Base agent implementation
 */

import {
    Agent,
    AgentConfig,
    AgentContext,
    AgentHooks,
    AgentInput,
    AgentOutput,
    AgentRunOptions,
    AgentRunResult,
    AgentState,
    EntityId,
    ExecutionMetadata,
    Message,
    MultiModalInput,
    StreamChunk,
} from './types.js';
import type { AgentLifecycleHooks as _AgentLifecycleHooks } from './types.js'; // reserved
import { generateEntityId } from './types.js';
import { DebugLogger, createDebugLogger } from '../shared/index.js';
import { PersonaForgeError } from '../contracts/index.js';

/**
 * Validated agent lifecycle transitions. Any `state → state` pair not listed
 * here is illegal in strict mode. Self-transitions are allowed (no-op).
 */
const AGENT_TRANSITIONS: Readonly<Record<AgentState, readonly AgentState[]>> = {
    [AgentState.IDLE]:      [AgentState.PLANNING, AgentState.EXECUTING, AgentState.CANCELLED, AgentState.FAILED],
    [AgentState.PLANNING]:  [AgentState.EXECUTING, AgentState.PAUSED, AgentState.COMPLETED, AgentState.FAILED, AgentState.CANCELLED],
    [AgentState.EXECUTING]: [AgentState.PLANNING, AgentState.PAUSED, AgentState.COMPLETED, AgentState.FAILED, AgentState.CANCELLED],
    [AgentState.PAUSED]:    [AgentState.PLANNING, AgentState.EXECUTING, AgentState.CANCELLED, AgentState.FAILED],
    [AgentState.COMPLETED]: [AgentState.IDLE, AgentState.PLANNING],   // permit re-runs
    [AgentState.FAILED]:    [AgentState.IDLE, AgentState.PLANNING],   // permit retries
    [AgentState.CANCELLED]: [AgentState.IDLE, AgentState.PLANNING],
};

/** Thrown when `strictStateMachine` rejects a state change. */
export class InvalidStateTransitionError extends PersonaForgeError {
    constructor(from: AgentState, to: AgentState, agentName: string) {
        super({
            code:      'INVALID_STATE_TRANSITION',
            message:   `Invalid state transition '${from}' → '${to}' for agent '${agentName}'`,
            retryable: false,
            context:   { from, to, agentName },
        });
        this.name = 'InvalidStateTransitionError';
    }
}

/**
 * Abstract base class providing common agent functionality
 */
export abstract class BaseAgent implements Agent {
    readonly id: EntityId;
    name: string;
    instructions: string = '';
    state: AgentState = AgentState.IDLE;
    readonly config: AgentConfig;
    readonly hooks: AgentHooks;
    protected startTime?: Date;
    protected iterationCount = 0;
    protected logger: DebugLogger;

    /** Guards the one-time deprecation warning for `runWithContext`. */
    private static _legacyRunWarned = false;
    private static _warnLegacyRunOnce(): void {
        if (BaseAgent._legacyRunWarned) return;
        BaseAgent._legacyRunWarned = true;
        console.warn(
            '[personaforge] BaseAgent.runWithContext is deprecated: it returns AgentOutput{state: FAILED} ' +
            'on error instead of throwing typed errors. Migrate to AgentRunner (personaforge/core) or ' +
            'createAgent (personaforge/agentic). This shim will be removed in a future major.',
        );
    }

    constructor(config: AgentConfig) {
        this.config = config;
        this.id = config.id ?? generateEntityId();
        this.name = config.name;
        this.hooks = {};
        this.logger = createDebugLogger(`Agent:${this.name}`, config.debug ?? false);
    }

    async setState(newState: AgentState, _ctx: AgentContext): Promise<void> {
        const old = this.state;
        // Strict mode: reject illegal transitions with a typed error. Opt-in via
        // AgentConfig.strictStateMachine; default preserves permissive behaviour.
        if (this.config.strictStateMachine && old !== newState) {
            const allowed = AGENT_TRANSITIONS[old];
            if (!allowed || !allowed.includes(newState)) {
                throw new InvalidStateTransitionError(old, newState, this.name);
            }
        }
        this.state = newState;
        if (this.hooks.onStateChange) await this.hooks.onStateChange(old, newState, _ctx);
    }

    // These must be implemented by concrete subclasses (Agent interface)
    abstract run(prompt: string | MultiModalInput, options?: AgentRunOptions): Promise<AgentRunResult>;
    abstract stream(prompt: string | MultiModalInput, options?: Omit<AgentRunOptions, 'onChunk'>): AsyncIterable<string>;
    abstract streamEvents(prompt: string | MultiModalInput, options?: Omit<AgentRunOptions, 'onChunk'>): AsyncIterable<StreamChunk>;
    abstract createSession(userId?: string): Promise<string>;
    abstract getSessionMessages(sessionId: string): Promise<Message[]>;
    abstract withSession(sessionId: string): { run: BaseAgent['run']; stream: BaseAgent['stream']; streamEvents: BaseAgent['streamEvents'] };

    /**
     * Internal execution method with lifecycle hooks (contracts-level `AgentInput`/`AgentOutput`).
     * Subclasses that use the older `AgentInput`/`AgentOutput` contract should call this.
     *
     * @deprecated Use `AgentRunner` (from `personaforge/core`) or `createAgent`
     *   (from `personaforge/agentic`) for new code. This method swallows errors
     *   into `AgentOutput{state: FAILED}` instead of throwing typed
     *   `PersonaForgeError`s and is kept only for backwards compatibility.
     *   Will be removed in a future major.
     */
    async runWithContext(input: AgentInput, ctx: AgentContext): Promise<AgentOutput> {
        BaseAgent._warnLegacyRunOnce();
        this.startTime = new Date();
        this.iterationCount = 0;

        this.logger.logStart('Agent execution', {
            agentId: this.id,
            prompt: input.prompt.slice(0, 100),
        });

        try {
            // Before execution hook
            if (this.hooks.beforeExecution) {
                this.logger.debug('Running beforeExecution hook');
                await this.hooks.beforeExecution(input, ctx);
            }

            // Set state to planning
            this.logger.logStateChange('Agent', this.state, AgentState.PLANNING);
            await this.setState(AgentState.PLANNING, ctx);

            // Execute the agent-specific logic
            this.logger.debug('Executing agent logic');
            const result = await this.execute(input, ctx);

            // Set state to completed
            this.logger.logStateChange('Agent', this.state, AgentState.COMPLETED);
            await this.setState(AgentState.COMPLETED, ctx);

            const output = this.createOutput(result, AgentState.COMPLETED);

            // After execution hook
            if (this.hooks.afterExecution) {
                this.logger.debug('Running afterExecution hook');
                await this.hooks.afterExecution(output, ctx);
            }

            this.logger.logComplete('Agent execution', output.metadata?.durationMs);
            return output;
        } catch (error) {
            // Set state to failed
            this.logger.logStateChange('Agent', this.state, AgentState.FAILED);
            await this.setState(AgentState.FAILED, ctx);

            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('Agent execution failed', undefined, { error: errorMessage });

            const errorOutput = this.createOutput(errorMessage, AgentState.FAILED);

            // Error hook
            if (this.hooks.onError) {
                await this.hooks.onError(error instanceof Error ? error : new Error(errorMessage), ctx);
            }

            // Error contract: when `throwOnError` is opted in, re-throw the typed
            // error instead of swallowing it into a FAILED output. The runner + HTTP
            // boundary convention (runners throw; adapters convert to Result) then
            // holds even on the legacy path.
            if (this.config.throwOnError) {
                throw error instanceof Error ? error : new Error(errorMessage);
            }

            return errorOutput;
        }
    }

    /**
     * Execute the agent's core logic - must be implemented by subclasses
     */
    protected abstract execute(input: AgentInput, ctx: AgentContext): Promise<unknown>;

    /**
     * Increment iteration counter
     */
    protected incrementIteration(): void {
        this.iterationCount++;
    }

    /**
     * Check if max iterations reached
     */
    protected isMaxIterationsReached(): boolean {
        if (!this.config.maxIterations) return false;
        return this.iterationCount >= this.config.maxIterations;
    }

    /**
     * Create an agent output with metadata
     */
    protected createOutput(result: unknown, state: AgentState): AgentOutput {
        const endTime = new Date();
        const startTime = this.startTime ?? endTime;
        const durationMs = endTime.getTime() - startTime.getTime();

        const metadata: ExecutionMetadata = {
            startTime,
            endTime,
            durationMs,
            iterations: this.iterationCount,
        };

        return {
            result,
            state,
            metadata,
        };
    }

    /**
     * Check if agent is currently executing
     */
    isExecuting(): boolean {
        return this.state === AgentState.EXECUTING || this.state === AgentState.PLANNING;
    }

    /**
     * Check if agent has completed
     */
    isCompleted(): boolean {
        return this.state === AgentState.COMPLETED;
    }

    /**
     * Check if agent has failed
     */
    hasFailed(): boolean {
        return this.state === AgentState.FAILED;
    }
}
