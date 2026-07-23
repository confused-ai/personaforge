/**
 * Scheduled Agent — Nightly Market Digest
 *
 * Real-world problem: A fintech team needs a bot that:
 *   1. Runs automatically at 09:00 every weekday
 *   2. Pulls the previous day's market snapshot
 *   3. Summarises it in ≤ 5 bullet points
 *   4. Saves the digest to a store (Slack/email/DB in production)
 *
 * This example uses ScheduleManager to register a cron job, wire an
 * in-process handler, and maintain a run history you can query.
 *
 * What it demonstrates:
 *   ✓  ScheduleManager CRUD (create, list, enable/disable, delete)
 *   ✓  In-process handler registry — register a key, fire by cron
 *   ✓  ScheduleRunStore — history of every execution
 *   ✓  Simulated poll loop (runs immediately in demo mode)
 *   ✓  Pattern for wiring a real agent as the handler
 *
 * Run: bun examples/scheduled-agent.ts
 */

import {
    ScheduleManager,
    InMemoryScheduleStore,
    InMemoryScheduleRunStore,
} from 'personaforge/scheduler';
import type { CreateScheduleInput } from 'personaforge/scheduler';

// ── Simulated market data ─────────────────────────────────────────────────

interface MarketSnapshot {
    date: string;
    indices: { name: string; change: string; value: number }[];
    topMovers: { ticker: string; change: string }[];
    sentiment: 'bullish' | 'neutral' | 'bearish';
}

function fetchMarketSnapshot(): MarketSnapshot {
    // In production: call a real market data API
    const today = new Date().toISOString().split('T')[0];
    return {
        date: today ?? 'unknown',
        indices: [
            { name: 'S&P 500',  change: '+0.82%', value: 5_247 },
            { name: 'NASDAQ',   change: '+1.14%', value: 16_920 },
            { name: 'FTSE 100', change: '-0.31%', value: 8_105 },
        ],
        topMovers: [
            { ticker: 'NVDA', change: '+4.2%' },
            { ticker: 'META', change: '+2.8%' },
            { ticker: 'TSLA', change: '-3.1%' },
        ],
        sentiment: 'bullish',
    };
}

function buildDigest(snapshot: MarketSnapshot): string {
    // In production: pass snapshot to an LLM agent for richer summaries
    const lines = [
        `📅 Market Digest — ${snapshot.date}`,
        ``,
        `📈 Indices:`,
        ...snapshot.indices.map(i => `  • ${i.name}: ${i.change} (${i.value.toLocaleString()})`),
        ``,
        `🔥 Top Movers:`,
        ...snapshot.topMovers.map(m => `  • ${m.ticker}: ${m.change}`),
        ``,
        `🧭 Overall Sentiment: ${snapshot.sentiment.toUpperCase()}`,
    ];
    return lines.join('\n');
}

async function deliverDigest(digest: string): Promise<void> {
    // In production: send to Slack / email / save to DB
    console.log('\n====== DIGEST DELIVERED ======');
    console.log(digest);
    console.log('==============================\n');
}

// ── Schedule setup ────────────────────────────────────────────────────────

function divider(title: string) {
    console.log(`\n${'─'.repeat(10)} ${title} ${'─'.repeat(10)}\n`);
}

async function main() {
    console.log('personaforge — Scheduled Agent: Nightly Market Digest\n');

    // ── 1. Create the manager with in-memory stores ───────────────────────
    const scheduleStore = new InMemoryScheduleStore();
    const runStore = new InMemoryScheduleRunStore();

    const manager = new ScheduleManager({
        store: scheduleStore,
        runStore,
        pollIntervalMs: 60_000, // real: check every minute
        debug: true,
    });

    // ── 2. Register the handler under a key ───────────────────────────────
    manager.register('market-digest', async () => {
        console.log('[handler] market-digest fired');
        const snapshot = fetchMarketSnapshot();
        const digest = buildDigest(snapshot);
        await deliverDigest(digest);
        return { delivered: true, date: snapshot.date };
    });

    divider('Creating schedule');

    // ── 3. Create the schedule ────────────────────────────────────────────
    const scheduleInput: CreateScheduleInput = {
        name: 'Nightly Market Digest',
        // Every weekday at 09:00 — cron: min hour dom mon dow
        // "0 9 * * 1-5"
        cronExpr: '0 9 * * 1-5',
        endpoint: 'market-digest', // matches the key above
        enabled: true,
        maxRetries: 2,
        retryDelaySeconds: 30,
    };

    const id = await manager.create(scheduleInput);
    console.log(`Created schedule id: ${id}`);

    // ── 4. Inspect the schedule ───────────────────────────────────────────
    const schedule = await manager.get(id);
    console.log(`Name      : ${schedule?.name}`);
    console.log(`Cron      : ${schedule?.cronExpr}`);
    console.log(`Next run  : ${schedule?.nextRunAt ?? '(computed on start)'}`);
    console.log(`Max retry : ${schedule?.maxRetries}`);

    divider('Listing all schedules');

    const all = await manager.list();
    for (const s of all) {
        console.log(`  [${s.enabled ? '✓' : ' '}] ${s.name} (${s.cronExpr})`);
    }

    // ── 5. Fire the handler manually (simulate a missed run / backfill) ───
    divider('Manual trigger (simulate missed run)');

    await manager.trigger(id);

    // ── 6. Query run history ──────────────────────────────────────────────
    divider('Run history');

    const runs = await manager.getRuns(id, 10);
    for (const run of runs) {
        const duration = run.completedAt
            ? `${new Date(run.completedAt).getTime() - new Date(run.triggeredAt).getTime()}ms`
            : 'in-progress';
        console.log(`  [${run.status.toUpperCase().padEnd(7)}] ${run.triggeredAt} (${duration})`);
        if (run.error) console.log(`             error: ${run.error}`);
    }

    // ── 7. Disable for the weekend ────────────────────────────────────────
    divider('Disable over weekend');

    await manager.update(id, { enabled: false });
    const updated = await manager.get(id);
    console.log(`Schedule enabled: ${updated?.enabled}`);

    // ── 8. Add a second schedule — hourly health digest ───────────────────
    divider('Add hourly health check schedule');

    manager.register('health-ping', async () => {
        console.log('[handler] health-ping fired — all systems nominal');
        return { ok: true };
    });

    const healthId = await manager.create({
        name: 'Hourly Health Ping',
        cronExpr: '0 * * * *', // every hour on the hour
        endpoint: 'health-ping',
        enabled: true,
        maxRetries: 1,
        retryDelaySeconds: 5,
    });

    console.log(`Health ping schedule id: ${healthId}`);

    const allAfter = await manager.list();
    console.log(`\nTotal schedules registered: ${allAfter.length}`);
    for (const s of allAfter) {
        console.log(`  [${s.enabled ? '✓' : ' '}] ${s.name}`);
    }

    // ── 9. Clean up (in production you would call manager.start() instead)
    divider('Cleanup');

    await manager.delete(healthId);
    console.log(`Deleted health-ping schedule.`);

    const remaining = await manager.list();
    console.log(`Remaining schedules: ${remaining.length}`);

    console.log('\nIn production: call manager.start() to begin the poll loop.');
    console.log('Call manager.stop() on SIGTERM for graceful shutdown.\n');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
