/**
 * Example: Multi-Agent Orchestration
 *
 * Demonstrates:
 * 1. Supervisor pattern: Research lead delegates to specialists
 * 2. Pipeline pattern: Sequential agent processing
 * 3. Consensus pattern: Multiple agents vote on best answer
 * 4. Graph-based agent workflows
 *
 * Uses mock LLM to run without API keys.
 */

import {
  MultiAgentOrchestrator,
  AgentRuntime,
  createGraph,
  DAGEngine,
  agentNode,
  TelemetryPlugin,
  type AgentDef,
  type LLMProvider,
  type LLMMessage,
  type LLMOptions,
  type LLMResponse,
  type NodeContext,
} from 'personaforge/graph';

// ── Mock LLM Provider ───────────────────────────────────────────────────────

/**
 * Deterministic mock LLM for testing.
 * In production, replace with OpenAI/Anthropic/local model provider.
 */
class MockLLM implements LLMProvider {
  name: string;
  private responses: Map<string, string>;
  private defaultResponse: string;

  constructor(name: string, responses?: Record<string, string>) {
    this.name = name;
    this.responses = new Map(Object.entries(responses ?? {}));
    this.defaultResponse = `[${name}] I've processed your request and here is my analysis.`;
  }

  async generate(messages: LLMMessage[], options?: LLMOptions): Promise<LLMResponse> {
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const prompt = lastUser?.content ?? '';

    // Check for tool calls
    if (options?.tools && options.tools.length > 0) {
      // Check if prompt suggests delegation
      if (prompt.toLowerCase().includes('delegate') || prompt.toLowerCase().includes('assign')) {
        const tool = options.tools.find(t => t.function.name === 'delegate');
        if (tool) {
          return {
            content: '',
            toolCalls: [{
              id: `tc_${Date.now()}`,
              type: 'function',
              function: {
                name: 'delegate',
                arguments: JSON.stringify({
                  worker: 'researcher',
                  task: prompt,
                }),
              },
            }],
            usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          };
        }
      }

      // Check for finish tool
      if (prompt.toLowerCase().includes('finish') || messages.some(m => m.role === 'tool')) {
        const finishTool = options.tools.find(t => t.function.name === 'finish');
        if (finishTool) {
          return {
            content: '',
            toolCalls: [{
              id: `tc_${Date.now()}`,
              type: 'function',
              function: {
                name: 'finish',
                arguments: JSON.stringify({
                  answer: `${this.name}: Task completed with comprehensive analysis.`,
                }),
              },
            }],
            usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
          };
        }
      }
    }

    // Find matching response
    for (const [pattern, response] of this.responses) {
      if (prompt.toLowerCase().includes(pattern.toLowerCase())) {
        return {
          content: response,
          usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
          finishReason: 'stop',
        };
      }
    }

    return {
      content: this.defaultResponse,
      usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
      finishReason: 'stop',
    };
  }
}

// ── Agent Definitions ───────────────────────────────────────────────────────

const researcherAgent: AgentDef = {
  name: 'researcher',
  description: 'Conducts deep research on topics',
  instructions: 'You are a thorough researcher. Analyze the topic deeply and provide evidence-based findings.',
  llm: new MockLLM('researcher', {
    'climate': 'Research findings: Global temperatures have risen 1.1°C since pre-industrial times. Key factors include CO2 emissions, deforestation, and methane.',
    'ai': 'Research findings: AI capabilities are advancing rapidly. Key areas: LLMs, multi-agent systems, and autonomous agents.',
  }),
};

const writerAgent: AgentDef = {
  name: 'writer',
  description: 'Writes polished content from research',
  instructions: 'You are a skilled writer. Transform research findings into clear, engaging prose.',
  llm: new MockLLM('writer', {
    'research': 'In an era of unprecedented change, our research reveals compelling insights that demand attention. The findings point to a clear trajectory...',
    'findings': 'Based on comprehensive analysis, we can confidently state that the evidence supports a nuanced understanding of the subject.',
  }),
};

const editorAgent: AgentDef = {
  name: 'editor',
  description: 'Reviews and improves content',
  instructions: 'You are an exacting editor. Review content for clarity, accuracy, and impact.',
  llm: new MockLLM('editor', {
    'review': 'EDITED: The content has been refined for clarity and impact. Key improvements: tighter prose, stronger evidence citations, clearer conclusions.',
  }),
};

const factCheckerAgent: AgentDef = {
  name: 'fact-checker',
  description: 'Verifies factual claims',
  instructions: 'You are a meticulous fact-checker. Verify all claims against known sources.',
  llm: new MockLLM('fact-checker', {
    default: 'FACT CHECK: All major claims verified. 2 minor corrections suggested. Overall accuracy: 94%.',
  }),
};

// ── Examples ────────────────────────────────────────────────────────────────

async function pipelineExample() {
  console.log('\n=== Pipeline Pattern ===');
  console.log('Agents process in sequence: researcher → writer → editor\n');

  const orchestrator = new MultiAgentOrchestrator();
  orchestrator
    .addAgent(researcherAgent)
    .addAgent(writerAgent)
    .addAgent(editorAgent);

  const result = await orchestrator.runPipeline({
    agents: ['researcher', 'writer', 'editor'],
    input: 'Write an article about climate change impacts on agriculture',
  });

  console.log(`Final output: ${result.text.slice(0, 100)}...`);
  console.log(`Agents involved: ${Object.keys(result.agentResults).join(', ')}`);
  console.log(`Messages exchanged: ${result.messages.length}`);
}

async function consensusExample() {
  console.log('\n=== Consensus Pattern ===');
  console.log('Multiple agents answer, best response wins\n');

  const orchestrator = new MultiAgentOrchestrator();
  orchestrator
    .addAgent(researcherAgent)
    .addAgent(writerAgent)
    .addAgent(factCheckerAgent);

  const result = await orchestrator.runConsensus({
    agents: ['researcher', 'writer', 'fact-checker'],
    task: 'What is the current state of AI research?',
    strategy: 'merge',
  });

  console.log(`Merged output:\n${result.text.slice(0, 200)}...`);
  console.log(`Participating agents: ${Object.keys(result.agentResults).join(', ')}`);
}

async function competitiveExample() {
  console.log('\n=== Competitive Pattern ===');
  console.log('Agents race — first response wins\n');

  const orchestrator = new MultiAgentOrchestrator();
  orchestrator
    .addAgent(researcherAgent)
    .addAgent(writerAgent);

  const result = await orchestrator.runCompetitive({
    agents: ['researcher', 'writer'],
    task: 'Explain quantum computing in one paragraph',
  });

  console.log(`Winner: ${result.winner}`);
  console.log(`Response: ${result.text.slice(0, 100)}...`);
}

async function graphBasedAgentWorkflow() {
  console.log('\n=== Graph-Based Agent Workflow ===');
  console.log('Agents as DAG nodes with parallel execution\n');

  const graph = createGraph('research-pipeline', {
    description: 'Multi-agent research pipeline with parallel fact-checking',
  })
    .addNode('start', { kind: 'start' })

    // Research phase (uses agent)
    .addNode('research', agentNode('research', researcherAgent, {
      promptTemplate: (input) => `Research the following topic: ${input}`,
    }))

    // Parallel phase: write + fact-check simultaneously
    .addNode('write', agentNode('write', writerAgent, {
      promptTemplate: (input) => {
        const research = typeof input === 'object' && input !== null ? (input as any).text : input;
        return `Transform these research findings into an article: ${research}`;
      },
    }))

    .addNode('fact-check', agentNode('fact-check', factCheckerAgent, {
      promptTemplate: (input) => {
        const research = typeof input === 'object' && input !== null ? (input as any).text : input;
        return `Review and fact-check: ${research}`;
      },
    }))

    // Merge phase
    .addNode('merge', {
      kind: 'task',
      execute: async (ctx: NodeContext) => {
        const article = ctx.getNodeOutput<{ text: string }>('write');
        const factCheck = ctx.getNodeOutput<{ text: string }>('fact-check');
        return {
          article: article?.text ?? 'No article',
          factCheck: factCheck?.text ?? 'No fact check',
          status: 'reviewed',
        };
      },
    })

    // Edit phase
    .addNode('edit', agentNode('edit', editorAgent, {
      promptTemplate: (input) => `Review and polish this article: ${JSON.stringify(input)}`,
    }))

    .addNode('end', { kind: 'end' })

    // Wire the graph
    .addEdge('start', 'research')
    .addEdge('research', 'write')       // research → write
    .addEdge('research', 'fact-check')  // research → fact-check (parallel)
    .addEdge('write', 'merge')          // write → merge
    .addEdge('fact-check', 'merge')     // fact-check → merge (join)
    .addEdge('merge', 'edit')
    .addEdge('edit', 'end')

    .build();

  const telemetry = new TelemetryPlugin();
  const engine = new DAGEngine(graph);

  const result = await engine.execute({
    variables: { text: 'The impact of AI on modern software development' },
    plugins: [telemetry],
  });

  console.log(`Status: ${result.status}`);
  console.log(`Duration: ${result.durationMs}ms`);
  console.log(`Nodes completed: ${Object.values(result.state.nodes).filter(n => n.status === 'completed').length}`);

  const metrics = telemetry.getMetrics();
  console.log(`\nMetrics:`);
  console.log(`  Nodes: ${metrics.completedNodes}/${metrics.totalNodes}`);
  console.log(`  Success rate: ${(metrics.successRate * 100).toFixed(0)}%`);
}

// ── Run All Examples ────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║    Multi-Agent Orchestration Examples        ║');
  console.log('╚══════════════════════════════════════════════╝');

  await pipelineExample();
  await consensusExample();
  await competitiveExample();
  await graphBasedAgentWorkflow();

  console.log('\n✓ All examples completed');
}

main().catch(console.error);
