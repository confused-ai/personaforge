/**
 * Load and parse configuration from environment variables
 */

import type { AppConfig, DatabaseConfig, ServerGuardrailsConfig, LLMConfig, LoggingConfig, ResilienceConfig, ServerConfig, SessionConfig } from './types.js';
import { validateConfig } from './validator.js';

/**
 * Load LLM configuration from environment
 */
function loadLLMConfig(): LLMConfig {
    const provider = (process.env.LLM_PROVIDER || 'openai') as 'openai' | 'openrouter' | 'ollama';

    let apiKey: string | undefined;
    let model: string | undefined;
    let baseUrl: string | undefined;

    if (provider === 'openai') {
        apiKey = process.env.OPENAI_API_KEY;
        model = process.env.OPENAI_MODEL || 'gpt-4o';
        baseUrl = process.env.OPENAI_BASE_URL;
    } else if (provider === 'openrouter') {
        apiKey = process.env.OPENROUTER_API_KEY;
        model = process.env.OPENROUTER_MODEL;
        baseUrl = 'https://openrouter.ai/api/v1';
    } else if (provider === 'ollama') {
        apiKey = 'ollama'; // Ollama doesn't require API key
        model = process.env.OLLAMA_MODEL || 'llama3.2';
        baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
    }

    return {
        provider,
        apiKey: apiKey || '',
        model: model || '',
        baseUrl,
    };
}

/**
 * Load database configuration from environment
 */
function loadDatabaseConfig(): DatabaseConfig {
    const type = (process.env.DB_TYPE || 'sqlite') as 'sqlite' | 'postgres' | 'memory';

    if (type === 'sqlite') {
        return {
            type,
            sqlitePath: process.env.SQLITE_PATH || './data/sessions.db',
        };
    }

    if (type === 'postgres') {
        return {
            type,
            host: process.env.DB_HOST,
            port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432,
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            poolSize: process.env.DB_POOL_SIZE ? parseInt(process.env.DB_POOL_SIZE, 10) : 10,
        };
    }

    return { type: 'memory' };
}

/**
 * Load server configuration from environment
 */
function loadServerConfig(): ServerConfig {
    return {
        port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3001,
        corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000').split(',').map((o) => o.trim()),
        nodeEnv: (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test',
        maxRequestSize: process.env.MAX_REQUEST_SIZE || '10mb',
    };
}

/**
 * Load logging configuration from environment
 */
function loadLoggingConfig(): LoggingConfig {
    return {
        level: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
        logRequests: process.env.LOG_REQUESTS !== 'false',
        enableMetrics: process.env.ENABLE_METRICS !== 'false',
        telemetryEndpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    };
}

/**
 * Load guardrails configuration from environment
 */
function loadGuardrailsConfig(): ServerGuardrailsConfig {
    return {
        enabled: process.env.ENABLE_GUARDRAILS !== 'false',
        rateLimitingEnabled: process.env.ENABLE_RATE_LIMITING !== 'false',
        rateLimitRequests: parseInt(process.env.RATE_LIMIT_REQUESTS || '100', 10),
        rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
        maxMessageLength: parseInt(process.env.MAX_MESSAGE_LENGTH || '10000', 10),
    };
}

/**
 * Load resilience configuration from environment
 */
function loadResilienceConfig(): ResilienceConfig {
    return {
        circuitBreakerEnabled: process.env.CIRCUIT_BREAKER_ENABLED !== 'false',
        circuitBreakerFailureThreshold: parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5', 10),
        circuitBreakerResetTimeoutMs: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT || '60000', 10),
        streamTimeoutMs: parseInt(process.env.STREAM_TIMEOUT_MS || '300000', 10),
        maxAgentSteps: parseInt(process.env.MAX_AGENT_STEPS || '20', 10),
    };
}

/**
 * Load session configuration from environment
 */
function loadSessionConfig(): SessionConfig {
    return {
        timeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS || '3600000', 10),
        cleanupIntervalMs: parseInt(process.env.SESSION_CLEANUP_INTERVAL_MS || '300000', 10),
    };
}

/**
 * Load all configuration from environment variables
 * Validates configuration and throws helpful errors if required values are missing
 *
 * @returns Validated application configuration
 * @throws AgentError with CONFIG_ERROR code if validation fails
 *
 * @example
 * ```ts
 * const config = loadConfig();
 * console.log(`Using ${config.llm.provider} with model ${config.llm.model}`);
 * ```
 */
export function loadConfig(): AppConfig {
    const config: Partial<AppConfig> = {
        llm: loadLLMConfig(),
        database: loadDatabaseConfig(),
        server: loadServerConfig(),
        logging: loadLoggingConfig(),
        guardrails: loadGuardrailsConfig(),
        resilience: loadResilienceConfig(),
        session: loadSessionConfig(),
    };

    const validated = validateConfig(config);
    const { errors, ...appConfig } = validated;

    return appConfig as AppConfig;
}

/**
 * Load configuration with defaults and log the result
 * Useful for debugging configuration issues
 */
export function loadConfigWithDefaults(overrides?: Partial<AppConfig>): AppConfig {
    let config = loadConfig();

    if (overrides) {
        config = {
            ...config,
            ...overrides,
            llm: { ...config.llm, ...overrides.llm },
            database: { ...config.database, ...overrides.database },
            server: { ...config.server, ...overrides.server },
            logging: { ...config.logging, ...overrides.logging },
            guardrails: { ...config.guardrails, ...overrides.guardrails },
            resilience: { ...config.resilience, ...overrides.resilience },
            session: { ...config.session, ...overrides.session },
        };
    }

    return config;
}

/**
 * Log configuration (safe version, hides sensitive values)
 */
export function logConfig(config: AppConfig, logger?: { log: (msg: string) => void }): void {
    const log = logger?.log || console.log;

    log(`
┌─ Agent Framework Configuration ─────────────────────────┐
│
│ LLM:        ${config.llm.provider} (${config.llm.model})
│ Database:   ${config.database.type}${config.database.sqlitePath ? ` (${config.database.sqlitePath})` : ''}
│ Server:     :${config.server.port} (${config.server.nodeEnv})
│ Log Level:  ${config.logging.level}
│ Guardrails: ${config.guardrails.enabled ? 'enabled' : 'disabled'}
│
└──────────────────────────────────────────────────────────┘
`);
}
