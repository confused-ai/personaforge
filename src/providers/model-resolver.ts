/**
 * Model string resolver: "provider:model_id" ("provider/model_id" alias) → provider config.
 *
 * Supported providers:
 *   openai, anthropic, google, groq, xai, together, fireworks,
 *   deepseek, mistral, cohere, perplexity, openrouter, ollama,
 *   azure, llamabarn, cerebras, sambanova, nvidia, ai21,
 *   hyperbolic, lambda, moonshot, dashscope, zhipu, yi,
 *   upstage, novita, writer, cloudflare, deepinfra, replicate,
 *   huggingface, lepton, vllm, lmstudio, snowflake, watsonx,
 *   featherless, hunyuan, volcengine, minimax, baichuan,
 *   stepfun, internlm, runpod, localai, kobold, textgenwebui, jan
 */

export const PROVIDER = {
    OPENAI: 'openai',
    ANTHROPIC: 'anthropic',
    GOOGLE: 'google',
    GROQ: 'groq',
    XAI: 'xai',
    TOGETHER: 'together',
    FIREWORKS: 'fireworks',
    DEEPSEEK: 'deepseek',
    MISTRAL: 'mistral',
    COHERE: 'cohere',
    PERPLEXITY: 'perplexity',
    OPENROUTER: 'openrouter',
    OLLAMA: 'ollama',
    AZURE: 'azure',
    LLAMABARN: 'llamabarn',
    // ── New providers ──────────────────────────────────────────────────
    CEREBRAS: 'cerebras',
    SAMBANOVA: 'sambanova',
    NVIDIA: 'nvidia',
    AI21: 'ai21',
    HYPERBOLIC: 'hyperbolic',
    LAMBDA: 'lambda',
    MOONSHOT: 'moonshot',
    DASHSCOPE: 'dashscope',
    ZHIPU: 'zhipu',
    YI: 'yi',
    UPSTAGE: 'upstage',
    NOVITA: 'novita',
    WRITER: 'writer',
    // ── Wave 2 additions ──────────────────────────────────────────────
    CLOUDFLARE: 'cloudflare',
    DEEPINFRA: 'deepinfra',
    REPLICATE: 'replicate',
    HUGGINGFACE: 'huggingface',
    LEPTON: 'lepton',
    VLLM: 'vllm',
    LMSTUDIO: 'lmstudio',
    SNOWFLAKE: 'snowflake',
    WATSONX: 'watsonx',
    FEATHERLESS: 'featherless',
    // ── Wave 4 — Chinese frontier ────────────────────────────────
    HUNYUAN: 'hunyuan',
    VOLCENGINE: 'volcengine',
    MINIMAX: 'minimax',
    BAICHUAN: 'baichuan',
    STEPFUN: 'stepfun',
    INTERNLM: 'internlm',
    // ── Wave 4 — Global cloud ────────────────────────────────────
    RUNPOD: 'runpod',
    // ── Additional self-hosted ─────────────────────────────────────────────
    LOCALAI: 'localai',
    KOBOLD: 'kobold',
    TEXTGENWEBUI: 'textgenwebui',
    JAN: 'jan',
} as const;

export type ProviderName = (typeof PROVIDER)[keyof typeof PROVIDER];

// ── Base URLs ──────────────────────────────────────────────────────────────

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const OLLAMA_BASE_URL = 'http://localhost:11434/v1';
export const LLAMABARN_BASE_URL = 'http://localhost:2276/v1';
export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const XAI_BASE_URL = 'https://api.x.ai/v1';
export const TOGETHER_BASE_URL = 'https://api.together.xyz/v1';
export const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';
export const MISTRAL_BASE_URL = 'https://api.mistral.ai/v1';
export const COHERE_BASE_URL = 'https://api.cohere.com/compatibility/v1';
export const PERPLEXITY_BASE_URL = 'https://api.perplexity.ai';
export const CEREBRAS_BASE_URL = 'https://api.cerebras.ai/v1';
export const SAMBANOVA_BASE_URL = 'https://api.sambanova.ai/v1';
export const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
export const AI21_BASE_URL = 'https://api.ai21.com/studio/v1';
export const HYPERBOLIC_BASE_URL = 'https://api.hyperbolic.xyz/v1';
export const LAMBDA_BASE_URL = 'https://api.lambdalabs.com/v1';
export const MOONSHOT_BASE_URL = 'https://api.moonshot.cn/v1';
export const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const ZHIPU_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
export const YI_BASE_URL = 'https://api.lingyiwanwu.com/v1';
export const UPSTAGE_BASE_URL = 'https://api.upstage.ai/v1';
export const NOVITA_BASE_URL = 'https://api.novita.ai/v3/openai';
export const WRITER_BASE_URL = 'https://api.writer.com/v1';
export const DEEPINFRA_BASE_URL = 'https://api.deepinfra.com/v1/openai';
export const REPLICATE_BASE_URL = 'https://api.replicate.com/v1';
export const LEPTON_BASE_URL = 'https://api.lepton.ai/api/v1';
export const VLLM_BASE_URL = 'http://localhost:8000/v1';
export const LMSTUDIO_BASE_URL = 'http://localhost:1234/v1';
export const SNOWFLAKE_BASE_URL = 'https://cortex.snowflake.com/v1';
export const WATSONX_BASE_URL = 'https://us-south.ml.cloud.ibm.com/ml/v1/text/generation';
export const FEATHERLESS_BASE_URL = 'https://api.featherless.ai/v1';
// Wave 4 Chinese
export const HUNYUAN_BASE_URL = 'https://api.hunyuan.cloud.tencent.com/v1';
export const VOLCENGINE_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3';
export const MINIMAX_BASE_URL = 'https://api.minimax.chat/v1';
export const BAICHUAN_BASE_URL = 'https://api.baichuan-ai.com/v1';
export const STEPFUN_BASE_URL = 'https://api.stepfun.com/v1';
export const INTERNLM_BASE_URL = 'https://internlm-chat.intern-ai.org.cn/puyu/api/v1';
// Wave 4 global / self-hosted
export const REPLICATE_COMPAT_BASE_URL = 'https://openai-compat.replicate.com/v1';
export const LOCALAI_BASE_URL = 'http://localhost:8080/v1';
export const KOBOLD_BASE_URL = 'http://localhost:5001/v1';
export const TEXTGENWEBUI_BASE_URL = 'http://localhost:7860/v1';
export const JAN_BASE_URL = 'http://localhost:1337/v1';

// ── Env var names ──────────────────────────────────────────────────────────

const ENV: Record<string, string> = {
    OPENAI: 'OPENAI_API_KEY',
    ANTHROPIC: 'ANTHROPIC_API_KEY',
    GOOGLE: 'GOOGLE_API_KEY',         // also accepts GEMINI_API_KEY
    GROQ: 'GROQ_API_KEY',
    XAI: 'XAI_API_KEY',
    TOGETHER: 'TOGETHER_API_KEY',
    FIREWORKS: 'FIREWORKS_API_KEY',
    DEEPSEEK: 'DEEPSEEK_API_KEY',
    MISTRAL: 'MISTRAL_API_KEY',
    COHERE: 'COHERE_API_KEY',
    PERPLEXITY: 'PERPLEXITY_API_KEY',
    OPENROUTER: 'OPENROUTER_API_KEY',
    LLAMABARN: 'LLAMABARN_API_KEY',
    CEREBRAS: 'CEREBRAS_API_KEY',
    SAMBANOVA: 'SAMBANOVA_API_KEY',
    NVIDIA: 'NVIDIA_API_KEY',
    AI21: 'AI21_API_KEY',
    HYPERBOLIC: 'HYPERBOLIC_API_KEY',
    LAMBDA: 'LAMBDA_API_KEY',
    MOONSHOT: 'MOONSHOT_API_KEY',
    DASHSCOPE: 'DASHSCOPE_API_KEY',
    ZHIPU: 'ZHIPU_API_KEY',
    YI: 'YI_API_KEY',
    UPSTAGE: 'UPSTAGE_API_KEY',
    NOVITA: 'NOVITA_API_KEY',
    WRITER: 'WRITER_API_KEY',
    CLOUDFLARE: 'CLOUDFLARE_API_KEY',
    DEEPINFRA: 'DEEPINFRA_API_KEY',
    REPLICATE: 'REPLICATE_API_TOKEN',
    HUGGINGFACE: 'HUGGINGFACE_API_KEY',
    LEPTON: 'LEPTON_API_KEY',
    SNOWFLAKE: 'SNOWFLAKE_API_KEY',
    WATSONX: 'WATSONX_API_KEY',
    FEATHERLESS: 'FEATHERLESS_API_KEY',
    // Wave 4
    HUNYUAN: 'HUNYUAN_API_KEY',
    VOLCENGINE: 'VOLCENGINE_API_KEY',
    MINIMAX: 'MINIMAX_API_KEY',
    BAICHUAN: 'BAICHUAN_API_KEY',
    STEPFUN: 'STEPFUN_API_KEY',
    INTERNLM: 'INTERNLM_API_KEY',
    RUNPOD: 'RUNPOD_API_KEY',
};

export interface ResolvedModelConfig {
    /** Base URL for OpenAI-compatible providers. Undefined → native SDK (anthropic, google). */
    baseURL?: string;
    apiKey?: string;
    model: string;
    /** Which SDK to use when baseURL is absent */
    nativeProvider?: 'anthropic' | 'google';
}

type EnvFn = (key: string) => string | undefined;

function env(getEnv: EnvFn | undefined, key: string): string | undefined {
    return getEnv ? getEnv(key) : undefined;
}

/**
 * Resolve "provider:model_id" → config (`provider/model_id` also accepted).
 * Returns undefined when the string doesn't contain a recognised provider prefix.
 */
export function resolveModelString(
    modelStr: string,
    getEnv?: EnvFn,
): ResolvedModelConfig | undefined {
    const ge = getEnv ?? (typeof process !== 'undefined' ? (k: string) => process.env?.[k] : undefined);
    const colon = modelStr.indexOf(':');
    const slash = modelStr.indexOf('/');
    const sep = colon > 0 ? colon : slash;
    if (sep <= 0) return undefined;

    const provider = modelStr.slice(0, sep).trim().toLowerCase() as ProviderName;
    const modelId = modelStr.slice(sep + 1).trim();
    if (!modelId) return undefined;

    switch (provider) {
        case PROVIDER.OPENAI:
            return { apiKey: env(ge, ENV.OPENAI), model: modelId };

        case PROVIDER.ANTHROPIC:
            return {
                apiKey: env(ge, ENV.ANTHROPIC),
                model: modelId,
                nativeProvider: 'anthropic',
            };

        case PROVIDER.GOOGLE:
            return {
                apiKey: env(ge, ENV.GOOGLE) ?? env(ge, 'GEMINI_API_KEY'),
                model: modelId,
                nativeProvider: 'google',
            };

        case PROVIDER.GROQ:
            return { baseURL: GROQ_BASE_URL, apiKey: env(ge, ENV.GROQ), model: modelId };

        case PROVIDER.XAI:
            return { baseURL: XAI_BASE_URL, apiKey: env(ge, ENV.XAI), model: modelId };

        case PROVIDER.TOGETHER:
            return { baseURL: TOGETHER_BASE_URL, apiKey: env(ge, ENV.TOGETHER), model: modelId };

        case PROVIDER.FIREWORKS:
            return { baseURL: FIREWORKS_BASE_URL, apiKey: env(ge, ENV.FIREWORKS), model: modelId };

        case PROVIDER.DEEPSEEK:
            return { baseURL: DEEPSEEK_BASE_URL, apiKey: env(ge, ENV.DEEPSEEK), model: modelId };

        case PROVIDER.MISTRAL:
            return { baseURL: MISTRAL_BASE_URL, apiKey: env(ge, ENV.MISTRAL), model: modelId };

        case PROVIDER.COHERE:
            return { baseURL: COHERE_BASE_URL, apiKey: env(ge, ENV.COHERE), model: modelId };

        case PROVIDER.PERPLEXITY:
            return { baseURL: PERPLEXITY_BASE_URL, apiKey: env(ge, ENV.PERPLEXITY), model: modelId };

        case PROVIDER.OPENROUTER:
            return { baseURL: OPENROUTER_BASE_URL, apiKey: env(ge, ENV.OPENROUTER), model: modelId };

        case PROVIDER.OLLAMA:
            return { baseURL: OLLAMA_BASE_URL, apiKey: 'not-needed', model: modelId };

        case PROVIDER.LLAMABARN:
            return {
                baseURL: LLAMABARN_BASE_URL,
                apiKey: env(ge, ENV.LLAMABARN) ?? 'not-needed',
                model: modelId,
            };

        case PROVIDER.CEREBRAS:
            return { baseURL: CEREBRAS_BASE_URL, apiKey: env(ge, ENV.CEREBRAS), model: modelId };

        case PROVIDER.SAMBANOVA:
            return { baseURL: SAMBANOVA_BASE_URL, apiKey: env(ge, ENV.SAMBANOVA), model: modelId };

        case PROVIDER.NVIDIA:
            return { baseURL: NVIDIA_BASE_URL, apiKey: env(ge, ENV.NVIDIA), model: modelId };

        case PROVIDER.AI21:
            return { baseURL: AI21_BASE_URL, apiKey: env(ge, ENV.AI21), model: modelId };

        case PROVIDER.HYPERBOLIC:
            return { baseURL: HYPERBOLIC_BASE_URL, apiKey: env(ge, ENV.HYPERBOLIC), model: modelId };

        case PROVIDER.LAMBDA:
            return { baseURL: LAMBDA_BASE_URL, apiKey: env(ge, ENV.LAMBDA), model: modelId };

        case PROVIDER.MOONSHOT:
            return { baseURL: MOONSHOT_BASE_URL, apiKey: env(ge, ENV.MOONSHOT), model: modelId };

        case PROVIDER.DASHSCOPE:
            return { baseURL: DASHSCOPE_BASE_URL, apiKey: env(ge, ENV.DASHSCOPE), model: modelId };

        case PROVIDER.ZHIPU:
            return { baseURL: ZHIPU_BASE_URL, apiKey: env(ge, ENV.ZHIPU), model: modelId };

        case PROVIDER.YI:
            return { baseURL: YI_BASE_URL, apiKey: env(ge, ENV.YI), model: modelId };

        case PROVIDER.UPSTAGE:
            return { baseURL: UPSTAGE_BASE_URL, apiKey: env(ge, ENV.UPSTAGE), model: modelId };

        case PROVIDER.NOVITA:
            return { baseURL: NOVITA_BASE_URL, apiKey: env(ge, ENV.NOVITA), model: modelId };

        case PROVIDER.WRITER:
            return { baseURL: WRITER_BASE_URL, apiKey: env(ge, ENV.WRITER), model: modelId };

        case PROVIDER.CLOUDFLARE: {
            // format: cloudflare:account_id/model or just cloudflare:@cf/model
            const accountId = env(ge, 'CLOUDFLARE_ACCOUNT_ID') ?? modelId.split('/')[0];
            const cfModel = modelId.includes('/') ? modelId.split('/').slice(1).join('/') : modelId;
            return {
                baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
                apiKey: env(ge, ENV.CLOUDFLARE),
                model: cfModel.startsWith('@') ? cfModel : `@cf/${cfModel}`,
            };
        }

        case PROVIDER.DEEPINFRA:
            return { baseURL: DEEPINFRA_BASE_URL, apiKey: env(ge, ENV.DEEPINFRA), model: modelId };

        case PROVIDER.REPLICATE:
            // Replicate uses OpenAI-compat endpoint for language models
            return { baseURL: REPLICATE_BASE_URL, apiKey: env(ge, ENV.REPLICATE), model: modelId };

        case PROVIDER.HUGGINGFACE:
            // HuggingFace Inference API — OpenAI-compat endpoint
            return {
                baseURL: 'https://api-inference.huggingface.co/v1',
                apiKey: env(ge, ENV.HUGGINGFACE),
                model: modelId,
            };

        case PROVIDER.LEPTON:
            return { baseURL: LEPTON_BASE_URL, apiKey: env(ge, ENV.LEPTON), model: modelId };

        case PROVIDER.VLLM:
            // vLLM self-hosted — VLLM_BASE_URL env override for custom deployments
            return {
                baseURL: env(ge, 'VLLM_BASE_URL') ?? VLLM_BASE_URL,
                apiKey: env(ge, 'VLLM_API_KEY') ?? 'not-needed',
                model: modelId,
            };

        case PROVIDER.LMSTUDIO:
            return {
                baseURL: env(ge, 'LMSTUDIO_BASE_URL') ?? LMSTUDIO_BASE_URL,
                apiKey: 'not-needed',
                model: modelId,
            };

        case PROVIDER.SNOWFLAKE:
            return { baseURL: SNOWFLAKE_BASE_URL, apiKey: env(ge, ENV.SNOWFLAKE), model: modelId };

        case PROVIDER.WATSONX:
            return { baseURL: WATSONX_BASE_URL, apiKey: env(ge, ENV.WATSONX), model: modelId };

        case PROVIDER.FEATHERLESS:
            return { baseURL: FEATHERLESS_BASE_URL, apiKey: env(ge, ENV.FEATHERLESS), model: modelId };

        case PROVIDER.HUNYUAN:
            return { baseURL: HUNYUAN_BASE_URL, apiKey: env(ge, ENV.HUNYUAN), model: modelId };

        case PROVIDER.VOLCENGINE:
            return {
                baseURL: VOLCENGINE_BASE_URL,
                apiKey: env(ge, ENV.VOLCENGINE) ?? env(ge, 'ARK_API_KEY'),
                model: modelId,
            };

        case PROVIDER.MINIMAX:
            return { baseURL: MINIMAX_BASE_URL, apiKey: env(ge, ENV.MINIMAX), model: modelId };

        case PROVIDER.BAICHUAN:
            return { baseURL: BAICHUAN_BASE_URL, apiKey: env(ge, ENV.BAICHUAN), model: modelId };

        case PROVIDER.STEPFUN:
            return { baseURL: STEPFUN_BASE_URL, apiKey: env(ge, ENV.STEPFUN), model: modelId };

        case PROVIDER.INTERNLM:
            return { baseURL: INTERNLM_BASE_URL, apiKey: env(ge, ENV.INTERNLM), model: modelId };

        case PROVIDER.RUNPOD: {
            // format: runpod:endpointId/model or runpod:endpointId
            const slash = modelId.indexOf('/');
            const endpointId = slash > 0 ? modelId.slice(0, slash) : modelId;
            const rpModel = slash > 0 ? modelId.slice(slash + 1) : 'default';
            return {
                baseURL: `https://api.runpod.ai/v2/${endpointId}/openai/v1`,
                apiKey: env(ge, ENV.RUNPOD),
                model: rpModel,
            };
        }

        case PROVIDER.LOCALAI:
            return {
                baseURL: env(ge, 'LOCALAI_BASE_URL') ?? LOCALAI_BASE_URL,
                apiKey: env(ge, 'LOCALAI_API_KEY') ?? 'not-needed',
                model: modelId,
            };

        case PROVIDER.KOBOLD:
            return {
                baseURL: env(ge, 'KOBOLD_BASE_URL') ?? KOBOLD_BASE_URL,
                apiKey: 'not-needed',
                model: modelId,
            };

        case PROVIDER.TEXTGENWEBUI:
            return {
                baseURL: env(ge, 'TEXTGENWEBUI_BASE_URL') ?? TEXTGENWEBUI_BASE_URL,
                apiKey: env(ge, 'TEXTGENWEBUI_API_KEY') ?? 'not-needed',
                model: modelId,
            };

        case PROVIDER.JAN:
            return {
                baseURL: env(ge, 'JAN_BASE_URL') ?? JAN_BASE_URL,
                apiKey: 'not-needed',
                model: modelId,
            };

        case PROVIDER.AZURE: {
            // format: azure:resource/deployment
            const slash = modelId.indexOf('/');
            if (slash <= 0) return undefined;
            const resource = modelId.slice(0, slash);
            const deployment = modelId.slice(slash + 1);
            const apiVersion = env(ge, 'AZURE_OPENAI_API_VERSION') ?? '2025-01-01-preview';
            return {
                baseURL: `https://${resource}.openai.azure.com/openai/deployments/${deployment}?api-version=${apiVersion}`,
                apiKey: env(ge, 'AZURE_OPENAI_API_KEY'),
                model: deployment,
            };
        }

        default:
            return undefined;
    }
}

/** Check if a string looks like "provider:model_id" (`provider/model_id` also accepted). */
export function isModelString(s: string): boolean {
    const colon = s.indexOf(':');
    const sep = colon > 0 ? colon : s.indexOf('/');
    return sep > 0 && s.slice(sep + 1).trim().length > 0;
}

/** Return the provider portion of a model string, or undefined. */
export function getProviderFromModelString(s: string): ProviderName | undefined {
    const colon = s.indexOf(':');
    const sep = colon > 0 ? colon : s.indexOf('/');
    if (sep <= 0) return undefined;
    const p = s.slice(0, sep).trim().toLowerCase();
    return Object.values(PROVIDER).includes(p as ProviderName) ? (p as ProviderName) : undefined;
}
