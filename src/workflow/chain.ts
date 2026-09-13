/**
 * Fluent workflow chain: `defineStep` / `defineWorkflow`.
 *
 * Complements the agent-pipeline `compose()` and the `branching` helpers with
 * a step-DAG builder: `.then()/.parallel()/.branch()/.foreach()`, zod I/O
 * validation, suspend/resume with schemas, per-run snapshots, and replayable
 * snapshot history.
 */

import { z } from 'zod';

/** Thrown internally to pause a run until `resume()` supplies data. */
export class WorkflowSuspended extends Error {
  readonly stepId: string;
  readonly suspendData: unknown;
  constructor(stepId: string, suspendData: unknown = {}) {
    super(`Workflow suspended at step "${stepId}"`);
    this.name = 'WorkflowSuspended';
    this.stepId = stepId;
    this.suspendData = suspendData;
  }
}

export interface ChainStepContext<TInput = unknown> {
  readonly inputData: TInput;
  readonly runId: string;
  readonly abortSignal?: AbortSignal;
  suspend: (suspendData?: unknown) => never;
  [key: string]: unknown;
}

export interface DefineStepOptions<TInput = unknown, TOutput = unknown> {
  readonly id: string;
  readonly description?: string;
  readonly inputSchema?: z.ZodType<TInput> | unknown;
  readonly outputSchema?: z.ZodType<TOutput> | unknown;
  readonly suspendSchema?: z.ZodType<unknown> | unknown;
  readonly resumeSchema?: z.ZodType<unknown> | unknown;
  readonly execute: (
    args: { inputData: TInput },
    ctx: ChainStepContext<TInput>,
  ) => Promise<TOutput> | TOutput;
}

export interface ChainStep<TInput = unknown, TOutput = unknown> {
  readonly id: string;
  readonly description?: string;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  readonly suspendSchema: unknown;
  readonly resumeSchema: unknown;
  execute: DefineStepOptions<TInput, TOutput>['execute'];
}

export function defineStep<TInput = unknown, TOutput = unknown>(
  options: DefineStepOptions<TInput, TOutput>,
): ChainStep<TInput, TOutput> {
  return {
    id: options.id,
    description: options.description,
    inputSchema: options.inputSchema ?? z.unknown(),
    outputSchema: options.outputSchema ?? z.unknown(),
    suspendSchema: options.suspendSchema ?? z.unknown(),
    resumeSchema: options.resumeSchema ?? z.unknown(),
    execute: options.execute,
  };
}

type Node =
  | { kind: 'step'; step: ChainStep }
  | { kind: 'parallel'; steps: ChainStep[] }
  | { kind: 'branch'; branches: Array<{ condition: (input: unknown) => boolean | Promise<boolean>; step: ChainStep }> }
  | { kind: 'foreach'; step: ChainStep };

export interface ChainSnapshot {
  readonly runId: string;
  readonly status: 'running' | 'suspended' | 'completed' | 'failed';
  readonly currentNode: number;
  readonly results: Record<string, unknown>;
  readonly suspendedStep?: string;
  readonly suspendData?: unknown;
  readonly history: Array<{ node: number; stepId: string; at: string }>;
}

export interface ChainRunResult {
  readonly status: 'completed' | 'suspended' | 'failed';
  readonly result?: unknown;
  readonly suspendedStep?: string;
  readonly suspendData?: unknown;
  readonly snapshot: ChainSnapshot;
  /** Failure reason when status is 'failed' (e.g. abort, step throw). */
  readonly error?: string;
}

function isZodSchema(s: unknown): s is z.ZodType<unknown> {
  return typeof s === 'object' && s !== null && 'safeParse' in (s as Record<string, unknown>);
}

function validate(schema: unknown, data: unknown, label: string): void {
  if (isZodSchema(schema)) {
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new Error(`[workflow] invalid ${label}: ${parsed.error.message}`);
  }
}

let runCounter = 0;

export class WorkflowChain {
  readonly id: string;
  readonly description?: string;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
  private nodes: Node[] = [];
  private readonly snapshots = new Map<string, ChainSnapshot[]>();

  constructor(options: { id: string; description?: string; inputSchema?: unknown; outputSchema?: unknown }) {
    this.id = options.id;
    this.description = options.description;
    this.inputSchema = options.inputSchema ?? z.unknown();
    this.outputSchema = options.outputSchema ?? z.unknown();
  }

  then(step: ChainStep): this {
    this.nodes.push({ kind: 'step', step });
    return this;
  }

  parallel(steps: ChainStep[]): this {
    this.nodes.push({ kind: 'parallel', steps });
    return this;
  }

  branch(
    branches:
      | Array<[condition: (input: unknown) => boolean | Promise<boolean>, step: ChainStep]>
      | Array<{ condition: (input: unknown) => boolean | Promise<boolean>; step: ChainStep }>
      | { condition: (input: unknown) => boolean | Promise<boolean>; trueStep: ChainStep; falseStep?: ChainStep },
  ): this {
    if (!Array.isArray(branches)) {
      const b = branches;
      this.nodes.push({
        kind: 'branch',
        branches: b.falseStep
          ? [
              { condition: b.condition, step: b.trueStep },
              { condition: async () => true, step: b.falseStep },
            ]
          : [{ condition: b.condition, step: b.trueStep }],
      });
      return this;
    }
    this.nodes.push({
      kind: 'branch',
      branches: (branches as Array<[ (input: unknown) => boolean | Promise<boolean>, ChainStep] | { condition: (input: unknown) => boolean | Promise<boolean>; step: ChainStep }>).map(
        (entry) => (Array.isArray(entry) ? { condition: entry[0], step: entry[1] } : entry),
      ),
    });
    return this;
  }

  foreach(step: ChainStep): this {
    this.nodes.push({ kind: 'foreach', step });
    return this;
  }

  get stepCount(): number {
    return this.nodes.length;
  }

  createRun(options?: { runId?: string }): WorkflowChainRun {
    runCounter += 1;
    return new WorkflowChainRun(this, options?.runId ?? `${this.id}-run-${Date.now()}-${runCounter}`);
  }

  /** @internal */
  _getNodes(): Node[] {
    return this.nodes;
  }

  /** @internal */
  _recordSnapshot(runId: string, snapshot: ChainSnapshot): void {
    const list = this.snapshots.get(runId) ?? [];
    list.push(snapshot);
    this.snapshots.set(runId, list);
  }

  /** Snapshot history for a run (replay / time-travel). */
  getSnapshots(runId: string): ChainSnapshot[] {
    return [...(this.snapshots.get(runId) ?? [])];
  }
}

export function defineWorkflow(options: { id: string; description?: string; inputSchema?: unknown; outputSchema?: unknown }): WorkflowChain {
  return new WorkflowChain(options);
}

export class WorkflowChainRun {
  private currentNode = 0;
  private results: Record<string, unknown> = {};
  private suspendedStep?: string;
  private suspendData?: unknown;
  private history: Array<{ node: number; stepId: string; at: string }> = [];

  constructor(
    private readonly workflow: WorkflowChain,
    readonly runId: string,
  ) {}

  private snapshot(status: ChainSnapshot['status']): ChainSnapshot {
    const snap: ChainSnapshot = {
      runId: this.runId,
      status,
      currentNode: this.currentNode,
      results: { ...this.results },
      history: [...this.history],
      ...(this.suspendedStep ? { suspendedStep: this.suspendedStep } : {}),
      ...(this.suspendData !== undefined ? { suspendData: this.suspendData } : {}),
    };
    this.workflow._recordSnapshot(this.runId, snap);
    return snap;
  }

  getSnapshot(): ChainSnapshot {
    return this.snapshot(this.suspendedStep ? 'suspended' : 'running');
  }

  private findStep(stepId: string): ChainStep | undefined {
    for (const node of this.workflow._getNodes()) {
      if (node.kind === 'step' && node.step.id === stepId) return node.step;
      if (node.kind === 'parallel') {
        const found = node.steps.find((s) => s.id === stepId);
        if (found) return found;
      }
      if (node.kind === 'branch') {
        const found = node.branches.map((b) => b.step).find((s) => s.id === stepId);
        if (found) return found;
      }
      if (node.kind === 'foreach' && node.step.id === stepId) return node.step;
    }
    return undefined;
  }

  private stepContext<TInput>(stepId: string, inputData: TInput, extra?: Record<string, unknown>): ChainStepContext<TInput> {
    return {
      inputData,
      runId: this.runId,
      ...extra,
      suspend: (data: unknown = {}): never => {
        const step = this.findStep(stepId);
        if (step && isZodSchema(step.suspendSchema)) validate(step.suspendSchema, data, `suspendData for step "${stepId}"`);
        throw new WorkflowSuspended(stepId, data);
      },
    };
  }

  private async runStep(step: ChainStep, input: unknown, extra?: Record<string, unknown>): Promise<unknown> {
    (extra?.['abortSignal'] as AbortSignal | undefined)?.throwIfAborted();
    validate(step.inputSchema, input, `input for step "${step.id}"`);
    const output = await step.execute({ inputData: input }, this.stepContext(step.id, input, extra));
    validate(step.outputSchema, output, `output for step "${step.id}"`);
    return output;
  }

  async start(options?: { inputData?: unknown; abortSignal?: AbortSignal }): Promise<ChainRunResult> {
    const nodes = this.workflow._getNodes();
    validate(this.workflow.inputSchema, options?.inputData, 'workflow input');
    let current: unknown = options?.inputData;
    const extra = { abortSignal: options?.abortSignal };
    try {
      for (; this.currentNode < nodes.length; this.currentNode++) {
        const node = nodes[this.currentNode]!;
        if (node.kind === 'step') {
          current = await this.runStep(node.step, current, extra);
          this.results[node.step.id] = current;
          this.history.push({ node: this.currentNode, stepId: node.step.id, at: new Date().toISOString() });
        } else if (node.kind === 'parallel') {
          const outputs = await Promise.all(node.steps.map((s) => this.runStep(s, current, extra)));
          const merged: Record<string, unknown> = {};
          node.steps.forEach((s, i) => {
            merged[s.id] = outputs[i];
            this.results[s.id] = outputs[i];
          });
          current = merged;
          this.history.push({ node: this.currentNode, stepId: `parallel(${node.steps.map((s) => s.id).join(',')})`, at: new Date().toISOString() });
        } else if (node.kind === 'branch') {
          for (const b of node.branches) {
            if (await b.condition(current)) {
              current = await this.runStep(b.step, current, extra);
              this.results[b.step.id] = current;
              this.history.push({ node: this.currentNode, stepId: b.step.id, at: new Date().toISOString() });
              break;
            }
          }
        } else {
          const items = Array.isArray(current) ? current : [current];
          const outputs: unknown[] = [];
          for (const item of items) outputs.push(await this.runStep(node.step, item, extra));
          current = outputs;
          this.results[node.step.id] = current;
          this.history.push({ node: this.currentNode, stepId: `foreach(${node.step.id})`, at: new Date().toISOString() });
        }
        this.snapshot('running');
      }
      validate(this.workflow.outputSchema, current, 'workflow output');
      this.currentNode = nodes.length;
      return { status: 'completed', result: current, snapshot: this.snapshot('completed') };
    } catch (err) {
      if (err instanceof WorkflowSuspended) {
        this.suspendedStep = err.stepId;
        this.suspendData = err.suspendData;
        return { status: 'suspended', suspendedStep: err.stepId, suspendData: err.suspendData, snapshot: this.snapshot('suspended') };
      }
      return { status: 'failed', error: err instanceof Error ? err.message : String(err), snapshot: this.snapshot('failed') };
    }
  }

  async resume(options: { step: string | ChainStep; resumeData?: unknown }): Promise<ChainRunResult> {
    const stepId = typeof options.step === 'string' ? options.step : options.step.id;
    const step = this.findStep(stepId);
    if (!step) throw new Error(`[workflow] cannot resume: unknown step "${stepId}"`);
    if (this.suspendedStep && this.suspendedStep !== stepId) {
      throw new Error(`[workflow] cannot resume step "${stepId}": run is suspended at "${this.suspendedStep}"`);
    }
    validate(step.resumeSchema, options.resumeData, `resumeData for step "${stepId}"`);
    this.results[stepId] = options.resumeData;
    this.suspendedStep = undefined;
    this.suspendData = undefined;
    this.currentNode += 1;
    this.history.push({ node: this.currentNode, stepId: `${stepId}:resumed`, at: new Date().toISOString() });
    let current: unknown = options.resumeData;
    try {
      const nodes = this.workflow._getNodes();
      for (; this.currentNode < nodes.length; this.currentNode++) {
        const node = nodes[this.currentNode]!;
        if (node.kind === 'step') {
          current = await this.runStep(node.step, current);
          this.results[node.step.id] = current;
          this.history.push({ node: this.currentNode, stepId: node.step.id, at: new Date().toISOString() });
        } else if (node.kind === 'parallel') {
          const outputs = await Promise.all(node.steps.map((s) => this.runStep(s, current)));
          const merged: Record<string, unknown> = {};
          node.steps.forEach((s, i) => {
            merged[s.id] = outputs[i];
            this.results[s.id] = outputs[i];
          });
          current = merged;
        } else if (node.kind === 'branch') {
          for (const b of node.branches) {
            if (await b.condition(current)) {
              current = await this.runStep(b.step, current);
              this.results[b.step.id] = current;
              break;
            }
          }
        } else {
          const items = Array.isArray(current) ? current : [current];
          const outputs: unknown[] = [];
          for (const item of items) outputs.push(await this.runStep(node.step, item));
          current = outputs;
          this.results[node.step.id] = current;
        }
        this.snapshot('running');
      }
      return { status: 'completed', result: current, snapshot: this.snapshot('completed') };
    } catch (err) {
      if (err instanceof WorkflowSuspended) {
        this.suspendedStep = err.stepId;
        this.suspendData = err.suspendData;
        return { status: 'suspended', suspendedStep: err.stepId, suspendData: err.suspendData, snapshot: this.snapshot('suspended') };
      }
      return { status: 'failed', error: err instanceof Error ? err.message : String(err), snapshot: this.snapshot('failed') };
    }
  }
}
