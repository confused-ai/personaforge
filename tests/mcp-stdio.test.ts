import { describe, it, expect } from 'vitest';
import { handleMcpStdioLine } from '@personaforge/tools';
import { CalculatorAddTool } from '@personaforge/tools';

const serverInfo = { name: 'test-mcp', version: '0.0.1' };

describe('handleMcpStdioLine', () => {
    it('responds to initialize', async () => {
        const line = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {},
        });
        const r = await handleMcpStdioLine(line, [], serverInfo);
        const o = JSON.parse(r!) as { result: { serverInfo: { name: string } } };
        expect(o.result.serverInfo.name).toBe('test-mcp');
    });

    it('lists tools', async () => {
        const tool = new CalculatorAddTool();
        const r = await handleMcpStdioLine(
            JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
            [tool],
            serverInfo
        );
        const o = JSON.parse(r!) as { result: { tools: { name: string }[] } };
        expect(o.result.tools.some((x) => x.name === 'calculator_add')).toBe(true);
    });

    it('invokes tools/call', async () => {
        const tool = new CalculatorAddTool();
        const r = await handleMcpStdioLine(
            JSON.stringify({
                jsonrpc: '2.0',
                id: 3,
                method: 'tools/call',
                params: { name: 'calculator_add', arguments: { a: 2, b: 3 } },
            }),
            [tool],
            serverInfo
        );
        const o = JSON.parse(r!) as { result: { content: { text: string }[] } };
        expect(o.result.content[0].text).toContain('5');
    });
});
