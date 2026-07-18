/**
 * Event creation.
 *
 * The factory generates id, timestamp, schemaVersion, and hash
 * automatically. TypeScript's generic constraint ensures the payload
 * type matches the event type at compile time.
 */

import { randomUUID } from 'crypto';
import { EVENT_SCHEMA_VERSION } from './types';
import { computeEventHash } from './hash';
import type { EventType, PayloadForType, EventForType } from './types';

export interface CreateEventInput<T extends EventType> {
  type: T;
  projectId: string;
  sessionId: string;
  sequence: number;
  source: string;
  payload: PayloadForType<T>;
  /** Override for testing or import. Defaults to now. */
  timestamp?: string;
  /** Override for testing or import. Defaults to generated. */
  id?: string;
}

export function generateEventId(): string {
  return `evt_${randomUUID()}`;
}

export function createEvent<T extends EventType>(
  input: CreateEventInput<T>,
): EventForType<T> {
  const id = input.id ?? generateEventId();
  const timestamp = input.timestamp ?? new Date().toISOString();

  const hash = computeEventHash(
    input.type,
    input.projectId,
    input.sessionId,
    input.sequence,
    timestamp,
    input.source,
    input.payload,
  );

  // The cast is safe: we set `type` to the discriminator value T,
  // so the object structurally satisfies EventForType<T>.
  return {
    id,
    type: input.type,
    projectId: input.projectId,
    sessionId: input.sessionId,
    timestamp,
    sequence: input.sequence,
    schemaVersion: EVENT_SCHEMA_VERSION,
    hash,
    source: input.source,
    payload: input.payload,
  } as EventForType<T>;
}
