# 02 · First Custom Tool

Give your agent a single focused capability. This is the baseline pattern for connecting the framework to any external API, database, or internal service.

## What you'll learn

- How to define a tool with `tool()`
- How to describe tool inputs with Zod
- How to attach the tool directly to an agent
- How the agent decides when to call the tool

## Current pattern

The current tools layer is typed against Zod v3 compatibility types. When you author custom tools, import `z` from `zod/v3`.

```ts
import { z } from 'zod/v3';
import { agent, tool } from 'personaforge';

const getWeather = tool({
  name: 'get_weather',
  description: 'Return the current weather for a city.',
  parameters: z.object({
    city: z.string().describe('The city name, for example Tokyo'),
  }),
  execute: async ({ city }) => {
    const conditions: Record<string, string> = {
      Paris: 'Partly cloudy, 18°C',
      London: 'Overcast, 12°C',
      Tokyo: 'Sunny, 24°C',
    };

    return conditions[city] ?? `No weather data for ${city}`;
  },
});

const bot = agent({
  name: 'WeatherBot',
  instructions: 'You are a weather assistant. Use the get_weather tool to answer weather questions.',
  tools: [getWeather],
  sessionStore: false,
  guardrails: false,
});

const result = await bot.run('What is the weather in Tokyo?');
console.log(result.text);
console.log(`finish=${result.finishReason} steps=${result.steps}`);
```

## How it works

1. The model sees `get_weather` in the available tool list.
2. When the user asks a weather question, the agent can call that tool.
3. The tool returns structured data.
4. The agent turns that result into a normal language response.

## Real API call

You can replace the stubbed `execute()` body with a real request:

```ts
execute: async ({ city }) => {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  const res = await fetch(
    `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric`,
  );
  const data = await res.json();
  return `${data.name}: ${data.main.temp}°C, ${data.weather[0].description}`;
},
```

## What's next?

- [03 · Tool with Approval](./03-approval-tool)
- [04 · Extend & Wrap Tools](./04-extend-tools)