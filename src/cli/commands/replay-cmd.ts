/**
 * CLI — `personaforge replay` command
 *
 * Replays the events of a durable run to stdout as a human-readable timeline.
 *
 * Usage:
 *   personaforge replay --run-id <executionId> [--db <path>]
 *   personaforge replay --run-id <executionId> --json
 */

import type { Command } from 'commander';
import { SqliteEventStore } from '../../graph/index.js';
import type { GraphEvent } from '../../graph/index.js';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${((ms % 60_000) / 1000).toFixed(0)}s`;
}

function eventLine(e: GraphEvent): string {
  const ts = new Date(e.timestamp).toISOString();
  const node = e.nodeId ? ` [${e.nodeId.slice(0, 12)}]` : '';
  const extra = e.data
    ? ' ' + Object.entries(e.data)
        .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
        .join(' ')
    : '';
  return `#${String(e.sequence).padStart(4, '0')}  ${ts}  ${e.type}${node}${extra}`;
}

export function registerReplayCommand(program: Command): void {
  program
    .command('replay')
    .description('Replay the event timeline for a durable execution run')
    .requiredOption('--run-id <id>', 'Execution ID to replay')
    .option('--db <path>', 'Path to the SQLite event store', './agent.db')
    .option('--json', 'Output raw events as JSON', false)
    .option('--from <seq>', 'Start from this sequence number', '0')
    .action(async (opts) => {
      const store = new SqliteEventStore(opts.db);
      await store.init();

      const fromSeq = parseInt(opts.from, 10);
      const events = fromSeq > 0
        ? await store.loadAfter(opts.runId, fromSeq)
        : await store.load(opts.runId);

      if (events.length === 0) {
        console.error(`No events found for run-id "${opts.runId}" in ${opts.db}`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(events, null, 2));
        return;
      }

      const first = events[0];
      const last = events[events.length - 1];
      if (!first || !last) return;
      const totalMs = last.timestamp - first.timestamp;

      console.log(`\nRun:      ${opts.runId}`);
      console.log(`Events:   ${events.length}`);
      console.log(`Duration: ${formatDuration(totalMs)}`);
      console.log(`DB:       ${opts.db}`);
      console.log('─'.repeat(80));

      for (const e of events) {
        console.log(eventLine(e));
      }
      console.log('─'.repeat(80));
    });
}
