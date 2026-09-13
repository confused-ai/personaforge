/**
 * Native DX wins: slash model refs, tool `id` alias, fluent workflow chains.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { resolveModelString, getProviderFromModelString, isModelString } from '../src/providers/model-resolver.js';
import { model } from '../src/dx/model.js';
import { tool } from '../src/tools/core/tool-helper.js';
import { defineStep, defineWorkflow } from '../src/workflow/chain.js';

describe('model string DX', () => {
  it('accepts provider/model as well as provider:model', () => {
    expect(resolveModelString('openai/gpt-4o')?.model).toBe('gpt-4o');
    expect(resolveModelString('openai:gpt-4o')?.model).toBe('gpt-4o');
    expect(getProviderFromModelString('anthropic/claude-x')).toBe('anthropic');
    expect(isModelString('google/gemini-2.0-flash')).toBe(true);
  });

  it('model() resolves both separators', () => {
    expect(model('openai:gpt-4o', { apiKey: 'test-key' })).toBeTruthy();
    expect(model('openai/gpt-4o', { apiKey: 'test-key' })).toBeTruthy();
  });
});

describe('tool() DX', () => {
  it('accepts id as an alias for name', async () => {
    const t = tool({
      id: 'getWeather',
      description: 'weather',
      parameters: z.object({ city: z.string() }),
      execute: async ({ city }) => `sunny in ${city}`,
    });
    expect(t.name).toBe('getWeather');
    const out = await t.execute({ city: 'Paris' });
    expect(out.success).toBe(true);
  });

  it('requires a name or id', () => {
    expect(() =>
      tool({
        description: 'nameless',
        parameters: z.object({}),
        execute: async () => 'x',
      } as never),
    ).toThrow(/requires `name`/);
  });
});

describe('defineWorkflow DX', () => {
  it('runs then chains with zod validation', async () => {
    const wf = defineWorkflow({ id: 'w', inputSchema: z.number(), outputSchema: z.number() })
      .then(defineStep({ id: 'double', inputSchema: z.number(), outputSchema: z.number(), execute: async ({ inputData }) => inputData * 2 }));
    const done = await wf.createRun().start({ inputData: 21 });
    expect(done.status).toBe('completed');
    expect(done.result).toBe(42);
    expect(wf.getSnapshots(done.snapshot.runId).length).toBeGreaterThan(0);
  });

  it('supports parallel, branch, foreach', async () => {
    const wf = defineWorkflow({ id: 'p' }).parallel([
      defineStep({ id: 'a', execute: async ({ inputData }) => (inputData as number) + 1 }),
      defineStep({ id: 'b', execute: async ({ inputData }) => (inputData as number) * 10 }),
    ]);
    expect((await wf.createRun().start({ inputData: 2 })).result).toMatchObject({ a: 3, b: 20 });

    const wb = defineWorkflow({ id: 'b' }).branch({
      condition: (v) => v === 'yes',
      trueStep: defineStep({ id: 'pick', execute: async ({ inputData }) => inputData }),
    });
    expect((await wb.createRun().start({ inputData: 'yes' })).status).toBe('completed');

    const we = defineWorkflow({ id: 'e' }).foreach(
      defineStep({ id: 'item', execute: async ({ inputData }) => (inputData as number) * 2 }),
    );
    expect((await we.createRun().start({ inputData: [1, 2, 3] })).result).toEqual([2, 4, 6]);
  });

  it('suspends with schema validation and resumes', async () => {
    const wf = defineWorkflow({ id: 's' })
      .then(
        defineStep({
          id: 'gate',
          suspendSchema: z.object({ reason: z.string() }),
          resumeSchema: z.number(),
          execute: async ({ inputData }, ctx) => {
            if ((inputData as number) > 100) ctx.suspend({ reason: 'too big' });
            return inputData as number;
          },
        }),
      )
      .then(defineStep({ id: 'finish', execute: async ({ inputData }) => (inputData as number) + 1 }));
    const run = wf.createRun();
    const suspended = await run.start({ inputData: 500 });
    expect(suspended.status).toBe('suspended');
    expect(suspended.suspendedStep).toBe('gate');
    const resumed = await run.resume({ step: 'gate', resumeData: 1 });
    expect(resumed.status).toBe('completed');
    expect(resumed.result).toBe(2);
  });
});
