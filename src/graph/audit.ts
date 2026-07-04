/**
 * Tamper-evident audit for the durable log.
 *
 * When a RunRecorder is created with `{ hashChain: true }`, every event carries
 * `data.__audit = { prev, hash }`, where `hash = sha256(prev | type | seq |
 * data)`. Each event's hash feeds the next, forming a chain: altering any past
 * event breaks every hash after it. `verifyChain` recomputes the chain and
 * reports the first break — a provable audit trail for regulated workloads.
 */

import { createHash } from 'node:crypto';
import type { GraphEvent } from './types.js';

export interface ChainVerification {
  valid: boolean;
  /** Index of the first event that failed verification (if any). */
  brokenAt?: number;
  reason?: string;
}

/** Recompute the hash chain and report the first tampered or broken link. */
export function verifyChain(events: GraphEvent[]): ChainVerification {
  let prev = '';
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const audit = (e.data as { __audit?: { prev: string; hash: string } } | undefined)?.__audit;
    if (!audit) return { valid: false, brokenAt: i, reason: 'missing audit metadata' };
    if (audit.prev !== prev) return { valid: false, brokenAt: i, reason: 'chain break: prev hash mismatch' };

    const { __audit, ...baseData } = e.data as Record<string, unknown>;
    void __audit;
    const expected = createHash('sha256')
      .update(`${audit.prev}|${e.type}|${e.sequence}|${JSON.stringify(baseData)}`)
      .digest('hex');
    if (expected !== audit.hash) return { valid: false, brokenAt: i, reason: 'tampered: hash mismatch' };

    prev = audit.hash;
  }
  return { valid: true };
}
