import { describe, it, expect, afterEach } from 'vitest';
import { createEnterpriseGateway } from '../src/gateway/index.js';
import type { EnterpriseGateway } from '../src/gateway/index.js';
import { InMemoryAuditStore } from '../src/production/audit-store.js';

let server: EnterpriseGateway | null = null;
const PORT = 4298;
const base = `http://localhost:${PORT}`;

afterEach(async () => { await server?.stop(100); server = null; });

/** Minimal structural mock satisfying the CreateAgentResult shape used by the gateway. */
function mockAgent(name: string) {
    return {
        name,
        instructions: 'test',
        run: async (prompt: string) => ({
            text: `${name}:${prompt}`,
            steps: 1,
            finishReason: 'stop' as const,
            usage: { totalTokens: 100, promptTokens: 50, completionTokens: 50 },
        }),
        stream: async function* () {},
        streamEvents: async function* () {},
        getCompressionStats: () => undefined,
        createSession: async () => `session-${name}`,
        getSessionMessages: async () => [],
        resume: () => ({ run: async () => ({}), stream: async function* () {}, streamEvents: async function* () {} }),
        asTool: () => ({ name, description: 'x', parameters: {}, execute: async () => ({}) }),
        generate: async () => ({}),
        observe: async () => ({ done: true, events: [] }),
        approveToolCall: async () => ({ done: true, events: [] }),
        declineToolCall: async () => ({ done: true, events: [] }),
        approveToolCallGenerate: async () => ({}),
        declineToolCallGenerate: async () => ({}),
        resumeStream: async () => ({ done: true, events: [] }),
        setObjective: async () => null,
        getObjective: async () => null,
        updateObjectiveOptions: async () => {},
        clearObjective: async () => {},
        listSuspendedRuns: async () => ({ runs: [] }),
        recoverActiveRuns: async () => ({ recovered: 0, succeeded: 0, failed: 0 }),
    };
}

describe('enterprise gateway', () => {
    it('serves compliance dashboard HTML at /compliance', async () => {
        server = createEnterpriseGateway({
            agents: { alpha: mockAgent('alpha') as never },
        });
        await server.start(PORT);
        const res = await fetch(base + '/compliance');
        expect(res.headers.get('content-type')).toContain('text/html');
        const html = await res.text();
        expect(html).toContain('Compliance Dashboard');
        expect(html).toContain('SOC2');
    });

    it('exposes compliance report as JSON at /compliance/report', async () => {
        server = createEnterpriseGateway({
            agents: { alpha: mockAgent('alpha') as never },
            auth: { strategy: 'api-key', keys: ['sk-test'] },
            tenants: [
                { id: 'acme', monthlyBudgetUsd: 100, maxRpm: 60 },
            ],
            policy: { monthlyBudgetUsd: 1000, requestTimeoutMs: 30_000 },
            auditStore: new InMemoryAuditStore(),
        });
        await server.start(PORT);
        const report = await (await fetch(base + '/compliance/report', {
            headers: { 'x-api-key': 'sk-test' },
        })).json();
        // A properly configured gateway must have zero failed controls
        expect(report.failCount).toBe(0);
        expect(['pass', 'warn']).toContain(report.overallStatus);
        expect(report.tenantCount).toBe(1);
        expect(report.agentCount).toBe(1);
        expect(report.controls.length).toBeGreaterThan(0);
        expect(report.controls.some((c: { id: string }) => c.id === 'AUTH-1')).toBe(true);
    });

    it('returns 401 without a valid API key', async () => {
        server = createEnterpriseGateway({
            agents: { alpha: mockAgent('alpha') as never },
            auth: { strategy: 'api-key', keys: ['sk-test'] },
        });
        await server.start(PORT);
        const res = await fetch(base + '/v1/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ message: 'hi' }),
        });
        expect(res.status).toBe(401);
    });

    it('proxies chat to the agent with auth', async () => {
        server = createEnterpriseGateway({
            agents: { alpha: mockAgent('alpha') as never },
            auth: { strategy: 'api-key', keys: ['sk-test'] },
        });
        await server.start(PORT);
        const d = await (await fetch(base + '/v1/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': 'sk-test' },
            body: JSON.stringify({ agent: 'alpha', message: 'hello' }),
        })).json();
        expect(d.text).toBe('alpha:hello');
    });

    it('enforces tenant agent allowlist', async () => {
        server = createEnterpriseGateway({
            agents: { support: mockAgent('support') as never, billing: mockAgent('billing') as never },
            auth: { strategy: 'api-key', keys: ['sk-test'] },
            tenants: [{ id: 'acme', allowedAgents: ['support'] }],
            tenantResolution: { mode: 'header' },
        });
        await server.start(PORT);

        // Allowed
        const ok = await fetch(base + '/v1/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': 'sk-test', 'x-tenant-id': 'acme' },
            body: JSON.stringify({ agent: 'support', message: 'hi' }),
        });
        expect(ok.status).toBe(200);

        // Not allowed
        const denied = await fetch(base + '/v1/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-api-key': 'sk-test', 'x-tenant-id': 'acme' },
            body: JSON.stringify({ agent: 'billing', message: 'hi' }),
        });
        expect(denied.status).toBe(403);
    });

    it('records audit entries with prompt hashes', async () => {
        const audit = new InMemoryAuditStore();
        server = createEnterpriseGateway({
            agents: { alpha: mockAgent('alpha') as never },
            auditStore: audit,
        });
        await server.start(PORT);
        await fetch(base + '/v1/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ agent: 'alpha', message: 'secret prompt' }),
        });

        const entries = await audit.query();
        expect(entries.length).toBe(1);
        expect(entries[0]!.promptHash).toBeTruthy();
        expect(entries[0]!.promptHash).not.toContain('secret');
        expect(entries[0]!.agentName).toBe('alpha');
    });

    it('enforces per-tenant rate limits', async () => {
        server = createEnterpriseGateway({
            agents: { alpha: mockAgent('alpha') as never },
            tenants: [{ id: 'acme', maxRpm: 2 }],
            tenantResolution: { mode: 'header' },
        });
        await server.start(PORT);

        const headers = { 'content-type': 'application/json', 'x-tenant-id': 'acme' };
        const body = JSON.stringify({ agent: 'alpha', message: 'hi' });

        const r1 = await fetch(base + '/v1/chat', { method: 'POST', headers, body });
        const r2 = await fetch(base + '/v1/chat', { method: 'POST', headers, body });
        const r3 = await fetch(base + '/v1/chat', { method: 'POST', headers, body });

        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);
        expect(r3.status).toBe(429);
    });

    it('returns 404 for unknown routes', async () => {
        server = createEnterpriseGateway({ agents: { alpha: mockAgent('alpha') as never } });
        await server.start(PORT);
        const res = await fetch(base + '/nope');
        expect(res.status).toBe(404);
    });

    it('getComplianceReport returns live budget usage', async () => {
        server = createEnterpriseGateway({
            agents: { alpha: mockAgent('alpha') as never },
        });
        await server.start(PORT);
        await fetch(base + '/v1/chat', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ agent: 'alpha', message: 'hi' }),
        });
        const report = await server.getComplianceReport();
        expect(report.budgetUsageUsd).toBeGreaterThan(0);
        expect(report.auditEntries).toBeGreaterThan(0);
    });
});