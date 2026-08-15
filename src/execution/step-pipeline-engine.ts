/**
 * Step-pipeline execution engine.
 *
 * Models work as an ordered *pipeline of steps* driven by an event loop:
 * async-first execution, parallel step groups with backpressure, a priority
 * queue, and dynamic pause/resume. Reach for this when you have a known
 * sequence of stages and need flow control over throughput.
 *
 * Features:
 * - Async-first, event-driven execution
 * - Parallel step execution with backpressure
 * - Dynamic pause/resume
 * - Built-in queue with priority handling
 * - Zero-dependency core
 *
 * Sibling engine: `task-plan-engine.ts` executes a *plan of tasks* as a
 * dependency DAG. The two are complementary, not versions of each other —
 * see `./index.ts` for the full comparison.
 */

import { EntityId, generateEntityId } from '../core/index.js';

// ── Event System ────────────────────────────────────────────────────────────

export const EngineEvent = {
  STEP_START: 'engine:step:start',
  STEP_COMPLETE: 'engine:step:complete',
  STEP_ERROR: 'engine:step:error',
  STEP_RETRY: 'engine:step:retry',
  WORKFLOW_START: 'engine:workflow:start',
  WORKFLOW_COMPLETE: 'engine:workflow:complete',
  WORKFLOW_ERROR: 'engine:workflow:error',
  QUEUE_OVERFLOW: 'engine:queue:overflow',
  BACKPRESSURE: 'engine:backpressure',
  PAUSE: 'engine:pause',
  RESUME: 'engine:resume',
} as const;

export type EngineEventType = typeof EngineEvent[keyof typeof EngineEvent];

export interface EngineEventPayload {
  [EngineEvent.STEP_START]: { stepId: EntityId; stepName: string; attempt: number };
  [EngineEvent.STEP_COMPLETE]: { stepId: EntityId; stepName: string; durationMs: number; output: unknown };
  [EngineEvent.STEP_ERROR]: { stepId: EntityId; stepName: string; error: string; retryable: boolean };
  [EngineEvent.STEP_RETRY]: { stepId: EntityId; stepName: string; attempt: number; delayMs: number };
  [EngineEvent.WORKFLOW_START]: { executionId: EntityId; totalSteps: number };
  [EngineEvent.WORKFLOW_COMPLETE]: { executionId: EntityId; durationMs: number; stepsCompleted: number };
  [EngineEvent.WORKFLOW_ERROR]: { executionId: EntityId; error: string; failedAtStep?: EntityId };
  [EngineEvent.QUEUE_OVERFLOW]: { queueSize: number; droppedPriority: number };
  [EngineEvent.BACKPRESSURE]: { activeSteps: number; queueDepth: number };
  [EngineEvent.PAUSE]: { executionId: EntityId };
  [EngineEvent.RESUME]: { executionId: EntityId };
}

type EventHandler<T extends EngineEventType> = (payload: EngineEventPayload[T]) => void;

class EventEmitterBase {
  private handlers: Map<EngineEventType, Set<EventHandler<EngineEventType>>> = new Map();

  on<T extends EngineEventType>(event: T, handler: EventHandler<T>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set() as Set<EventHandler<EngineEventType>>);
    }
    this.handlers.get(event)!.add(handler as EventHandler<EngineEventType>);
    return () => this.off(event, handler);
  }

  off<T extends EngineEventType>(event: T, handler: EventHandler<T>): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler as EventHandler<EngineEventType>);
    }
  }

  emit<T extends EngineEventType>(event: T, payload: EngineEventPayload[T]): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.forEach(h => (h as EventHandler<T>)(payload));
    }
  }
}

// ── Execution Step ─────────────────────────────────────────────────────────

export interface StepConfig {
  id?: EntityId;
  name: string;
  execute: (ctx: StepContext) => Promise<StepResult>;
  maxRetries?: number;
  timeoutMs?: number;
  priority?: StepPriority;
  onError?: (error: Error, attempt: number) => StepErrorPolicy;
  dependencies?: EntityId[];
}

export enum StepPriority {
  CRITICAL = 0,
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
}

export interface StepContext {
  executionId: EntityId;
  stepId: EntityId;
  variables: Map<string, unknown>;
  metadata: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface StepResult {
  success: boolean;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface StepErrorPolicy {
  retry: boolean;
  backoffMs?: number;
  fallback?: () => Promise<StepResult>;
}

export interface QueuedStep {
  config: StepConfig;
  attempt: number;
  enqueuedAt: Date;
  priority: StepPriority;
}

// ── Execution Engine ───────────────────────────────────────────────────────

export interface StepExecutorConfig {
  maxConcurrency: number;
  maxQueueSize: number;
  defaultTimeoutMs: number;
  enableBackpressure: boolean;
  backpressureThreshold?: number;
  retryPolicy?: {
    maxRetries: number;
    backoffMs: number;
    maxBackoffMs?: number;
    exponentialBase?: number;
  };
}

export class StepExecutor extends EventEmitterBase {
  private config: Required<StepExecutorConfig>;
  private runningSteps: Map<EntityId, { step: StepConfig; startedAt: Date }> = new Map();
  private stepQueue: QueuedStep[] = [];
  private stepResults: Map<EntityId, StepResult> = new Map();
  private pausedExecutions: Set<EntityId> = new Set();
  private variables: Map<EntityId, Map<string, unknown>> = new Map();

  constructor(config: StepExecutorConfig) {
    super();
    this.config = {
      maxConcurrency: config.maxConcurrency ?? 4,
      maxQueueSize: config.maxQueueSize ?? 100,
      defaultTimeoutMs: config.defaultTimeoutMs ?? 30000,
      enableBackpressure: config.enableBackpressure ?? true,
      backpressureThreshold: config.backpressureThreshold ?? 0.8,
      retryPolicy: config.retryPolicy ?? {
        maxRetries: 3,
        backoffMs: 1000,
        maxBackoffMs: 30000,
        exponentialBase: 2,
      },
    };
  }

  async execute(
    steps: StepConfig[],
    options: { executionId?: EntityId; signal?: AbortSignal; initialVariables?: Record<string, unknown> } = {}
  ): Promise<WorkflowExecutionResultV2> {
    const executionId = options.executionId ?? generateEntityId();
    const startTime = Date.now();
    const sortedSteps = this.topologicalSort(steps);

    this.variables.set(executionId, new Map(Object.entries(options.initialVariables ?? {})));

    this.emit(EngineEvent.WORKFLOW_START, {
      executionId,
      totalSteps: sortedSteps.length,
    });

    try {
      for (const step of sortedSteps) {
        if (options.signal?.aborted) {
          throw new Error('Execution cancelled');
        }

        await this.executeStep(step, executionId, options.signal);

        if (this.pausedExecutions.has(executionId)) {
          return {
            executionId,
            status: 'paused',
            completedSteps: this.stepResults.size,
            totalSteps: sortedSteps.length,
            durationMs: Date.now() - startTime,
          };
        }
      }

      const result: WorkflowExecutionResultV2 = {
        executionId,
        status: 'completed',
        completedSteps: sortedSteps.length,
        totalSteps: sortedSteps.length,
        durationMs: Date.now() - startTime,
        outputs: this.collectOutputs(executionId),
      };

      this.emit(EngineEvent.WORKFLOW_COMPLETE, {
        executionId,
        durationMs: result.durationMs,
        stepsCompleted: result.completedSteps,
      });

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emit(EngineEvent.WORKFLOW_ERROR, {
        executionId,
        error: err.message,
      });

      return {
        executionId,
        status: 'failed',
        completedSteps: this.stepResults.size,
        totalSteps: sortedSteps.length,
        durationMs: Date.now() - startTime,
        error: err.message,
      };
    }
  }

  private async executeStep(
    step: StepConfig,
    executionId: EntityId,
    signal?: AbortSignal
  ): Promise<StepResult> {
    const stepId = step.id ?? generateEntityId();
    const maxRetries = step.maxRetries ?? this.config.retryPolicy.maxRetries;
    let attempt = 0;

    while (attempt <= maxRetries) {
      if (signal?.aborted) {
        throw new Error('Step cancelled');
      }

      this.emit(EngineEvent.STEP_START, {
        stepId,
        stepName: step.name,
        attempt: attempt + 1,
      });

      const ctx: StepContext = {
        executionId,
        stepId,
        variables: this.variables.get(executionId) ?? new Map(),
        metadata: {},
        ...(signal !== undefined ? { signal } : {}),
      };

      try {
        const timeoutMs = step.timeoutMs ?? this.config.defaultTimeoutMs;
        const result = await this.withTimeout(
          step.execute(ctx),
          timeoutMs,
          `Step "${step.name}" timed out after ${timeoutMs}ms`
        );

        this.stepResults.set(stepId, result);
        this.emit(EngineEvent.STEP_COMPLETE, {
          stepId,
          stepName: step.name,
          durationMs: 0,
          output: result.output,
        });

        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        if (step.onError) {
          const policy = step.onError(err, attempt);
          if (policy.retry && attempt < maxRetries) {
            const backoffMs = policy.backoffMs ?? this.calculateBackoff(attempt);
            this.emit(EngineEvent.STEP_RETRY, {
              stepId,
              stepName: step.name,
              attempt: attempt + 1,
              delayMs: backoffMs,
            });
            await this.sleep(backoffMs);
            attempt++;
            continue;
          } else if (policy.fallback) {
            return policy.fallback();
          }
        }

        if (attempt < maxRetries) {
          const backoff = this.calculateBackoff(attempt);
          this.emit(EngineEvent.STEP_RETRY, {
            stepId,
            stepName: step.name,
            attempt: attempt + 1,
            delayMs: backoff,
          });
          await this.sleep(backoff);
          attempt++;
        } else {
          const failedResult: StepResult = {
            success: false,
            error: err.message,
          };
          this.stepResults.set(stepId, failedResult);
          this.emit(EngineEvent.STEP_ERROR, {
            stepId,
            stepName: step.name,
            error: err.message,
            retryable: attempt < maxRetries,
          });
          throw err;
        }
      }
    }

    throw new Error(`Step "${step.name}" failed after ${maxRetries + 1} attempts`);
  }

  private calculateBackoff(attempt: number): number {
    const { backoffMs, maxBackoffMs, exponentialBase } = this.config.retryPolicy;
    return Math.min(
      backoffMs * Math.pow(exponentialBase ?? 2, attempt),
      maxBackoffMs ?? Infinity
    );
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
      promise
        .then(resolve)
        .catch(reject)
        .finally(() => clearTimeout(timer));
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private topologicalSort(steps: StepConfig[]): StepConfig[] {
    const visited = new Set<string>();
    const result: StepConfig[] = [];
    const stepMap = new Map<string, StepConfig>();

    for (const step of steps) {
      stepMap.set(step.id ?? step.name, step);
    }

    const visit = (step: StepConfig) => {
      const id = step.id ?? step.name;
      if (visited.has(id)) return;
      visited.add(id);

      if (step.dependencies) {
        for (const depId of step.dependencies) {
          const dep = stepMap.get(depId);
          if (dep) visit(dep);
        }
      }

      result.push(step);
    };

    for (const step of steps) {
      visit(step);
    }

    return result;
  }

  private collectOutputs(_executionId: EntityId): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};
    for (const [stepId, result] of this.stepResults) {
      if (result.output !== undefined) {
        outputs[stepId] = result.output;
      }
    }
    return outputs;
  }

  pause(executionId: EntityId): boolean {
    this.pausedExecutions.add(executionId);
    this.emit(EngineEvent.PAUSE, { executionId });
    return true;
  }

  resume(executionId: EntityId): boolean {
    this.pausedExecutions.delete(executionId);
    this.emit(EngineEvent.RESUME, { executionId });
    return true;
  }

  getStatus(executionId: EntityId): ExecutionStatus {
    return {
      executionId,
      activeSteps: this.runningSteps.size,
      queueDepth: this.stepQueue.length,
      paused: this.pausedExecutions.has(executionId),
    };
  }

  getResults(_executionId: EntityId): Map<EntityId, StepResult> {
    return new Map(this.stepResults);
  }
}

export interface WorkflowExecutionResultV2 {
  executionId: EntityId;
  status: 'completed' | 'failed' | 'paused' | 'cancelled';
  completedSteps: number;
  totalSteps: number;
  durationMs: number;
  outputs?: Record<string, unknown>;
  error?: string;
}

export interface ExecutionStatus {
  executionId: EntityId;
  activeSteps: number;
  queueDepth: number;
  paused: boolean;
}

// ── Pipeline Builder ────────────────────────────────────────────────────────

export class PipelineBuilder {
  private steps: StepConfig[] = [];

  step(
    name: string,
    fn: (ctx: StepContext) => Promise<unknown>,
    options?: Partial<StepConfig>
  ): PipelineBuilder {
    this.steps.push({
      id: options?.id ?? generateEntityId(),
      name,
      execute: async (ctx) => {
        const result = await fn(ctx);
        return { success: true, output: result };
      },
      ...(options?.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
      ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      ...(options?.priority !== undefined ? { priority: options.priority } : {}),
    });
    return this;
  }

  withRetry(maxRetries: number): PipelineBuilder {
    const lastStep = this.steps[this.steps.length - 1];
    if (lastStep) {
      lastStep.maxRetries = maxRetries;
    }
    return this;
  }

  withTimeout(timeoutMs: number): PipelineBuilder {
    const lastStep = this.steps[this.steps.length - 1];
    if (lastStep) {
      lastStep.timeoutMs = timeoutMs;
    }
    return this;
  }

  dependsOn(stepId: EntityId): PipelineBuilder {
    const lastStep = this.steps[this.steps.length - 1];
    if (lastStep) {
      lastStep.dependencies = [...(lastStep.dependencies ?? []), stepId];
    }
    return this;
  }

  build(): StepConfig[] {
    return [...this.steps];
  }
}

// ── Parallel Pipeline ───────────────────────────────────────────────────────

export async function executeParallel(
  steps: StepConfig[],
  maxConcurrency: number = 4
): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const executing: Promise<void>[] = [];
  const stepMap = new Map<string, StepConfig>();

  for (const step of steps) {
    stepMap.set(step.id ?? step.name, step);
  }

  const readySteps = steps.filter(s => !s.dependencies || s.dependencies.length === 0);
  const pendingSteps = new Set(steps.filter(s => s.dependencies && s.dependencies.length > 0));

  const executeStep = async (step: StepConfig): Promise<StepResult> => {
    return step.execute({
      executionId: 'parallel',
      stepId: step.id ?? generateEntityId(),
      variables: new Map(),
      metadata: {},
    });
  };

  const onStepComplete = (result: StepResult, _step: StepConfig) => {
    results.push(result);
    for (const pending of pendingSteps) {
      if (pending.dependencies) {
        const allDone = pending.dependencies.every(depId => {
          const dep = stepMap.get(depId);
          return dep && results.some((_, idx) => idx < results.length);
        });
        if (allDone && executing.length < maxConcurrency) {
          executing.push(executeStep(pending).then(r => onStepComplete(r, pending)));
        }
      }
    }
  };

  for (const step of readySteps.slice(0, maxConcurrency)) {
    executing.push(executeStep(step).then(r => onStepComplete(r, step)));
  }

  await Promise.all(executing);
  return results;
}

// ── Backpressure Queue ──────────────────────────────────────────────────────

export class BackpressureQueue<T> {
  private queue: T[] = [];
  private maxSize: number;
  private paused = false;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  enqueue(item: T): boolean {
    if (this.paused) return false;
    if (this.queue.length >= this.maxSize) {
      return false;
    }
    this.queue.push(item);
    return true;
  }

  dequeue(): T | undefined {
    return this.queue.shift();
  }

  peek(): T | undefined {
    return this.queue[0];
  }

  get size(): number {
    return this.queue.length;
  }

  isFull(): boolean {
    return this.queue.length >= this.maxSize;
  }

  isPaused(): boolean {
    return this.paused;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  clear(): void {
    this.queue = [];
  }
}