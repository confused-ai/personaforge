/**
 * OpenAI-compatible provider factories for Groq, xAI, Together AI,
 * Fireworks AI, DeepSeek, Mistral, Cohere, and Perplexity.
 *
 * All these services expose an OpenAI-compatible REST API, so they
 * are thin wrappers around OpenAIProvider with a different base URL.
 */

import type { LLMProvider } from './types.js';
import { OpenAIProvider } from './openai-provider.js';

// ── Base URLs ──────────────────────────────────────────────────────────────

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const XAI_BASE_URL = 'https://api.x.ai/v1';
export const TOGETHER_BASE_URL = 'https://api.together.xyz/v1';
export const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
export const MISTRAL_BASE_URL = 'https://api.mistral.ai/v1';
export const COHERE_BASE_URL = 'https://api.cohere.com/compatibility/v1';
export const PERPLEXITY_BASE_URL = 'https://api.perplexity.ai';
export const AZURE_BASE_URL_TEMPLATE = 'https://{resource}.openai.azure.com/openai/deployments/{deployment}';

/**
 * Provider-specific capabilities for OpenAI-compatible endpoints.
 *
 * Every OpenAI-compatible factory accepts these to reach the long tail of
 * provider-unique features that fall outside the shared OpenAI subset:
 * reasoning-effort / thinking budgets (DeepSeek, Qwen, GLM, Hunyuan),
 * JSON-mode / `response_format` (Cohere, Perplexity, Mistral structured),
 * and non-standard auth headers (DashScope `X-DashScope-*`, Azure conventions).
 */
export interface OpenAICompatibleCapabilities {
    /** Extra HTTP headers (provider-specific auth, tracing, inspection). */
    readonly headers?: Record<string, string>;
    /** Extra JSON merged into the request body (provider-specific params). */
    readonly extraBody?: Record<string, unknown>;
}

// ── Groq ──────────────────────────────────────────────────────────────────

export interface GroqProviderConfig {
    readonly headers?: Record<string, string>;
    readonly extraBody?: Record<string, unknown>;
    /** Groq API key (or GROQ_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: llama-3.3-70b-versatile
     * Fast options: llama-3.1-8b-instant, gemma2-9b-it, mixtral-8x7b-32768
     */
    model?: string;
    debug?: boolean;
}

/** Ultra-fast inference via Groq's Language Processing Units (LPUs). */
export function createGroqProvider(config: GroqProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.GROQ_API_KEY : undefined);
    if (!apiKey) throw new Error('GroqProvider requires apiKey or GROQ_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: GROQ_BASE_URL,
        model: config.model ?? 'llama-3.3-70b-versatile',
        headers: config.headers,
        extraBody: config.extraBody,
        debug: config.debug,
    });
}

// ── xAI (Grok) ────────────────────────────────────────────────────────────

export interface XAIProviderConfig {
    readonly headers?: Record<string, string>;
    readonly extraBody?: Record<string, unknown>;
    /** xAI API key (or XAI_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: grok-3
     * Options: grok-3-mini, grok-2, grok-2-mini, grok-beta
     */
    model?: string;
    debug?: boolean;
}

/** xAI's Grok models — reasoning-capable, large-context. */
export function createXAIProvider(config: XAIProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.XAI_API_KEY : undefined);
    if (!apiKey) throw new Error('XAIProvider requires apiKey or XAI_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: XAI_BASE_URL,
        model: config.model ?? 'grok-3',
        headers: config.headers,
        extraBody: config.extraBody,
        debug: config.debug,
    });
}

// ── Together AI ───────────────────────────────────────────────────────────

export interface TogetherProviderConfig {
    readonly headers?: Record<string, string>;
    readonly extraBody?: Record<string, unknown>;
    /** Together AI API key (or TOGETHER_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: meta-llama/Llama-3.3-70B-Instruct-Turbo
     * Options: mistralai/Mixtral-8x22B-Instruct-v0.1, Qwen/Qwen2.5-72B-Instruct-Turbo, etc.
     */
    model?: string;
    debug?: boolean;
}

/** Together AI — open-source models at scale. */
export function createTogetherProvider(config: TogetherProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.TOGETHER_API_KEY : undefined);
    if (!apiKey) throw new Error('TogetherProvider requires apiKey or TOGETHER_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: TOGETHER_BASE_URL,
        model: config.model ?? 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        headers: config.headers,
        extraBody: config.extraBody,
        debug: config.debug,
    });
}

// ── Fireworks AI ──────────────────────────────────────────────────────────

export interface FireworksProviderConfig {
    readonly headers?: Record<string, string>;
    readonly extraBody?: Record<string, unknown>;
    /** Fireworks API key (or FIREWORKS_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: accounts/fireworks/models/llama-v3p3-70b-instruct
     * Fast: accounts/fireworks/models/llama-v3p1-8b-instruct
     */
    model?: string;
    debug?: boolean;
}

/** Fireworks AI — fast open-source model inference. */
export function createFireworksProvider(config: FireworksProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.FIREWORKS_API_KEY : undefined);
    if (!apiKey) throw new Error('FireworksProvider requires apiKey or FIREWORKS_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: FIREWORKS_BASE_URL,
        model: config.model ?? 'accounts/fireworks/models/llama-v3p3-70b-instruct',
        headers: config.headers,
        extraBody: config.extraBody,
        debug: config.debug,
    });
}

// ── DeepSeek ──────────────────────────────────────────────────────────────

export interface DeepSeekProviderConfig {
    readonly headers?: Record<string, string>;
    readonly extraBody?: Record<string, unknown>;
    /** DeepSeek API key (or DEEPSEEK_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: deepseek-chat (DeepSeek-V3)
     * Reasoning: deepseek-reasoner (DeepSeek-R1)
     */
    model?: string;
    debug?: boolean;
}

/** DeepSeek — high-performance models including DeepSeek-V3 and R1. */
export function createDeepSeekProvider(config: DeepSeekProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.DEEPSEEK_API_KEY : undefined);
    if (!apiKey) throw new Error('DeepSeekProvider requires apiKey or DEEPSEEK_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: DEEPSEEK_BASE_URL,
        model: config.model ?? 'deepseek-chat',
        headers: config.headers,
        extraBody: config.extraBody,
        debug: config.debug,
    });
}

// ── Mistral ───────────────────────────────────────────────────────────────

export interface MistralProviderConfig {
    readonly headers?: Record<string, string>;
    readonly extraBody?: Record<string, unknown>;
    /** Mistral API key (or MISTRAL_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: mistral-large-latest
     * Options: mistral-small-latest, mistral-medium-latest, codestral-latest, open-mistral-nemo
     */
    model?: string;
    debug?: boolean;
}

/** Mistral AI — European frontier models. */
export function createMistralProvider(config: MistralProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.MISTRAL_API_KEY : undefined);
    if (!apiKey) throw new Error('MistralProvider requires apiKey or MISTRAL_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: MISTRAL_BASE_URL,
        model: config.model ?? 'mistral-large-latest',
        headers: config.headers,
        extraBody: config.extraBody,
        debug: config.debug,
    });
}

// ── Cohere ────────────────────────────────────────────────────────────────

export interface CohereProviderConfig {
    readonly headers?: Record<string, string>;
    readonly extraBody?: Record<string, unknown>;
    /** Cohere API key (or COHERE_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: command-r-plus-08-2024
     * Options: command-r-08-2024, command-r7b-12-2024
     */
    model?: string;
    debug?: boolean;
}

/** Cohere — Command R models optimized for RAG and tool use. */
export function createCohereProvider(config: CohereProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.COHERE_API_KEY : undefined);
    if (!apiKey) throw new Error('CohereProvider requires apiKey or COHERE_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: COHERE_BASE_URL,
        model: config.model ?? 'command-r-plus-08-2024',
        headers: config.headers,
        extraBody: config.extraBody,
        debug: config.debug,
    });
}

// ── Perplexity ────────────────────────────────────────────────────────────

export interface PerplexityProviderConfig {
    readonly headers?: Record<string, string>;
    readonly extraBody?: Record<string, unknown>;
    /** Perplexity API key (or PERPLEXITY_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: sonar-pro
     * Options: sonar, sonar-reasoning-pro, sonar-reasoning, sonar-deep-research
     */
    model?: string;
    debug?: boolean;
}

/** Perplexity — web-grounded models with real-time search. */
export function createPerplexityProvider(config: PerplexityProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.PERPLEXITY_API_KEY : undefined);
    if (!apiKey) throw new Error('PerplexityProvider requires apiKey or PERPLEXITY_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: PERPLEXITY_BASE_URL,
        model: config.model ?? 'sonar-pro',
        headers: config.headers,
        extraBody: config.extraBody,
        debug: config.debug,
    });
}

// ── Azure OpenAI ──────────────────────────────────────────────────────────

export interface AzureOpenAIProviderConfig {
    /** Azure OpenAI API key (or AZURE_OPENAI_API_KEY env var) */
    apiKey?: string;
    /** Azure resource name (or AZURE_OPENAI_RESOURCE env var) */
    resource?: string;
    /** Azure deployment name (or AZURE_OPENAI_DEPLOYMENT env var) */
    deployment?: string;
    /** API version (default: 2025-01-01-preview) */
    apiVersion?: string;
    debug?: boolean;
}

/** Azure OpenAI — enterprise-grade OpenAI hosting. */
export function createAzureOpenAIProvider(config: AzureOpenAIProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.AZURE_OPENAI_API_KEY : undefined);
    const resource = config.resource ?? (typeof process !== 'undefined' ? process.env.AZURE_OPENAI_RESOURCE : undefined);
    const deployment = config.deployment ?? (typeof process !== 'undefined' ? process.env.AZURE_OPENAI_DEPLOYMENT : undefined);
    if (!apiKey) throw new Error('AzureOpenAIProvider requires apiKey or AZURE_OPENAI_API_KEY env var');
    if (!resource) throw new Error('AzureOpenAIProvider requires resource or AZURE_OPENAI_RESOURCE env var');
    if (!deployment) throw new Error('AzureOpenAIProvider requires deployment or AZURE_OPENAI_DEPLOYMENT env var');
    const apiVersion = config.apiVersion ?? '2025-01-01-preview';
    const baseURL = `https://${resource}.openai.azure.com/openai/deployments/${deployment}?api-version=${apiVersion}`;
    return new OpenAIProvider({ apiKey, baseURL, model: deployment, debug: config.debug });
}

// ── Custom / Generic OpenAI-compatible ────────────────────────────────────

export interface OpenAICompatibleProviderConfig {
    readonly headers?: Record<string, string>;
    readonly extraBody?: Record<string, unknown>;
    /**
     * Full base URL of any OpenAI-compatible endpoint.
     * Examples:
     *   - "http://localhost:11434/v1"         (Ollama)
     *   - "https://my-vllm.internal/v1"       (self-hosted vLLM)
     *   - "https://gateway.example.com/v1"    (custom gateway)
     */
    baseURL: string;
    /** API key — use "not-needed" or any non-empty string for unauthenticated endpoints. */
    apiKey: string;
    /** Model id to request. */
    model: string;
    /** Optional max-tokens override (currently passed through if supported by the endpoint). */
    maxTokens?: number;
    debug?: boolean;
}

/**
 * Generic factory for any OpenAI-compatible API.
 * Use this to integrate private deployments, custom gateways, or new providers
 * that expose the OpenAI `/chat/completions` interface.
 *
 * @example
 * const provider = createOpenAICompatibleProvider({
 *   baseURL: 'https://my-vllm.internal/v1',
 *   apiKey: process.env.MY_API_KEY!,
 *   model: 'my-fine-tuned-model',
 * });
 */
export function createOpenAICompatibleProvider(config: OpenAICompatibleProviderConfig): LLMProvider {
    if (!config.baseURL) throw new Error('createOpenAICompatibleProvider requires baseURL');
    if (!config.apiKey) throw new Error('createOpenAICompatibleProvider requires apiKey');
    if (!config.model) throw new Error('createOpenAICompatibleProvider requires model');
    return new OpenAIProvider({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        model: config.model,
        debug: config.debug,
        headers: config.headers,
        extraBody: config.extraBody,
    });
}

// ── Cerebras ──────────────────────────────────────────────────────────────

export const CEREBRAS_BASE_URL = 'https://api.cerebras.ai/v1';

export interface CerebrasProviderConfig {
    /** Cerebras API key (or CEREBRAS_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: llama-3.3-70b
     * Options: llama-3.1-8b, llama-3.1-70b, llama-3.3-70b
     * Note: Cerebras uses dash-separated names (llama-3.3-70b).
     */
    model?: string;
    debug?: boolean;
}

/** Cerebras — wafer-scale chip inference, ultra-low latency. */
export function createCerebrasProvider(config: CerebrasProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.CEREBRAS_API_KEY : undefined);
    if (!apiKey) throw new Error('CerebrasProvider requires apiKey or CEREBRAS_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: CEREBRAS_BASE_URL,
        model: config.model ?? 'llama-3.3-70b',
        debug: config.debug,
    });
}

// ── SambaNova ─────────────────────────────────────────────────────────────

export const SAMBANOVA_BASE_URL = 'https://api.sambanova.ai/v1';

export interface SambaNovaProviderConfig {
    /** SambaNova API key (or SAMBANOVA_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: Meta-Llama-3.3-70B-Instruct
     * Options: Meta-Llama-3.1-8B-Instruct, Meta-Llama-3.1-405B-Instruct,
     *          Qwen2.5-72B-Instruct, DeepSeek-R1
     */
    model?: string;
    debug?: boolean;
}

/** SambaNova — RDU-based high-throughput inference. */
export function createSambaNovaProvider(config: SambaNovaProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.SAMBANOVA_API_KEY : undefined);
    if (!apiKey) throw new Error('SambaNovaProvider requires apiKey or SAMBANOVA_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: SAMBANOVA_BASE_URL,
        model: config.model ?? 'Meta-Llama-3.3-70B-Instruct',
        debug: config.debug,
    });
}

// ── NVIDIA NIM ────────────────────────────────────────────────────────────

export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export interface NvidiaProviderConfig {
    /** NVIDIA API key (or NVIDIA_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: meta/llama-3.3-70b-instruct
     * Options: nvidia/llama-3.1-nemotron-ultra-253b-v1,
     *          mistralai/mixtral-8x22b-instruct-v0.1,
     *          google/gemma-3-27b-it, deepseek-ai/deepseek-r1
     */
    model?: string;
    debug?: boolean;
}

/** NVIDIA NIM — enterprise GPU microservices for AI inference. */
export function createNvidiaProvider(config: NvidiaProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.NVIDIA_API_KEY : undefined);
    if (!apiKey) throw new Error('NvidiaProvider requires apiKey or NVIDIA_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: NVIDIA_BASE_URL,
        model: config.model ?? 'meta/llama-3.3-70b-instruct',
        debug: config.debug,
    });
}

// ── AI21 Labs ─────────────────────────────────────────────────────────────

export const AI21_BASE_URL = 'https://api.ai21.com/studio/v1';

export interface AI21ProviderConfig {
    /** AI21 API key (or AI21_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: jamba-1.5-large
     * Options: jamba-1.5-mini, jamba-instruct
     */
    model?: string;
    debug?: boolean;
}

/** AI21 Labs — Jamba hybrid SSM-Transformer models. */
export function createAI21Provider(config: AI21ProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.AI21_API_KEY : undefined);
    if (!apiKey) throw new Error('AI21Provider requires apiKey or AI21_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: AI21_BASE_URL,
        model: config.model ?? 'jamba-1.5-large',
        debug: config.debug,
    });
}

// ── Hyperbolic ────────────────────────────────────────────────────────────

export const HYPERBOLIC_BASE_URL = 'https://api.hyperbolic.xyz/v1';

export interface HyperbolicProviderConfig {
    /** Hyperbolic API key (or HYPERBOLIC_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: meta-llama/Llama-3.3-70B-Instruct
     * Options: deepseek-ai/DeepSeek-R1, Qwen/Qwen2.5-72B-Instruct,
     *          meta-llama/Meta-Llama-3.1-405B-Instruct
     */
    model?: string;
    debug?: boolean;
}

/** Hyperbolic — low-cost GPU cloud inference for open models. */
export function createHyperbolicProvider(config: HyperbolicProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.HYPERBOLIC_API_KEY : undefined);
    if (!apiKey) throw new Error('HyperbolicProvider requires apiKey or HYPERBOLIC_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: HYPERBOLIC_BASE_URL,
        model: config.model ?? 'meta-llama/Llama-3.3-70B-Instruct',
        debug: config.debug,
    });
}

// ── Lambda Labs ───────────────────────────────────────────────────────────

export const LAMBDA_BASE_URL = 'https://api.lambdalabs.com/v1';

export interface LambdaProviderConfig {
    /** Lambda API key (or LAMBDA_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: llama3.3-70b-instruct-fp8
     * Options: llama3.1-8b-instruct, llama3.1-70b-instruct-fp8,
     *          llama3.1-405b-instruct-fp8, hermes3-405b
     */
    model?: string;
    debug?: boolean;
}

/** Lambda Labs — GPU cloud inference. */
export function createLambdaProvider(config: LambdaProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.LAMBDA_API_KEY : undefined);
    if (!apiKey) throw new Error('LambdaProvider requires apiKey or LAMBDA_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: LAMBDA_BASE_URL,
        model: config.model ?? 'llama3.3-70b-instruct-fp8',
        debug: config.debug,
    });
}

// ── Moonshot AI (Kimi) ────────────────────────────────────────────────────

export const MOONSHOT_BASE_URL = 'https://api.moonshot.cn/v1';

export interface MoonshotProviderConfig {
    readonly headers?: Record<string, string>;
    readonly extraBody?: Record<string, unknown>;
    /** Moonshot API key (or MOONSHOT_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: moonshot-v1-32k
     * Options: moonshot-v1-8k, moonshot-v1-128k, kimi-latest
     */
    model?: string;
    debug?: boolean;
}

/** Moonshot AI (Kimi) — Chinese frontier model with long context. */
export function createMoonshotProvider(config: MoonshotProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.MOONSHOT_API_KEY : undefined);
    if (!apiKey) throw new Error('MoonshotProvider requires apiKey or MOONSHOT_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: MOONSHOT_BASE_URL,
        model: config.model ?? 'moonshot-v1-32k',
        headers: config.headers,
        extraBody: config.extraBody,
        debug: config.debug,
    });
}

// ── Alibaba DashScope (Qwen) ──────────────────────────────────────────────

export const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export interface DashScopeProviderConfig {
    readonly headers?: Record<string, string>;
    readonly extraBody?: Record<string, unknown>;
    /** DashScope API key (or DASHSCOPE_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: qwen-max
     * Options: qwen-plus, qwen-turbo, qwen-long,
     *          qwen2.5-72b-instruct, qwq-32b
     */
    model?: string;
    debug?: boolean;
}

/** Alibaba DashScope — Qwen family models via OpenAI-compatible mode. */
export function createDashScopeProvider(config: DashScopeProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.DASHSCOPE_API_KEY : undefined);
    if (!apiKey) throw new Error('DashScopeProvider requires apiKey or DASHSCOPE_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: DASHSCOPE_BASE_URL,
        model: config.model ?? 'qwen-max',
        headers: config.headers,
        extraBody: config.extraBody,
        debug: config.debug,
    });
}

// ── Zhipu AI (GLM / BigModel) ─────────────────────────────────────────────

export const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';

export interface ZhipuProviderConfig {
    /** Zhipu API key (or ZHIPU_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: glm-4-plus
     * Options: glm-4, glm-4-air, glm-4-flash, glm-z1-flash
     */
    model?: string;
    debug?: boolean;
}

/** Zhipu AI — GLM series models from Tsinghua KEG. */
export function createZhipuProvider(config: ZhipuProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.ZHIPU_API_KEY : undefined);
    if (!apiKey) throw new Error('ZhipuProvider requires apiKey or ZHIPU_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: ZHIPU_BASE_URL,
        model: config.model ?? 'glm-4-plus',
        debug: config.debug,
    });
}

// ── 01.AI (Yi) ────────────────────────────────────────────────────────────

export const YI_BASE_URL = 'https://api.lingyiwanwu.com/v1';

export interface YiProviderConfig {
    /** 01.AI API key (or YI_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: yi-large
     * Options: yi-medium, yi-spark, yi-large-turbo, yi-large-rag
     */
    model?: string;
    debug?: boolean;
}

/** 01.AI — Yi large language models. */
export function createYiProvider(config: YiProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.YI_API_KEY : undefined);
    if (!apiKey) throw new Error('YiProvider requires apiKey or YI_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: YI_BASE_URL,
        model: config.model ?? 'yi-large',
        debug: config.debug,
    });
}

// ── Upstage (Solar) ───────────────────────────────────────────────────────

export const UPSTAGE_BASE_URL = 'https://api.upstage.ai/v1';

export interface UpstageProviderConfig {
    /** Upstage API key (or UPSTAGE_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: solar-pro
     * Options: solar-mini, solar-pro2
     */
    model?: string;
    debug?: boolean;
}

/** Upstage — Solar models optimized for enterprise RAG. */
export function createUpstageProvider(config: UpstageProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.UPSTAGE_API_KEY : undefined);
    if (!apiKey) throw new Error('UpstageProvider requires apiKey or UPSTAGE_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: UPSTAGE_BASE_URL,
        model: config.model ?? 'solar-pro',
        debug: config.debug,
    });
}

// ── Novita AI ─────────────────────────────────────────────────────────────

export const NOVITA_BASE_URL = 'https://api.novita.ai/v3/openai';

export interface NovitaProviderConfig {
    /** Novita API key (or NOVITA_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: meta-llama/llama-3.3-70b-instruct
     * Options: deepseek/deepseek-r1, qwen/qwen2.5-72b-instruct,
     *          mistralai/mistral-nemo
     */
    model?: string;
    debug?: boolean;
}

/** Novita AI — cost-efficient open-source model hosting. */
export function createNovitaProvider(config: NovitaProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.NOVITA_API_KEY : undefined);
    if (!apiKey) throw new Error('NovitaProvider requires apiKey or NOVITA_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: NOVITA_BASE_URL,
        model: config.model ?? 'meta-llama/llama-3.3-70b-instruct',
        debug: config.debug,
    });
}

// ── Cloudflare Workers AI ─────────────────────────────────────────────────

export interface CloudflareProviderConfig {
    /** Cloudflare API token (or CLOUDFLARE_API_KEY env var) */
    apiKey?: string;
    /** Cloudflare Account ID (or CLOUDFLARE_ACCOUNT_ID env var) */
    accountId?: string;
    /**
     * Model id (Cloudflare model name). Default: @cf/meta/llama-3.3-70b-instruct-fp8-fast
     * Options: @cf/deepseek-ai/deepseek-r1-distill-qwen-32b,
     *          @cf/mistral/mistral-7b-instruct-v0.1,
     *          @hf/google/gemma-7b-it
     */
    model?: string;
    debug?: boolean;
}

/** Cloudflare Workers AI — serverless GPU inference at the edge. */
export function createCloudflareProvider(config: CloudflareProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.CLOUDFLARE_API_KEY : undefined);
    const accountId = config.accountId ?? (typeof process !== 'undefined' ? process.env.CLOUDFLARE_ACCOUNT_ID : undefined);
    if (!apiKey) throw new Error('CloudflareProvider requires apiKey or CLOUDFLARE_API_KEY env var');
    if (!accountId) throw new Error('CloudflareProvider requires accountId or CLOUDFLARE_ACCOUNT_ID env var');
    const baseURL = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
    return new OpenAIProvider({
        apiKey,
        baseURL,
        model: config.model ?? '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        debug: config.debug,
    });
}

// ── Writer (Palmyra) ──────────────────────────────────────────────────────

export const WRITER_BASE_URL = 'https://api.writer.com/v1';

export interface WriterProviderConfig {
    /** Writer API key (or WRITER_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: palmyra-x5
     * Options: palmyra-x4, palmyra-med, palmyra-fin
     */
    model?: string;
    debug?: boolean;
}

/** Writer — Palmyra enterprise models for business use cases. */
export function createWriterProvider(config: WriterProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.WRITER_API_KEY : undefined);
    if (!apiKey) throw new Error('WriterProvider requires apiKey or WRITER_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: WRITER_BASE_URL,
        model: config.model ?? 'palmyra-x5',
        debug: config.debug,
    });
}

// ── Wave 2: DeepInfra, HuggingFace, Lepton, Featherless, Snowflake ─────────

export const DEEPINFRA_BASE_URL = 'https://api.deepinfra.com/v1/openai';
export const HUGGINGFACE_INFERENCE_BASE_URL = 'https://api-inference.huggingface.co/v1';
export const LEPTON_BASE_URL = 'https://api.lepton.ai/api/v1';
export const FEATHERLESS_BASE_URL = 'https://api.featherless.ai/v1';
export const SNOWFLAKE_BASE_URL = 'https://cortex.snowflake.com/v1';

export interface DeepInfraProviderConfig {
    apiKey?: string;
    /** Model id, e.g. meta-llama/Meta-Llama-3.1-70B-Instruct */
    model?: string;
    debug?: boolean;
}

/**
 * DeepInfra — serverless inference for 100+ open models.
 * Popular choices: meta-llama/Meta-Llama-3.1-70B-Instruct, mistralai/Mixtral-8x7B-Instruct-v0.1
 */
export function createDeepInfraProvider(config: DeepInfraProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.DEEPINFRA_API_KEY : undefined);
    if (!apiKey) throw new Error('DeepInfraProvider requires apiKey or DEEPINFRA_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: DEEPINFRA_BASE_URL,
        model: config.model ?? 'meta-llama/Meta-Llama-3.1-70B-Instruct',
        debug: config.debug,
    });
}

export interface HuggingFaceProviderConfig {
    apiKey?: string;
    /** Model repo id, e.g. mistralai/Mistral-7B-Instruct-v0.3 */
    model?: string;
    debug?: boolean;
}

/**
 * HuggingFace Inference API — OpenAI-compatible /v1 endpoint.
 * Works with all HF-hosted models that support the messages API.
 */
export function createHuggingFaceProvider(config: HuggingFaceProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.HUGGINGFACE_API_KEY : undefined);
    if (!apiKey) throw new Error('HuggingFaceProvider requires apiKey or HUGGINGFACE_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: HUGGINGFACE_INFERENCE_BASE_URL,
        model: config.model ?? 'mistralai/Mistral-7B-Instruct-v0.3',
        debug: config.debug,
    });
}

export interface LeptonProviderConfig {
    apiKey?: string;
    /** Model id, e.g. llama3-1-405b */
    model?: string;
    debug?: boolean;
}

/** Lepton AI — high-throughput managed inference. */
export function createLeptonProvider(config: LeptonProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.LEPTON_API_KEY : undefined);
    if (!apiKey) throw new Error('LeptonProvider requires apiKey or LEPTON_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: LEPTON_BASE_URL,
        model: config.model ?? 'llama3-1-405b',
        debug: config.debug,
    });
}

export interface FeatherlessProviderConfig {
    apiKey?: string;
    /** Model id, e.g. mistralai/Mistral-7B-Instruct-v0.3 */
    model?: string;
    debug?: boolean;
}

/** Featherless AI — serverless inference with no minimum commitments. */
export function createFeatherlessProvider(config: FeatherlessProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.FEATHERLESS_API_KEY : undefined);
    if (!apiKey) throw new Error('FeatherlessProvider requires apiKey or FEATHERLESS_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: FEATHERLESS_BASE_URL,
        model: config.model ?? 'mistralai/Mistral-7B-Instruct-v0.3',
        debug: config.debug,
    });
}

export interface SnowflakeProviderConfig {
    apiKey?: string;
    /** Snowflake Cortex model, e.g. snowflake-arctic, llama3-70b */
    model?: string;
    debug?: boolean;
}

/** Snowflake Cortex — LLM inference built into Snowflake Data Cloud. */
export function createSnowflakeProvider(config: SnowflakeProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.SNOWFLAKE_API_KEY : undefined);
    if (!apiKey) throw new Error('SnowflakeProvider requires apiKey or SNOWFLAKE_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: SNOWFLAKE_BASE_URL,
        model: config.model ?? 'snowflake-arctic',
        debug: config.debug,
    });
}

// ── Self-hosted / local ─────────────────────────────────────────────────────

export interface VllmProviderConfig {
    /** vLLM server base URL. Default: http://localhost:8000/v1 */
    baseURL?: string;
    apiKey?: string;
    model?: string;
    debug?: boolean;
}

/**
 * vLLM — self-hosted high-throughput LLM server.
 * Run with: vllm serve <model> --port 8000
 */
export function createVllmProvider(config: VllmProviderConfig = {}): LLMProvider {
    const baseURL = config.baseURL ??
        (typeof process !== 'undefined' ? process.env.VLLM_BASE_URL : undefined) ??
        'http://localhost:8000/v1';
    return new OpenAIProvider({
        apiKey: config.apiKey ?? (typeof process !== 'undefined' ? process.env.VLLM_API_KEY : undefined) ?? 'not-needed',
        baseURL,
        model: config.model ?? 'default',
        debug: config.debug,
    });
}

export interface LmStudioProviderConfig {
    /** LM Studio server URL. Default: http://localhost:1234/v1 */
    baseURL?: string;
    model?: string;
    debug?: boolean;
}

/**
 * LM Studio — run any GGUF model locally with a GUI.
 * Start the local server in LM Studio and point here.
 */
export function createLmStudioProvider(config: LmStudioProviderConfig = {}): LLMProvider {
    const baseURL = config.baseURL ??
        (typeof process !== 'undefined' ? process.env.LMSTUDIO_BASE_URL : undefined) ??
        'http://localhost:1234/v1';
    return new OpenAIProvider({
        apiKey: 'not-needed',
        baseURL,
        model: config.model ?? 'local-model',
        debug: config.debug,
    });
}

// ── Wave 4: Chinese frontier providers ────────────────────────────────────

export const HUNYUAN_BASE_URL = 'https://api.hunyuan.cloud.tencent.com/v1';

export interface HunyuanProviderConfig {
    /** Tencent Hunyuan API key (or HUNYUAN_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: hunyuan-pro
     * Options: hunyuan-standard, hunyuan-lite, hunyuan-turbo, hunyuan-vision-pro
     */
    model?: string;
    debug?: boolean;
}

/** Tencent Hunyuan — frontier Chinese LLM from Tencent. */
export function createHunyuanProvider(config: HunyuanProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.HUNYUAN_API_KEY : undefined);
    if (!apiKey) throw new Error('HunyuanProvider requires apiKey or HUNYUAN_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: HUNYUAN_BASE_URL,
        model: config.model ?? 'hunyuan-pro',
        debug: config.debug,
    });
}

// ── Volcengine ARK (ByteDance DouBao) ──────────────────────────────────────

export const VOLCENGINE_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';

export interface VolcengineProviderConfig {
    /** Volcengine ARK API key (or VOLCENGINE_API_KEY / ARK_API_KEY env var) */
    apiKey?: string;
    /**
     * Endpoint ID for your deployed model (required — format: ep-xxxxxxxx-xxxxx).
     * Create an endpoint at https://console.volcengine.com/ark
     */
    model: string;
    debug?: boolean;
}

/** Volcengine ARK — ByteDance's DouBao/Skylark models. Requires a model endpoint ID. */
export function createVolcengineProvider(config: VolcengineProviderConfig): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined'
        ? (process.env.VOLCENGINE_API_KEY ?? process.env.ARK_API_KEY)
        : undefined);
    if (!apiKey) throw new Error('VolcengineProvider requires apiKey or VOLCENGINE_API_KEY / ARK_API_KEY env var');
    if (!config.model) throw new Error('VolcengineProvider requires model (endpoint ID, e.g. ep-xxxxxxxx-xxxxx)');
    return new OpenAIProvider({
        apiKey,
        baseURL: VOLCENGINE_BASE_URL,
        model: config.model,
        debug: config.debug,
    });
}

// ── Minimax ────────────────────────────────────────────────────────────────

export const MINIMAX_BASE_URL = 'https://api.minimax.chat/v1';

export interface MinimaxProviderConfig {
    /** Minimax API key (or MINIMAX_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: MiniMax-Text-01
     * Options: abab6.5s-chat, abab6.5t-chat, abab5.5-chat
     */
    model?: string;
    debug?: boolean;
}

/** Minimax AI — flagship MiniMax-Text and abab model series. */
export function createMinimaxProvider(config: MinimaxProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.MINIMAX_API_KEY : undefined);
    if (!apiKey) throw new Error('MinimaxProvider requires apiKey or MINIMAX_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: MINIMAX_BASE_URL,
        model: config.model ?? 'MiniMax-Text-01',
        debug: config.debug,
    });
}

// ── Baichuan AI ────────────────────────────────────────────────────────────

export const BAICHUAN_BASE_URL = 'https://api.baichuan-ai.com/v1';

export interface BaichuanProviderConfig {
    /** Baichuan API key (or BAICHUAN_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: Baichuan4-Turbo
     * Options: Baichuan4-Air, Baichuan3-Turbo, Baichuan3-Turbo-128k
     */
    model?: string;
    debug?: boolean;
}

/** Baichuan AI — Baichuan series bilingual (zh/en) models. */
export function createBaichuanProvider(config: BaichuanProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.BAICHUAN_API_KEY : undefined);
    if (!apiKey) throw new Error('BaichuanProvider requires apiKey or BAICHUAN_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: BAICHUAN_BASE_URL,
        model: config.model ?? 'Baichuan4-Turbo',
        debug: config.debug,
    });
}

// ── Stepfun ────────────────────────────────────────────────────────────────

export const STEPFUN_BASE_URL = 'https://api.stepfun.com/v1';

export interface StepfunProviderConfig {
    /** Stepfun API key (or STEPFUN_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: step-2-16k
     * Options: step-1-8k, step-1-32k, step-1-128k, step-1-256k, step-1v-8k (vision)
     */
    model?: string;
    debug?: boolean;
}

/** Stepfun — Step-1/Step-2 large language models (Shanghai). */
export function createStepfunProvider(config: StepfunProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.STEPFUN_API_KEY : undefined);
    if (!apiKey) throw new Error('StepfunProvider requires apiKey or STEPFUN_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: STEPFUN_BASE_URL,
        model: config.model ?? 'step-2-16k',
        debug: config.debug,
    });
}

// ── InternLM (Shanghai AI Lab) ─────────────────────────────────────────────

export const INTERNLM_BASE_URL = 'https://internlm-chat.intern-ai.org.cn/puyu/api/v1';

export interface InternLMProviderConfig {
    /** InternLM API key (or INTERNLM_API_KEY env var) */
    apiKey?: string;
    /**
     * Model id. Default: internlm2.5-latest
     * Options: internlm2.5-7b-chat, internlm2.5-20b-chat
     */
    model?: string;
    debug?: boolean;
}

/** InternLM — open-source InternLM2.5 series by Shanghai AI Lab. */
export function createInternLMProvider(config: InternLMProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.INTERNLM_API_KEY : undefined);
    if (!apiKey) throw new Error('InternLMProvider requires apiKey or INTERNLM_API_KEY env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: INTERNLM_BASE_URL,
        model: config.model ?? 'internlm2.5-latest',
        debug: config.debug,
    });
}

// ── Wave 4: Global cloud providers ────────────────────────────────────────

export const REPLICATE_BASE_URL = 'https://openai-compat.replicate.com/v1';

export interface ReplicateProviderConfig {
    /** Replicate API token (or REPLICATE_API_TOKEN / REPLICATE_API_KEY env var) */
    apiKey?: string;
    /**
     * Model identifier. Default: meta/meta-llama-3-70b-instruct
     * Format: owner/model-name (e.g. mistralai/mixtral-8x7b-instruct-v0-1)
     */
    model?: string;
    debug?: boolean;
}

/** Replicate — run open-source models via serverless GPU. */
export function createReplicateProvider(config: ReplicateProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined'
        ? (process.env.REPLICATE_API_TOKEN ?? process.env.REPLICATE_API_KEY)
        : undefined);
    if (!apiKey) throw new Error('ReplicateProvider requires apiKey or REPLICATE_API_TOKEN env var');
    return new OpenAIProvider({
        apiKey,
        baseURL: REPLICATE_BASE_URL,
        model: config.model ?? 'meta/meta-llama-3-70b-instruct',
        debug: config.debug,
    });
}

// ── RunPod ─────────────────────────────────────────────────────────────────

export interface RunPodProviderConfig {
    /** RunPod API key (or RUNPOD_API_KEY env var) */
    apiKey?: string;
    /**
     * Your RunPod serverless endpoint ID (required).
     * Find it in https://www.runpod.io/console/serverless
     */
    endpointId: string;
    /**
     * Model id served by the endpoint. Default: default
     * Some RunPod endpoints serve a fixed model and ignore this field.
     */
    model?: string;
    debug?: boolean;
}

/** RunPod — serverless GPU inference on your own RunPod endpoint. */
export function createRunPodProvider(config: RunPodProviderConfig): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined' ? process.env.RUNPOD_API_KEY : undefined);
    if (!apiKey) throw new Error('RunPodProvider requires apiKey or RUNPOD_API_KEY env var');
    if (!config.endpointId) throw new Error('RunPodProvider requires endpointId');
    const baseURL = `https://api.runpod.ai/v2/${config.endpointId}/openai/v1`;
    return new OpenAIProvider({
        apiKey,
        baseURL,
        model: config.model ?? 'default',
        debug: config.debug,
    });
}

// ── IBM watsonx.ai ─────────────────────────────────────────────────────────

export const WATSONX_REGION_URLS: Record<string, string> = {
    'us-south': 'https://us-south.ml.cloud.ibm.com/ml/v1',
    'eu-de':    'https://eu-de.ml.cloud.ibm.com/ml/v1',
    'eu-gb':    'https://eu-gb.ml.cloud.ibm.com/ml/v1',
    'jp-tok':   'https://jp-tok.ml.cloud.ibm.com/ml/v1',
    'au-syd':   'https://au-syd.ml.cloud.ibm.com/ml/v1',
};

export interface WatsonxProviderConfig {
    /**
     * Pre-obtained IBM IAM Bearer token (or WATSONX_API_KEY / IBMCLOUD_API_KEY env var).
     * Generate with: ibmcloud iam oauth-tokens
     */
    apiKey?: string;
    /** watsonx.ai region. Default: us-south */
    region?: string;
    /**
     * Model id. Default: meta-llama/llama-3-70b-instruct
     * Options: ibm/granite-13b-chat-v2, mistralai/mixtral-8x7b-instruct-v01,
     *          google/flan-ul2
     */
    model?: string;
    debug?: boolean;
}

/**
 * IBM watsonx.ai — enterprise AI with Granite and open models.
 * Note: Requires a pre-obtained IBM IAM Bearer token as apiKey.
 */
export function createWatsonxProvider(config: WatsonxProviderConfig = {}): LLMProvider {
    const apiKey = config.apiKey ?? (typeof process !== 'undefined'
        ? (process.env.WATSONX_API_KEY ?? process.env.IBMCLOUD_API_KEY)
        : undefined);
    if (!apiKey) throw new Error('WatsonxProvider requires apiKey (IBM IAM token) or WATSONX_API_KEY env var');
    const region = config.region ?? (typeof process !== 'undefined' ? process.env.WATSONX_REGION : undefined) ?? 'us-south';
    const regionBase = WATSONX_REGION_URLS[region] ?? `https://${region}.ml.cloud.ibm.com/ml/v1`;
    // watsonx exposes OpenAI-compatible /text/chat — versioned via query param
    const baseURL = `${regionBase}/text/chat?version=2023-05-29`;
    return new OpenAIProvider({
        apiKey,
        baseURL,
        model: config.model ?? 'meta-llama/llama-3-70b-instruct',
        debug: config.debug,
    });
}

// ── Wave 4: Additional self-hosted / local providers ───────────────────────

export interface LocalAIProviderConfig {
    /** LocalAI server URL. Default: http://localhost:8080/v1 */
    baseURL?: string;
    /** API key if your LocalAI server is auth-protected. */
    apiKey?: string;
    /**
     * Model name as configured in LocalAI (e.g. ggml-gpt4all-j, llama-3).
     * Default: ggml-gpt4all-j
     */
    model?: string;
    debug?: boolean;
}

/**
 * LocalAI — drop-in OpenAI replacement running locally.
 * https://localai.io — supports GGUF, GPTQ, AWQ, and more.
 */
export function createLocalAIProvider(config: LocalAIProviderConfig = {}): LLMProvider {
    const baseURL = config.baseURL ??
        (typeof process !== 'undefined' ? process.env.LOCALAI_BASE_URL : undefined) ??
        'http://localhost:8080/v1';
    return new OpenAIProvider({
        apiKey: config.apiKey ?? (typeof process !== 'undefined' ? process.env.LOCALAI_API_KEY : undefined) ?? 'not-needed',
        baseURL,
        model: config.model ?? 'ggml-gpt4all-j',
        debug: config.debug,
    });
}

export interface KoboldProviderConfig {
    /** KoboldCpp server URL. Default: http://localhost:5001/v1 */
    baseURL?: string;
    /**
     * Model name. Default: local-model
     * KoboldCpp serves whatever GGUF is loaded; this is passed for completeness.
     */
    model?: string;
    debug?: boolean;
}

/**
 * KoboldCpp — GGUF CPU/GPU inference with an OpenAI-compatible API.
 * https://github.com/LostRuins/koboldcpp
 */
export function createKoboldProvider(config: KoboldProviderConfig = {}): LLMProvider {
    const baseURL = config.baseURL ??
        (typeof process !== 'undefined' ? process.env.KOBOLD_BASE_URL : undefined) ??
        'http://localhost:5001/v1';
    return new OpenAIProvider({
        apiKey: 'not-needed',
        baseURL,
        model: config.model ?? 'local-model',
        debug: config.debug,
    });
}

export interface TextGenWebUIProviderConfig {
    /** Text Generation WebUI server URL. Default: http://localhost:7860/v1 */
    baseURL?: string;
    /** API key if --api-key is set in the WebUI launch options. */
    apiKey?: string;
    /** Model name. Default: local-model */
    model?: string;
    debug?: boolean;
}

/**
 * Text Generation WebUI (oobabooga) — OpenAI-compatible local inference.
 * Start with --api flag: python server.py --api
 * https://github.com/oobabooga/text-generation-webui
 */
export function createTextGenWebUIProvider(config: TextGenWebUIProviderConfig = {}): LLMProvider {
    const baseURL = config.baseURL ??
        (typeof process !== 'undefined' ? process.env.TEXTGENWEBUI_BASE_URL : undefined) ??
        'http://localhost:7860/v1';
    return new OpenAIProvider({
        apiKey: config.apiKey ?? (typeof process !== 'undefined' ? process.env.TEXTGENWEBUI_API_KEY : undefined) ?? 'not-needed',
        baseURL,
        model: config.model ?? 'local-model',
        debug: config.debug,
    });
}

export interface JanProviderConfig {
    /** Jan local server URL. Default: http://localhost:1337/v1 */
    baseURL?: string;
    /**
     * Model id as listed in Jan (e.g. llama3.2-3b-instruct, mistral-7b-instruct).
     * Default: llama3.2-3b-instruct
     */
    model?: string;
    debug?: boolean;
}

/**
 * Jan — open-source, offline-capable AI assistant with an OpenAI-compatible server.
 * https://jan.ai
 */
export function createJanProvider(config: JanProviderConfig = {}): LLMProvider {
    const baseURL = config.baseURL ??
        (typeof process !== 'undefined' ? process.env.JAN_BASE_URL : undefined) ??
        'http://localhost:1337/v1';
    return new OpenAIProvider({
        apiKey: 'not-needed',
        baseURL,
        model: config.model ?? 'llama3.2-3b-instruct',
        debug: config.debug,
    });
}

