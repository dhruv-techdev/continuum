/**
 * Deterministic content hashing for event integrity.
 *
 * Uses recursive key-sorted JSON canonicalization so that
 * logically identical payloads always produce the same hash,
 * regardless of property insertion order.
 */

import { createHash } from 'crypto';

/**
 * Produce a canonical JSON string with recursively sorted keys.
 * This guarantees identical hashes for semantically identical objects
 * even if property order differs (e.g. after deserialization).
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const pairs = sortedKeys.map((key) => `${JSON.stringify(key)}:${canonicalize(obj[key])}`);
    return '{' + pairs.join(',') + '}';
  }

  // Functions, symbols, etc. — should never appear in event data.
  return 'null';
}

/**
 * Compute the SHA-256 hash of the hashable content of an event.
 *
 * The hash covers: type, projectId, sessionId, sequence, timestamp,
 * source, and payload. It deliberately excludes `id` (generated)
 * and `hash` (would be circular).
 */
export function computeEventHash(
  type: string,
  projectId: string,
  sessionId: string,
  sequence: number,
  timestamp: string,
  source: string,
  payload: unknown,
): string {
  const canonical = canonicalize({
    type,
    projectId,
    sessionId,
    sequence,
    timestamp,
    source,
    payload,
  });

  return createHash('sha256').update(canonical, 'utf-8').digest('hex');
}

/**
 * Re-derive the hash of an existing event and compare it to the stored value.
 * Returns true if the event has not been tampered with.
 */
export function verifyEventHash(event: {
  type: string;
  projectId: string;
  sessionId: string;
  sequence: number;
  timestamp: string;
  source: string;
  hash: string;
  payload: unknown;
}): boolean {
  const expected = computeEventHash(
    event.type,
    event.projectId,
    event.sessionId,
    event.sequence,
    event.timestamp,
    event.source,
    event.payload,
  );
  return expected === event.hash;
}
