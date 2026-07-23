/**
 * Example: Multi-Step Agent Workflow with Branching and Parallelism
 *
 * This demonstrates:
 * 1. Graph-based workflow with parallel execution
 * 2. Conditional routing (branching)
 * 3. Join/merge of parallel results
 * 4. Event sourcing for durability
 * 5. Plugin system (telemetry + logging)
 *
 * Scenario: A content pipeline that:
 * - Classifies incoming text
 * - Routes to different processors based on type
 * - Runs parallel analysis (sentiment + entities)
 * - Merges results and generates a final report
 */

import {
  createGraph,
  DAGEngine,
  InMemoryEventStore,
  TelemetryPlugin,
  LoggingPlugin,
  AuditPlugin,
  replayState,
  type NodeContext,
  type GraphPlugin,
  type GraphEvent,
} from 'personaforge/graph';

// ── Step Functions ──────────────────────────────────────────────────────────

async function classifyText(ctx: NodeContext<string>): Promise<string> {
  const text = typeof ctx.input === 'string' ? ctx.input : (ctx.input as any)?.text ?? '';
  ctx.log.info(`Classifying text: "${text.slice(0, 50)}..."`);

  // Simple classification logic (would use LLM in production)
  if (text.toLowerCase().includes('bug') || text.toLowerCase().includes('error')) {
    return 'technical';
  }
  if (text.toLowerCase().includes('love') || text.toLowerCase().includes('hate')) {
    return 'emotional';
  }
  return 'general';
}

async function analyzeSentiment(ctx: NodeContext): Promise<{ sentiment: string; confidence: number }> {
  ctx.log.info('Running sentiment analysis...');
  // Simulate async work
  await new Promise(r => setTimeout(r, 50));
  const text = typeof ctx.input === 'string' ? ctx.input : JSON.stringify(ctx.input);
  const positive = text.toLowerCase().includes('love') || text.toLowerCase().includes('great');
  return {
    sentiment: positive ? 'positive' : 'negative',
    confidence: 0.87,
  };
}

async function extractEntities(ctx: NodeContext): Promise<{ entities: string[] }> {
  ctx.log.info('Extracting entities...');
  await new Promise(r => setTimeout(r, 30));
  return { entities: ['content', 'analysis', 'pipeline'] };
}

async function processTechnical(ctx: NodeContext): Promise<{ category: string; priority: string }> {
  ctx.log.info('Processing technical content...');
  await new Promise(r => setTimeout(r, 40));
  return { category: 'technical', priority: 'high' };
}

async function processEmotional(ctx: NodeContext): Promise<{ category: string; tone: string }> {
  ctx.log.info('Processing emotional content...');
  await new Promise(r => setTimeout(r, 35));
  return { category: 'emotional', tone: 'intense' };
}

async function processGeneral(ctx: NodeContext): Promise<{ category: string; summary: string }> {
  ctx.log.info('Processing general content...');
  await new Promise(r => setTimeout(r, 25));
  return { category: 'general', summary: 'Standard content processed' };
}

async function mergeResults(ctx: NodeContext): Promise<Record<string, unknown>> {
  ctx.log.info('Merging analysis results...');
  // Collect all upstream outputs
  const sentiment = ctx.getNodeOutput<{ sentiment: string; confidence: number }>('sentiment-analysis');
  const entities = ctx.getNodeOutput<{ entities: string[] }>('entity-extraction');
  return {
    sentiment,
    entities,
    mergedAt: new Date().toISOString(),
  };
}

async function generateReport(ctx: NodeContext): Promise<string> {
  ctx.log.info('Generating final report...');
  const classification = ctx.getNodeOutput('classify');
  const analysis = ctx.getNodeOutput('merge-results');
  return `## Analysis Report\n\nClassification: ${classification}\nAnalysis: ${JSON.stringify(analysis, null, 2)}`;
}

// ── Build the Graph ─────────────────────────────────────────────────────────

async function main() {
  console.log('=== Content Analysis Pipeline ===\n');

  // Build the graph
  const graph = createGraph('content-pipeline', {
    description: 'Multi-step content analysis with branching and parallelism',
    version: '1.0.0',
  })
    // Entry point
    .addNode('start', { kind: 'start' })

    // Classification router
    .addNode('classify', {
      kind: 'router',
      route: async (ctx) => {
        const text = ctx.getVariable<string>('input') ?? '';
        if (text.includes('bug') || text.includes('error')) return 'technical';
        if (text.includes('love') || text.includes('hate')) return 'emotional';
        return 'general';
      },
      description: 'Routes content to appropriate processor',
    })

    // Specialized processors (branching)
    .addNode('process-technical', {
      kind: 'task',
      execute: processTechnical,
      description: 'Handles technical content',
    })
    .addNode('process-emotional', {
      kind: 'task',
      execute: processEmotional,
      description: 'Handles emotional content',
    })
    .addNode('process-general', {
      kind: 'task',
      execute: processGeneral,
      description: 'Handles general content',
    })

    // Parallel analysis (runs concurrently)
    .addNode('sentiment-analysis', {
      kind: 'task',
      execute: analyzeSentiment,
      description: 'Parallel: sentiment analysis',
    })
    .addNode('entity-extraction', {
      kind: 'task',
      execute: extractEntities,
      description: 'Parallel: entity extraction',
    })

    // Merge parallel results
    .addNode('merge-results', {
      kind: 'join',
      merge: async (results) => results,
      description: 'Merges parallel analysis results',
    })

    // Final report
    .addNode('report', {
      kind: 'task',
      execute: generateReport,
      description: 'Generates final report',
    })

    .addNode('end', { kind: 'end' })

    // Edges: linear flow
    .addEdge('start', 'classify')

    // Routing edges
    .addEdge('classify', 'process-technical', { label: 'technical' })
    .addEdge('classify', 'process-emotional', { label: 'emotional' })
    .addEdge('classify', 'process-general', { label: 'general' })

    // After classification, also run parallel analysis
    .addEdge('start', 'sentiment-analysis')
    .addEdge('start', 'entity-extraction')

    // Join parallel results
    .addEdge('sentiment-analysis', 'merge-results')
    .addEdge('entity-extraction', 'merge-results')

    // Generate report from merged data
    .addEdge('merge-results', 'report')
    .addEdge('report', 'end')

    .build();

  // Set up plugins
  const telemetry = new TelemetryPlugin();
  const audit = new AuditPlugin();
  const eventStore = new InMemoryEventStore();

  // Execute
  const engine = new DAGEngine(graph);
  const result = await engine.execute({
    variables: { input: 'I love this product but found a bug in the login flow' },
    plugins: [
      telemetry,
      new LoggingPlugin({ level: 'info' }),
      audit,
    ],
    eventStore,
  });

  console.log(`\nExecution Status: ${result.status}`);
  console.log(`Duration: ${result.durationMs}ms`);
  console.log(`Events emitted: ${result.events.length}`);

  // Show results
  console.log('\n=== Node Results ===');
  for (const [name, value] of Object.entries(result.state.results)) {
    console.log(`  ${name}: ${JSON.stringify(value)}`);
  }

  // Show metrics
  const metrics = telemetry.getMetrics();
  console.log('\n=== Metrics ===');
  console.log(`  Total nodes executed: ${metrics.completedNodes}`);
  console.log(`  Success rate: ${(metrics.successRate * 100).toFixed(1)}%`);
  console.log(`  Avg execution time: ${metrics.avgExecutionMs.toFixed(1)}ms`);

  // Demonstrate replay from events
  console.log('\n=== Event Replay ===');
  const events = await eventStore.load(result.executionId);
  const replayedState = replayState(events, graph);
  console.log(`  Replayed status: ${replayedState.status}`);
  console.log(`  States match: ${replayedState.status === result.state.status}`);

  // Show audit trail
  const nodeEvents = audit.getAuditLog().filter(e => e.type.startsWith('node.'));
  console.log('\n=== Audit Trail ===');
  for (const event of nodeEvents.slice(0, 10)) {
    console.log(`  [${event.type}] node=${event.nodeId?.slice(0, 8)} ${JSON.stringify(event.data ?? {})}`);
  }
}

main().catch(console.error);
