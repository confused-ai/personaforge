/**
 * HTTP service configuration.
 *
 * Common declarative options for exposing an agent over HTTP. Imported from
 * the root entry point (`personaforge`) so consumers have a stable config
 * surface for HTTP serving.
 */

/** Optional per-request rate limiting for the HTTP service. */
export interface HttpServiceRateLimit {
    /** Max requests per interval. */
    readonly maxRequests?: number;
    /** Rate-limit window in milliseconds. */
    readonly intervalMs?: number;
}

/**
 * Declarative configuration for an HTTP service exposing agents.
 */
export interface HttpServiceConfig {
    /** Bind host. Default: '0.0.0.0'. */
    readonly host?: string;
    /** Port to listen on. */
    readonly port: number;
    /** CORS origin allowlist. Use `'*'` for open APIs, or an explicit list. */
    readonly corsOrigin?: string | string[] | RegExp;
    /** Enable security-header middleware. Default: true. */
    readonly securityHeaders?: boolean;
    /** Per-request rate limiting. */
    readonly rateLimit?: HttpServiceRateLimit;
    /** Maximum request body size in bytes. Default: 1 MB. */
    readonly maxBodyBytes?: number;
    /** Per-request timeout in milliseconds. */
    readonly requestTimeoutMs?: number;
    /** Whether to expose raw error messages. Default: false. */
    readonly exposeErrors?: boolean;
}
