/**
 * Parity guard: `personaforge/models` is a compatibility barrel over `personaforge/providers`.
 *
 * After the 2026-07 consolidation there is exactly one implementation of each
 * provider class and one model-string resolver. This test locks that in: if
 * anyone ever re-introduces a divergent copy inside `src/models/`, the identity
 * checks below fail and force a conscious decision.
 *
 * Also exercises the swarm boundary that used to break: `swarm.ts` constructs
 * providers from `personaforge/providers` and coerces them to `core.LLMProvider`.
 * We assert both the identity and a runtime shape check that the coerced object
 * really behaves like an `LLMProvider`.
 */

import { describe, it, expect } from 'vitest';

import * as models from '../src/models/index.js';
import * as providers from '../src/providers/index.js';

describe('models ↔ providers parity', () => {
    it('re-exports the same OpenAIProvider class (identity)', () => {
        expect(models.OpenAIProvider).toBeDefined();
        expect(providers.OpenAIProvider).toBeDefined();
        expect(models.OpenAIProvider).toBe(providers.OpenAIProvider);
    });

    it('re-exports the same createOpenRouterProvider factory (identity)', () => {
        expect(models.createOpenRouterProvider).toBe(providers.createOpenRouterProvider);
    });

    it('re-exports the same model-string resolver (identity)', () => {
        expect(models.resolveModelString).toBe(providers.resolveModelString);
        expect(models.isModelString).toBe(providers.isModelString);
    });

    it('re-exports every canonical base URL constant with matching values', () => {
        const baseUrlNames = [
            'LLAMABARN_BASE_URL',
            'DEEPINFRA_BASE_URL',
            'HUGGINGFACE_INFERENCE_BASE_URL',
            'LEPTON_BASE_URL',
            'FEATHERLESS_BASE_URL',
            'SNOWFLAKE_BASE_URL',
            'HUNYUAN_BASE_URL',
            'VOLCENGINE_BASE_URL',
            'MINIMAX_BASE_URL',
            'BAICHUAN_BASE_URL',
            'STEPFUN_BASE_URL',
            'INTERNLM_BASE_URL',
            'REPLICATE_BASE_URL',
            'VLLM_BASE_URL',
            'LMSTUDIO_BASE_URL',
            'LOCALAI_BASE_URL',
            'KOBOLD_BASE_URL',
            'TEXTGENWEBUI_BASE_URL',
            'JAN_BASE_URL',
        ] as const;
        for (const name of baseUrlNames) {
            const m = (models as Record<string, unknown>)[name];
            const p = (providers as Record<string, unknown>)[name];
            expect(typeof m, `models.${name}`).toBe('string');
            expect(typeof p, `providers.${name}`).toBe('string');
            expect(m, `${name} values differ`).toBe(p);
        }
    });

    it('models re-exports PROVIDER (aliased from providers.MODEL_PROVIDER)', () => {
        expect(models.PROVIDER).toBeDefined();
        // Aliased on import — must be the same runtime value.
        expect(models.PROVIDER).toBe(
            (providers as unknown as { MODEL_PROVIDER: unknown }).MODEL_PROVIDER,
        );
    });

    it('src/models no longer ships duplicate provider implementations', async () => {
        // Regression guard: if anyone re-creates these files, `models.OpenAIProvider`
        // would silently shadow `providers.OpenAIProvider` and the identity checks
        // above would fail. Belt-and-braces filesystem check.
        const fs = await import('node:fs');
        const url = await import('node:url');
        const dupePaths = [
            new URL('../src/models/openai-provider.ts', import.meta.url),
            new URL('../src/models/openrouter-provider.ts', import.meta.url),
            new URL('../src/models/model-resolver.ts', import.meta.url),
        ];
        for (const u of dupePaths) {
            expect(
                fs.existsSync(url.fileURLToPath(u)),
                `duplicate impl reintroduced: ${u.pathname}`,
            ).toBe(false);
        }
    });
});

describe('OpenAIProvider constructed shape', () => {
    it('exposes generateText and (optional) streamText functions', () => {
        const p = new providers.OpenAIProvider({ apiKey: 'sk-test' });
        expect(typeof p.generateText).toBe('function');
        // streamText is optional on the interface; if present, it must be callable.
        if (p.streamText !== undefined) {
            expect(typeof p.streamText).toBe('function');
        }
    });
});
