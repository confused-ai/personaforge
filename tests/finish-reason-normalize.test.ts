/**
 * Unit coverage for normalizeFinishReason — the single point where raw SDK
 * finish-reason vocabularies collapse into the canonical
 * `contracts/interfaces.GenerateResult.finishReason` union.
 */

import { describe, it, expect } from 'vitest';
import { normalizeFinishReason } from '../src/providers/types.js';

describe('normalizeFinishReason', () => {
    it('passes canonical values through unchanged', () => {
        expect(normalizeFinishReason('stop')).toBe('stop');
        expect(normalizeFinishReason('tool_calls')).toBe('tool_calls');
        expect(normalizeFinishReason('max_tokens')).toBe('max_tokens');
        expect(normalizeFinishReason('error')).toBe('error');
    });

    it('maps OpenAI vocabulary', () => {
        expect(normalizeFinishReason('length')).toBe('max_tokens');
        expect(normalizeFinishReason('function_call')).toBe('tool_calls');
        expect(normalizeFinishReason('content_filter')).toBe('error');
    });

    it('maps Anthropic vocabulary', () => {
        expect(normalizeFinishReason('end_turn')).toBe('stop');
        expect(normalizeFinishReason('stop_sequence')).toBe('stop');
        expect(normalizeFinishReason('tool_use')).toBe('tool_calls');
        expect(normalizeFinishReason('max_tokens')).toBe('max_tokens');
    });

    it('maps Google / Bedrock vocabulary (case-insensitive)', () => {
        expect(normalizeFinishReason('STOP')).toBe('stop');
        expect(normalizeFinishReason('MAX_TOKENS')).toBe('max_tokens');
        expect(normalizeFinishReason('MAX_OUTPUT_TOKENS')).toBe('max_tokens');
        expect(normalizeFinishReason('SAFETY')).toBe('error');
        expect(normalizeFinishReason('RECITATION')).toBe('error');
    });

    it('collapses null / undefined / empty / unknown to undefined', () => {
        expect(normalizeFinishReason(undefined)).toBeUndefined();
        expect(normalizeFinishReason(null)).toBeUndefined();
        expect(normalizeFinishReason('')).toBeUndefined();
        expect(normalizeFinishReason('unknown')).toBeUndefined();
        expect(normalizeFinishReason('some_future_reason')).toBeUndefined();
    });

    it('never returns a value outside the canonical union', () => {
        const allowed = new Set(['stop', 'tool_calls', 'max_tokens', 'error', undefined]);
        const samples = [
            'stop', 'length', 'tool_calls', 'tool_use', 'end_turn', 'STOP', 'SAFETY',
            'content_filter', 'function_call', 'stop_sequence', 'max_output_tokens',
            'weird', '', 'unknown', 'FINISH', 'complete', 'recitation', 'blocklist',
        ];
        for (const s of samples) {
            expect(allowed.has(normalizeFinishReason(s)), `value for ${s}`).toBe(true);
        }
    });
});
