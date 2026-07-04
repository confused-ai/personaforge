---
title: Providers
description: Every LLM provider supported by the framework — native SDKs, OpenAI-compatible factories, self-hosted servers, and multi-model gateways.
outline: [2, 3]
---

# Providers

Every provider implements the same `LLMProvider` interface. Swapping one for another is a single-line change in `createAgent()`.

## Quick start

```ts
import { createAgent } from 'confused-ai';
import { OpenAIProvider } from 'confused-ai';

const agent = createAgent({
  name: 'assistant',
  instructions: 'You are a helpful assistant.',
  llm: new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY! }),
});

const result = await agent.run('Explain transformers in two sentences.');
console.log(result.text);
```

Swap `OpenAIProvider` for any provider below — the rest of the agent code stays the same.

---

## Native SDK providers

These providers use their official SDKs at runtime (peer dependencies — install only what you use).

### OpenAI

```ts
import { OpenAIProvider } from 'confused-ai';

const llm = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY!,
  model: 'gpt-4o',          // default: gpt-4o
  // baseURL: '...'         // override for custom endpoints
  // debug: true            // log raw API calls
});
```

**Install:** `npm install openai`

**Popular models:** `gpt-4o`, `gpt-4o-mini`, `gpt-4.1`, `gpt-4.1-nano`, `o3-mini`, `o4-mini`

### Anthropic

```ts
import { AnthropicProvider } from 'confused-ai';

const llm = new AnthropicProvider({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  model: 'claude-sonnet-4-20250514',  // default: claude-3-5-sonnet-20241022
});
```

**Install:** `npm install @anthropic-ai/sdk`

**Popular models:** `claude-opus-4-20250514`, `claude-sonnet-4-20250514`, `claude-haiku-4-20250514`

### Google Gemini

```ts
import { GoogleProvider } from 'confused-ai';

const llm = new GoogleProvider({
  apiKey: process.env.GOOGLE_API_KEY!,
  model: 'gemini-2.5-pro-preview',  // default: gemini-2.0-flash
});
```

**Install:** `npm install @google/generative-ai`

**Popular models:** `gemini-2.5-pro-preview`, `gemini-2.0-flash`, `gemini-1.5-pro`, `gemini-1.5-flash`

### Amazon Bedrock

```ts
import { BedrockConverseProvider } from 'confused-ai';

const llm = new BedrockConverseProvider({
  region: 'us-east-1',
  modelId: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
  // client: myPrebuiltClient   // optional
});
```

**Install:** `npm install @aws-sdk/client-bedrock-runtime`

Uses the default AWS credential chain (env vars, instance profile, etc.).

---

## Multi-model gateway

### OpenRouter

Access every major model through one API key and one endpoint.

```ts
import { createOpenRouterProvider } from 'confused-ai';

const llm = createOpenRouterProvider({
  apiKey: process.env.OPENROUTER_API_KEY!,
  model: 'anthropic/claude-sonnet-4',  // any OpenRouter model id
});
```

**Popular model ids:** `openai/gpt-4o`, `anthropic/claude-opus-4`, `google/gemini-2.5-pro-preview`, `meta-llama/llama-3.3-70b-instruct`

---

## Fast inference

### Groq (LPU)

```ts
import { createGroqProvider } from 'confused-ai';

const llm = createGroqProvider({
  apiKey: process.env.GROQ_API_KEY,
  model: 'llama-3.3-70b-versatile',  // default
});
```

**Popular models:** `llama-3.3-70b-versatile`, `llama-3.1-8b-instant`, `gemma2-9b-it`, `mixtral-8x7b-32768`

### Cerebras

```ts
import { createCerebrasProvider } from 'confused-ai';

const llm = createCerebrasProvider({
  apiKey: process.env.CEREBRAS_API_KEY,
  model: 'llama3.3-70b',
});
```

### Fireworks AI

```ts
import { createFireworksProvider } from 'confused-ai';

const llm = createFireworksProvider({
  apiKey: process.env.FIREWORKS_API_KEY,
  model: 'accounts/fireworks/models/llama-v3p3-70b-instruct',  // default
});
```

### SambaNova

```ts
import { createSambaNovaProvider } from 'confused-ai';

const llm = createSambaNovaProvider({
  apiKey: process.env.SAMBANOVA_API_KEY,
  model: 'Meta-Llama-3.3-70B-Instruct',
});
```

---

## Other cloud providers

### xAI (Grok)

```ts
import { createXAIProvider } from 'confused-ai';

const llm = createXAIProvider({
  apiKey: process.env.XAI_API_KEY,
  model: 'grok-3',  // default. Also: grok-3-mini, grok-2
});
```

### Together AI

```ts
import { createTogetherProvider } from 'confused-ai';

const llm = createTogetherProvider({
  apiKey: process.env.TOGETHER_API_KEY,
  model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',  // default
});
```

### DeepSeek

```ts
import { createDeepSeekProvider } from 'confused-ai';

const llm = createDeepSeekProvider({
  apiKey: process.env.DEEPSEEK_API_KEY,
  model: 'deepseek-chat',      // DeepSeek-V3 (default)
  // model: 'deepseek-reasoner'  // DeepSeek-R1
});
```

### Mistral AI

```ts
import { createMistralProvider } from 'confused-ai';

const llm = createMistralProvider({
  apiKey: process.env.MISTRAL_API_KEY,
  model: 'mistral-large-latest',  // default. Also: codestral-latest
});
```

### Perplexity (web-grounded)

```ts
import { createPerplexityProvider } from 'confused-ai';

const llm = createPerplexityProvider({
  apiKey: process.env.PERPLEXITY_API_KEY,
  model: 'sonar-pro',  // default. Also: sonar-reasoning-pro
});
```

### Cohere (Command R)

```ts
import { createCohereProvider } from 'confused-ai';

const llm = createCohereProvider({
  apiKey: process.env.COHERE_API_KEY,
  model: 'command-r-plus-08-2024',  // default
});
```

### NVIDIA NIM

```ts
import { createNvidiaProvider } from 'confused-ai';

const llm = createNvidiaProvider({
  apiKey: process.env.NVIDIA_API_KEY,
  model: 'meta/llama-3.3-70b-instruct',
});
```

### Hyperbolic

```ts
import { createHyperbolicProvider } from 'confused-ai';

const llm = createHyperbolicProvider({
  apiKey: process.env.HYPERBOLIC_API_KEY,
  model: 'meta-llama/Llama-3.3-70B-Instruct',
});
```

### Deep Infra

```ts
import { createDeepInfraProvider } from 'confused-ai';

const llm = createDeepInfraProvider({
  apiKey: process.env.DEEPINFRA_API_KEY,
  model: 'meta-llama/Meta-Llama-3.1-70B-Instruct',
});
```

### Hugging Face Inference API

```ts
import { createHuggingFaceProvider } from 'confused-ai';

const llm = createHuggingFaceProvider({
  apiKey: process.env.HF_API_KEY,
  model: 'meta-llama/Llama-3.3-70B-Instruct',
});
```

### Replicate

```ts
import { createReplicateProvider } from 'confused-ai';

const llm = createReplicateProvider({
  apiKey: process.env.REPLICATE_API_KEY,
  model: 'meta/meta-llama-3-70b-instruct',
});
```

---

## Enterprise

### Azure OpenAI

```ts
import { createAzureOpenAIProvider } from 'confused-ai';

const llm = createAzureOpenAIProvider({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  resource: process.env.AZURE_OPENAI_RESOURCE,      // Azure resource name
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT,  // deployment name
  apiVersion: '2025-01-01-preview',                 // default
});
```

### IBM watsonx.ai

```ts
import { createWatsonxProvider } from 'confused-ai';

const llm = createWatsonxProvider({
  apiKey: process.env.WATSONX_API_KEY,
  model: 'ibm/granite-13b-chat-v2',
});
```

### Snowflake Cortex

```ts
import { createSnowflakeProvider } from 'confused-ai';

const llm = createSnowflakeProvider({
  apiKey: process.env.SNOWFLAKE_API_KEY,
  model: 'snowflake-arctic-instruct',
});
```

### Cloudflare AI

```ts
import { createCloudflareProvider } from 'confused-ai';

const llm = createCloudflareProvider({
  apiKey: process.env.CLOUDFLARE_API_KEY,
  model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
});
```

---

## Self-hosted and local

### Ollama

```ts
import { OpenAIProvider } from 'confused-ai';

// Ollama exposes an OpenAI-compatible API on port 11434
const llm = new OpenAIProvider({
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama',   // required by the SDK, ignored by Ollama
  model: 'llama3.2',  // run: ollama pull llama3.2
});
```

### vLLM

```ts
import { createVllmProvider } from 'confused-ai';

const llm = createVllmProvider({
  baseURL: 'http://localhost:8000/v1',  // default (VLLM_BASE_URL env)
  model: 'meta-llama/Llama-3.3-70B-Instruct',
});
// Start server: vllm serve meta-llama/Llama-3.3-70B-Instruct --port 8000
```

### LM Studio

```ts
import { createLmStudioProvider } from 'confused-ai';

const llm = createLmStudioProvider({
  baseURL: 'http://localhost:1234/v1',  // default
  model: 'local-model',
});
```

### Generic OpenAI-compatible endpoint

```ts
import { createOpenAICompatibleProvider } from 'confused-ai';

const llm = createOpenAICompatibleProvider({
  baseURL: 'https://my-gateway.internal/v1',
  apiKey: process.env.MY_API_KEY!,
  model: 'my-fine-tuned-model',
});
```

---

## Chinese frontier providers

```ts
import {
  createHunyuanProvider,     // Tencent Hunyuan
  createVolcengineProvider,  // ByteDance Volcengine (Doubao)
  createMinimaxProvider,     // MiniMax
  createBaichuanProvider,    // Baichuan
  createStepfunProvider,     // Stepfun
  createInternLMProvider,    // InternLM (Shanghai AI Lab)
  createMoonshotProvider,    // Moonshot (Kimi)
  createDashScopeProvider,   // Alibaba DashScope (Qwen)
  createZhipuProvider,       // Zhipu AI (GLM)
  createYiProvider,          // 01.AI (Yi)
} from 'confused-ai';

const llm = createDashScopeProvider({
  apiKey: process.env.DASHSCOPE_API_KEY,
  model: 'qwen-max',
});
```

---

## Fallback chain

Chain multiple providers so failures cascade automatically.

```ts
import { FallbackChainProvider, FallbackStrategy } from 'confused-ai';

const llm = new FallbackChainProvider({
  providers: [
    createGroqProvider({ model: 'llama-3.1-8b-instant' }),  // fast, cheap
    new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY!, model: 'gpt-4o-mini' }),
    new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY!, model: 'gpt-4o' }),
  ],
  strategy: FallbackStrategy.ANY_ERROR,
  // strategy: FallbackStrategy.RATE_LIMIT  // cascade only on 429s
  debug: true,
});
```

**Strategies:** `ANY_ERROR` · `RATE_LIMIT` · `TIMEOUT` · `API_ERROR`

---

## Bring your own provider

Any object that satisfies this interface works:

```ts
interface LLMProvider {
  generateText(messages: Message[], options?: GenerateOptions): Promise<GenerateResult>;
  streamText?(messages: Message[], options?: StreamOptions): Promise<GenerateResult>;
}
```

---

## Where to go next

- [LLM Router](./llm-router) — route each request to the best model per task, cost, and speed.
- [Stream utilities](./stream-utils) — consume and transform provider streams.
- [Production](./production) — circuit breakers, budget limits, and observability for provider calls.
