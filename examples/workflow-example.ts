/**
 * Example: Graph-Based Workflow
 *
 * Demonstrates:
 * - DAG-based state management
 * - Conditional transitions
 * - Parallel execution
 * - Checkpoint/resume
 *
 * Run: bun examples/workflow-example.ts
 */

import {
    WorkflowBuilder,
    StateGraph,
    WorkflowExecutor,
    NodeType,
    TransitionType,
    WorkflowStatus,
} from 'personaforge/execution';
import { StepExecutor, PipelineBuilder, EngineEvent } from 'personaforge/execution';

async function main() {
    console.log('=== Graph-Based Workflow Example ===\n');

    // Example 1: Simple Linear Workflow
    console.log('1. Simple Linear Workflow:');
    await simpleWorkflow();

    // Example 2: Conditional Workflow
    console.log('\n2. Conditional Workflow:');
    await conditionalWorkflow();

    // Example 3: Step Executor
    console.log('\n3. Step Executor:');
    await stepExecutor();

    // Example 4: Pipeline Builder
    console.log('\n4. Pipeline Builder:');
    await pipelineBuilder();

    console.log('\n=== Done ===');
}

async function simpleWorkflow() {
    const workflow = new WorkflowBuilder('simple')
        .start('start')
        .task('fetch', async (ctx) => {
            console.log('  → Fetching data...');
            ctx.variables.set('data', { users: [1, 2, 3] });
            return { count: 3 };
        }, { timeoutMs: 5000 })
        .task('process', async (ctx) => {
            const data = ctx.variables.get('data') as any;
            console.log(`  → Processing ${data.count} items...`);
            return { processed: true };
        })
        .task('save', async () => {
            console.log('  → Saving results...');
            return { saved: true };
        })
        .end('end')
        .build();

    const executor = new WorkflowExecutor(workflow);
    const result = await executor.execute({});

    console.log(`  Status: ${result.status}`);
    console.log(`  Duration: ${result.totalDurationMs}ms`);
    console.log(`  Output:`, result.outputVariables);
}

async function conditionalWorkflow() {
    const workflow = new WorkflowBuilder('conditional')
        .start('start')
        .task('validate', async (ctx) => {
            ctx.variables.set('valid', true);
            return { valid: true };
        })
        .decision('check', async (ctx) => {
            return ctx.variables.get('valid') as boolean;
        })
        .task('on-success', async () => {
            console.log('  → Path: SUCCESS');
            return { status: 'success' };
        })
        .task('on-failure', async () => {
            console.log('  → Path: FAILURE');
            return { status: 'failure' };
        })
        .end('end')
        .build();

    // Add explicit transitions for the decision
    const nodes = workflow.getNodes();
    const validateNode = nodes.find(n => n.name === 'validate');
    const checkNode = nodes.find(n => n.name === 'check');
    const successNode = nodes.find(n => n.name === 'on-success');
    const failureNode = nodes.find(n => n.name === 'on-failure');

    if (validateNode && checkNode && successNode && failureNode) {
        workflow.addTransition({
            from: validateNode.id,
            to: checkNode.id,
            type: TransitionType.UNCONDITIONAL,
        });
        workflow.addTransition({
            from: checkNode.id,
            to: successNode.id,
            type: TransitionType.CONDITIONAL,
            condition: async () => true, // Simplified for demo
        });
        workflow.addTransition({
            from: checkNode.id,
            to: failureNode.id,
            type: TransitionType.ERROR,
        });
        workflow.addTransition({
            from: successNode.id,
            to: failureNode.id,
            type: TransitionType.UNCONDITIONAL,
        });
    }

    const executor = new WorkflowExecutor(workflow);
    const result = await executor.execute({});

    console.log(`  Status: ${result.status}`);
    console.log(`  History: ${result.history.length} nodes executed`);
}

async function stepExecutor() {
    const executor = new StepExecutor({
        maxConcurrency: 2,
        maxQueueSize: 10,
        defaultTimeoutMs: 5000,
        enableBackpressure: true,
    });

    // Subscribe to events
    executor.on(EngineEvent.STEP_START, (p) => {
        console.log(`  Step "${p.stepName}" started (attempt ${p.attempt})`);
    });
    executor.on(EngineEvent.STEP_COMPLETE, (p) => {
        console.log(`  Step "${p.stepName}" completed in ${p.durationMs}ms`);
    });

    const steps = [
        {
            name: 'fetch',
            execute: async () => {
                await new Promise(r => setTimeout(r, 100));
                return { success: true, output: 'data' };
            },
        },
        {
            name: 'transform',
            execute: async () => {
                await new Promise(r => setTimeout(r, 50));
                return { success: true, output: 'transformed' };
            },
        },
        {
            name: 'save',
            execute: async () => {
                await new Promise(r => setTimeout(r, 50));
                return { success: true, output: 'saved' };
            },
        },
    ];

    const result = await executor.execute(steps, {});

    console.log(`  Status: ${result.status}`);
    console.log(`  Steps: ${result.completedSteps}/${result.totalSteps}`);
    console.log(`  Duration: ${result.durationMs}ms`);
}

async function pipelineBuilder() {
    const pipeline = new PipelineBuilder();

    pipeline
        .step('fetch', async () => {
            await new Promise(r => setTimeout(r, 50));
            return { users: [1, 2, 3] };
        })
        .withRetry(3)
        .withTimeout(5000)
        .step('process', async (ctx) => {
            const users = ctx.variables.get('users') as number[];
            return users.map(u => u * 2);
        })
        .step('save', async () => {
            return { saved: true };
        });

    const executor = new StepExecutor({
        maxConcurrency: 4,
        maxQueueSize: 100,
        defaultTimeoutMs: 10000,
    });

    const result = await executor.execute(pipeline.build(), {});

    console.log(`  Status: ${result.status}`);
    console.log(`  Duration: ${result.durationMs}ms`);
    console.log(`  Outputs:`, result.outputs);
}

main().catch(console.error);