import { describe, it, expect } from 'vitest';
import { BaseAgent, InvalidStateTransitionError } from '../src/core/base-agent.js';
import { AgentState, type AgentContext } from '../src/core/types.js';

class Bot extends BaseAgent {
  async execute(): Promise<unknown> { return null; }
  async run(): Promise<never> { throw new Error('n/a'); }
  async *stream(): AsyncIterable<string> { yield ''; }
  async *streamEvents(): AsyncIterable<never> { /* nothing */ }
  async createSession(): Promise<string> { return 's'; }
  async getSessionMessages(): Promise<never[]> { return []; }
  withSession(): any { return this; }
}
const ctx = (): AgentContext => ({ userId: 'u', sessionId: 's', metadata: {} });

describe('BaseAgent strict state machine (item 14)', () => {
  it('accepts legal transitions when strictStateMachine is enabled', async () => {
    const bot = new Bot({ name: 'bot', strictStateMachine: true });
    await bot.setState(AgentState.PLANNING, ctx());
    await bot.setState(AgentState.EXECUTING, ctx());
    await bot.setState(AgentState.COMPLETED, ctx());
    expect(bot.state).toBe(AgentState.COMPLETED);
  });

  it('throws InvalidStateTransitionError on an illegal transition', async () => {
    const bot = new Bot({ name: 'bot', strictStateMachine: true });
    await bot.setState(AgentState.PLANNING, ctx());
    await bot.setState(AgentState.COMPLETED, ctx());
    await expect(bot.setState(AgentState.EXECUTING, ctx()))
      .rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it('remains permissive when strictStateMachine is off (default)', async () => {
    const bot = new Bot({ name: 'bot' });
    await bot.setState(AgentState.COMPLETED, ctx());
    await bot.setState(AgentState.EXECUTING, ctx());   // would be illegal in strict mode
    expect(bot.state).toBe(AgentState.EXECUTING);
  });
});
