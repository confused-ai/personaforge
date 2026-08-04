/**
 * Coverage for src/create-agent.ts (barrel) — exercises the barrel's own exports
 * (createAgent + resolveLlmForCreateAgent + env constants) without a live LLM.
 */

import { describe, it, expect } from 'vitest';
import {
    createAgent,
    resolveLlmForCreateAgent,
    ENV_API_KEY,
    ENV_MODEL,
    ENV_BASE_URL,
    ENV_OPENROUTER_API_KEY,
    ENV_OPENROUTER_MODEL,
    OPENROUTER_BASE_URL,
} from '../src/create-agent.js';

const defaults = { model: 'gpt-4o', apiKey: undefined, baseURL: undefined };

describe('create-agent barrel', () => {
    it('re-exports the env constant names and openrouter base url', () => {
        expect(ENV_API_KEY).toBe('OPENAI_API_KEY');
        expect(ENV_MODEL).toBe('OPENAI_MODEL');
        expect(ENV_BASE_URL).toBe('OPENAI_BASE_URL');
        expect(ENV_OPENROUTER_API_KEY).toBe('OPENROUTER_API_KEY');
        expect(ENV_OPENROUTER_MODEL).toBe('OPENROUTER_MODEL');
        expect(OPENROUTER_BASE_URL).toContain('openrouter.ai');
    });

    it('resolveLlmForCreateAgent passes through a pre-built provider', () => {
        const provider = { id: 'fake' } as never;
        const resolved = resolveLlmForCreateAgent(
            { instructions: 'i', llm: provider } as never,
            defaults,
        );
        expect(resolved).toBe(provider);
    });

    it('resolveLlmForCreateAgent resolves a provider:model string to a provider', () => {
        const saved = process.env.OPENAI_API_KEY;
        process.env.OPENAI_API_KEY = 'sk-test';
        try {
            const resolved = resolveLlmForCreateAgent(
                { instructions: 'i', model: 'openai:gpt-4o' } as never,
                defaults,
            );
            expect(resolved).toBeDefined();
            expect(typeof resolved).toBe('object');
        } finally {
            if (saved === undefined) delete process.env.OPENAI_API_KEY;
            else process.env.OPENAI_API_KEY = saved;
        }
    });

    it('resolveLlmForCreateAgent throws on an unknown provider in the model string', () => {
        expect(() =>
            resolveLlmForCreateAgent(
                { instructions: 'i', model: 'notaprovider:model' } as never,
                defaults,
            ),
        ).toThrow(/Unknown provider/);
    });

    it('resolveLlmForCreateAgent throws when no LLM is configured', () => {
        // Strip any ambient provider env vars for a deterministic throw.
        const saved = {
            ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
            GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
            GEMINI_API_KEY: process.env.GEMINI_API_KEY,
            OPENAI_API_KEY: process.env.OPENAI_API_KEY,
            OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
        };
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.GOOGLE_API_KEY;
        delete process.env.GEMINI_API_KEY;
        delete process.env.OPENAI_API_KEY;
        delete process.env.OPENROUTER_API_KEY;
        try {
            expect(() =>
                resolveLlmForCreateAgent({ instructions: 'i' } as never, defaults),
            ).toThrow(/No LLM configured/);
        } finally {
            Object.assign(process.env, saved);
        }
    });

    it('createAgent builds a runnable result (construction only, no LLM call)', () => {
        const provider = { id: 'fake', run: async () => ({ text: 'x' }) } as never;
        const result = createAgent({
            name: 'CoverageAgent',
            instructions: 'i',
            llm: provider,
            sessionStore: false,
            guardrails: false,
        } as never);
        expect(typeof result.run).toBe('function');
        expect(typeof result.stream).toBe('function');
        expect(result.name).toBe('CoverageAgent');
    });
});
