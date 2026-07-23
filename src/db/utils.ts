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
