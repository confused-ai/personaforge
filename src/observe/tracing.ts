/**
 * OpenTelemetry tracing helpers.
 *
 * `withSpan` wraps an async function in an active span, attaches attributes,
 * marks errors, and ends the span — the canonical way to instrument every
 * agent run, tool call, and LLM completion.
 *
 * @module
 */
import {
  trace,
  SpanStatusCode,
  type Tracer,
  type Span,
  type SpanOptions,
} from '@opentelemetry/api';
import { isPersonaForgeError } from '../contracts/index.js';

export const TRACER_NAME = 'personaforge';

/**
 * Returns (or creates) the named OpenTelemetry tracer for personaforge.
 *
 * @param version - Optional semver string; defaults to `npm_package_version` env var.
 */
export function getTracer(version?: string): Tracer {
  return trace.getTracer(TRACER_NAME, version ?? process.env['npm_package_version'] ?? '0.0.0');
}

export type SpanAttributes = Record<string, string | number | boolean | undefined>;

/**
 * Build OpenTelemetry GenAI semantic-convention attributes for an LLM span.
 *
 * Emits the standard `gen_ai.*` keys (system, request.model, operation.name,
 * usage.input_tokens, usage.output_tokens) and keeps the legacy `llm.*` keys
 * as aliases so existing dashboards keep working.
 *
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/
 */
export function genAiAttributes(input: {
  /** Provider id, e.g. `'anthropic'` | `'openai'`. Inferred from `model` when omitted. */
  system?: string;
  /** Requested model id, e.g. `'gpt-4o'` / `'claude-sonnet-4'`. */
  model?: string;
  /** GenAI operation name. Default `'chat'`. */
  operation?: string;
  /** Prompt (input) tokens. */
  inputTokens?: number;
  /** Completion (output) tokens. */
  outputTokens?: number;
}): SpanAttributes {
  const operation = input.operation ?? 'chat';
  const system = input.system ?? inferGenAiSystem(input.model);
  const attrs: SpanAttributes = {
    'gen_ai.operation.name': operation,
    ...(system !== undefined && { 'gen_ai.system': system }),
    ...(input.model !== undefined && {
      'gen_ai.request.model': input.model,
      'llm.request.model': input.model, // legacy alias
    }),
    ...(input.inputTokens !== undefined && {
      'gen_ai.usage.input_tokens': input.inputTokens,
      'llm.usage.prompt_tokens': input.inputTokens, // legacy alias
    }),
    ...(input.outputTokens !== undefined && {
      'gen_ai.usage.output_tokens': input.outputTokens,
      'llm.usage.completion_tokens': input.outputTokens, // legacy alias
    }),
  };
  return attrs;
}

/** Best-effort provider id from a model string, for `gen_ai.system`. */
export function inferGenAiSystem(model?: string): string | undefined {
  if (!model) return undefined;
  const m = model.toLowerCase();
  const provider = m.includes(':') ? (m.split(':')[0] as string) : '';
  if (provider) {
    if (/(anthropic|openai|google|gemini|vertex|cohere|mistral|groq|deepseek|xai|grok|azure)/.test(provider)) {
      return provider === 'grok' ? 'xai' : provider === 'gemini' ? 'google' : provider;
    }
  }
  if (m.includes('claude')) return 'anthropic';
  if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3')) return 'openai';
  if (m.includes('gemini')) return 'google';
  if (m.includes('mistral') || m.includes('mixtral')) return 'mistral';
  if (m.includes('deepseek')) return 'deepseek';
  if (m.includes('grok')) return 'xai';
  if (m.includes('command-r') || m.includes('cohere')) return 'cohere';
  return undefined;
}

function cleanAttributes(attrs: SpanAttributes): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Wrap an async function in an active OTEL span.
 *
 * On success the span is marked OK; on failure the error is recorded and
 * `error.code` / `error.retryable` attributes are set for `PersonaForgeError`s.
 *
 * @param name       - Span name (e.g. `'agent.run'`, `'tool.call'`).
 * @param attributes - Initial span attributes — `undefined` values are dropped.
 * @param fn         - Async work to instrument. Receives the live `Span`.
 * @param options    - Optional `SpanOptions` forwarded to `startActiveSpan`.
 */
export async function withSpan<T>(
  name: string,
  attributes: SpanAttributes,
  fn: (span: Span) => Promise<T>,
  options?: SpanOptions,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(
    name,
    { ...options, attributes: cleanAttributes(attributes) },
    async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (e) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: e instanceof Error ? e.message : String(e),
        });
        if (isPersonaForgeError(e)) {
          span.setAttribute('error.code', e.code);
          span.setAttribute('error.retryable', e.retryable);
        }
        if (e instanceof Error) span.recordException(e);
        throw e;
      } finally {
        span.end();
      }
    },
  );
}
