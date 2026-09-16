import { describe, it, expect } from 'vitest';
import { formatChatTurn } from '../src/cli/commands/chat.js';

describe('formatChatTurn', () => {
    it('prints reasoning before the assistant line when present', () => {
        expect(formatChatTurn({ text: 'final answer', reasoningText: 'because X' })).toEqual([
            '\n[Reasoning: because X]',
            '\nAssistant: final answer\n',
        ]);
    });

    it('omits the reasoning line when reasoningText is absent or empty', () => {
        expect(formatChatTurn({ text: 'final answer' })).toEqual(['\nAssistant: final answer\n']);
        expect(formatChatTurn({ text: 'final answer', reasoningText: '' })).toEqual(['\nAssistant: final answer\n']);
    });

    it('handles string and non-text results like before', () => {
        expect(formatChatTurn('plain')).toEqual(['\nAssistant: plain\n']);
        expect(formatChatTurn({ other: 1 })).toEqual([`\nAssistant: ${JSON.stringify({ other: 1 }, null, 2)}\n`]);
    });
});
