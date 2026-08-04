/**
 * Agent Swarm Implementation
 *
 * Key concepts:
 * - Orchestrator decomposes tasks into parallelizable subtasks
 * - Dynamic subagent instantiation (up to 100 sub-agents)
 * - Parallel execution across coordinated steps
 * - Critical path optimization for latency reduction
 * - No predefined roles or hand-crafted workflows
 */

import type { OrchestrableAgent, AgentInput, AgentOutput, AgentContext, EntityId } from '../core/types.js';
import { AgentState } from '../core/types.js';
import type { AgentRole, MessageBus } from '../core/types.js';
import { MessageBusImpl } from '../core/message-bus.js';
import { createRunnableAgent, type RunnableAgentConfig } from '../core/agent-adapter.js';
import { AgentContextBuilder } from '../_context-builder.js';
import { InMemoryStore } from '../../memory/index.js';
import { ToolRegistryImpl } from '../../tools/index.js';
import { ClassicalPlanner } from '../../planner/index.js';
import { PlanningAlgorithm } from '../../planner/index.js';
import type { LLMProvider, Message, GenerateOptions } from '../../core/index.js';
import { OpenAIProvider } from '../../providers/index.js';
import { createOpenRouterProvider } from '../../providers/index.js';
import { resolveModelString, isModelString, LLAMABARN_BASE_URL } from '../../providers/index.js';
import { DebugLogger, createDebugLogger } from '../../shared/index.js';
import { newId } from '../../contracts/index.js';

/**
 * Subagent template for dynamic instantiation
 */
export interface SubagentTemplate {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly capabilities: string[];
    readonly specialization: string;
    readonly maxConcurrentTasks?: number;
}

/**
 * A decomposed subtask ready for parallel execution
 */
export interface Subtask {
    readonly id: EntityId;
    readonly description: string;
    readonly specialization: string;
    readonly dependencies: EntityId[];
    readonly estimatedComplexity: number; // 1-10 scale
    readonly input: AgentInput;
}

/**
 * Execution stage for critical path optimization
 */
export interface ExecutionStage {
    readonly id: EntityId;
    readonly subtasks: Subtask[];
    readonly stageNumber: number;
    readonly canParallelize: boolean;
}

/**
 * Subagent instance created dynamically
 */
export interface SubagentInstance {
    readonly id: EntityId;
    readonly templateId: string;
    readonly agent: OrchestrableAgent;
    readonly role: AgentRole;
    assignedSubtasks: EntityId[];
    readonly createdAt: Date;
    active: boolean;
}

/**
 * Result from a subtask execution
 */
export interface SubtaskResult {
    readonly subtaskId: EntityId;
    readonly subagentId: EntityId;
    readonly output: AgentOutput;
    readonly executionTimeMs: number;
    readonly completedAt: Date;
}

/**
 * Critical path metrics for optimization
 */
export interface CriticalPathMetrics {
    readonly totalStages: number;
    readonly criticalSteps: number;
    readonly parallelEfficiency: number; // 0-1 scale
    readonly orchestrationOverheadMs: number;
    readonly slowestSubagentTimeMs: number;
}

/**
 * Swarm execution result
 */
export interface SwarmResult {
    readonly taskId: EntityId;
    readonly status: 'success' | 'partial' | 'failed';
    readonly results: Map<EntityId, SubtaskResult>;
    readonly aggregatedOutput: unknown;
    readonly executionTimeMs: number;
    readonly metrics: CriticalPathMetrics;
    readonly subagentCount: number;
}

/**
 * LLM configuration for swarm subagents
 */
export interface SwarmLLMConfig {
    /** 
     * LLM provider to use for subagents.
     * Can be a provider instance, a model string (e.g., "openrouter:meta-llama/llama-3.3-70b-instruct"),
     * or "default" to use placeholder logic.
     */
    readonly provider?: LLMProvider | string;
    /** 
     * Model identifier for OpenRouter or other providers.
     * Examples: "meta-llama/llama-3.3-70b-instruct", "openai/gpt-oss-20b"
     */
    readonly model?: string;
    /** Temperature for LLM generation (default: 0.7) */
    readonly temperature?: number;
    /** Maximum tokens for LLM generation */
    readonly maxTokens?: number;
    /** OpenRouter API key (if using OpenRouter) */
    readonly openRouterApiKey?: string;
    /** OpenAI API key (if using OpenAI) */
    readonly openAIApiKey?: string;
    /** Base URL for custom endpoints */
    readonly baseURL?: string;
    /** LlamaBarn API key (if using LlamaBarn) */
    readonly llamaBarnApiKey?: string;
}

/**
 * Configuration for the swarm orchestrator
 */
export interface SwarmConfig {
    /** Maximum number of subagents that can be instantiated (default: 100) */
    readonly maxSubagents?: number;
    /** Maximum number of parallel execution stages (default: 1500) */
    readonly maxStages?: number;
    /** Timeout for individual subtask execution (default: 30000ms) */
    readonly subtaskTimeoutMs?: number;
    /** Enable critical path optimization (default: true) */
    readonly enableCriticalPathOptimization?: boolean;
    /** Minimum parallelism threshold to avoid serial collapse (default: 2) */
    readonly minParallelism?: number;
    /** Templates for dynamic subagent creation */
    readonly subagentTemplates?: SubagentTemplate[];
    /** LLM configuration for subagents */
    readonly llm?: SwarmLLMConfig;
    /** Maximum parallel subtasks per stage (default: 8, max: 32) */
    readonly concurrency?: number;
    /** Enable debug logging (default: false) */
    readonly debug?: boolean;
    /** Memory store for subagent contexts (defaults to InMemoryStore). */
    readonly memoryStore?: import('../../memory/index.js').MemoryStore;
}

/**
 * Task decomposition result
 */
interface TaskDecomposition {
    readonly subtasks: Subtask[];
    readonly stages: ExecutionStage[];
    readonly estimatedTotalComplexity: number;
}

/**
 * Swarm Orchestrator
 *
 * The orchestrator:
 * 1. Decomposes complex tasks into parallelizable subtasks
 * 2. Dynamically instantiates specialized subagents
 * 3. Executes subtasks across stages optimizing for critical path
 * 4. Aggregates results and manages subagent lifecycle
 */
export class SwarmOrchestrator {
    private config: Required<SwarmConfig>;
    /** @internal Message bus for inter-agent communication */
    messageBus: MessageBus;
    private subagents: Map<EntityId, SubagentInstance> = new Map();
    private templates: Map<string, SubagentTemplate> = new Map();
    private _isRunning = false;
    private logger: DebugLogger;

    private llmProvider: LLMProvider | undefined;

    constructor(config: SwarmConfig = {}, messageBus?: MessageBus) {
        this.config = {
            maxSubagents: config.maxSubagents ?? 100,
            maxStages: config.maxStages ?? 1500,
            subtaskTimeoutMs: config.subtaskTimeoutMs ?? 30000,
            enableCriticalPathOptimization: config.enableCriticalPathOptimization ?? true,
            minParallelism: config.minParallelism ?? 2,
            subagentTemplates: config.subagentTemplates ?? defaultTemplates,
            llm: config.llm ?? {},
            concurrency: config.concurrency ?? 8,
            debug: config.debug ?? false,
            memoryStore: config.memoryStore ?? new InMemoryStore(),
        };
        this.messageBus = messageBus ?? new MessageBusImpl();
        this.llmProvider = this.initializeLLMProvider(config.llm);
        this.logger = createDebugLogger('Swarm', this.config.debug);

        // Register templates
        for (const template of this.config.subagentTemplates) {
            this.templates.set(template.id, template);
        }

        this.logger.logStart('SwarmOrchestrator initialization', {
            maxSubagents: this.config.maxSubagents,
            maxStages: this.config.maxStages,
            debug: this.config.debug,
        });
    }

    /**
     * Initialize LLM provider from configuration
     */
    private initializeLLMProvider(llmConfig?: SwarmLLMConfig): LLMProvider | undefined {
        if (!llmConfig) {
            return undefined;
        }

        // If a provider instance is passed directly, use it
        if (llmConfig.provider && typeof llmConfig.provider === 'object') {
            return llmConfig.provider;
        }

        // If a model string is passed (e.g., "openrouter:meta-llama/llama-3.3-70b-instruct")
        if (typeof llmConfig.provider === 'string' && isModelString(llmConfig.provider)) {
            const resolved = resolveModelString(llmConfig.provider);
            if (resolved) {
                return new OpenAIProvider({
                    apiKey: resolved.apiKey,
                    baseURL: resolved.baseURL,
                    model: resolved.model,
                });
            }
        }

        // If model is specified but no provider, try to infer from model string
        if (llmConfig.model) {
            // Check if model string is a provider:model format
            if (isModelString(llmConfig.model)) {
                const resolved = resolveModelString(llmConfig.model);
                if (resolved) {
                    return new OpenAIProvider({
                        apiKey: resolved.apiKey ?? llmConfig.openRouterApiKey ?? llmConfig.openAIApiKey ?? llmConfig.llamaBarnApiKey,
                        baseURL: resolved.baseURL ?? llmConfig.baseURL,
                        model: resolved.model,
                    });
                }
            }

            // If it looks like an OpenRouter model (contains "/")
            if (llmConfig.model.includes('/')) {
                return createOpenRouterProvider({
                    apiKey: llmConfig.openRouterApiKey ?? process.env.OPENROUTER_API_KEY ?? '',
                    model: llmConfig.model,
                });
            }

            // Check for LlamaBarn GPT-OSS models
            if (llmConfig.model.toLowerCase().includes('gpt-oss')) {
                return new OpenAIProvider({
                    apiKey: llmConfig.llamaBarnApiKey ?? process.env.LLAMABARN_API_KEY ?? 'not-needed',
                    baseURL: llmConfig.baseURL ?? LLAMABARN_BASE_URL,
                    model: llmConfig.model,
                });
            }

            // Default to OpenAI provider with the specified model
            return new OpenAIProvider({
                apiKey: llmConfig.openAIApiKey ?? process.env.OPENAI_API_KEY,
                baseURL: llmConfig.baseURL,
                model: llmConfig.model,
            });
        }

        return undefined;
    }

    /**
     * Execute a complex task using the swarm pattern
     *
     * This is the main entry point that:
     * 1. Decomposes the task into subtasks
     * 2. Creates execution stages based on dependencies
     * 3. Dynamically instantiates subagents
     * 4. Executes stages in parallel where possible
     * 5. Aggregates results
     */
    async execute(task: AgentInput, parentContext?: AgentContext): Promise<SwarmResult> {
        const startTime = Date.now();
        const taskId = this.generateTaskId();

        this.logger.logStart(`Task execution: ${taskId}`, {
            prompt: task.prompt.slice(0, 80),
            hasLLM: !!this.llmProvider,
        });

        if (!this._isRunning) {
            await this.start();
        }

        try {
            // Step 1: Decompose task into parallelizable subtasks
            this.logger.logStep('Task decomposition', 1, 4, { taskId });
            const decomposition = await this.decomposeTask(task, parentContext);
            this.logger.logComplete('Task decomposition', undefined, {
                subtaskCount: decomposition.subtasks.length,
                stageCount: decomposition.stages.length,
            });

            // Step 2: Validate parallelism (avoid serial collapse)
            if (this.config.enableCriticalPathOptimization) {
                this.logger.logStep('Parallelism validation', 2, 4);
                this.validateParallelism(decomposition);
            }

            // Step 3: Execute stages
            this.logger.logStep('Stage execution', 3, 4, { totalStages: decomposition.stages.length });
            const results = new Map<EntityId, SubtaskResult>();
            let orchestrationOverheadMs = 0;
            let slowestSubagentTimeMs = 0;

            for (const stage of decomposition.stages) {
                const stageStart = Date.now();
                this.logger.logStart(`Stage ${stage.stageNumber}/${decomposition.stages.length}`, {
                    subtaskCount: stage.subtasks.length,
                    canParallelize: stage.canParallelize,
                });

                // Dynamically instantiate subagents for this stage
                const stageSubagents = await this.instantiateSubagentsForStage(stage);
                this.logger.debug(`Instantiated ${stageSubagents.length} subagents for stage ${stage.stageNumber}`);

                // Execute subtasks in parallel
                const stageResults = await this.executeStage(stage, stageSubagents);
                const stageTime = Date.now() - stageStart;
                this.logger.logComplete(`Stage ${stage.stageNumber}`, stageTime, {
                    resultsCount: stageResults.length,
                });

                // Track metrics
                orchestrationOverheadMs += stageTime;
                slowestSubagentTimeMs = Math.max(
                    slowestSubagentTimeMs,
                    ...stageResults.map(r => r.executionTimeMs)
                );

                // Store results
                for (const result of stageResults) {
                    results.set(result.subtaskId, result);
                }

                // Clean up subagents that are no longer needed
                await this.cleanupSubagents(stage, decomposition.stages);
            }

            // Step 4: Aggregate results
            this.logger.logStep('Result aggregation', 4, 4);
            const aggregatedOutput = await this.aggregateResults(results, task);

            const executionTimeMs = Date.now() - startTime;

            // Calculate critical path metrics
            const metrics: CriticalPathMetrics = {
                totalStages: decomposition.stages.length,
                criticalSteps: this.calculateCriticalSteps(decomposition.stages),
                parallelEfficiency: this.calculateParallelEfficiency(decomposition, results),
                orchestrationOverheadMs,
                slowestSubagentTimeMs,
            };

            const finalStatus = this.determineStatus(results, decomposition.subtasks.length);
            this.logger.logComplete(`Task ${taskId}`, executionTimeMs, {
                status: finalStatus,
                stages: metrics.totalStages,
                parallelEfficiency: `${(metrics.parallelEfficiency * 100).toFixed(1)}%`,
            });

            return {
                taskId,
                status: finalStatus,
                results,
                aggregatedOutput,
                executionTimeMs,
                metrics,
                subagentCount: this.subagents.size,
            };
        } catch (error) {
            this.logger.error(`Task ${taskId} failed`, undefined, {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        } finally {
            // Cleanup all subagents
            this.logger.debug('Cleaning up subagents...');
            await this.cleanupAllSubagents();
            this.logger.debug('Cleanup complete');
        }
    }

    /**
     * Decompose a complex task into parallelizable subtasks
     *
     * This mimics the PARL orchestrator's task decomposition capability
     */
    private async decomposeTask(
        task: AgentInput,
        _parentContext?: AgentContext
    ): Promise<TaskDecomposition> {
        // Use the configured LLM to decompose intelligently; fall back to the
        // keyword-based heuristic only when no LLM is available.
        const subtasks = this.llmProvider
            ? await this.llmDecomposition(task)
            : this.ruleBasedDecomposition(task);

        // Build execution stages based on dependencies
        const stages = this.buildExecutionStages(subtasks);

        const estimatedTotalComplexity = subtasks.reduce(
            (sum, s) => sum + s.estimatedComplexity,
            0
        );

        return { subtasks, stages, estimatedTotalComplexity };
    }

    /**
     * LLM-driven decomposition: ask the model to split the task into independent
     * subtasks, returned as a validated JSON array. Falls back to the rule-based
     * heuristic if the model returns nothing usable.
     */
    private async llmDecomposition(task: AgentInput): Promise<Subtask[]> {
        const maxSubtasks = Math.max(2, Math.min(6, this.config.maxSubagents));
        const messages: Message[] = [
            {
                role: 'system',
                content:
                    'You decompose a complex task into independent, parallelizable subtasks for a swarm of ' +
                    `specialist agents. Return ONLY a JSON array (no prose, no markdown fences) of at most ${maxSubtasks} ` +
                    'objects, each: {"description": string, "specialization": ' +
                    '"researcher"|"developer"|"analyst"|"writer"|"generalist", ' +
                    '"dependsOn": number[] (indices of earlier subtasks that must finish first; [] if none), ' +
                    '"complexity": integer 1-10}.',
            },
            { role: 'user', content: `Task: ${task.prompt}` },
        ];
        const options: GenerateOptions = {
            temperature: this.config.llm?.temperature ?? 0.2,
            maxTokens: this.config.llm?.maxTokens,
        };
        const result = await this.llmProvider!.generateText(messages, options);
        const parsed = this.parseDecomposition(result.text, task);
        if (parsed.length === 0) {
            this.logger.debug('LLM decomposition returned no usable subtasks; using rule-based fallback');
            return this.ruleBasedDecomposition(task);
        }
        return parsed;
    }

    /**
     * Parse + validate an LLM decomposition response into Subtasks. Tolerates
     * surrounding prose/fences by extracting the first JSON array. Dependencies
     * may only reference earlier subtasks, which keeps the dependency graph acyclic.
     */
    private parseDecomposition(text: string, task: AgentInput): Subtask[] {
        const match = text.match(/\[[\s\S]*\]/);
        if (!match) return [];
        let raw: unknown;
        try {
            raw = JSON.parse(match[0]);
        } catch {
            return [];
        }
        if (!Array.isArray(raw)) return [];

        const subtasks: Subtask[] = [];
        raw.forEach((item, i) => {
            if (!item || typeof item !== 'object') return;
            const o = item as Record<string, unknown>;
            const description = typeof o.description === 'string' && o.description.trim()
                ? o.description.trim()
                : `Subtask ${i + 1}`;
            const specialization = typeof o.specialization === 'string' && o.specialization.trim()
                ? o.specialization.trim()
                : 'generalist';
            const dependsOn = Array.isArray(o.dependsOn)
                ? o.dependsOn.filter((d): d is number => Number.isInteger(d) && d >= 0 && d < i)
                : [];
            const complexity = Number.isInteger(o.complexity)
                ? Math.min(10, Math.max(1, o.complexity as number))
                : 5;
            subtasks.push({
                id: `subtask-${i + 1}`,
                description,
                specialization,
                dependencies: dependsOn.map(d => `subtask-${d + 1}`),
                estimatedComplexity: complexity,
                input: {
                    prompt: `${description}\n\nOverall task: ${task.prompt}`,
                    context: task.context,
                },
            });
        });
        return subtasks;
    }

    /**
     * Rule-based decomposition fallback, used only when no LLM is configured
     * (see {@link llmDecomposition}). Keyword heuristic — not a replacement for
     * model-driven decomposition.
     */
    private ruleBasedDecomposition(task: AgentInput): Subtask[] {
        const subtasks: Subtask[] = [];

        // Detect task type and decompose accordingly
        const prompt = task.prompt.toLowerCase();

        if (prompt.includes('research') || prompt.includes('analyze')) {
            // Research task - parallelize by aspect
            const aspects = ['background', 'current_state', 'future_trends', 'key_players'];
            for (let i = 0; i < aspects.length; i++) {
                subtasks.push({
                    id: `subtask-${i + 1}`,
                    description: `Research ${aspects[i]}`,
                    specialization: 'researcher',
                    dependencies: [],
                    estimatedComplexity: 5,
                    input: {
                        prompt: `Research the ${aspects[i]} of: ${task.prompt}`,
                        context: task.context,
                    },
                });
            }
        } else if (prompt.includes('code') || prompt.includes('develop')) {
            // Development task - parallelize by component
            const components = ['architecture', 'implementation', 'testing', 'documentation'];
            for (let i = 0; i < components.length; i++) {
                const deps = i > 0 ? [`subtask-${i}`] : [];
                subtasks.push({
                    id: `subtask-${i + 1}`,
                    description: `${components[i]} phase`,
                    specialization: 'developer',
                    dependencies: deps,
                    estimatedComplexity: 6,
                    input: {
                        prompt: `Handle the ${components[i]} for: ${task.prompt}`,
                        context: task.context,
                    },
                });
            }
        } else {
            // Generic task - create parallel subtasks
            const subtaskCount = Math.min(3, this.config.maxSubagents);
            for (let i = 0; i < subtaskCount; i++) {
                subtasks.push({
                    id: `subtask-${i + 1}`,
                    description: `Subtask ${i + 1}`,
                    specialization: 'generalist',
                    dependencies: [],
                    estimatedComplexity: 4,
                    input: {
                        prompt: `Part ${i + 1} of: ${task.prompt}`,
                        context: task.context,
                    },
                });
            }
        }

        return subtasks;
    }

    /**
     * Build execution stages from subtasks based on dependencies.
     * Uses a Map<id→subtask> so the "ready?" check is O(1) per dependency
     * instead of O(subtasks) per remaining subtask per iteration.
     */
    private buildExecutionStages(subtasks: Subtask[]): ExecutionStage[] {
        const stages: ExecutionStage[] = [];
        const completed = new Set<EntityId>();
        const remaining = new Map<EntityId, Subtask>();
        for (const s of subtasks) remaining.set(s.id, s);

        let stageNumber = 1;

        while (remaining.size > 0) {
            // Find subtasks with all dependencies satisfied — O(remaining) per stage
            const readySubtasks: Subtask[] = [];
            for (const [, s] of remaining) {
                if (s.dependencies.every(dep => completed.has(dep))) {
                    readySubtasks.push(s);
                }
            }

            if (readySubtasks.length === 0) {
                throw new Error('Circular or invalid dependency detected in subtasks');
            }

            stages.push({
                id: `stage-${stageNumber}`,
                subtasks: readySubtasks,
                stageNumber,
                canParallelize: readySubtasks.length > 1,
            });

            for (const subtask of readySubtasks) {
                completed.add(subtask.id);
                remaining.delete(subtask.id);
            }

            stageNumber++;

            if (stageNumber > this.config.maxStages) {
                throw new Error(`Exceeded maximum stages (${this.config.maxStages})`);
            }
        }

        return stages;
    }

    /**
     * Validate that we have sufficient parallelism to avoid serial collapse
     */
    private validateParallelism(decomposition: TaskDecomposition): void {
        const parallelStages = decomposition.stages.filter(s => s.canParallelize);
        const avgParallelism =
            parallelStages.reduce((sum, s) => sum + s.subtasks.length, 0) /
            (parallelStages.length || 1);

        if (avgParallelism < this.config.minParallelism && decomposition.stages.length > 1) {
            console.warn(
                `Warning: Low parallelism detected (${avgParallelism.toFixed(1)}). ` +
                `Consider restructuring tasks for better parallelization.`
            );
        }
    }

    /**
     * Dynamically instantiate subagents for a stage
     */
    private async instantiateSubagentsForStage(
        stage: ExecutionStage
    ): Promise<SubagentInstance[]> {
        const instances: SubagentInstance[] = [];

        for (const subtask of stage.subtasks) {
            const template = this.templates.get(subtask.specialization);
            if (!template) {
                throw new Error(`Unknown specialization: ${subtask.specialization}`);
            }

            // Check if we can reuse an existing subagent
            const existing = this.findReusableSubagent(template, subtask);

            if (existing) {
                this.logger.debug(`Reusing subagent ${existing.id} (${template.name}) for ${subtask.id}`);
                existing.assignedSubtasks.push(subtask.id);
                instances.push(existing);
            } else {
                // Create new subagent instance
                this.logger.debug(`Creating new subagent (${template.name}) for ${subtask.id}`);
                const instance = await this.createSubagent(template, subtask);
                instances.push(instance);
                this.subagents.set(instance.id, instance);
                this.logger.debug(`Created subagent ${instance.id}`);
            }
        }

        return instances;
    }

    /**
     * Find a reusable subagent that can handle additional tasks
     */
    private findReusableSubagent(
        template: SubagentTemplate,
        _subtask: Subtask
    ): SubagentInstance | undefined {
        for (const instance of this.subagents.values()) {
            if (
                instance.templateId === template.id &&
                instance.active &&
                instance.assignedSubtasks.length < (template.maxConcurrentTasks ?? 5)
            ) {
                return instance;
            }
        }
        return undefined;
    }

    /**
     * Create a new subagent instance from a template
     */
    private async createSubagent(
        template: SubagentTemplate,
        subtask: Subtask
    ): Promise<SubagentInstance> {
        const id = `subagent-${template.id}-${newId('worker')}`;

        // Create the agent using the adapter
        const agentConfig: RunnableAgentConfig = {
            name: `${template.name} (${id})`,
            description: template.description,
            run: async (input: AgentInput, ctx: AgentContext): Promise<AgentOutput> => {
                // Subagent execution logic
                const startTime = Date.now();
                try {
                    // In a real implementation, this would use an LLM
                    // For now, return a placeholder result
                    const result = await this.executeSubagentLogic(template, input, ctx);

                    return {
                        result,
                        state: AgentState.COMPLETED,
                        metadata: {
                            startTime: new Date(startTime),
                            iterations: 1,
                            durationMs: Date.now() - startTime,
                        },
                    };
                } catch (error) {
                    return {
                        result: error instanceof Error ? error.message : String(error),
                        state: AgentState.FAILED,
                        metadata: {
                            startTime: new Date(startTime),
                            iterations: 1,
                            durationMs: Date.now() - startTime,
                        },
                    };
                }
            },
        };

        const agent = createRunnableAgent(agentConfig);

        const role: AgentRole = {
            id: `role-${template.id}`,
            name: template.name,
            description: template.description,
            responsibilities: template.capabilities,
            permissions: {
                canExecuteTools: true,
                canAccessMemory: true,
                canCreateSubAgents: false,
                canModifyPlan: false,
            },
            canDelegate: false,
            canCommunicateWith: [],
        };

        return {
            id,
            templateId: template.id,
            agent,
            role,
            assignedSubtasks: [subtask.id],
            createdAt: new Date(),
            active: true,
        };
    }

    /**
     * System prompts for different subagent specializations
     */
    private getSystemPrompt(template: SubagentTemplate): string {
        const basePrompt = `You are a specialized AI agent: ${template.name}.
${template.description}

Your capabilities include: ${template.capabilities.join(', ')}.
Your specialization: ${template.specialization}

Provide a detailed, helpful response to the user's request.`;

        // Add specialization-specific instructions
        switch (template.specialization) {
            case 'research':
                return `${basePrompt}\n\nWhen researching:\n- Gather comprehensive information\n- Cite sources when possible\n- Synthesize findings clearly\n- Identify key trends and insights`;
            case 'development':
                return `${basePrompt}\n\nWhen developing:\n- Write clean, well-documented code\n- Follow best practices\n- Consider edge cases\n- Provide explanations for complex logic`;
            case 'analysis':
                return `${basePrompt}\n\nWhen analyzing:\n- Be thorough and data-driven\n- Identify patterns and correlations\n- Provide actionable insights\n- Support conclusions with evidence`;
            case 'writing':
                return `${basePrompt}\n\nWhen writing:\n- Create engaging, clear content\n- Adapt tone to the audience\n- Structure information logically\n- Edit for clarity and impact`;
            case 'verification':
                return `${basePrompt}\n\nWhen fact-checking:\n- Verify claims against reliable sources\n- Cross-reference information\n- Identify potential biases\n- Report confidence levels`;
            default:
                return basePrompt;
        }
    }

    /**
     * Execute subagent logic using LLM if configured, otherwise use placeholder
     */
    private async executeSubagentLogic(
        template: SubagentTemplate,
        input: AgentInput,
        _ctx: AgentContext
    ): Promise<unknown> {
        // Fail loud: without an LLM/executor we cannot produce a real result.
        // Returning a fake placeholder would silently mask a misconfiguration.
        if (!this.llmProvider) {
            throw new Error(
                `Swarm subagent "${template.name}" has no LLM/executor configured. ` +
                `Provide an LLM via SwarmConfig.llm (or inject an executor) before running the swarm.`,
            );
        }

        this.logger.debug(`Calling LLM for ${template.name}`, undefined, {
            promptPreview: input.prompt.slice(0, 60),
            model: this.config.llm?.model ?? 'unknown',
        });

        // Build messages for LLM
        const messages: Message[] = [
            { role: 'system', content: this.getSystemPrompt(template) },
            { role: 'user', content: input.prompt },
        ];

        // Add context if available
        if (input.context && Object.keys(input.context).length > 0) {
            messages.push({
                role: 'user',
                content: `Context: ${JSON.stringify(input.context, null, 2)}`,
            });
        }

        // Call LLM
        const options: GenerateOptions = {
            temperature: this.config.llm?.temperature ?? 0.7,
            maxTokens: this.config.llm?.maxTokens,
        };

        this.logger.debug(`Sending ${messages.length} messages to LLM`, undefined, {
            model: this.config.llm?.model ?? 'unknown',
        });
        const llmStartTime = Date.now();
        const result = await this.llmProvider.generateText(messages, options);
        this.logger.logComplete(`LLM call for ${template.name}`, Date.now() - llmStartTime, {
            tokens: result.usage?.totalTokens,
        });

        return {
            specialization: template.specialization,
            capabilities: template.capabilities,
            result: result.text,
            model: this.config.llm?.model ?? 'unknown',
            usage: result.usage,
        };
    }

    /**
     * Execute all subtasks in a stage in parallel
     */
    private async executeStage(
        stage: ExecutionStage,
        subagents: SubagentInstance[]
    ): Promise<SubtaskResult[]> {
        const concurrency = Math.min(this.config.concurrency ?? 8, 32);
        const results = new Array<SubtaskResult>(stage.subtasks.length);
        const queue = stage.subtasks.map((item, i) => ({ item, i }));

        const workers = Array.from({ length: Math.min(concurrency, queue.length || 1) }, async () => {
            while (queue.length > 0) {
                const task = queue.shift();
                if (!task) break;
                const subtask = task.item;
                const subagent = subagents.find(s => s.assignedSubtasks.includes(subtask.id));
                if (!subagent) {
                    throw new Error(`No subagent found for subtask ${subtask.id}`);
                }

                const startTime = Date.now();
                this.logger.logStart(`Subtask ${subtask.id}`, {
                    subagentId: subagent.id,
                    templateId: subagent.templateId,
                });

                const ctx = this.createMinimalContext(subagent.agent);

                let timer!: ReturnType<typeof setTimeout>;
                const timeoutPromise = new Promise<AgentOutput>((_, reject) => {
                    timer = setTimeout(
                        () => reject(new Error(`Subtask ${subtask.id} timed out after ${this.config.subtaskTimeoutMs}ms`)),
                        this.config.subtaskTimeoutMs
                    );
                });

                let output: AgentOutput;
                try {
                    output = await Promise.race([
                        subagent.agent.run(subtask.input, ctx),
                        timeoutPromise,
                    ]);
                } catch (error) {
                    this.logger.error(`Subtask ${subtask.id} failed`, undefined, {
                        error: error instanceof Error ? error.message : String(error),
                    });
                    throw error;
                } finally {
                    clearTimeout(timer);
                }

                this.logger.logComplete(`Subtask ${subtask.id}`, Date.now() - startTime, {
                    state: output.state,
                });
                results[task.i] = {
                    subtaskId: subtask.id,
                    subagentId: subagent.id,
                    output,
                    executionTimeMs: Date.now() - startTime,
                    completedAt: new Date(),
                };
            }
        });

        await Promise.all(workers);
        return results;
    }

    /**
     * Cleanup subagents that are no longer needed
     */
    private async cleanupSubagents(
        currentStage: ExecutionStage,
        allStages: ExecutionStage[]
    ): Promise<void> {
        const currentSubtaskIds = new Set(currentStage.subtasks.map(s => s.id));
        const futureSubtaskIds = new Set<EntityId>();

        // Collect all future subtask IDs
        let foundCurrent = false;
        for (const stage of allStages) {
            if (foundCurrent) {
                for (const subtask of stage.subtasks) {
                    futureSubtaskIds.add(subtask.id);
                }
            }
            if (stage.id === currentStage.id) {
                foundCurrent = true;
            }
        }

        // Find subagents that can be cleaned up
        for (const instance of this.subagents.values()) {
            const hasCurrentTasks = instance.assignedSubtasks.some(id => currentSubtaskIds.has(id));
            const hasFutureTasks = instance.assignedSubtasks.some(id => futureSubtaskIds.has(id));

            if (!hasCurrentTasks && !hasFutureTasks) {
                instance.active = false;
                this.subagents.delete(instance.id);
            }
        }
    }

    /**
     * Cleanup all subagents
     */
    private async cleanupAllSubagents(): Promise<void> {
        this.subagents.clear();
    }

    /**
     * Aggregate results from all subtasks
     */
    private async aggregateResults(
        results: Map<EntityId, SubtaskResult>,
        originalTask: AgentInput
    ): Promise<unknown> {
        // Structured aggregation: collate each subtask's real output keyed by id.
        // (This is a deterministic collation, not an LLM synthesis — callers that
        // want a narrative summary should run the result through a judge/agent.)
        const outputs: Record<string, unknown> = {};

        results.forEach((result, subtaskId) => {
            outputs[subtaskId] = {
                result: result.output.result,
                executionTimeMs: result.executionTimeMs,
            };
        });

        return {
            originalTask: originalTask.prompt,
            subtaskResults: outputs,
            summary: `Completed ${results.size} subtasks`,
        };
    }

    /**
     * Calculate critical steps metric
     */
    private calculateCriticalSteps(stages: ExecutionStage[]): number {
        return stages.reduce((sum, stage) => {
            // S_main: orchestration overhead per stage (constant)
            const orchestrationOverhead = 1;

            // max_i S_sub,i: slowest subagent in this stage
            const maxSubagentSteps = stage.canParallelize ? Math.max(1, stage.subtasks.length * 0.5) : 1;

            return sum + orchestrationOverhead + maxSubagentSteps;
        }, 0);
    }

    /**
     * Calculate parallel efficiency metric
     */
    private calculateParallelEfficiency(
        decomposition: TaskDecomposition,
        _results: Map<EntityId, SubtaskResult>
    ): number {
        if (decomposition.subtasks.length <= 1) return 1;

        const totalSubtasks = decomposition.subtasks.length;
        const parallelSubtasks = decomposition.stages
            .filter(s => s.canParallelize)
            .reduce((sum, s) => sum + s.subtasks.length, 0);

        return parallelSubtasks / totalSubtasks;
    }

    /**
     * Determine overall execution status
     */
    private determineStatus(
        results: Map<EntityId, SubtaskResult>,
        totalSubtasks: number
    ): 'success' | 'partial' | 'failed' {
        const completed = Array.from(results.values()).filter(
            r => r.output.state === AgentState.COMPLETED
        ).length;

        if (completed === totalSubtasks) return 'success';
        if (completed === 0) return 'failed';
        return 'partial';
    }

    /**
     * Generate unique task ID
     */
    private generateTaskId(): EntityId {
        return newId('wf');
    }

    /**
     * Create minimal context for subagent execution
     */
    private createMinimalContext(agent: OrchestrableAgent): AgentContext {
        return new AgentContextBuilder()
            .withAgentId(agent.id)
            .withMemory(this.config.memoryStore ?? new InMemoryStore())
            .withTools(new ToolRegistryImpl())
            .withPlanner(new ClassicalPlanner({ algorithm: PlanningAlgorithm.HIERARCHICAL }))
            .build();
    }

    /**
     * Start the orchestrator
     */
    async start(): Promise<void> {
        this._isRunning = true;
    }

    /**
     * Stop the orchestrator
     */
    async stop(): Promise<void> {
        this._isRunning = false;
        await this.cleanupAllSubagents();
    }

    /**
     * Check if orchestrator is running
     */
    isRunning(): boolean {
        return this._isRunning;
    }

    /**
     * Get current subagent count
     */
    getSubagentCount(): number {
        return this.subagents.size;
    }

    /**
     * Register a custom subagent template
     */
    registerTemplate(template: SubagentTemplate): void {
        this.templates.set(template.id, template);
    }

    /**
     * Get registered templates
     */
    getTemplates(): SubagentTemplate[] {
        return Array.from(this.templates.values());
    }
}

/**
 * Default subagent templates
 */
const defaultTemplates: SubagentTemplate[] = [
    {
        id: 'researcher',
        name: 'Research Agent',
        description: 'Specialized in research and information gathering',
        capabilities: ['web_search', 'data_analysis', 'synthesis'],
        specialization: 'research',
        maxConcurrentTasks: 5,
    },
    {
        id: 'developer',
        name: 'Developer Agent',
        description: 'Specialized in code development and technical tasks',
        capabilities: ['code_generation', 'debugging', 'testing'],
        specialization: 'development',
        maxConcurrentTasks: 3,
    },
    {
        id: 'analyst',
        name: 'Analyst Agent',
        description: 'Specialized in data analysis and insights',
        capabilities: ['data_processing', 'statistical_analysis', 'visualization'],
        specialization: 'analysis',
        maxConcurrentTasks: 4,
    },
    {
        id: 'writer',
        name: 'Writer Agent',
        description: 'Specialized in content creation and writing',
        capabilities: ['content_generation', 'editing', 'formatting'],
        specialization: 'writing',
        maxConcurrentTasks: 5,
    },
    {
        id: 'fact-checker',
        name: 'Fact Checker Agent',
        description: 'Specialized in verifying facts and accuracy',
        capabilities: ['verification', 'cross_reference', 'validation'],
        specialization: 'verification',
        maxConcurrentTasks: 10,
    },
    {
        id: 'generalist',
        name: 'Generalist Agent',
        description: 'General-purpose agent for various tasks',
        capabilities: ['general_task_execution', 'coordination'],
        specialization: 'general',
        maxConcurrentTasks: 5,
    },
];

/**
 * Create a swarm orchestrator with the given configuration
 */
export function createSwarm(config?: SwarmConfig): SwarmOrchestrator {
    return new SwarmOrchestrator(config);
}

/**
 * Create a swarm-based agent that can be used in the framework
 */
export function createSwarmAgent(
    name: string,
    config?: SwarmConfig
): OrchestrableAgent {
    const swarm = new SwarmOrchestrator(config);

    const run = async (input: AgentInput, _ctx: AgentContext): Promise<AgentOutput> => {
        const result = await swarm.execute(input);

        return {
            result: {
                swarmResult: result,
                aggregated: result.aggregatedOutput,
            },
            state: result.status === 'success' ? AgentState.COMPLETED : AgentState.FAILED,
            metadata: {
                startTime: new Date(Date.now() - result.executionTimeMs),
                durationMs: result.executionTimeMs,
                iterations: result.metrics.totalStages,
            },
        };
    };

    return createRunnableAgent({
        name,
        description: `Swarm-based agent using ${config?.maxSubagents ?? 100} max subagents`,
        run,
    });
}
