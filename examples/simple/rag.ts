import { agent } from 'personaforge';
import { KnowledgeEngine, TextLoader, InMemoryVectorStore } from 'personaforge/knowledge';
import { OpenAIEmbeddingProvider } from 'personaforge/memory';

const knowledge = new KnowledgeEngine({
  embeddingProvider: new OpenAIEmbeddingProvider(),
  vectorStore: new InMemoryVectorStore(),
});

// Ingest a document
await knowledge.ingest([{ content: 'personaforge is a TypeScript framework...' }]);
await knowledge.ingest([{ content: 'personaforge is a framework for building AI applications.' }]);

const ragAgent = agent({
  model: 'gpt-4o-mini',
  instructions: 'Answer questions using the knowledge base. Do not use external tools.',
  knowledgebase: knowledge,
  tools: [],
});

const r = await ragAgent.run('What is personaforge?');
console.log(r.text);