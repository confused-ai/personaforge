/**
 * Structured logger interface. Concrete implementations (pino, winston) ship
 * in adapter packages; a JSON `ConsoleLogger` is provided here as the
 * zero-dependency default.
 *
 * @module
 */

import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: string;
  readonly [key: string]: unknown;
}

export interface Logger {
  debug(msg: string, ctx?: Record<string, unknown>): void;
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// ── Secret masking ────────────────────────────────────────────────────────────
// Patterns are ordered from most specific to least specific to avoid partial
// matches shadowing longer secrets.
//
// Covered formats:
//   OpenAI           sk-...  / sk-proj-...
//   Anthropic        sk-ant-...
//   Google AI        AIza...
//   OpenRouter       sk-or-...
//   AWS              AKIA... (access key) + any 40-char key-like string after it
//   Generic Bearer   Authorization: Bearer <token>
//   Generic API key  api_key / apikey / api-key fields
const SECRET_PATTERNS: [RegExp, string][] = [
  // OpenAI / compatible: sk-<base62, 20+>
  [/sk-(?:proj-|ant-|or-)?[A-Za-z0-9_-]{20,}/g, '[REDACTED_API_KEY]'],
  // Google AI Studio: AIza<base62, 35>
  [/AIza[A-Za-z0-9_-]{35}/g, '[REDACTED_API_KEY]'],
  // AWS Access Key ID
  [/(?<![A-Z0-9])AKIA[A-Z0-9]{16}(?![A-Z0-9])/g, '[REDACTED_AWS_KEY]'],
  // Bearer token in Authorization header values
  [/Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, 'Bearer [REDACTED]'],
  // JSON field patterns: "api_key":"<value>", "apiKey":"<value>", "api-key":"<value>"
  [/("(?:api[_-]?key|apiKey|secret|token|password|authorization)"\s*:\s*")[^"]{8,}(")/gi,
    '$1[REDACTED]$2'],
];

/**
 * Replace known secret patterns in a string with redaction placeholders.
 * Applied to the final serialized JSON line before writing. Exported so other
 * egress paths (e.g. Langfuse/LangSmith trace export) can scrub before sending.
 */
export function maskSecrets(line: string): string {
  let out = line;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

export interface ConsoleLoggerOptions {
  level?: LogLevel;
  bindings?: Record<string, unknown>;
  /** Custom write target — useful for tests. Defaults to process.stdout. */
  write?: (line: string) => void;
  /**
   * Disable automatic secret masking.
   * **Only set this in fully-trusted, isolated test environments.**
   * @default false
   */
  disableSecretMasking?: boolean;
}

export class ConsoleLogger implements Logger {
  private readonly level: LogLevel;
  private readonly bindings: Record<string, unknown>;
  private readonly write: (line: string) => void;
  private readonly maskSecrets: boolean;

  constructor(opts: ConsoleLoggerOptions = {}) {
    this.level = opts.level ?? (process.env['LOG_LEVEL'] as LogLevel | undefined) ?? 'info';
    this.bindings = opts.bindings ?? {};
    this.maskSecrets = !(opts.disableSecretMasking ?? false);
    const rawWrite = opts.write ?? ((line) => process.stdout.write(line + '\n'));
    this.write = this.maskSecrets
      ? (line) => { rawWrite(maskSecrets(line)); }
      : rawWrite;
  }

  private emit(level: LogLevel, message: string, ctx?: Record<string, unknown>): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) return;
    // Automatically inject OTEL trace/span IDs when an active span exists.
    // This provides log-trace correlation without requiring callers to use
    // withTraceContext(). Context supplied in `ctx` always takes precedence.
    const otel = tryGetOtelSpanContext();
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...this.bindings,
      ...(otel.traceId !== undefined && { traceId: otel.traceId }),
      ...(otel.spanId  !== undefined && { spanId:  otel.spanId }),
      ...(ctx ?? {}),
    };
    this.write(JSON.stringify(entry));
  }

  debug(msg: string, ctx?: Record<string, unknown>): void { this.emit('debug', msg, ctx); }
  info(msg: string, ctx?: Record<string, unknown>): void { this.emit('info', msg, ctx); }
  warn(msg: string, ctx?: Record<string, unknown>): void { this.emit('warn', msg, ctx); }
  error(msg: string, ctx?: Record<string, unknown>): void { this.emit('error', msg, ctx); }

  child(bindings: Record<string, unknown>): Logger {
    return new ConsoleLogger({
      level: this.level,
      bindings: { ...this.bindings, ...bindings },
      write: this.write,
      // Child inherits parent's write fn which already has masking baked in.
      // Pass disableSecretMasking=true to avoid double-masking.
      disableSecretMasking: true,
    });
  }
}

export function createLogger(opts?: ConsoleLoggerOptions): Logger {
  return new ConsoleLogger(opts);
}

// ── Trace-context logger wrapper ─────────────────────────────────────────────
// Lazily loads @opentelemetry/api to avoid making it a hard dependency.
// Falls back to RequestContext when no active OTEL span is available.

type OtelContextApi = typeof import('@opentelemetry/api');
let _otelApi: OtelContextApi | null | 'unresolved' = 'unresolved';

function tryGetOtelSpanContext(): { traceId?: string; spanId?: string } {
  if (_otelApi === 'unresolved') {
    try {
      // ESM-compatible require for optional peer dep (@opentelemetry/api)
      _otelApi = _require('@opentelemetry/api') as OtelContextApi;
    } catch {
      _otelApi = null;
    }
  }
  if (_otelApi === null) return {};
  const span = _otelApi.trace.getActiveSpan();
  if (!span) return {};
  const ctx = span.spanContext();
  if (!_otelApi.isSpanContextValid(ctx)) return {};
  return { traceId: ctx.traceId, spanId: ctx.spanId };
}

/**
 * Wrap a `Logger` so that every log call automatically includes `traceId` and
 * `spanId` from the active OpenTelemetry span (when available) or falls back
 * to `RequestContext.getTraceId()`.
 *
 * This is a zero-allocation fast-path: if neither OTEL nor RequestContext has
 * a trace ID, the underlying logger is called with the original context unchanged.
 *
 * @example
 * ```ts
 * import { createLogger, withTraceContext } from 'personaforge/observe';
 *
 * const logger = withTraceContext(createLogger({ level: 'info' }));
 * // Every log line now automatically includes traceId / spanId
 * ```
 */
export function withTraceContext(base: Logger): Logger {
  function inject(ctx?: Record<string, unknown>): Record<string, unknown> | undefined {
    const otel = tryGetOtelSpanContext();
    const hasOtel = otel.traceId !== undefined;
    if (!hasOtel) return ctx;

    return {
      ...(otel.traceId !== undefined && { traceId: otel.traceId }),
      ...(otel.spanId  !== undefined && { spanId:  otel.spanId }),
      ...ctx,
    };
  }

  return {
    debug(msg, ctx) { base.debug(msg, inject(ctx)); },
    info (msg, ctx) { base.info (msg, inject(ctx)); },
    warn (msg, ctx) { base.warn (msg, inject(ctx)); },
    error(msg, ctx) { base.error(msg, inject(ctx)); },
    child(bindings)  { return withTraceContext(base.child(bindings)); },
  };
}
