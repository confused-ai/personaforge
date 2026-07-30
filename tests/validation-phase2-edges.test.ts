/**
 * Phase-2 Standard Schema edges — serve, guardrails, providers structured output.
 */
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import * as v from 'valibot';
import { validateBody, validate } from '../src/serve/validate.js';
import { ChatRequestSchema } from '../src/serve/schemas.js';
import { handleFeedback } from '../src/serve/feedback.js';
import { GuardrailValidator } from '../src/guardrails/validator.js';
import {
    validateStructuredOutput as providerValidate,
    buildStructuredOutputPrompt as providerPrompt,
} from '../src/providers/structured-output.js';
import { generateStructured } from '../src/structured/index.js';
import type { LLMProvider, Message } from '../src/contracts/interfaces.js';
import type { FeedbackStore } from '../src/production/index.js';

describe('serve validateBody edges', () => {
    it('accepts Zod ChatRequestSchema', () => {
        const ok = validateBody(ChatRequestSchema, { message: 'hello' });
        expect(ok.ok).toBe(true);
        if (ok.ok) expect(ok.data.message).toBe('hello');
    });

    it('rejects invalid body with issues', () => {
        const bad = validateBody(ChatRequestSchema, { message: '' });
        expect(bad.ok).toBe(false);
        if (!bad.ok) {
            expect(bad.error.message).toMatch(/Validation failed/i);
            expect(bad.issues).toBeDefined();
        }
    });

    it('accepts Valibot schemas', () => {
        const schema = v.object({ message: v.pipe(v.string(), v.minLength(1)) });
        const ok = validateBody(schema, { message: 'hi' });
        expect(ok.ok).toBe(true);
        const bad = validateBody(schema, { message: '' });
        expect(bad.ok).toBe(false);
    });

    it('Express middleware sets body or returns 400', () => {
        const mw = validate(z.object({ id: z.string() }));
        const next = vi.fn();
        const res = {
            status: vi.fn().mockReturnThis(),
            json: vi.fn(),
        };
        mw({ body: { id: 'a' } }, res as never, next);
        expect(next).toHaveBeenCalled();

        const next2 = vi.fn();
        mw({ body: { id: 1 } }, res as never, next2);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(next2).not.toHaveBeenCalled();
    });
});

describe('serve feedback edges', () => {
    it('stores valid feedback and rejects invalid', async () => {
        const stored: unknown[] = [];
        const store = {
            append: async (entry: unknown) => {
                stored.push(entry);
                return { ...(entry as object), id: 'fb1' };
            },
        } as unknown as FeedbackStore;

        const bad = await handleFeedback({ rating: 1 }, store);
        expect(bad.status).toBe(422);

        const ok = await handleFeedback({
            runId: 'run-1',
            rating: 1,
        }, store);
        expect(ok.status).toBe(201);
        expect(stored).toHaveLength(1);
    });
});

describe('guardrails schema edges', () => {
    it('passes Zod and Valibot output schemas', async () => {
        const engine = new GuardrailValidator({
            schemaValidations: [
                { name: 'zod-out', schema: z.object({ ok: z.boolean() }) },
                { name: 'val-out', schema: v.object({ ok: v.boolean() }) },
            ],
        });
        const ctx = { agentId: 'a1' };
        const pass = await engine.validateOutput({ ok: true }, ctx);
        expect(pass.every((r) => r.passed)).toBe(true);

        const fail = await engine.validateOutput({ ok: 'no' }, ctx);
        expect(fail.some((r) => !r.passed)).toBe(true);
    });
});

describe('providers structured-output edges', () => {
    it('validates Zod and Valibot', () => {
        const zOk = providerValidate('{"n":1}', { schema: z.object({ n: z.number() }) });
        expect(zOk.validated).toBe(true);
        const vOk = providerValidate('{"n":2}', { schema: v.object({ n: v.number() }) });
        expect(vOk.validated).toBe(true);
        const bad = providerValidate('{"n":"x"}', { schema: z.object({ n: z.number() }) });
        expect(bad.validated).toBe(false);
    });

    it('builds prompt with JSON Schema', () => {
        const prompt = providerPrompt({ schema: z.object({ a: z.string() }) });
        expect(prompt).toContain('"a"');
        expect(prompt).toContain('```json');
    });
});

describe('structured generateStructured edges', () => {
    it('accepts a raw Zod schema via Standard Schema adapter', async () => {
        const provider = {
            constructor: { name: 'UnknownProvider' },
            async generateText(_messages: Message[]) {
                return { text: '{"answer":"42"}', toolCalls: [] };
            },
        } as unknown as LLMProvider;

        const result = await generateStructured(
            provider,
            [{ role: 'user', content: 'q' }],
            z.object({ answer: z.string() }),
            { maxRetries: 0 },
        );
        expect(result.data).toEqual({ answer: '42' });
        expect(result.attempts).toBe(1);
    });

    it('accepts Valibot schema', async () => {
        const provider = {
            constructor: { name: 'UnknownProvider' },
            async generateText() {
                return { text: '{"answer":"ok"}', toolCalls: [] };
            },
        } as unknown as LLMProvider;

        const result = await generateStructured(
            provider,
            [{ role: 'user', content: 'q' }],
            v.object({ answer: v.string() }),
            { maxRetries: 0 },
        );
        expect(result.data).toEqual({ answer: 'ok' });
    });
});
