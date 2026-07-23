/**
 * CLI — `personaforge export` command
 *
 * Exports all events for a run to a JSON file (or stdout).
 *
 * Usage:
 *   personaforge export --run-id <id> [--db <path>] [--out <file>]
 *   personaforge export --run-id <id> --out -          # stdout
 */

import type { Command } from 'commander';
import fs from 'node:fs/promises';
import { SqliteEventStore } from '../../graph/index.js';

export function registerExportCommand(program: Command): void {
  program
    .command('export')
    .description('Export run events to JSON')
    .requiredOption('--run-id <id>', 'Execution ID to export')
    .option('--db <path>', 'Path to the SQLite event store', './agent.db')
    .option('--out <file>', 'Output file path (use "-" for stdout)', '-')
    .option('--pretty', 'Pretty-print JSON (default when writing to file)', false)
    .action(async (opts) => {
      const store = new SqliteEventStore(opts.db);
      await store.init();

      const events = await store.load(opts.runId);
      if (events.length === 0) {
        console.error(`No events found for run-id "${opts.runId}" in ${opts.db}`);
        process.exit(1);
      }

      const toFile = opts.out !== '-';
      const json = JSON.stringify(events, null, toFile || opts.pretty ? 2 : undefined);

      if (toFile) {
        await fs.writeFile(opts.out, json, 'utf8');
        console.log(`Exported ${events.length} events → ${opts.out}`);
      } else {
        process.stdout.write(json + '\n');
      }
    });
}
