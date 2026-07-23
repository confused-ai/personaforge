/**
 * GSD (Get Shit Done) Protocol — Spec-driven context engineering and project orchestration.
 *
 * Implements context-isolation through three discrete phases: Plan, Execute, and Verify.
 * Utilizes a .planning folder containing REQUIREMENTS.md, ROADMAP.md, and STATE.md to keep
 * agents aligned on tasks without polluting the conversation history.
 *
 * @example
 * ```ts
 * import { createGSDCoordinator, FilesystemGSDStorage } from 'personaforge/orchestration';
 *
 * const gsd = createGSDCoordinator({
 *   projectDir: './my-project',
 *   plannerAgent,
 *   executorAgent,
 *   verifierAgent,
 *   storage: new FilesystemGSDStorage('./my-project/.planning'),
 * });
 *
 * await gsd.plan('Implement a rate limiter class');
 * const stepResult = await gsd.executeStep();
 * const verification = await gsd.verify();
 * ```
 */

import type { Agent as CoreAgent } from '../../core/index.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Storage Interface ───────────────────────────────────────────────────────

/** Pluggable storage adapter for GSD planning specifications. */
export interface GSDStorage {
    read(file: string): Promise<string> | string;
    write(file: string, content: string): Promise<void> | void;
    exists(file: string): Promise<boolean> | boolean;
    mkdir(): Promise<void> | void;
}

/** In-Memory GSD storage (ideal for tests and light runs). */
export class InMemoryGSDStorage implements GSDStorage {
    private readonly files = new Map<string, string>();

    async read(file: string): Promise<string> {
        const val = this.files.get(file);
        if (val === undefined) throw new Error(`File not found: ${file}`);
        return val;
    }

    async write(file: string, content: string): Promise<void> {
        this.files.set(file, content);
    }

    async exists(file: string): Promise<boolean> {
        return this.files.has(file);
    }

    async mkdir(): Promise<void> {}
}

/** Local filesystem GSD storage (for production CLI and workspaces). */
export class FilesystemGSDStorage implements GSDStorage {
    private readonly dir: string;

    constructor(dir: string) {
        this.dir = path.resolve(dir);
    }

    async read(file: string): Promise<string> {
        const filePath = path.join(this.dir, file);
        return fs.promises.readFile(filePath, 'utf8');
    }

    async write(file: string, content: string): Promise<void> {
        await this.mkdir();
        const filePath = path.join(this.dir, file);
        await fs.promises.writeFile(filePath, content, 'utf8');
    }

    async exists(file: string): Promise<boolean> {
        const filePath = path.join(this.dir, file);
        try {
            await fs.promises.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async mkdir(): Promise<void> {
        await fs.promises.mkdir(this.dir, { recursive: true });
    }
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface GSDConfig {
    readonly projectDir: string;
    readonly plannerAgent: CoreAgent;
    readonly executorAgent: CoreAgent;
    readonly verifierAgent: CoreAgent;
    /** Defaults to InMemoryGSDStorage if not specified. */
    readonly storage?: GSDStorage;
}

export interface GSDState {
    status: 'PLANNING' | 'EXECUTING' | 'VERIFYING' | 'COMPLETED' | 'FAILED';
    currentStepIndex: number;
    tasks: Array<{
        id: string;
        name: string;
        description: string;
        completed: boolean;
        result?: string;
    }>;
}

// ── Implementation ─────────────────────────────────────────────────────────

export class GSDCoordinator {
    private readonly config: GSDConfig;
    private readonly storage: GSDStorage;

    constructor(config: GSDConfig) {
        this.config = config;
        this.storage = config.storage ?? new InMemoryGSDStorage();
    }

    /** Phase 1: Plan. Analyze the goal, write requirements, and generate roadmap. */
    async plan(goal: string): Promise<void> {
        await this.storage.mkdir();
        await this.storage.write('REQUIREMENTS.md', `# Project Goal & Requirements\n\n${goal}`);

        const prompt = `You are a project planner. Create a step-by-step roadmap to achieve the following goal: "${goal}".
Format your output as a JSON block matching this structure:
{
  "tasks": [
    { "id": "task_1", "name": "Task Name", "description": "Details of the task" }
  ]
}`;

        const runResult = await this.config.plannerAgent.run(prompt);
        let tasks = [];
        try {
            // Find JSON in the response
            const match = runResult.text.match(/\{[\s\S]*\}/);
            const jsonText = match ? match[0] : runResult.text;
            const parsed = JSON.parse(jsonText);
            tasks = parsed.tasks ?? [];
        } catch {
            // Fallback default tasks if JSON parsing fails
            tasks = [
                { id: 'task_1', name: 'Design and Setup', description: `Design implementation for: ${goal}` },
                { id: 'task_2', name: 'Core Implementation', description: 'Write the implementation code' },
                { id: 'task_3', name: 'Verification & Finalize', description: 'Verify features function as expected' },
            ];
        }

        // Write ROADMAP.md
        let roadmapMarkdown = `# Project Roadmap\n\n`;
        for (const t of tasks) {
            roadmapMarkdown += `## [ ] ${t.id}: ${t.name}\n${t.description}\n\n`;
        }
        await this.storage.write('ROADMAP.md', roadmapMarkdown);

        // Save STATE.md
        const initialState: GSDState = {
            status: 'PLANNING',
            currentStepIndex: 0,
            tasks: tasks.map((t: any) => ({ ...t, completed: false })),
        };
        await this.saveState(initialState);
    }

    /** Phase 2: Execute. Execute the next atomic task in the roadmap. */
    async executeStep(): Promise<{ taskName: string; output: string; completed: boolean }> {
        const state = await this.loadState();
        if (state.tasks.length === 0) {
            throw new Error('No tasks in roadmap. Run plan() first.');
        }

        const nextIndex = state.tasks.findIndex(t => !t.completed);
        if (nextIndex === -1) {
            return { taskName: 'none', output: 'All tasks are already marked completed.', completed: true };
        }

        const task = state.tasks[nextIndex]!;
        state.status = 'EXECUTING';
        state.currentStepIndex = nextIndex;
        await this.saveState(state);

        const requirements = await this.storage.read('REQUIREMENTS.md');
        const prompt = `You are an execution agent. Complete the current task in the context of the overall project goals.
---
Overall Requirements:
${requirements}
---
Current Task to Complete:
Name: ${task.name}
Description: ${task.description}
---
Perform the work, modify/simulate workspace changes, and report back detailing exactly what changes were made.`;

        // Run execution in a clean session
        const sessionId = await this.config.executorAgent.createSession(`gsd-exec-${task.id}-${Date.now()}`);
        const result = await this.config.executorAgent.run(prompt, { sessionId });

        // Update task status
        task.completed = true;
        task.result = result.text;

        // Update ROADMAP.md checking off the task
        const roadmapText = await this.storage.read('ROADMAP.md');
        const updatedRoadmap = roadmapText.replace(`## [ ] ${task.id}:`, `## [x] ${task.id}:`);
        await this.storage.write('ROADMAP.md', updatedRoadmap);

        const allDone = state.tasks.every(t => t.completed);
        if (allDone) {
            state.status = 'VERIFYING';
        }
        await this.saveState(state);

        return {
            taskName: task.name,
            output: result.text,
            completed: allDone,
        };
    }

    /** Phase 3: Verify. Validate requirements are met. */
    async verify(): Promise<{ success: boolean; report: string }> {
        const state = await this.loadState();
        state.status = 'VERIFYING';
        await this.saveState(state);

        const requirements = await this.storage.read('REQUIREMENTS.md');
        const roadmap = await this.storage.read('ROADMAP.md');

        const prompt = `You are a validator. Review the goal, the roadmap, and evaluate if requirements are satisfied.
---
Goal & Requirements:
${requirements}
---
Completed Roadmap:
${roadmap}
---
Write a brief report detailing verification outcome. Confirm with "[VERIFIED]" if success, or "[FAILED]" if bugs/missing items are detected.`;

        const result = await this.config.verifierAgent.run(prompt);
        const success = result.text.includes('[VERIFIED]');

        state.status = success ? 'COMPLETED' : 'FAILED';
        await this.saveState(state);

        return {
            success,
            report: result.text,
        };
    }

    /** Load current state from planning storage. */
    async loadState(): Promise<GSDState> {
        try {
            const jsonText = await this.storage.read('STATE.md');
            return JSON.parse(jsonText);
        } catch {
            return { status: 'PLANNING', currentStepIndex: 0, tasks: [] };
        }
    }

    private async saveState(state: GSDState): Promise<void> {
        await this.storage.write('STATE.md', JSON.stringify(state, null, 2));
    }
}

/** Create a GSD (Get Shit Done) Coordinator instance. */
export function createGSDCoordinator(config: GSDConfig): GSDCoordinator {
    return new GSDCoordinator(config);
}
