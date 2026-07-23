/**
 * Export Smoke Tests — Phase 1 Acceptance Criterion
 *
 * Verifies that every public subpath entry point resolves at least one named
 * symbol. This catches export drift (pointing to missing or empty files),
 * barrel re-export gaps, and broken re-exports after package restructuring.
 *
 * Tests are intentionally read-only (no runtime execution of imports) —
 * they only assert that the resolved value is defined and the module loads.
 *
 * Covers: root ('.'), all named subpaths from package.json#exports.
 */

import { describe, it, expect } from 'vitest';

// ── Root entry point ─────────────────────────────────────────────────────────

describe('personaforge root (src/index.ts)', () => {
    it('exports agent (headline API)', async () => {
        const m = await import('../src/index.js');
        expect(m.agent).toBeDefined();
        expect(typeof m.agent).toBe('function');
    });

    it('exports createAgent (legacy)', async () => {
        const m = await import('../src/index.js');
        expect(m.createAgent).toBeDefined();
    });

    it('keeps optional integration tools behind category subpaths', async () => {
        const m = await import('../src/index.js');
        expect((m as Record<string, unknown>).CalculatorAddTool).toBeDefined();
        expect((m as Record<string, unknown>).PlaywrightPageTitleTool).toBeUndefined();
        expect((m as Record<string, unknown>).StripeCreateCustomerTool).toBeUndefined();
        expect((m as Record<string, unknown>).PostgreSQLQueryTool).toBeUndefined();
    });
});

// ── Subpath: ./model ─────────────────────────────────────────────────────────

describe('personaforge/model (src/model.ts)', () => {
    it('exports openai provider factory', async () => {
        const m = await import('../src/model.js');
        expect(m.openai).toBeDefined();
    });
});

// ── Subpath: ./observe ───────────────────────────────────────────────────────

describe('personaforge/observe (src/observe.ts)', () => {
    it('exports ConsoleLogger', async () => {
        const m = await import('../src/observe.js');
        expect(m.ConsoleLogger).toBeDefined();
    });
});

// ── Subpath: ./serve (src/serve.ts) ─────────────────────────────────────────

describe('personaforge/serve (src/serve.ts)', () => {
    it('exports createHttpService', async () => {
        const m = await import('../src/serve.js');
        expect(m.createHttpService).toBeDefined();
    });
});

// ── Subpath: ./tool ──────────────────────────────────────────────────────────

describe('personaforge/tool (src/tool.ts)', () => {
    it('exports tool() builder', async () => {
        const m = await import('../src/tool.js');
        expect(m.tool).toBeDefined();
        expect(typeof m.tool).toBe('function');
    });

    it('exports createTool', async () => {
        const m = await import('../src/tool.js');
        expect(m.createTool).toBeDefined();
    });
});

// ── Subpath: ./guard ─────────────────────────────────────────────────────────

describe('personaforge/guard (src/guard.ts)', () => {
    it('exports BudgetEnforcer', async () => {
        const m = await import('../src/guard.js');
        expect(m.BudgetEnforcer).toBeDefined();
    });

    it('exports RateLimiter', async () => {
        const m = await import('../src/guard.js');
        expect(m.RateLimiter).toBeDefined();
    });
});

// ── Subpath: ./workflow ──────────────────────────────────────────────────────

describe('personaforge/workflow (src/workflow.ts)', () => {
    it('exports createGraph builder', async () => {
        const m = await import('../src/workflow.js');
        expect(m.createGraph).toBeDefined();
    });
});

// ── Subpath: ./test ──────────────────────────────────────────────────────────

describe('personaforge/test (src/test.ts)', () => {
    it('exports mockAgent', async () => {
        const m = await import('../src/test.js');
        expect(m.mockAgent).toBeDefined();
    });
});

// ── Subpath: ./create-agent ──────────────────────────────────────────────────

describe('personaforge/create-agent (src/create-agent.ts)', () => {
    it('exports createAgent', async () => {
        const m = await import('../src/create-agent.js');
        expect(m.createAgent).toBeDefined();
    });
});

// ── Subpath: ./lite ──────────────────────────────────────────────────────────

describe('personaforge/lite (src/lite.ts)', () => {
    it('exports the minimal modern agent surface', async () => {
        const m = await import('../src/lite.js');
        expect(m.agent).toBeDefined();
        expect(m.createAgent).toBeDefined();
        expect(m.defineAgent).toBeDefined();
    });

    it('does not export umbrella barrel symbols', async () => {
        const m = await import('../src/lite.js');
        expect((m as Record<string, unknown>).InMemorySessionStore).toBeUndefined();
        expect((m as Record<string, unknown>).Agent).toBeUndefined();
    });
});

// ── Granular tool category subpaths ─────────────────────────────────────────

describe('personaforge/tools/* category subpaths', () => {
    it('search exports search tools without communication tools', async () => {
        const m = await import('../src/tools/search/index.js');
        expect(m.TavilySearchTool).toBeDefined();
        expect((m as Record<string, unknown>).SlackSendMessageTool).toBeUndefined();
    });

    it('core exports tool infrastructure without search tools', async () => {
        const m = await import('../src/tools/core/index.js');
        expect(m.tool).toBeDefined();
        expect((m as Record<string, unknown>).TavilySearchTool).toBeUndefined();
    });

    it('scraping exposes Playwright explicitly', async () => {
        const m = await import('../src/tools/scraping/index.js');
        expect(m.PlaywrightPageTitleTool).toBeDefined();
    });
});

// ── Subpath: ./playground ────────────────────────────────────────────────────

describe('personaforge/playground (src/playground.ts)', () => {
    it('exports createPlayground', async () => {
        const m = await import('../src/playground.js');
        expect(m.createPlayground).toBeDefined();
    });
});

// ── Package subpaths (src/ re-exports to @personaforge/* packages) ────────────

describe('src/index.ts → @personaforge packages (via re-export)', () => {
    it('agentic: AgenticRunner exported from root', async () => {
        const m = await import('../src/index.js');
        expect(m.AgenticRunner).toBeDefined();
    });

    it('session: InMemorySessionStore exported from root', async () => {
        const m = await import('../src/index.js');
        expect(m.InMemorySessionStore).toBeDefined();
    });

    it('guardrails: GuardrailValidator exported from root', async () => {
        const m = await import('../src/index.js');
        expect(m.GuardrailValidator).toBeDefined();
    });

    it('sdk: createWorkflow exported from root', async () => {
        const m = await import('../src/index.js');
        expect(m.createWorkflow).toBeDefined();
    });

    it('memory: InMemoryStore exported from root', async () => {
        const m = await import('../src/index.js');
        expect(m.InMemoryStore).toBeDefined();
    });
});

// ── Direct @personaforge/* package entry points ───────────────────────────────

describe('@personaforge/contracts', () => {
    it('exports newId', async () => {
        const m = await import('@personaforge/contracts');
        expect(m.newId).toBeDefined();
    });
});

describe('@personaforge/core', () => {
    it('exports AgentState', async () => {
        const m = await import('@personaforge/core');
        expect(m.AgentState).toBeDefined();
    });
});

describe('@personaforge/agentic', () => {
    it('exports AgenticRunner', async () => {
        const m = await import('@personaforge/agentic');
        expect(m.AgenticRunner).toBeDefined();
    });
});

describe('@personaforge/session', () => {
    it('exports InMemorySessionStore', async () => {
        const m = await import('@personaforge/session');
        expect(m.InMemorySessionStore).toBeDefined();
    });
});

describe('@personaforge/tools', () => {
    it('exports tool()', async () => {
        const m = await import('@personaforge/tools');
        expect(m.tool).toBeDefined();
    });

    it('exports createShellTool (not shell singleton)', async () => {
        const m = await import('@personaforge/tools');
        expect(m.createShellTool).toBeDefined();
        // The unrestricted singleton must NOT be exported from the barrel
        expect((m as Record<string, unknown>)['shell']).toBeUndefined();
    });

    it('does not export optional provider-backed tools from the safe barrel', async () => {
        const m = await import('@personaforge/tools');
        expect((m as Record<string, unknown>).CalculatorAddTool).toBeDefined();
        expect((m as Record<string, unknown>).PlaywrightPageTitleTool).toBeUndefined();
        expect((m as Record<string, unknown>).StripeCreateCustomerTool).toBeUndefined();
        expect((m as Record<string, unknown>).PostgreSQLQueryTool).toBeUndefined();
    });
});

describe('@personaforge/tools/search', () => {
    it('exports search tools without pulling the whole tools barrel', async () => {
        const m = await import('@personaforge/tools/search');
        expect(m.TavilySearchTool).toBeDefined();
        expect((m as Record<string, unknown>).SlackSendMessageTool).toBeUndefined();
    });
});

describe('@personaforge/graph', () => {
    it('exports DAGEngine', async () => {
        const m = await import('@personaforge/graph');
        expect(m.DAGEngine).toBeDefined();
    });
});

describe('@personaforge/workflow', () => {
    it('exports compose', async () => {
        const m = await import('@personaforge/workflow');
        expect(m.compose).toBeDefined();
    });
});

describe('@personaforge/orchestration', () => {
    it('exports OrchestratorImpl', async () => {
        const m = await import('@personaforge/orchestration');
        expect(m.OrchestratorImpl).toBeDefined();
    });
});

describe('@personaforge/memory', () => {
    it('exports InMemoryStore', async () => {
        const m = await import('@personaforge/memory');
        expect(m.InMemoryStore).toBeDefined();
    });
});

describe('@personaforge/knowledge', () => {
    it('exports KnowledgeEngine', async () => {
        const m = await import('@personaforge/knowledge');
        expect(m.KnowledgeEngine).toBeDefined();
    });
});

describe('@personaforge/guardrails', () => {
    it('exports GuardrailValidator', async () => {
        const m = await import('@personaforge/guardrails');
        expect(m.GuardrailValidator).toBeDefined();
    });
});

describe('@personaforge/production', () => {
    it('exports CircuitBreaker', async () => {
        const m = await import('@personaforge/production');
        expect(m.CircuitBreaker).toBeDefined();
    });

    it('exports ResilientAgent', async () => {
        const m = await import('@personaforge/production');
        expect(m.ResilientAgent).toBeDefined();
    });

    it('exports TenantScopedSessionStore', async () => {
        const m = await import('@personaforge/production');
        expect(m.TenantScopedSessionStore).toBeDefined();
    });
});

describe('@personaforge/observe', () => {
    it('exports createLogger', async () => {
        const m = await import('@personaforge/observe');
        expect(m.createLogger).toBeDefined();
    });
});

describe('@personaforge/models', () => {
    it('exports openai provider factory', async () => {
        const m = await import('@personaforge/models');
        expect(m.openai).toBeDefined();
    });
});

describe('@personaforge/shared', () => {
    it('exports DebugLogger', async () => {
        const m = await import('@personaforge/shared');
        expect(m.DebugLogger).toBeDefined();
    });
});

describe('@personaforge/guard', () => {
    it('exports CircuitBreaker', async () => {
        const m = await import('@personaforge/guard');
        expect(m.CircuitBreaker).toBeDefined();
    });
});

describe('@personaforge/planner', () => {
    it('exports ClassicalPlanner', async () => {
        const m = await import('@personaforge/planner');
        expect(m.ClassicalPlanner).toBeDefined();
    });
});

describe('@personaforge/execution', () => {
    it('exports ExecutionEngineImpl', async () => {
        const m = await import('@personaforge/execution');
        expect(m.ExecutionEngineImpl).toBeDefined();
    });
});

describe('@personaforge/sdk', () => {
    it('exports defineAgent', async () => {
        const m = await import('@personaforge/sdk');
        expect(m.defineAgent).toBeDefined();
    });
});

describe('@personaforge/test-utils', () => {
    it('exports createMockLLM', async () => {
        const m = await import('@personaforge/test-utils');
        expect(m.createMockLLM).toBeDefined();
    });
});
