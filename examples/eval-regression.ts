/**
 * Eval Regression Guard — CI-safe prompt versioning
 *
 * Real-world problem: Your team ships a new system prompt. Before it goes to
 * production you want to know:
 *   "Does this change make the agent better, worse, or neutral?"
 *
 * This example uses runEvalSuite + InMemoryEvalStore to:
 *   1. Run a golden dataset against v1 (the baseline prompt)
 *   2. Save it as the baseline
 *   3. Run the same dataset against v2 (a prompt change candidate)
 *   4. Compare → detect regression if score drops > 5%
 *   5. Exit code 1 in CI on regression (process.exit is shown but commented for demo)
 *
 * What it demonstrates:
 *   ✓  runEvalSuite — run a dataset, score, compare to baseline
 *   ✓  InMemoryEvalStore — persist runs + baselines across suite calls
 *   ✓  setBaseline: true — save the first run as baseline
 *   ✓  regressionThreshold — customise acceptable score drop (default: 5%)
 *   ✓  Custom scorer — word-overlap F1 instead of exact match
 *   ✓  EvalReport — full structured report with per-sample breakdown
 *   ✓  MockLLMProvider — deterministic scoring, no API key needed
 *
 * Run: bun examples/eval-regression.ts
 * CI:  set EXIT_ON_REGRESSION=1 to make it exit 1 on regression
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

config({
    path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env'),
    quiet: true,
});

import {
    InMemoryEvalStore,
    runEvalSuite,
    type EvalDatasetItem,
    type EvalReport,
    type EvalScorer,
} from 'personaforge';
import { createAgent } from 'personaforge';
import { MockLLMProvider } from 'personaforge/test-utils';

// ── Golden dataset ─────────────────────────────────────────────────────────
// In production: load from JSON, CSV, or a database

const DATASET: EvalDatasetItem[] = [
    {
        input: 'What is the return policy?',
        expectedOutput: 'You can return any item within 30 days of purchase for a full refund.',
    },
    {
        input: 'How do I track my order?',
        expectedOutput: 'Visit the Orders page or check your confirmation email for a tracking link.',
    },
    {
        input: 'Do you offer free shipping?',
        expectedOutput: 'Free shipping on all orders over $50.',
    },
    {
        input: 'How do I cancel my subscription?',
        expectedOutput: 'Go to Account > Subscriptions > Cancel. Cancellation takes effect at end of billing period.',
    },
    {
        input: 'Is my payment information secure?',
        expectedOutput: 'Yes. We use PCI-DSS compliant payment processing and never store card numbers.',
    },
];

// ── V1 prompt (baseline) ──────────────────────────────────────────────────

const V1_RESPONSES = new Map([
    ['What is the return policy?',
        'You can return any item within 30 days of purchase for a full refund.'],
    ['How do I track my order?',
        'Visit the Orders page or check your confirmation email for a tracking link.'],
    ['Do you offer free shipping?',
        'Free shipping on all orders over $50.'],
    ['How do I cancel my subscription?',
        'Go to Account > Subscriptions > Cancel. Cancellation takes effect at end of billing period.'],
    ['Is my payment information secure?',
        'Yes. We use PCI-DSS compliant payment processing and never store card numbers.'],
]);

// ── V2 prompt (candidate — subtly worse) ─────────────────────────────────
// Simulates a prompt change that degrades accuracy on some questions

const V2_RESPONSES = new Map([
    ['What is the return policy?',
        'Returns are accepted within 30 days.'],   // shorter — slightly worse match
    ['How do I track my order?',
        'Check your email.'],                       // too vague — bad match
    ['Do you offer free shipping?',
        'Free shipping on orders over $50.'],       // close
    ['How do I cancel my subscription?',
        'Go to Account > Subscriptions > Cancel. Cancellation takes effect at end of billing period.'],
    ['Is my payment information secure?',
        'We follow industry security standards.'],  // vague — worse
]);

// ── Scorer: word-overlap F1 ────────────────────────────────────────────────
// Better than exact match for free-form support answers

function tokenize(text: string): Set<string> {
    return new Set(
        text.toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter(Boolean),
    );
}

const wordOverlapF1Scorer: EvalScorer = (_input, expected, actual) => {
    if (!expected) return 0.5;
    const expTokens = tokenize(expected);
    const actTokens = tokenize(actual);

    let overlap = 0;
    for (const t of actTokens) {
        if (expTokens.has(t)) overlap++;
    }

    const precision = actTokens.size === 0 ? 0 : overlap / actTokens.size;
    const recall    = expTokens.size === 0 ? 0 : overlap / expTokens.size;

    if (precision + recall === 0) return 0;
    return (2 * precision * recall) / (precision + recall);
};

// ── Helpers ───────────────────────────────────────────────────────────────

function divider(title: string) {
    console.log(`\n${'─'.repeat(10)} ${title} ${'─'.repeat(10)}\n`);
}

function printReport(report: EvalReport) {
    console.log(`Suite      : ${report.suiteName}`);
    console.log(`Score      : ${(report.averageScore * 100).toFixed(1)}%  (${report.passedCount}/${report.totalCount} passed)`);
    console.log(`Baseline   : ${report.baselineScore !== null ? (report.baselineScore * 100).toFixed(1) + '%' : 'none (this run becomes baseline)'}`);
    if (report.regressionDelta !== null) {
        const arrow = report.regressionDelta >= 0 ? '↑' : '↓';
        console.log(`Delta      : ${arrow} ${(Math.abs(report.regressionDelta) * 100).toFixed(1)}%`);
    }
    console.log(`Status     : ${report.passed ? '✅ PASSED' : '❌ FAILED — regression detected'}`);
    console.log(`Duration   : ${report.durationMs}ms`);

    console.log('\nPer-sample breakdown:');
    const header = '  Input                             | Score | Pass | Expected (truncated)';
    console.log(header);
    console.log('  ' + '─'.repeat(header.length - 2));
    for (const s of report.samples) {
        const input   = s.input.slice(0, 34).padEnd(34);
        const score   = (s.score * 100).toFixed(0).padStart(4) + '%';
        const pass    = s.passed ? ' ✓  ' : ' ✗  ';
        const expected = (s.expectedOutput ?? '—').slice(0, 40);
        console.log(`  ${input} | ${score} | ${pass} | ${expected}`);
    }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
    console.log('personaforge — Eval Regression Guard\n');

    const store = new InMemoryEvalStore();

    // ── Run 1: V1 prompt (establish baseline) ─────────────────────────────

    divider('Run 1 — V1 prompt (baseline)');

    const agentV1 = createAgent({
        name: 'SupportBot-v1',
        instructions: 'You are a helpful customer support agent. Answer customer questions accurately and concisely.',
        tools: false,
        llm: new MockLLMProvider({ responses: V1_RESPONSES }),
    });

    const report1 = await runEvalSuite({
        suiteName: 'support-qa',
        dataset: DATASET,
        agent: agentV1,
        store,
        scorer: wordOverlapF1Scorer,
        passingScore: 0.6,        // each sample must score ≥ 60%
        regressionThreshold: 0.05, // fail if score drops > 5%
        setBaseline: true,         // save this run as the baseline
        onSample: (i, total, s) => {
            process.stdout.write(`  [${i}/${total}] ${s.input.slice(0, 50)}\r`);
        },
    });

    console.log('');
    printReport(report1);

    // ── Run 2: V2 prompt candidate (regression check) ─────────────────────

    divider('Run 2 — V2 prompt candidate (regression check)');

    const agentV2 = createAgent({
        name: 'SupportBot-v2',
        instructions: 'You are a support assistant. Be brief.',  // ← worse prompt
        tools: false,
        llm: new MockLLMProvider({ responses: V2_RESPONSES }),
    });

    const report2 = await runEvalSuite({
        suiteName: 'support-qa',   // same suite name → compares to baseline from Run 1
        dataset: DATASET,
        agent: agentV2,
        store,
        scorer: wordOverlapF1Scorer,
        passingScore: 0.6,
        regressionThreshold: 0.05,
    });

    console.log('');
    printReport(report2);

    // ── Run 3: V2 with a fix (should pass) ────────────────────────────────

    divider('Run 3 — V2 fixed (should pass)');

    // Patch the two degraded answers
    const V2_FIXED = new Map(V2_RESPONSES);
    V2_FIXED.set('How do I track my order?',
        'Visit the Orders page or check your confirmation email for a tracking link.');
    V2_FIXED.set('Is my payment information secure?',
        'Yes. We use PCI-DSS compliant payment processing and never store card numbers.');

    const agentV2Fixed = createAgent({
        name: 'SupportBot-v2-fixed',
        instructions: 'You are a support assistant. Be brief.',
        tools: false,
        llm: new MockLLMProvider({ responses: V2_FIXED }),
    });

    const report3 = await runEvalSuite({
        suiteName: 'support-qa',
        dataset: DATASET,
        agent: agentV2Fixed,
        store,
        scorer: wordOverlapF1Scorer,
        passingScore: 0.6,
        regressionThreshold: 0.05,
    });

    console.log('');
    printReport(report3);

    // ── History summary ────────────────────────────────────────────────────

    divider('Eval history');

    const history = await store.queryRuns('support-qa', 10);
    for (const run of history) {
        const baseline = run.isBaseline ? ' [BASELINE]' : '';
        const pass     = run.passedCount === run.totalCount ? '✅' : '⚠️ ';
        console.log(`  ${pass} ${run.id.slice(0, 8)}  avg ${(run.averageScore * 100).toFixed(1)}%  (${run.passedCount}/${run.totalCount})${baseline}`);
    }

    // ── CI exit ────────────────────────────────────────────────────────────

    divider('CI result');

    const allPassed = [report1, report2, report3].every(r => r.passed);
    const failed    = [report1, report2, report3].filter(r => !r.passed);

    if (failed.length > 0) {
        console.log(`${failed.length} run(s) failed regression check:`);
        for (const r of failed) {
            console.log(`  ✗  ${r.suiteName} — delta: ${r.regressionDelta !== null ? (r.regressionDelta * 100).toFixed(1) + '%' : 'N/A'}`);
        }
        // In CI: uncomment the next line to fail the build on regression
        // if (process.env.EXIT_ON_REGRESSION === '1') process.exit(1);
        console.log('\n(Set EXIT_ON_REGRESSION=1 to exit 1 in CI)');
    } else {
        console.log('All runs passed. ✅ Safe to ship.');
    }

    console.log('\nProduction tip: swap InMemoryEvalStore for SqliteEvalStore');
    console.log('  const store = createSqliteEvalStore("./evals.db");');
    console.log('Results persist across CI runs — baselines survive deploys.\n');

    void allPassed;
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
