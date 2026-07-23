---
title: Migrate From LangChain
description: Port LangChain chains, agents, tools, memory, and retrievers to personaforge equivalents. LLMChain becomes compose(). AgentExecutor becomes createAgent(). Document loaders map to RAG ingestion helpers.
outline: [2, 3]
---

# Migrate From LangChain

`personaforge` replaces LangChain's broad toolkit with purpose-built modules. The table below gives the mapping, followed by side-by-side code examples.

---

## Quick comparison

| LangChain concept | personaforge equivalent |
|---|---|
| `ChatOpenAI`, `ChatAnthropic` | Model string in `createAgent({ model })` |
| `LLMChain` | `compose(a, b)` or single `createAgent` call |
| `SequentialChain` | `compose(a, b, c)` |
| `AgentExecutor` | `createAgent({ tools })` |
| `Tool`, `StructuredTool` | `tool({ name, description, schema, execute })` |
| `ConversationBufferMemory` | `createAgent({ sessionId })` — managed by session store |
| `VectorStoreRetriever` | `ContextProvider` or RAG via `createKnowledgeBase` |
| `RunnableSequence` | `pipe(a).then(b).then(c)` |
| `LCEL pipe (|)` | `pipe(a).then(b)` |
| `Callbacks` | [Hooks](./hooks) and [Observability](./observability) |
| `ConversationalRetrievalChain` | `createAgent` with a `ContextProvider` tool |
| `Document`, `loader.load()` | `ContextProvider.update(documents)` |
| `LangSmith` tracing | [Observability](./observability) — OpenTelemetry-native |

---

## Simple LLM call

```ts
// LangChain
import { ChatOpenAI } from '@langchain/openai';
const llm = new ChatOpenAI({ model: 'gpt-4o' });
const result = await llm.invoke('What is the capital of France?');

// personaforge
import { createAgent } from 'personaforge';
const agent = createAgent({
  name: 'assistant',
  instructions: 'You are a helpful assistant.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
});
const result = await agent.run('What is the capital of France?');
// result.text — the model output
```

---

## LLMChain → `createAgent`

```ts
// LangChain
import { LLMChain } from 'langchain/chains';
import { PromptTemplate } from '@langchain/core/prompts';
const chain = new LLMChain({
  llm,
  prompt: PromptTemplate.fromTemplate('Summarise this: {text}'),
});
await chain.call({ text: document });

// personaforge
const summarizer = createAgent({
  name: 'summarizer',
  instructions: 'Summarise the provided text concisely.',
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY!,
});
await summarizer.run(`Summarise this: ${document}`);
```

---

## LCEL pipeline → `pipe`

```ts
// LangChain (LCEL)
const chain = prompt | llm | outputParser;
const result = await chain.invoke({ input: 'Hello' });

// personaforge
import { pipe } from 'personaforge';

const result = await pipe(researchAgent)
  .then(summaryAgent,  { transform: (r) => `Summarise:\n${r.text}` })
  .then(formatAgent,   { transform: (r) => `Format for markdown:\n${r.text}` })
  .run('Latest AI developments');
```

---

## Tools

```ts
// LangChain
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
const searchTool = new DynamicStructuredTool({
  name: 'search',
  description: 'Search the web',
  schema: z.object({ query: z.string() }),
  func: async ({ query }) => fetchSearchResults(query),
});

// personaforge
import { tool } from 'personaforge';
import { z } from 'zod';
const searchTool = tool({
  name: 'search',
  description: 'Search the web for up-to-date information.',
  schema: z.object({ query: z.string().describe('The search query') }),
  execute: async ({ query }) => fetchSearchResults(query),
});
```

---

## Agent with tools

```ts
// LangChain
import { createOpenAIFunctionsAgent, AgentExecutor } from 'langchain/agents';
const agent = await createOpenAIFunctionsAgent({ llm, tools, prompt });
const executor = new AgentExecutor({ agent, tools });
const result = await executor.invoke({ input: 'What is the weather in London?' });

// personaforge
const weatherAgent = createAgent({
  name: 'weather-agent',
  instructions: 'Answer questions about weather using the available tools.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  tools: [weatherTool, locationTool],
});
const result = await weatherAgent.run('What is the weather in London?');
```

---

## Conversation memory → session

```ts
// LangChain
import { ConversationChain } from 'langchain/chains';
import { ConversationBufferMemory } from 'langchain/memory';
const chain = new ConversationChain({ llm, memory: new ConversationBufferMemory() });
await chain.call({ input: 'My name is Alice' });
await chain.call({ input: 'What is my name?' }); // remembers Alice

// personaforge — sessions auto-persist history
const agent = createAgent({ name: 'chat', instructions: 'You are a helpful assistant.', model: 'gpt-4o', apiKey: ... });
const session = agent.createSession({ sessionId: 'user-123' });
await session.run('My name is Alice');
const result = await session.run('What is my name?'); // remembers Alice
```

---

## RAG / retrieval

```ts
// LangChain
const vectorStore = await MemoryVectorStore.fromTexts(texts, metadata, new OpenAIEmbeddings());
const chain = new ConversationalRetrievalChain({ retriever: vectorStore.asRetriever(), llm });
const result = await chain.call({ question: 'What is the return policy?' });

// personaforge
import { createKnowledgeBase } from 'personaforge';

const kb = await createKnowledgeBase({ type: 'memory', embedder: 'openai', apiKey: process.env.OPENAI_API_KEY! });
await kb.add(documents);

const agent = createAgent({
  name: 'support-agent',
  instructions: 'Answer questions using the knowledge base.',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  contextProviders: [kb.asContextProvider()],
});
const result = await agent.run('What is the return policy?');
```

---

## Callbacks → hooks

```ts
// LangChain
const handler = new BaseCallbackHandler({
  handleLLMStart: () => console.log('LLM started'),
  handleLLMEnd: (output) => console.log('LLM done', output),
});

// personaforge
const agent = createAgent({
  name: 'traced-agent',
  instructions: '...',
  model: 'gpt-4o',
  apiKey: process.env.OPENAI_API_KEY!,
  hooks: {
    beforeRun: (ctx) => console.log('Run started', ctx.runId),
    afterRun:  (ctx, result) => console.log('Run done', result.text),
  },
});
```

---

## Where to go next

- [Agents](./agents) — full `createAgent` API.
- [Tools](./tools) — `tool()` authoring.
- [RAG](./rag) — knowledge base and context providers.
- [Hooks](./hooks) — lifecycle events for observability.
