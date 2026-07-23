---
title: Orchestration API
description: Complete reference for createTeam(), createSupervisor(), defineRole(), defineTask(), createRole(), createRunnableAgent(), and CoordinationType.
outline: [2, 3]
---

# Orchestration API

`personaforge/orchestration` is the multi-agent coordination layer. Use it when a single agent is no longer sufficient — when work needs to be split across specialists, delegated explicitly, routed by capability, or supervised by a coordinator.

```ts
import {
  createTeam,
  createSupervisor,
  defineRole,
  defineTask,
  createRole,
  createRunnableAgent,
  AgentState,
  CoordinationType,
} from 'personaforge/orchestration';
```

---

## `defineRole()` — define a specialist

A role is an agent with a clear identity: what it knows, what it's for, and how it generates text.

```ts
import { defineRole } from 'personaforge/orchestration';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const researcher = defineRole({
  role: 'Researcher',
  backstory: 'You gather accurate facts and cite sources.',
  goal: 'Collect the key facts needed to answer the request.',
  llm: {
    async generateText(messages) {
      const res = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1024,
        messages: messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: String(m.content),
        })),
      });
      const block = res.content[0];
      return { text: block.type === 'text' ? block.text : '', finishReason: 'stop' as const };
    },
  },
  allowDelegation: false,  // prevent this role from handing off work
  planning: false,
});
```

**`defineRole()` options:**

| Field | Type | Required | Description |
|---|---|---|---|
| `role` | `string` | ✓ | Role name — shown in team outputs |
| `backstory` | `string` | ✓ | Who this role is — shapes its answer style |
| `goal` | `string` | ✓ | What this role is trying to accomplish |
| `llm` | `LlmAdapter` | ✓ | Object with `generateText(messages)` method |
| `allowDelegation` | `boolean` | — | Allow this role to hand off to others (default: false) |
| `planning` | `boolean` | — | Include this role in pre-run planning (default: false) |

---

## `defineTask()` — define a unit of work

A task describes what should be done, what the expected output is, which role handles it, and optionally which previous tasks it depends on.

```ts
import { defineTask } from 'personaforge/orchestration';

const researchTask = defineTask({
  name: 'Research',
  description: 'Find the key facts about the user request.',
  expectedOutput: 'A short bullet list of verified facts.',
  agent: researcher,
});

const writeTask = defineTask({
  name: 'Write Response',
  description: 'Write the final response using the research findings.',
  expectedOutput: 'A concise, helpful response in plain English.',
  agent: writer,
  context: [researchTask],  // writer sees research output before executing
});
```

**`defineTask()` options:**

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✓ | Task identifier |
| `description` | `string` | ✓ | What this task should accomplish |
| `expectedOutput` | `string` | ✓ | Describes the expected format and content of the output |
| `agent` | `Role` | ✓ | The role responsible for this task |
| `context` | `Task[]` | — | Tasks whose outputs are passed to this task as additional context |

---

## `createTeam()` — run a team of agents

`createTeam()` coordinates roles and tasks into a runnable workflow.

```ts
import { createTeam } from 'personaforge/orchestration';

const team = createTeam({
  name: 'SupportTeam',
  agents: [researcher, writer],
  tasks: [researchTask, writeTask],
  mode: 'sequential',   // 'sequential' | 'route' | 'parallel'
  planning: false,
});

const result = await team.run('Explain the difference between the Pro and Enterprise plans.');

console.log(result.output);          // final output (last task result)
console.log(result.taskOutputs);     // { 'Research': '...', 'Write Response': '...' }
```

**`createTeam()` options:**

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | — | Team identifier |
| `agents` | `Role[]` | ✓ | Roles participating in the team |
| `tasks` | `Task[]` | ✓ | Tasks to execute (in sequential mode) |
| `mode` | `'sequential' \| 'route' \| 'parallel'` | `'sequential'` | Execution strategy |
| `planning` | `boolean` | `false` | Generate a shared plan before executing tasks |
| `capabilities` | `string[][]` | — | Per-agent capability tags for `route` mode |

### Route mode

In `route` mode, each request is directed to the single most capable role. Define capability tags per agent:

```ts
const routerTeam = createTeam({
  name: 'RouterTeam',
  mode: 'route',
  agents: [billingAgent, techAgent, generalAgent],
  capabilities: [
    ['billing', 'refunds', 'invoices', 'payment'],
    ['api', 'technical', 'integration', 'sdk'],
    ['general', 'account', 'other'],
  ],
});

const result = await routerTeam.run('I need help with an invoice refund.');
// → routed to billingAgent
```

---

## `createSupervisor()` — explicit delegation

`createSupervisor()` uses a coordinator agent that explicitly decides which worker handles each step.

```ts
import {
  createSupervisor,
  createRole,
  createRunnableAgent,
  AgentState,
  CoordinationType,
} from 'personaforge/orchestration';

// Create runnable worker agents
const researchWorker = createRunnableAgent({
  name: 'research-worker',
  description: 'Collects market data and statistics.',
  run: async (input) => ({
    result: { findings: `Research for: ${input.prompt}` },
    state: AgentState.COMPLETED,
    metadata: {
      startTime: new Date(),
      endTime: new Date(),
      durationMs: 100,
      iterations: 1,
    },
  }),
});

const analysisWorker = createRunnableAgent({
  name: 'analysis-worker',
  description: 'Interprets data and identifies key trends.',
  run: async (input) => ({
    result: { analysis: `Analysis for: ${input.prompt}` },
    state: AgentState.COMPLETED,
    metadata: {
      startTime: new Date(),
      endTime: new Date(),
      durationMs: 150,
      iterations: 1,
    },
  }),
});

// Create the supervisor
const supervisor = createSupervisor({
  name: 'report-supervisor',
  coordinationType: CoordinationType.PARALLEL,  // run workers concurrently
  subAgents: [
    {
      agent: researchWorker,
      role: createRole('Researcher', ['Collect market facts', 'Find supporting data']),
    },
    {
      agent: analysisWorker,
      role: createRole('Analyst', ['Interpret data', 'Identify key trends']),
    },
  ],
});

const outcome = await supervisor.run(
  { prompt: 'Prepare an EV market summary for Q1 2026.' },
  { agentId: 'report-supervisor', metadata: {} },
);

console.log(outcome.result);
```

---

## `CoordinationType` enum

| Value | Behaviour |
|---|---|
| `CoordinationType.SEQUENTIAL` | Run workers one after another, in order |
| `CoordinationType.PARALLEL` | Run all workers concurrently and merge results |
| `CoordinationType.CONSENSUS` | Run workers and synthesise a consensus answer |

---

## `AgentState` enum

Returned in every worker's run response:

| Value | Meaning |
|---|---|
| `AgentState.COMPLETED` | Worker finished successfully |
| `AgentState.FAILED` | Worker encountered an unrecoverable error |
| `AgentState.DELEGATED` | Worker handed off to another agent |

---

## When to use `createTeam` vs `createSupervisor`

| Scenario | Use |
|---|---|
| Fixed pipeline of specialised roles with task dependencies | `createTeam()` with `mode: 'sequential'` |
| Route each request to the best-suited specialist | `createTeam()` with `mode: 'route'` |
| One coordinator decides how to split work among workers | `createSupervisor()` |
| Workers run in parallel and results are merged | `createSupervisor()` with `CoordinationType.PARALLEL` |

When a linear `compose()` or `pipe()` pipeline is sufficient, prefer that — it is simpler and easier to test.

---

## `createGSDCoordinator()` — spec-driven workflow

Initializes a GSD Coordinator instance.

```ts
import { createGSDCoordinator } from 'personaforge/orchestration';

const gsd = createGSDCoordinator({
  projectDir: './my-project',
  plannerAgent,
  executorAgent,
  verifierAgent,
  storage: new FilesystemGSDStorage('./my-project/.planning'),
});
```

**`createGSDCoordinator()` options (`GSDConfig`):**

| Field | Type | Default | Description |
|---|---|---|---|
| `projectDir` | `string` | ✓ | Path to project workspace |
| `plannerAgent` | `Agent` | ✓ | Agent used for the Plan phase |
| `executorAgent` | `Agent` | ✓ | Agent used for the Execute phase |
| `verifierAgent` | `Agent` | ✓ | Agent used for the Verify phase |
| `storage` | `GSDStorage` | `InMemoryGSDStorage` | Storage backend for requirements, roadmap, and state |

### `GSDCoordinator` Methods

* **`plan(goal: string): Promise<void>`**
  Analyzes the goal, initializes the requirements log, and builds the roadmap task list.
* **`executeStep(): Promise<{ taskName: string, output: string, completed: boolean }>`**
  Identifies the next incomplete task in the roadmap and runs it inside an isolated session. Returns the output and whether the roadmap is completed.
* **`verify(): Promise<{ success: boolean, report: string }>`**
  Evaluates the generated project outputs against the requirements. Marks the state as `COMPLETED` or `FAILED`.

---

## `createRalphLoop()` — iterative cycle loop

Initializes a Ralph / RALF loop runner.

```ts
import { createRalphLoop } from 'personaforge/orchestration';

const loop = createRalphLoop({
  agent,
  maxCycles: 5,
  checkComplete: async (ctx) => ctx.lastResult.includes('Verified'),
});
```

**`createRalphLoop()` options (`RalphLoopConfig`):**

| Field | Type | Default | Description |
|---|---|---|---|
| `agent` | `Agent` | ✓ | Core agent to run in the loop |
| `maxCycles` | `number` | `5` | Maximum loop iterations |
| `checkComplete` | `(context: RalphLoopContext) => Promise<boolean> \| boolean` | ✓ | Function verifying if the task has been solved |
| `initialState` | `Record<string, any>` | `{}` | Initial state variable map |
| `promptFormatter` | `(prompt: string, context: RalphLoopContext) => string \| Promise<string>` | *built-in* | Formatter for successive iteration prompts |

### `RalphLoop` Methods

* **`run(prompt: string): Promise<RalphLoopResult>`**
  Runs the loop. Returns `{ success: boolean, finalOutput: string, cyclesRun: number, logs: RalphLoopLog[], state: Record<string, any> }`.

---

## Multi-Agent Pattern Constructors

Each pattern helper returns a standard `OrchestrableAgent` object that can be run or embedded inside other orchestration constructs.

### `createMixtureOfAgents()`

```ts
import { createMixtureOfAgents } from 'personaforge/orchestration';

const agent = createMixtureOfAgents({
  name: 'MoA',
  proposers: [agentA, agentB],
  aggregator: agentC,
  rounds: 2,
});
```

* **`proposers: AnyAgent[]`**: Parallel candidate generators.
* **`aggregator: AnyAgent`**: Synthesizes proposer answers.
* **`rounds?: number`** (default `1`): Number of proposer refinement rounds.

### `createActorCritic()`

```ts
import { createActorCritic } from 'personaforge/orchestration';

const agent = createActorCritic({
  name: 'CriticLoop',
  actor,
  critic,
  maxRefinements: 3,
  isSatisfactory: (feedback) => feedback.includes('pass'),
});
```

* **`actor: AnyAgent`**: Generates responses.
* **`critic: AnyAgent`**: Critiques actor responses.
* **`maxRefinements?: number`** (default `3`): Max feedback loop cycles.
* **`isSatisfactory?: (critique: string) => boolean`**: Validation check.

### `createSocraticAgent()`

```ts
import { createSocraticAgent } from 'personaforge/orchestration';

const agent = createSocraticAgent({
  name: 'Tutor',
  agent,
  topic: 'Math',
  instructions: 'Guide step-by-step',
});
```

* **`agent: AnyAgent`**: Backing agent.
* **`topic?: string`**: Subject domain.
* **`instructions?: string`**: Extra tutor prompts.

### `createPromptChain()`

```ts
import { createPromptChain } from 'personaforge/orchestration';

const agent = createPromptChain({
  name: 'Chain',
  steps: [
    { name: 'step1', agent: agentA },
    { name: 'step2', agent: agentB, template: (input, prev) => `Input: ${input}, prev: ${prev.step1}` }
  ],
});
```

* **`steps: ChainStep[]`**: Ordered list of chain components `{ name, agent, template? }`.

### `createProgramOfThought()`

```ts
import { createProgramOfThought } from 'personaforge/orchestration';

const agent = createProgramOfThought({
  name: 'PoT',
  agent,
  executor: async (code) => ({ stdout: 'Result', stderr: '' }),
});
```

* **`agent: AnyAgent`**: The coding agent.
* **`executor?: (code: string) => Promise<{ stdout: string, stderr: string }>`**: Sandboxed runtime.

### `createSkeletonOfThought()`

```ts
import { createSkeletonOfThought } from 'personaforge/orchestration';

const agent = createSkeletonOfThought({
  name: 'SoT',
  planner,
  worker,
  parallel: true,
});
```

* **`planner: AnyAgent`**: Outline planner.
* **`worker: AnyAgent`**: Section writer.
* **`parallel?: boolean`** (default `true`): Parallel section writing.

### `createStepBackAgent()`

```ts
import { createStepBackAgent } from 'personaforge/orchestration';

const agent = createStepBackAgent({
  name: 'StepBack',
  stepBackAgent,
  solverAgent,
});
```

* **`stepBackAgent: AnyAgent`**: Conceptual agent.
* **`solverAgent: AnyAgent`**: Specific problem solving agent.

### `createRejectionSampling()`

```ts
import { createRejectionSampling } from 'personaforge/orchestration';

const agent = createRejectionSampling({
  name: 'BestOfN',
  agent,
  judge,
  n: 3,
});
```

* **`agent: AnyAgent`**: Candidate generator.
* **`judge: AnyAgent | ((candidate: string) => Promise<number> \| number)`**: Scorer/Evaluation agent.
* **`n?: number`** (default `3`): Number of candidates to sample.

### `createSelfCorrection()`

```ts
import { createSelfCorrection } from 'personaforge/orchestration';

const agent = createSelfCorrection({
  name: 'SelfCorrect',
  agent,
  validator: (out) => ({ valid: out.length > 10 }),
  maxRetries: 3,
});
```

* **`agent: AnyAgent`**: Core agent.
* **`validator: (output: string) => Promise<{ valid: boolean, errors?: string[] }>`**: Target schema/correctness check.
* **`maxRetries?: number`** (default `3`): Number of attempts.

---

## Where to go next

- [Orchestration guide](../guide/orchestration) — rollout advice and patterns
- [08 · Multi-Agent Team](../examples/08-team) — runnable team example
- [09 · Supervisor Workflow](../examples/09-supervisor) — runnable supervisor example
- [Compose guide](../guide/compose) — simpler sequential pipelines without orchestration

