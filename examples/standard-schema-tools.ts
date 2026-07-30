/**
 * Standard Schema multi-library tools — same tool with Zod or Valibot.
 *
 * Run: npx tsx examples/standard-schema-tools.ts
 */
import { z } from 'zod';
import * as v from 'valibot';
import { tool, safeValidate, schemaToJsonSchema } from '../src/index.js';

const zodWeather = tool({
    name: 'getWeatherZod',
    description: 'Get weather (Zod schemas)',
    parameters: z.object({
        location: z.string().describe('City name'),
        unit: z.enum(['celsius', 'fahrenheit']).default('celsius'),
    }),
    outputSchema: z.object({
        temperature: z.number(),
        condition: z.string(),
    }),
    execute: async ({ location, unit }) => ({
        temperature: unit === 'celsius' ? 22 : 72,
        condition: `Clear in ${location}`,
    }),
});

const valibotWeather = tool({
    name: 'getWeatherValibot',
    description: 'Get weather (Valibot schemas)',
    parameters: v.object({
        location: v.pipe(v.string(), v.description('City name')),
        unit: v.optional(v.picklist(['celsius', 'fahrenheit']), 'celsius'),
    }),
    outputSchema: v.object({
        temperature: v.number(),
        condition: v.string(),
    }),
    execute: async (params) => {
        const { location, unit } = params as {
            location: string;
            unit?: 'celsius' | 'fahrenheit';
        };
        return {
            temperature: unit === 'fahrenheit' ? 72 : 22,
            condition: `Clear in ${location}`,
        };
    },
});

async function main() {
    const zodResult = await zodWeather.execute({ location: 'Paris' });
    const valResult = await valibotWeather.execute({ location: 'Tokyo', unit: 'fahrenheit' } as never);

    console.log('Zod tool:', zodResult.data);
    console.log('Valibot tool:', valResult.data);
    console.log('Zod JSON Schema:', JSON.stringify(schemaToJsonSchema(zodWeather.parameters), null, 2));
    console.log(
        'Direct Valibot validate:',
        safeValidate(v.object({ ok: v.boolean() }), { ok: true }),
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
