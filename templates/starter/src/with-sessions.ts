/**
 * Stateful agent with session persistence.
 *
 * Sessions let the agent remember conversation context across turns.
 */

import { agent } from 'personaforge';

const chatAgent = agent({
  name: 'assistant',
  model: 'gpt-4o-mini',
  instructions: 'You are a helpful assistant. Remember the user\'s name and preferences.',
});

// First turn — introduces themselves
const session1 = await chatAgent.run('My name is Bob and I love astronomy.', {
  sessionId: 'user-bob-1',
});
console.log('Turn 1:', session1.text);

// Second turn — agent should remember Bob
const session2 = await chatAgent.run('What do I like?', {
  sessionId: 'user-bob-1',
});
console.log('Turn 2:', session2.text);
// "You love astronomy, Bob!"
