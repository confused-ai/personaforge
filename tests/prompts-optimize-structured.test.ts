/**
 * Tests for:
 *   - renderTemplate + PromptRegistry (personaforge/prompts)
 *   - renderFewShot (personaforge/optimize)
 *   - detectProviderKind (personaforge/structured)
 */

import { describe, it, expect } from 'vitest';
import { renderTemplate, PromptRegistry } from '../src/prompts/index.js';
import { renderFewShot } from '../src/optimize/index.js';
import { detectProviderKind } from '../src/structured/index.js';

describe('renderTemplate', () => {
    it('substitutes {{var}} placeholders', () => {
        expect(renderTemplate('Hello {{name}}!', { name: 'Ada' })).toBe('Hello Ada!');
    });

    it('leaves unknown placeholders intact', () => {
        expect(renderTemplate('Hi {{who}}', {})).toBe('Hi {{who}}');
    });

    it('coerces non-string values', () => {
        expect(renderTemplate('n={{n}}', { n: 42 })).toBe('n=42');
    });

    it('handles multiple placeholders', () => {
        expect(renderTemplate('{{a}}-{{b}}-{{a}}', { a: '1', b: '2' })).toBe('1-2-1');
    });
});

describe('PromptRegistry', () => {
    it('registers and retrieves the default (latest) version', () => {
        const reg = new PromptRegistry();
        reg.register('greeting', 'Hello {{name}}');
        const v = reg.get('greeting');
        expect(v.template).toBe('Hello {{name}}');
    });

    it('supports multiple versions and explicit version selection', () => {
        const reg = new PromptRegistry();
        reg.register('p', 'v1 template', { version: 'v1' });
        reg.register('p', 'v2 template', { version: 'v2' });
        expect(reg.get('p', { version: 'v1' }).template).toBe('v1 template');
        expect(reg.get('p', { version: 'v2' }).template).toBe('v2 template');
    });

    it('render() interpolates the selected version', () => {
        const reg = new PromptRegistry();
        reg.register('hi', 'Hi {{name}}');
        expect(reg.render('hi', { name: 'Grace' })).toBe('Hi Grace');
    });

    it('throws on duplicate explicit version', () => {
        const reg = new PromptRegistry();
        reg.register('p', 'a', { version: 'v1' });
        expect(() => reg.register('p', 'b', { version: 'v1' })).toThrow();
    });

    it('throws for an unknown version', () => {
        const reg = new PromptRegistry();
        reg.register('p', 'a');
        expect(() => reg.get('p', { version: 'does-not-exist' })).toThrow();
    });
});

describe('renderFewShot', () => {
    const fmt = (s: string) => s;

    it('includes the instruction and the target input', () => {
        const out = renderFewShot('Classify sentiment.', [], fmt, 'I love it');
        expect(out).toContain('Classify sentiment.');
        expect(out).toContain('Input: I love it');
        expect(out.trimEnd().endsWith('Output:')).toBe(true);
    });

    it('renders demos as Input/Output pairs', () => {
        const demos = [
            { input: 'great', output: 'positive' },
            { input: 'awful', output: 'negative' },
        ];
        const out = renderFewShot('Classify.', demos, fmt, 'meh');
        expect(out).toContain('Examples:');
        expect(out).toContain('Input: great');
        expect(out).toContain('Output: positive');
        expect(out).toContain('Input: awful');
    });
});

describe('detectProviderKind', () => {
    it('maps class name to a provider kind', () => {
        class OpenAIProvider {}
        class AnthropicProvider {}
        class GoogleProvider {}
        class BedrockConverseProvider {}
        class SomethingElse {}
        expect(detectProviderKind(new OpenAIProvider() as never)).toBe('openai');
        expect(detectProviderKind(new AnthropicProvider() as never)).toBe('anthropic');
        expect(detectProviderKind(new GoogleProvider() as never)).toBe('gemini');
        expect(detectProviderKind(new BedrockConverseProvider() as never)).toBe('bedrock');
        expect(detectProviderKind(new SomethingElse() as never)).toBe('unknown');
    });
});
