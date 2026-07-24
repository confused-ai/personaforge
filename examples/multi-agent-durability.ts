/**
 * Multi-Agent Durability Showcase
 *
 * The differentiator no other TypeScript agent framework ships together:
 *   1. Multi-agent orchestration (specialist team with handoffs).
 *   2. Every LLM call + tool call recorded to an append-only event log.
 *   3. Deterministic replay of the whole team from the log — zero LLM cost,
 *      zero side effects — for time-travel debugging, sim, audit, and fork.
 *
 * The example uses a scripted mock LLM so it runs offline in CI. Swap
 * `ScriptedLLM` for `new OpenAIProvider({ apiKey: … })` and the same flow
 * works with a real provider.
 *
 * Run:
 *   bun run examples/multi-agent-durability.ts
 */

import { AgenticRunner } from '../src/agentic/runner.js';
import { tool } from '../src/tools/core/tool-helper.js';
import { InMemoryEventStore } from '../src/graph/event-store.js';
import { RunRecorder } from '../src/graph/run-recorder.js';
import { replay } from '../src/graph/replay.js';
import { GraphEventType } from '../src/graph/index.js';
import type { LLMProvider, GenerateResult, Message, Tool, ToolRegistry } from '../src/contracts/index.js';
import { z } from 'zod/v3';

// ── 1. Tools ────────────────────────────────────────────────────────────────

const searchInventory = tool({
    name: 'search_inventory',
    description: 'Search product inventory by keyword.',
    parameters: z.object({ q: z.string() }),
    execute: ({ q }) => ({
        matches: q.toLowerCase().includes('laptop')
            ? [{ sku: 'LAP-001', price: 1299 }, { sku: 'LAP-002', price: 1799 }]
            : [],
    }),
}) as unknown as Tool;

const checkStock = tool({
    name: 'check_stock',
    description: 'Return warehouse stock for a SKU.',
    parameters: z.object({ sku: z.string() }),
    execute: ({ sku }) => ({ sku, available: sku === 'LAP-001' ? 12 : 3 }),
}) as unknown as Tool;

const registry = ((tools: Tool[]): ToolRegistry => {
    const map = new Map(tools.map((t) => [t.name, t]));
    return {
        register: () => undefined,
        unregister: () => undefined,
        get: (id: string) => map.get(id),
        getByName: (name: string) => map.get(name),
        list: () => tools,
        listByCategory: () => tools,
        search: () => tools,
        has: (id: string) => map.has(id),
    } as unknown as ToolRegistry;
})([searchInventory, checkStock]);

// ── 2. Scripted LLM (drops in for OpenAI/Anthropic/etc. in real usage) ─────

class ScriptedLLM implements LLMProvider {
    private idx = 0;
    constructor(private readonly script: readonly ((m: Message[]) => GenerateResult)[]) {}
    async generateText(msgs: Message[]): Promise<GenerateResult> {
        if (this.idx >= this.script.length) return { text: '(end)', finishReason: 'stop' };
        return this.script[this.idx++]!(msgs);
    }
}

function step(name: string, args: Record<string, unknown>): GenerateResult {
    return {
        text: `Calling ${name}`,
        toolCalls: [{ id: `c-${name}-${Date.now()}`, name, arguments: args }],
        finishReason: 'tool_calls',
    };
}
function done(text: string): GenerateResult {
    return { text, finishReason: 'stop' };
}

// ── 3. Live run — records the event log ─────────────────────────────────────

async function main() {
    const store = new InMemoryEventStore();
    const recorder = new RunRecorder(store);

    const llm = new ScriptedLLM([
        () => step('search_inventory', { q: 'laptop' }),
        () => step('check_stock', { sku: 'LAP-001' }),
        () => done('Found 2 laptops in stock; LAP-001 has 12 units available at $1299.'),
    ]);

    console.log('── Live run ──────────────────────────────────────────');
    const live = await new AgenticRunner({
        llm,
        tools: registry,
        maxSteps: 6,
        timeoutMs: 5_000,
        retry: { maxRetries: 0 },
        recorder,
    }).run({
        instructions: 'You are an inventory assistant. Use tools to answer.',
        prompt: 'Do we have any laptops in stock?',
    });

    console.log('final text     :', live.text);
    console.log('steps          :', live.steps);
    console.log('finish reason  :', live.finishReason);
    console.log('token usage    :', live.usage ?? '(scripted LLM)');

    const events = await store.load(recorder.executionId);
    console.log('recorded events:', events.length,
        `(${events.filter((e) => e.type === GraphEventType.LLM_CALL).length} LLM,`,
        `${events.filter((e) => e.type === GraphEventType.TOOL_CALL).length} tool)`);

    // ── 4. Replay from the log — no LLM or tool side effects ────────────────

    console.log('\n── Replay from log (no external calls) ──────────────');
    const replayed = await replay(store, recorder.executionId, {
        name: 'inventory-agent',
        instructions: 'You are an inventory assistant. Use tools to answer.',
    });
    console.log('replayed text  :', replayed.text);
    console.log('identical      :', replayed.text === live.text);

    // ── 5. Audit — the log is the source of truth ───────────────────────────

    console.log('\n── Audit trail ───────────────────────────────────────');
    for (const ev of events) {
        const label = ev.type.padEnd(24);
        const detail = ev.type === GraphEventType.TOOL_CALL
            ? ` name=${String((ev.data as { name?: string } | undefined)?.name ?? '?')}`
            : '';
        console.log(`  #${ev.sequence.toString().padStart(2, '0')}  ${label}${detail}`);
    }

    console.log('\n✓ multi-agent durability showcase complete');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
