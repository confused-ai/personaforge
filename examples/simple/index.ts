import { agent } from 'personaforge';
import { withResilience } from 'personaforge/production';

async function main(): Promise<void> {
  const base = agent({
    name: 'DevAssistant',
    model: 'openai:gpt-4o-mini',
    instructions: 'You are a helpful developer assistant. Answer with short, concrete bullets.',
    tools: [],
    sessionStore: false,
    guardrails: false,
  });

  const ai = withResilience(base, {
    circuitBreaker: { failureThreshold: 5, resetTimeoutMs: 30_000 },
    rateLimit: { maxRpm: 60 },
    retry: { maxRetries: 3, backoffMs: 1_000 },
  });

  const result:any = await ai.run('Summarize 3 practical TypeScript 5.x upgrades teams should adopt.');
  console.log(result.text);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});