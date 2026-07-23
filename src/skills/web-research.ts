/**
 * Web Research Skill
 *
 * Equips an agent with HTTP fetching and basic HTML stripping so it can look
 * up information from the web at runtime.
 *
 * The skill works with any LLM — it provides a `fetchPage` tool that the
 * agent calls to retrieve content, then synthesises the result.
 *
 * Usage:
 * ```ts
 * import { webResearchSkill } from './index.js';
 * import { agent } from 'personaforge';
 *
 * const bot = agent({
 *   name: 'Researcher',
 *   skills: [webResearchSkill],
 * });
 * ```
 */

import type { Skill, Tool } from '../contracts/index.js';

// ── fetchPage tool ────────────────────────────────────────────────────────────

const fetchPageTool: Tool = {
  name: 'fetch_page',
  description:
    'Fetch the text content of a web page by URL. Returns the visible text (HTML stripped). ' +
    'Use this to look up facts, read documentation, or retrieve current information.',
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The full URL to fetch (must start with https://).',
      },
      maxChars: {
        type: 'number',
        description: 'Maximum characters to return. Default: 4000.',
      },
    },
    required: ['url'],
  },
  async execute(input: Record<string, unknown>): Promise<string> {
    const url = input['url'] as string;
    const maxChars = (input['maxChars'] as number | undefined) ?? 4000;

    if (!url.startsWith('https://')) {
      throw new Error('fetch_page: only HTTPS URLs are allowed.');
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10_000);
    try {
      const res = await fetch(url, {
        signal: ac.signal,
        headers: { 'User-Agent': 'personaforge/web-research-skill' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const html = await res.text();
      // Strip tags, normalise whitespace
      const text = html
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      return text.slice(0, maxChars);
    } finally {
      clearTimeout(timer);
    }
  },
};

// ── Skill definition ──────────────────────────────────────────────────────────

export const webResearchSkill: Skill = {
  id: 'web-research',
  name: 'Web Research',
  description:
    'Browse the web and retrieve current information from any HTTPS URL.',
  instructions:
    'You have the ability to fetch web pages. When you need up-to-date facts or ' +
    'information not in your training data, call the fetch_page tool with the ' +
    'relevant URL. Summarise the content for the user; do not repeat raw HTML.',
  tools: [fetchPageTool],
  metadata: {
    version: '1.0.0',
    category: 'research',
    tags: ['web', 'http', 'research'],
  },
};
