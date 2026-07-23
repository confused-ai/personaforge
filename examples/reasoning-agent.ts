/**
 * Reasoning Agent — Production Incident Triage
 *
 * Real-world problem: It's 3am. PagerDuty fires — "API error rate > 5%".
 * You need a structured diagnosis, not a one-shot guess.
 *
 * This example uses ReasoningManager to drive Chain-of-Thought (CoT) analysis
 * step-by-step. Each step produces: action → result → next_action.
 * Streaming ReasoningEvents give real-time visibility into the reasoning.
 *
 * What it demonstrates:
 *   ✓  ReasoningManager with a custom generate function
 *   ✓  Streaming ReasoningEvents (STARTED → STEP → COMPLETED)
 *   ✓  NextAction loop (continue → validate → final_answer)
 *   ✓  Mock LLM — runs without any API key
 *   ✓  Pattern for wiring a real LLM (OpenAI / Anthropic) in 5 lines
 *
 * Run: bun examples/reasoning-agent.ts
 * Real LLM: set OPENAI_API_KEY in examples/.env and uncomment the OpenAI block
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

config({
    path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env'),
    quiet: true,
});

import { ReasoningManager } from 'personaforge/reasoning';
import {
    NextAction,
    ReasoningEventType,
    type ReasoningEvent,
    type ReasoningStep,
} from 'personaforge/reasoning';

// ── Mock LLM (deterministic — no API key needed) ──────────────────────────

/**
 * Simulates an LLM that produces structured ReasoningStep JSON.
 * In production replace with:
 *
 *   import { OpenAIProvider } from 'personaforge';
 *   const llm = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY!, model: 'gpt-4o' });
 *   const generate = async (messages) => {
 *     const r = await llm.generate(messages.map(m => ({ role: m.role as any, content: m.content })));
 *     return r.content;
 *   };
 */
const MOCK_STEPS: ReasoningStep[] = [
    {
        title: 'Gather telemetry signals',
        action: 'I will check the error rate trend, affected endpoints, and upstream dependencies.',
        result: 'Error rate spiked at 03:17 UTC — confined to POST /v1/orders. DB latency also elevated (p99 = 4.2s vs baseline 80ms).',
        reasoning: 'Correlating the spike with a specific endpoint and infra component narrows the blast radius before digging deeper.',
        nextAction: NextAction.CONTINUE,
        confidence: 0.75,
    },
    {
        title: 'Check recent deployments',
        action: 'I will review deployment history for the past 2 hours.',
        result: 'Deployment "orders-service v2.4.1" was rolled out at 03:10 UTC — 7 minutes before the incident. Change diff shows a new DB query added to the order creation flow.',
        reasoning: 'A deployment immediately before the incident is the highest-probability causal candidate.',
        nextAction: NextAction.CONTINUE,
        confidence: 0.85,
    },
    {
        title: 'Analyse the new DB query',
        action: 'I will inspect the query introduced in v2.4.1 for common performance issues.',
        result: 'The new query: `SELECT * FROM inventory WHERE product_id = $1` is missing an index on `product_id`. At current traffic (3,200 orders/min) this causes a full-table scan per request.',
        reasoning: 'Missing index on a high-traffic query is a classic p99-latency bomb — consistent with the observed 4.2s DB latency.',
        nextAction: NextAction.VALIDATE,
        confidence: 0.92,
    },
    {
        title: 'Validate root cause',
        action: 'I will cross-check: is `product_id` indexed in staging? Does rolling back v2.4.1 restore DB latency?',
        result: 'Confirmed — staging DB has `product_id` indexed (added in migration but migration was not run in prod). Simulated rollback projection: DB latency returns to baseline. Root cause validated.',
        reasoning: 'Two independent validation signals (missing migration + rollback projection) confirm the hypothesis.',
        nextAction: NextAction.FINAL_ANSWER,
        confidence: 0.97,
    },
];

let mockStepIndex = 0;

async function mockGenerate(
    messages: Array<{ role: string; content: string }>,
): Promise<string> {
    void messages; // ignored in mock — real LLM reads full history
    const step = MOCK_STEPS[mockStepIndex % MOCK_STEPS.length];
    mockStepIndex++;
    return JSON.stringify(step);
}

// ── Incident payload ──────────────────────────────────────────────────────

const INCIDENT = `
INCIDENT REPORT — SEV-1
========================
Alert: API error rate > 5% (current: 8.3%)
Affected service: orders-service
Time: 2026-04-27 03:22 UTC
Symptoms:
  - POST /v1/orders returning HTTP 504 (Gateway Timeout) for ~12% of requests
  - DB connection pool showing high wait times
  - Customer complaints: checkout failures
On-call engineer: Alex (paged at 03:22 UTC)

Diagnose the root cause and suggest a remediation plan.
`.trim();

// ── Helpers ───────────────────────────────────────────────────────────────

function divider(title: string) {
    console.log(`\n${'─'.repeat(10)} ${title} ${'─'.repeat(10)}\n`);
}

function formatConfidence(c?: number): string {
    if (c === undefined) return '';
    const pct = Math.round(c * 100);
    const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
    return `  confidence ${bar} ${pct}%`;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
    console.log('personaforge — Reasoning Agent: Production Incident Triage\n');
    console.log('Incident:\n' + INCIDENT);

    const manager = new ReasoningManager({
        generate: mockGenerate,
        minSteps: 2,
        maxSteps: 8,
        debug: false,
    });

    const messages = [{ role: 'user', content: INCIDENT }];

    divider('Chain-of-Thought Reasoning');

    let stepCount = 0;
    const completedSteps: ReasoningStep[] = [];

    for await (const event of manager.reason(messages)) {
        switch (event.eventType) {
            case ReasoningEventType.STARTED:
                console.log('Reasoning started…\n');
                break;

            case ReasoningEventType.STEP: {
                const step = event.step!;
                stepCount++;
                console.log(`Step ${stepCount}: ${step.title ?? '(untitled)'}`);
                if (step.action)  console.log(`  Action  : ${step.action}`);
                if (step.result)  console.log(`  Result  : ${step.result}`);
                if (step.reasoning) console.log(`  Rationale: ${step.reasoning}`);
                console.log(`  Next    : ${step.nextAction ?? '—'}${formatConfidence(step.confidence)}`);
                console.log();
                break;
            }

            case ReasoningEventType.COMPLETED:
                completedSteps.push(...(event.steps ?? []));
                break;

            case ReasoningEventType.ERROR:
                console.error('Reasoning error:', event.error);
                break;
        }
    }

    divider('Incident Report Summary');

    const finalStep = completedSteps[completedSteps.length - 1];
    if (finalStep) {
        console.log(`Root cause identified after ${completedSteps.length} reasoning steps.\n`);
        console.log('Validated finding:', finalStep.result);
        console.log(formatConfidence(finalStep.confidence));
    }

    divider('Recommended Remediation');

    console.log(`
1. IMMEDIATE  (0–5 min)
   → Roll back orders-service to v2.4.0
   → Command: kubectl rollout undo deployment/orders-service

2. SHORT-TERM (5–30 min)
   → Run missing production migration:
     CREATE INDEX CONCURRENTLY idx_inventory_product_id ON inventory(product_id);

3. MEDIUM-TERM (next sprint)
   → Add migration-run check to CI/CD gate before production deploy
   → Add EXPLAIN ANALYZE regression test for all new queries
   → Set DB query timeout on orders-service: statement_timeout = '500ms'

4. POST-MORTEM
   → Schedule 48h retrospective
   → Add alerting on DB p99 > 500ms (current threshold: p99 > 2s — too late)
`);

    console.log(`Reasoning used ${stepCount} steps.\n`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
