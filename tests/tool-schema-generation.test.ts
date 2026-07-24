/**
 * Regression guard for a real bug the τ-bench benchmark surfaced (2026-07-24):
 *
 * Tools defined with the `tool({ parameters: z.object({...}) })` helper produced
 * an EMPTY JSON-Schema (`properties: {}`) when converted for the LLM, because
 * `zodToJsonSchema` read `def.shape` as an object while Zod v3's `ZodObject`
 * exposes `shape` as a lazy *function*. The model therefore never saw any
 * parameter descriptors and passed `undefined` for every required argument —
 * silently breaking every tool that takes arguments.
 *
 * These tests lock the fix: the generated schema must carry the declared
 * properties and mark non-optional ones as required.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod/v3';
import { tool } from '../src/tools/core/tool-helper.js';
import { toolToLLMDef, zodToJsonSchema } from '../src/agentic/_zod-to-schema.js';
import type { Tool } from '../src/core/index.js';

interface JsonObjectSchema {
    type: string;
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
}

describe('tool() → LLM schema generation', () => {
    it('includes a single required string property', () => {
        const t = tool({
            name: 'get_order',
            description: 'Look up an order.',
            parameters: z.object({ orderId: z.string().describe('Order id like W1001') }),
            execute: ({ orderId }) => ({ orderId }),
        }) as unknown as Tool;
        const schema = toolToLLMDef(t as never).parameters as JsonObjectSchema;
        expect(schema.properties?.orderId?.type).toBe('string');
        expect(schema.properties?.orderId?.description).toBe('Order id like W1001');
        expect(schema.required).toContain('orderId');
    });

    it('marks optional properties as not-required', () => {
        const schema = zodToJsonSchema(
            z.object({
                region: z.string().optional(),
                product: z.string(),
            }) as never,
        ) as JsonObjectSchema;
        expect(schema.properties?.region).toBeDefined();
        expect(schema.properties?.product).toBeDefined();
        expect(schema.required ?? []).toContain('product');
        expect(schema.required ?? []).not.toContain('region');
    });

    it('handles multiple typed properties (string + number + enum)', () => {
        const schema = zodToJsonSchema(
            z.object({
                column: z.enum(['units', 'revenue']),
                op: z.enum(['sum', 'avg']),
                limit: z.number(),
            }) as never,
        ) as JsonObjectSchema & { properties: Record<string, { enum?: string[]; type?: string }> };
        expect(schema.properties.column?.enum).toEqual(['units', 'revenue']);
        expect(schema.properties.limit?.type).toBe('number');
        expect(schema.required).toEqual(expect.arrayContaining(['column', 'op', 'limit']));
    });

    it('produces an empty-but-valid object schema for a no-arg tool', () => {
        const schema = zodToJsonSchema(z.object({}) as never) as JsonObjectSchema;
        expect(schema.type).toBe('object');
        expect(schema.properties).toEqual({});
    });
});
