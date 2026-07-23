/**
 * @personaforge/memory — SummaryBufferMemory middleware.
 *
 * Keeps the conversation history manageable by compressing older messages into
 * a running summary when the buffer grows beyond a configurable threshold.
 *
 * How it works:
 *   1. Before each LLM step, count the messages in the conversation.
 *   2. When the count exceeds `maxTokensBeforeSummary` (message count proxy),
 *      take all messages except the last `keepLastN` ones and ask the LLM to
 *      summarise them.
 *   3. Replace those older messages with a single `[Summary]` system message.
 *
 * The result is injected as an `AgenticLifecycleHooks.beforeStep` function so
 * it can be passed directly to `createAgent({ hooks: { beforeStep: ... } })`.
 *
 * Usage:
 * ```ts
 * import { createSummaryBufferHook } from './index.js';
 *
 * const beforeStep = createSummaryBufferHook({
 *   llm,
 *   maxMessages: 30,
 *   keepLastN:   10,
 * });
 *
 * const agent = createAgent({ name: 'Bot', llm, hooks: { beforeStep } });
 * ```
 */

import type { Message } from '../core/index.js';

// ── Minimal LLM interface (avoids hard dep on @personaforge/core for type) ────

interface SummaryLLM {
  generateText(
    messages: Message[],
    opts?: { temperature?: number; maxTokens?: number },
  ): Promise<{ text?: string }>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SummaryBufferOptions {
  /** LLM to use for generating summaries. */
  llm: SummaryLLM;
  /**
   * When the conversation exceeds this many messages, trigger summarisation.
   * Default: 30.
   */
  maxMessages?: number;
  /**
   * Number of most-recent messages to keep verbatim after summarisation.
   * The rest are replaced by the summary. Default: 10.
   */
  keepLastN?: number;
  /**
   * System prompt injected at the start of the summarisation request.
   * Override to customise the summary style.
   */
  summarizePrompt?: string;
}

/**
 * A `beforeStep` lifecycle hook that compresses old messages into a rolling
 * summary to prevent context-window overflow.
 */
export type SummaryBeforeStepHook = (
  step: number,
  messages: Message[],
) => Promise<Message[]>;

// ── Implementation ────────────────────────────────────────────────────────────

const DEFAULT_SUMMARIZE_PROMPT =
  'You are a concise summariser. Summarise the following conversation excerpt ' +
  'in plain prose. Preserve key facts, decisions, tool outputs, and user intent. ' +
  'Omit small-talk and redundant repetition. Maximum 300 words.';

/**
 * Create a `beforeStep` hook that automatically summarises old messages.
 *
 * @example
 * ```ts
 * const beforeStep = createSummaryBufferHook({ llm, maxMessages: 40 });
 * const agent = createAgent({ hooks: { beforeStep } });
 * ```
 */
export function createSummaryBufferHook(opts: SummaryBufferOptions): SummaryBeforeStepHook {
  const {
    llm,
    maxMessages       = 30,
    keepLastN         = 10,
    summarizePrompt   = DEFAULT_SUMMARIZE_PROMPT,
  } = opts;

  // Rolling summary from previous compressions (persists across steps).
  let rollingContext = '';

  return async (_step: number, messages: Message[]): Promise<Message[]> => {
    // Filter out the system message — we'll re-insert it below.
    const [systemMsg, ...rest] = messages[0]?.role === 'system'
      ? [messages[0], ...messages.slice(1)]
      : [undefined, ...messages];

    // Nothing to compress yet.
    if (rest.length <= maxMessages) return messages;

    const toCompress = rest.slice(0, rest.length - keepLastN);
    const toKeep     = rest.slice(rest.length - keepLastN);

    // Build the summarisation payload.
    const excerptLines = toCompress
      .map(m => {
        const role = m.role === 'tool' ? 'tool-result' : m.role;
        return `[${role}]: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`;
      })
      .join('\n\n');

    const contextPreamble = rollingContext
      ? `Previous summary:\n${rollingContext}\n\nNew excerpt to incorporate:`
      : 'Conversation excerpt to summarise:';

    const summaryResult = await llm.generateText(
      [
        { role: 'system',  content: summarizePrompt },
        { role: 'user',    content: `${contextPreamble}\n\n${excerptLines}` },
      ],
      { temperature: 0, maxTokens: 600 },
    );

    const summaryText = summaryResult.text?.trim() ?? '[summary unavailable]';
    rollingContext = summaryText;

    const summaryMessage: Message = {
      role:    'system',
      content: `[Conversation Summary]\n${summaryText}`,
    };

    // Reassemble: original system → summary → recent messages.
    const rebuilt: Message[] = [];
    if (systemMsg !== undefined) rebuilt.push(systemMsg);
    rebuilt.push(summaryMessage);
    rebuilt.push(...toKeep);

    return rebuilt;
  };
}
