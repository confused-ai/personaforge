/**
 * CLI — `personaforge diff` command
 *
 * Compares the event timelines of two runs side-by-side.
 * Highlights nodes that diverge in status, order, or duration.
 *
 * Usage:
 *   personaforge diff --run-id-a <idA> --run-id-b <idB> [--db <path>]
 */

import type { Command } from 'commander';
import { SqliteEventStore, GraphEventType } from '../../graph/index.js';
import type { GraphEvent } from '../../graph/index.js';

interface NodeOutcome {
  status: string;
  attempts: number;
  durationMs?: number;
  sequence: number;
}

function extractOutcomes(events: GraphEvent[]): Map<string, NodeOutcome> {
  const outcomes = new Map<string, NodeOutcome>();
  for (const e of events) {
    if (!e.nodeId) continue;
    if (!outcomes.has(e.nodeId)) {
      outcomes.set(e.nodeId, { status: 'pending', attempts: 0, sequence: e.sequence });
    }
    const o = outcomes.get(e.nodeId);
    if (!o) continue;
    switch (e.type) {
      case GraphEventType.NODE_STARTED:
        o.status = 'running';
        o.attempts = typeof e.data?.['attempt'] === 'number' ? e.data['attempt'] : o.attempts + 1;
        o.sequence = e.sequence;
        break;
      case GraphEventType.NODE_COMPLETED:
        o.status = 'completed';
        if (typeof e.data?.['durationMs'] === 'number') o.durationMs = e.data['durationMs'];
        break;
      case GraphEventType.NODE_FAILED:
        o.status = 'failed';
        break;
      case GraphEventType.NODE_SKIPPED:
        o.status = 'skipped';
        break;
    }
  }
  return outcomes;
}

function diffSymbol(a?: string, b?: string): string {
  if (!a) return '<missing>';
  if (!b) return '<missing>';
  return a === b ? '=' : '≠';
}

export function registerDiffCommand(program: Command): void {
  program
    .command('diff')
    .description('Compare event timelines of two runs')
    .requiredOption('--run-id-a <id>', 'First run ID (baseline)')
    .requiredOption('--run-id-b <id>', 'Second run ID (comparison)')
    .option('--db <path>', 'Path to the SQLite event store', './agent.db')
    .option('--db-a <path>', 'Path to event store for run A (overrides --db)')
    .option('--db-b <path>', 'Path to event store for run B (overrides --db)')
    .action(async (opts) => {
      const dbA = opts.dbA ?? opts.db;
      const dbB = opts.dbB ?? opts.db;

      const storeA = new SqliteEventStore(dbA);
      const storeB = dbB === dbA ? storeA : new SqliteEventStore(dbB);
      await storeA.init();
      if (dbB !== dbA) await storeB.init();

      const eventsA = await storeA.load(opts.runIdA);
      const eventsB = await storeB.load(opts.runIdB);

      if (eventsA.length === 0) {
        console.error(`No events found for run A: "${opts.runIdA}"`);
        process.exit(1);
        return;
      }
      if (eventsB.length === 0) {
        console.error(`No events found for run B: "${opts.runIdB}"`);
        process.exit(1);
        return;
      }

      const outcomesA = extractOutcomes(eventsA);
      const outcomesB = extractOutcomes(eventsB);

      // All node IDs across both runs
      const allNodeIds = new Set([...outcomesA.keys(), ...outcomesB.keys()]);

      // Summary line
      const totalA = eventsA.length;
      const totalB = eventsB.length;
      const firstA = eventsA[0];
      const lastA = eventsA[eventsA.length - 1];
      const firstB = eventsB[0];
      const lastB = eventsB[eventsB.length - 1];
      if (!firstA || !lastA || !firstB || !lastB) return;
      const durA = lastA.timestamp - firstA.timestamp;
      const durB = lastB.timestamp - firstB.timestamp;

      console.log(`\nRun A: ${opts.runIdA}  (${totalA} events, ${durA}ms)`);
      console.log(`Run B: ${opts.runIdB}  (${totalB} events, ${durB}ms)`);
      console.log(`Duration delta: ${durB - durA > 0 ? '+' : ''}${durB - durA}ms`);
      console.log();

      const W = { node: 18, status: 12, dur: 10 };
      const header =
        'NODE ID'.padEnd(W.node) +
        'RUN A STATUS'.padEnd(W.status) +
        'RUN B STATUS'.padEnd(W.status) +
        'DIFF'.padEnd(6) +
        'DUR A'.padEnd(W.dur) +
        'DUR B'.padEnd(W.dur) +
        'Δ DUR';
      console.log(header);
      console.log('─'.repeat(header.length + 5));

      let divergent = 0;

      for (const nid of allNodeIds) {
        const a = outcomesA.get(nid);
        const b = outcomesB.get(nid);
        const sym = diffSymbol(a?.status, b?.status);
        const same = sym === '=';
        if (!same) divergent++;

        const durAStr = a?.durationMs != null ? `${a.durationMs}ms` : '-';
        const durBStr = b?.durationMs != null ? `${b.durationMs}ms` : '-';
        const deltaDur = a?.durationMs != null && b?.durationMs != null
          ? `${b.durationMs - a.durationMs > 0 ? '+' : ''}${b.durationMs - a.durationMs}ms`
          : '-';

        const marker = same ? ' ' : '!';
        const row =
          `${marker} ${nid.slice(0, W.node - 2).padEnd(W.node - 2)}` +
          (a?.status ?? '-').padEnd(W.status) +
          (b?.status ?? '-').padEnd(W.status) +
          sym.padEnd(6) +
          durAStr.padEnd(W.dur) +
          durBStr.padEnd(W.dur) +
          deltaDur;
        console.log(row);
      }

      console.log();
      console.log(`${allNodeIds.size} nodes compared — ${divergent} divergent`);
      if (divergent > 0) process.exitCode = 1;
    });
}
