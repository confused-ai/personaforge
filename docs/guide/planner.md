---
title: Planner
description: Decompose a goal into an ordered task plan using LLMPlanner or ClassicalPlanner, validate the plan, execute tasks, and track status with TaskStatus.
outline: [2, 3]
---

# Planner

The planner module separates goal decomposition from execution. `LLMPlanner` uses a language model to break a goal into a structured `Plan` of `Task` objects. `ClassicalPlanner` uses deterministic rules. `PlanValidator` checks a plan before execution starts.

```ts
import {
  LLMPlanner,
  ClassicalPlanner,
  PlanValidator,
  TaskPriority,
  TaskStatus,
} from 'confused-ai';
```

---

## `LLMPlanner` — LLM-driven decomposition

```ts
import { createAgent, OpenAIProvider } from 'confused-ai';
import { LLMPlanner, TaskPriority } from 'confused-ai';

const llm = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY!, model: 'gpt-4o' });

const planner = new LLMPlanner(
  {
    maxIterations: 10,
    allowParallelExecution: true,
    model: 'gpt-4o',
    temperature: 0.3,
    maxTokens: 2_000,
  },
  {
    generateText: async (prompt) => {
      const result = await llm.generateText([{ role: 'user', content: prompt }]);
      return result.text;
    },
  },
);

// Generate a plan
const plan = await planner.plan('Launch a new product blog post', {
  availableTools: ['search_web', 'write_content', 'publish_post'],
  constraints: ['Must be done in 2 hours', 'Use SEO best practices'],
});

console.log(plan.tasks.map(t => ({
  id:       t.id,
  name:     t.name,
  priority: t.priority,
  deps:     t.dependencies,
})));
// [
//   { id: 'task-1', name: 'Research keywords', priority: TaskPriority.HIGH, deps: [] },
//   { id: 'task-2', name: 'Write draft',       priority: TaskPriority.MEDIUM, deps: ['task-1'] },
//   { id: 'task-3', name: 'SEO review',        priority: TaskPriority.MEDIUM, deps: ['task-2'] },
//   { id: 'task-4', name: 'Publish post',      priority: TaskPriority.LOW,    deps: ['task-3'] },
// ]
```

---

## `Task` shape

```ts
interface Task {
  readonly id:                  string;
  readonly name:                string;
  readonly description:         string;
  readonly dependencies:        string[];         // task IDs this depends on
  readonly priority:            TaskPriority;     // CRITICAL=0 HIGH=1 MEDIUM=2 LOW=3
  readonly estimatedDurationMs: number | undefined;
  readonly metadata: {
    toolIds?:         string[];   // which tools this task needs
    requiredMemory?:  string[];   // memory keys needed
    outputKey?:       string;     // key to store result under
    maxRetries?:      number;
    timeoutMs?:       number;
  };
}
```

---

## `PlanValidator`

Validate a plan before executing it:

```ts
import { PlanValidator } from 'confused-ai';

const validator = new PlanValidator();

const validation = validator.validate(plan);

if (!validation.valid) {
  console.error('Plan is invalid:', validation.errors);
  // [{ taskId: 'task-3', message: 'Missing dependency: task-99 does not exist in the plan', severity: 'error' }]
} else {
  console.log('Plan is valid. Executing...');
}
```

---

## Execute a plan

Execute tasks in dependency order with agents:

```ts
import { createAgent } from 'confused-ai';

// Map task names to agents
const executors: Record<string, ReturnType<typeof createAgent>> = {
  'Research keywords': createAgent({ name: 'researcher', instructions: 'Research SEO keywords.', model: 'gpt-4o-mini', apiKey: '...' }),
  'Write draft':       createAgent({ name: 'writer',     instructions: 'Write blog content.',     model: 'gpt-4o',     apiKey: '...' }),
  'SEO review':        createAgent({ name: 'seo',        instructions: 'Review for SEO.',          model: 'gpt-4o-mini', apiKey: '...' }),
  'Publish post':      createAgent({ name: 'publisher',  instructions: 'Publish the post.',        model: 'gpt-4o-mini', apiKey: '...' }),
};

const taskResults: Record<string, string> = {};

for (const task of plan.tasks) {
  const executor = executors[task.name];
  if (!executor) continue;

  // Build context from upstream results
  const context = task.dependencies.map(depId => {
    const depTask = plan.tasks.find(t => t.id === depId);
    return depTask ? `${depTask.name}: ${taskResults[depId]}` : '';
  }).join('\n');

  const result = await executor.run(`${task.description}\n\nContext:\n${context}`);
  taskResults[task.id] = result.text;
  console.log(`✓ ${task.name}`);
}

console.log('Done!', taskResults);
```

---

## `ClassicalPlanner` — deterministic rules

```ts
import { ClassicalPlanner, PlanningAlgorithm, TaskPriority } from 'confused-ai';

// `algorithm` is required: A_STAR | BFS | DFS | GREEDY | HIERARCHICAL
const planner = new ClassicalPlanner({
  algorithm: PlanningAlgorithm.HIERARCHICAL,
});

// Register rule-based decompositions as task patterns
planner.registerPattern({
  name: 'report',
  matches: (goal) => goal.includes('report'),
  generateTasks: (goal) => [
    { id: 'gather',  name: 'Gather data',  description: 'Collect raw data.', dependencies: [], priority: TaskPriority.HIGH,   metadata: {} },
    { id: 'analyse', name: 'Analyse data', description: 'Run analysis.',      dependencies: [], priority: TaskPriority.MEDIUM, metadata: {} },
    { id: 'write',   name: 'Write report', description: 'Write the report.',  dependencies: [], priority: TaskPriority.LOW,    metadata: {} },
  ],
});

const plan = await planner.plan('Generate quarterly sales report');
```

---

## Where to go next

- [Workflows](./workflows) — execute a plan as a structured DAG.
- [Reasoning](./reasoning) — step-by-step chain-of-thought before planning.
- [Orchestration](./orchestration) — multi-agent teams to execute each plan task.
