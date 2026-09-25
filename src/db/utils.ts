/**
 * @personaforge/db — shared internal utilities.
 *
 * Centralised here so every backend uses the same implementations and there is
 * no risk of divergence (e.g. a backend accidentally using Math.random() for IDs).
 */

import { randomUUID } from 'node:crypto';

/**
 * Cryptographically-secure UUID v4.
 * Uses `node:crypto.randomUUID()` (Node ≥ 14.17.0; Web Crypto API on edge).
 */
export function uuid(): string {
  return randomUUID();
}

/**
 * Current wall-clock time as a Unix epoch integer (seconds).
 * All `created_at` / `updated_at` columns use this unit.
 */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

/** Writable columns of the schedules table (mirrors ScheduleRow minus immutable keys). */
const SCHEDULE_COLUMNS = new Set([
  'name', 'agent_id', 'cron', 'enabled', 'next_run_at', 'last_run_at',
  'locked_by', 'locked_at', 'metadata', 'updated_at',
]);

/**
 * Throw unless `key` is a writable schedules column. Update paths
 * interpolate column names into SQL, so anything else fails closed.
 */
export function assertScheduleColumn(key: string): string {
  if (!SCHEDULE_COLUMNS.has(key)) {
    throw new Error(`Invalid schedule column: ${JSON.stringify(key)}.`);
  }
  return key;
}

/**
 * Strip MongoDB operator injection from an update document: drop keys
 * starting with `$` or containing `.`, which would otherwise escape `$set`.
 */
export function sanitizeMongoUpdate(updates: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(updates)) {
    if (k.startsWith('$') || k.includes('.')) continue;
    clean[k] = v;
  }
  return clean;
}
