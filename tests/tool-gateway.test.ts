import { describe, it, expect } from 'vitest';
import { handleToolGatewayRequest } from '@personaforge/tools';
import { CalculatorAddTool } from '@personaforge/tools';

describe('handleToolGatewayRequest', () => {
    const tools = [
        new CalculatorAddTool({
            id: 'calc_add',
            name: 'calculator_add',
            description: 'add',
        }),
    ];

    it('lists tools', async () => {
        const r = await handleToolGatewayRequest('GET', '/tools', undefined, tools);
        expect(r.statusCode).toBe(200);
        expect((r.body as { tools: unknown[] }).tools).toHaveLength(1);
        expect((r.body as { tools: Array<{ id: string }> }).tools[0].id).toBe('calc_add');
    });

    it('invokes tool', async () => {
        const body = JSON.stringify({ toolId: 'calc_add', args: { a: 2, b: 3 } });
        const r = await handleToolGatewayRequest('POST', '/invoke', body, tools);
        expect(r.statusCode).toBe(200);
        const b = r.body as { success: boolean; data?: { result?: number } };
        expect(b.success).toBe(true);
        expect(b.data?.result).toBe(5);
    });

    it('404 for unknown tool', async () => {
        const r = await handleToolGatewayRequest(
            'POST',
            '/invoke',
            JSON.stringify({ toolId: 'nope', args: {} }),
            tools
        );
        expect(r.statusCode).toBe(404);
    });
});
