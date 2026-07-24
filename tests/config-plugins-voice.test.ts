/**
 * Tests for personaforge/config, personaforge/plugins, personaforge/voice
 * factories — pure code paths reachable without external services.
 */

import { describe, it, expect } from 'vitest';
import { validateConfig } from '../src/config/validator.js';
import { EnvSecretManagerAdapter } from '../src/config/secret-manager.js';
import { createPluginRegistry, createLoggingPlugin, createTelemetryPlugin } from '../src/plugins/plugins.js';
import { createVoiceProvider } from '../src/voice/voice-provider.js';

describe('validateConfig', () => {
    it('throws when required blocks are missing', () => {
        expect(() => validateConfig({} as never)).toThrow(/validation failed/i);
    });

    it('throws with context.errors listing every missing field', () => {
        try {
            validateConfig({ llm: { provider: 'openai' } as never });
            throw new Error('expected validateConfig to throw');
        } catch (e) {
            const err = e as { context?: { errors?: Array<{ field: string }> } };
            const fields = err.context?.errors?.map((x) => x.field) ?? [];
            expect(fields).toContain('llm.apiKey');
            expect(fields).toContain('llm.model');
        }
    });

    it('accepts a fully-populated config without throwing', () => {
        expect(() =>
            validateConfig({
                llm: { provider: 'openai', apiKey: 'k', model: 'gpt-4o-mini' } as never,
                database: { type: 'memory' } as never,
                server: { port: 8080 } as never,
            } as never),
        ).not.toThrow();
    });
});

describe('EnvSecretManagerAdapter', () => {
    it('reads a value from process.env', async () => {
        process.env['PF_TEST_SECRET'] = 'top-value';
        const adapter = new EnvSecretManagerAdapter({ prefix: 'PF_TEST_' });
        expect(await adapter.getSecret('SECRET')).toBe('top-value');
    });

    it('throws when the env var is missing', async () => {
        delete process.env['PF_TEST_MISSING'];
        const adapter = new EnvSecretManagerAdapter({ prefix: 'PF_TEST_' });
        await expect(adapter.getSecret('MISSING')).rejects.toThrow(/Secret not found/);
    });
});

describe('createPluginRegistry', () => {
    it('registers, retrieves, lists and unregisters plugins', () => {
        const reg = createPluginRegistry();
        const p = createLoggingPlugin();
        reg.register(p);
        expect(reg.get(p.id)?.id).toBe(p.id);
        expect(reg.list().some((x) => x.id === p.id)).toBe(true);
        expect(reg.unregister(p.id)).toBe(true);
        expect(reg.get(p.id)).toBeUndefined();
    });

    it('unregister returns false for an unknown id', () => {
        const reg = createPluginRegistry();
        expect(reg.unregister('never-registered')).toBe(false);
    });
});

describe('createTelemetryPlugin', () => {
    it('creates a plugin with an id and hooks', () => {
        const metrics = {
            counter: () => undefined,
            gauge: () => undefined,
            histogram: () => undefined,
            incrementCounter: () => undefined,
            recordGauge: () => undefined,
            recordHistogram: () => undefined,
        } as unknown as import('../src/contracts/index.js').MetricsCollector;
        const p = createTelemetryPlugin(metrics);
        expect(typeof p.id).toBe('string');
        expect(p.id.length).toBeGreaterThan(0);
    });
});

describe('createVoiceProvider', () => {
    it('returns an OpenAIVoiceProvider for provider="openai"', () => {
        const p = createVoiceProvider({ provider: 'openai', apiKey: 'k' } as never);
        expect(p.constructor.name).toBe('OpenAIVoiceProvider');
    });

    it('returns an ElevenLabsVoiceProvider for provider="elevenlabs"', () => {
        const p = createVoiceProvider({ provider: 'elevenlabs', apiKey: 'k' } as never);
        expect(p.constructor.name).toBe('ElevenLabsVoiceProvider');
    });

    it('throws for an unknown provider', () => {
        expect(() => createVoiceProvider({ provider: 'unknown' as never, apiKey: 'k' } as never)).toThrow();
    });
});
