/**
 * Quickstart 02 — Custom Tool
 *
 * Teaches the agent a custom tool using the `tool()` helper with a Zod schema.
 * The agent can call the tool, inspect the result, and answer naturally.
 *
 * Run:
 *   OPENAI_API_KEY=sk-... bun examples/quickstart/02-tool.ts
 */

import { z } from 'zod';
import { agent, tool } from 'personaforge';

// ── Define a tool ────────────────────────────────────────────────────────────

const getWeather = tool({
  name: 'get_weather',
  description: 'Returns the current weather for a city.',
  parameters: z.object({
    city: z.string().describe('The city name, e.g. "Paris"'),
  }),
  execute: async ({ city }) => {
    // Stubbed — replace with a real weather API call.
    const conditions: Record<string, string> = {
      Paris: 'Partly cloudy, 18°C',
      London: 'Overcast, 12°C',
      Tokyo: 'Sunny, 24°C',
    };
    return conditions[city] ?? `No data for ${city}`;
  },
});

// ── Create the agent with the tool ───────────────────────────────────────────

const bot = agent({
  name: 'WeatherBot',
  instructions: 'You are a weather assistant. Use the get_weather tool to answer questions.',
  tools: [getWeather],
});

const result = await bot.run('What is the weather in Tokyo?');
console.log(result.text);
console.log(`(finish: ${result.finishReason}, steps: ${result.steps})`);
