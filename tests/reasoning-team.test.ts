import { describe, it, expect } from 'vitest';
import { ReasoningScratchpad, createReasoningTools } from '../src/reasoning/reasoning-tools.js';
import { createModeTeam as createTeam } from '../src/orchestration/team-modes.js';
import type { TeamAgent } from '../src/orchestration/team-modes.js';

describe('ReasoningScratchpad + tools', () => {
  it('think records steps, analyze reviews them', async () => {
    const pad = new ReasoningScratchpad();
    const { think, analyze } = createReasoningTools(pad);

    const r1 = await think.execute({ title: 'Plan', thought: 'break into subtasks' });
    expect(r1.stepId).toBe(1);
    expect(r1.totalSteps).toBe(1);

    await think.execute({ title: 'Search', thought: 'query the database for users' });

    const all = await analyze.execute({});
    expect(all.steps).toHaveLength(2);

    const filtered = await analyze.execute({ query: 'database' });
    expect(filtered.steps).toHaveLength(1);
    expect(filtered.steps[0]!.title).toBe('Search');
  });

  it('render produces prompt-injectable text', () => {
    const pad = new ReasoningScratchpad();
    pad.add('A', 'first');
    pad.add('B', 'second');
    expect(pad.render()).toContain('Step 1 — A');
    expect(pad.render()).toContain('Step 2 — B');
  });
});

// Fake agents for team tests.
const makeAgent = (name: string, reply: (p: string) => string, instructions = ''): TeamAgent => ({
  name,
  instructions,
  run: async (prompt: string) => ({ text: reply(prompt) }),
});

describe('createTeam', () => {
  it('route: leader picks one agent', async () => {
    const leader = makeAgent('leader', () => '{"agent": "math"}');
    const math = makeAgent('math', (p) => `math handled: ${p}`, 'does math');
    const prose = makeAgent('prose', () => 'prose', 'writes prose');
    const team = createTeam({ mode: 'route', leader, agents: [math, prose] });
    const result = await team.run('2+2?');
    expect(result.text).toContain('math handled');
    expect(result.contributions).toHaveLength(1);
    expect(result.contributions[0]!.agent).toBe('math');
  });

  it('coordinate: all respond, leader synthesizes', async () => {
    const leader = makeAgent('leader', (p) => `synthesis of: ${p.includes('Expert') ? 'experts' : 'none'}`);
    const a = makeAgent('a', () => 'answer A');
    const b = makeAgent('b', () => 'answer B');
    const team = createTeam({ mode: 'coordinate', leader, agents: [a, b] });
    const result = await team.run('question');
    expect(result.text).toContain('synthesis');
    expect(result.contributions).toHaveLength(2);
  });

  it('collaborate: merges all agent outputs', async () => {
    const a = makeAgent('a', () => 'from A');
    const b = makeAgent('b', () => 'from B');
    const team = createTeam({ mode: 'collaborate', agents: [a, b] });
    const result = await team.run('q');
    expect(result.text).toContain('[a]: from A');
    expect(result.text).toContain('[b]: from B');
    expect(result.contributions).toHaveLength(2);
  });

  it('route requires a leader', () => {
    expect(() => createTeam({ mode: 'route', agents: [] })).toThrow('requires a leader');
  });
});
