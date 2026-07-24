/**
 * τ-bench retail domain tasks. Mirrors τ-bench's retail scenarios: order
 * lookups, returns, address changes — multi-step tool use with argument-level
 * verification.
 */

import { z } from 'zod/v3';
import { tool } from '../../../src/tools/core/tool-helper.js';
import type { AgentTask, RecordedCall } from '../harness.js';
import type { Tool } from '../../../src/core/index.js';

// ── Fake retail backend (deterministic) ─────────────────────────────────────
const ORDERS: Record<string, { userId: string; status: string; total: number; items: string[] }> = {
    'W1001': { userId: 'ada', status: 'delivered', total: 129.99, items: ['keyboard'] },
    'W1002': { userId: 'grace', status: 'shipped', total: 59.0, items: ['mouse'] },
    'W1003': { userId: 'ada', status: 'processing', total: 999.0, items: ['laptop-stand', 'cable'] },
};

const getOrder = tool({
    name: 'get_order',
    description: 'Look up an order by its id (e.g. W1001). Returns status, total, items.',
    parameters: z.object({ orderId: z.string().describe('Order id like W1001') }),
    execute: ({ orderId }) => ORDERS[orderId] ?? { error: 'not found' },
}) as unknown as Tool;

const listUserOrders = tool({
    name: 'list_user_orders',
    description: 'List all order ids belonging to a user id.',
    parameters: z.object({ userId: z.string() }),
    execute: ({ userId }) => ({
        orderIds: Object.entries(ORDERS).filter(([, o]) => o.userId === userId).map(([id]) => id),
    }),
}) as unknown as Tool;

const cancelOrder = tool({
    name: 'cancel_order',
    description: 'Cancel an order. Only allowed if status is "processing".',
    parameters: z.object({ orderId: z.string() }),
    execute: ({ orderId }) => {
        const o = ORDERS[orderId];
        if (!o) return { ok: false, error: 'not found' };
        if (o.status !== 'processing') return { ok: false, error: `cannot cancel: status is ${o.status}` };
        return { ok: true };
    },
}) as unknown as Tool;

const RETAIL_TOOLS = [getOrder, listUserOrders, cancelOrder];

function called(calls: readonly RecordedCall[], name: string): RecordedCall | undefined {
    return calls.find((c) => c.name === name);
}

export const RETAIL_TASKS: AgentTask[] = [
    {
        id: 'retail-01-order-status',
        domain: 'retail',
        instruction: 'What is the status of order W1002? Look it up.',
        tools: RETAIL_TOOLS,
        verify: (calls, text) => {
            const c = called(calls, 'get_order');
            if (!c) return { passed: false, reason: 'did not call get_order' };
            if (c.arguments['orderId'] !== 'W1002') return { passed: false, reason: `wrong orderId: ${String(c.arguments['orderId'])}` };
            const mentionsStatus = /shipped/i.test(text);
            return { passed: mentionsStatus, reason: mentionsStatus ? 'ok' : 'final text did not mention status "shipped"' };
        },
    },
    {
        id: 'retail-02-list-then-lookup',
        domain: 'retail',
        instruction: 'List all orders for user "ada", then tell me the total of her most expensive one.',
        tools: RETAIL_TOOLS,
        maxSteps: 6,
        verify: (calls) => {
            const list = called(calls, 'list_user_orders');
            if (!list || list.arguments['userId'] !== 'ada') return { passed: false, reason: 'did not list ada orders' };
            const looked = calls.filter((c) => c.name === 'get_order' && ['W1001', 'W1003'].includes(String(c.arguments['orderId'])));
            return { passed: looked.length >= 1, reason: looked.length >= 1 ? 'ok' : 'did not look up ada orders' };
        },
    },
    {
        id: 'retail-03-cancel-allowed',
        domain: 'retail',
        instruction: 'Cancel order W1003 for me.',
        tools: RETAIL_TOOLS,
        verify: (calls) => {
            const c = called(calls, 'cancel_order');
            if (!c) return { passed: false, reason: 'did not call cancel_order' };
            return { passed: c.arguments['orderId'] === 'W1003', reason: c.arguments['orderId'] === 'W1003' ? 'ok' : 'wrong orderId' };
        },
    },
    {
        id: 'retail-04-cancel-denied',
        domain: 'retail',
        instruction: 'Cancel order W1001. If it cannot be cancelled, explain why.',
        tools: RETAIL_TOOLS,
        verify: (calls, text) => {
            // W1001 is 'delivered' → cannot be cancelled. Two correct paths:
            //   (a) attempt cancel_order(W1001) and surface the denial, or
            //   (b) look it up with get_order(W1001), see it's delivered, and
            //       explain without a pointless mutating call.
            // Both are valid; only require that the agent inspected the right
            // order and explained why it can't be cancelled.
            const attemptedCancel = calls.some(
                (x) => x.name === 'cancel_order' && x.arguments['orderId'] === 'W1001',
            );
            const inspected = calls.some(
                (x) => x.name === 'get_order' && x.arguments['orderId'] === 'W1001',
            );
            if (!attemptedCancel && !inspected) {
                return { passed: false, reason: 'did not inspect or attempt to cancel W1001' };
            }
            const explained = /deliver|cannot|can't|unable|already/i.test(text);
            return { passed: explained, reason: explained ? 'ok' : 'did not explain why cancel failed' };
        },
    },
    {
        id: 'retail-05-multi-order-total',
        domain: 'retail',
        instruction: 'How much has user "ada" spent in total across all her orders? Look up each order.',
        tools: RETAIL_TOOLS,
        maxSteps: 8,
        verify: (calls) => {
            const looked = new Set(calls.filter((c) => c.name === 'get_order').map((c) => String(c.arguments['orderId'])));
            const hasBoth = looked.has('W1001') && looked.has('W1003');
            return { passed: hasBoth, reason: hasBoth ? 'ok' : `looked up ${[...looked].join(',') || 'nothing'} (needed W1001 & W1003)` };
        },
    },
];
