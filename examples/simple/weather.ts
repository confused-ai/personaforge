import { agent, defineTool } from 'personaforge';
import { z } from 'zod';

const getWeather = defineTool()
  .name('getWeather')
  .description('Get current weather for a given city')
  .parameters(z.object({ city: z.string().describe('City name') }))
  .execute(async ({ city }) => {
    // replace with a real API call
    console.log("called getWeather tool with city:", city);

    return { city, temp: 25, condition: 'sunny' };
  }).transform(async (weather: any) => {
    console.log("came here");

    return {
      text: `The weather in ${weather.city} is ${weather.temp}°C and ${weather.condition}.`
    }
  }).build()

const weatherAgent = agent({
  model: 'gpt-4o-mini',
  instructions: 'Help with weather queries. Use the tool to get the weather and then respond to the user.',
  tools: [getWeather],
});

const r = await weatherAgent.run('What is the weather in Paris?');
console.log(r.text);