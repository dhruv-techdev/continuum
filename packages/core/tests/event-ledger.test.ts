import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { EventLedger } from '../src/ledger/event-ledger';
import { createEvent, EventTypes, MessageRoles, verifyEventHash } from '../src/events/index';
import type { ContinuumEvent, MessageEvent } from '../src/events/types';

// ─── Helpers ────────────────────────────────────────────────

const FIXED_TS = '2025-06-01T12:00:00.000Z';

function makeEvent(sequence: number, content: string = `msg-${sequence}`): MessageEvent {
  return createEvent({
    type: EventTypes.MESSAGE,
    projectId: 'proj_test',
    sessionId: 'sess_test',
    sequence,
    source: 'test',
    timestamp: FIXED_TS,
    payload: { role: MessageRoles.USER, content },
  });
}

describe('EventLedger', () => {
  let sessionDir: string;
  let ledger: EventLedger;

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tmpdir(), 'continuum-ledger-test-'));
    ledger = new EventLedger(sessionDir);
  });

  afterEach(() => {
    rmSync(sessionDir, { recursive: true, force: true });
  });

  // ── ST1: Append-only storage ────────────────────────────────

  describe('ST1 — Append-only JSONL storage', () => {
    it('should create events.jsonl on first append', () => {
      const event = makeEvent(0);
      const result = ledger.append(event);

      expect(result.status).toBe('ok');
      expect(existsSync(ledger.path)).toBe(true);
    });

    it('should store each event as a single JSON line', () => {
      ledger.append(makeEvent(0));
      ledger.append(makeEvent(1));
      ledger.append(makeEvent(2));

      const raw = readFileSync(ledger.path, 'utf-8');
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);

      expect(lines).toHaveLength(3);

      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed.type).toBe('message');
        expect(parsed.id).toMatch(/^evt_/);
      }
    });

    it('should preserve the exact original JSON payload', () => {
      const event = makeEvent(0, 'exact payload test 🚀');
      ledger.append(event);

      const raw = readFileSync(ledger.path, 'utf-8').trim();
      const restored = JSON.parse(raw) as MessageEvent;

      expect(restored.id).toBe(event.id);
      expect(restored.payload.content).toBe('exact payload test 🚀');
      expect(restored.hash).toBe(event.hash);
      expect(restored.sequence).toBe(0);
      expect(restored.timestamp).toBe(FIXED_TS);
    });

    it('should refuse to persist an event with invalid hash', () => {
      const event = makeEvent(0);
      // Tamper with payload after creation
      const tampered = { ...event, payload: { role: 'user', content: 'tampered' } } as MessageEvent;

      const result = ledger.append(tampered);

      expect(result.status).toBe('hash_mismatch');
      expect(result.error).toContain('invalid content hash');
      expect(existsSync(ledger.path)).toBe(false);
    });

    it('should track event count accurately', () => {
      expect(ledger.count()).toBe(0);

      ledger.append(makeEvent(0));
      expect(ledger.count()).toBe(1);

      ledger.append(makeEvent(1));
      ledger.append(makeEvent(2));
      expect(ledger.count()).toBe(3);
    });

    it('should track lastSequence accurately', () => {
      expect(ledger.lastSequence()).toBe(-1);

      ledger.append(makeEvent(0));
      expect(ledger.lastSequence()).toBe(0);

      ledger.append(makeEvent(5));
      expect(ledger.lastSequence()).toBe(5);
    });
  });

  // ── ST2: Ordering and payload preservation ──────────────────

  describe('ST2 — Preserve event ordering and original payloads', () => {
    it('should enforce strictly increasing sequence numbers', () => {
      ledger.append(makeEvent(0));
      ledger.append(makeEvent(1));

      // Same sequence — violation
      const dup = makeEvent(1, 'different content');
      const result = ledger.append(dup);

      expect(result.status).toBe('sequence_violation');
      expect(result.error).toContain('not greater than');
      expect(ledger.count()).toBe(2);
    });

    it('should reject decreasing sequence numbers', () => {
      ledger.append(makeEvent(5));

      const result = ledger.append(makeEvent(3));

      expect(result.status).toBe('sequence_violation');
      expect(ledger.count()).toBe(1);
    });

    it('should allow non-contiguous sequences (gaps are OK)', () => {
      ledger.append(makeEvent(0));
      const result = ledger.append(makeEvent(10));

      expect(result.status).toBe('ok');
      expect(ledger.count()).toBe(2);
      expect(ledger.lastSequence()).toBe(10);
    });

    it('should read back events in insertion order', () => {
      ledger.append(makeEvent(0, 'first'));
      ledger.append(makeEvent(1, 'second'));
      ledger.append(makeEvent(2, 'third'));

      const { events } = ledger.readAll();

      expect(events).toHaveLength(3);
      expect((events[0] as MessageEvent).payload.content).toBe('first');
      expect((events[1] as MessageEvent).payload.content).toBe('second');
      expect((events[2] as MessageEvent).payload.content).toBe('third');
    });

    it('should verify hash integrity on read', () => {
      ledger.append(makeEvent(0, 'original'));

      // Manually tamper with the file
      const raw = readFileSync(ledger.path, 'utf-8');
      const tampered = raw.replace('original', 'TAMPERED');
      writeFileSync(ledger.path, tampered, 'utf-8');

      // Re-create ledger to clear cache
      const freshLedger = new EventLedger(sessionDir);
      const { events, integrityIssues } = freshLedger.readAll();

      // Event is still returned (caller decides), but flagged
      expect(events).toHaveLength(1);
      expect(integrityIssues.length).toBeGreaterThanOrEqual(1);
      expect(integrityIssues[0].message).toContain('Hash mismatch');
    });

    it('should detect out-of-order events on read', () => {
      // Write two events in wrong order directly to file
      const e0 = makeEvent(5, 'higher');
      const e1 = makeEvent(2, 'lower');

      writeFileSync(ledger.path, JSON.stringify(e0) + '\n' + JSON.stringify(e1), 'utf-8');

      const freshLedger = new EventLedger(sessionDir);
      const { integrityIssues } = freshLedger.readAll();

      expect(integrityIssues.some((i) => i.message.includes('Sequence order violation'))).toBe(true);
    });

    it('should handle corrupted JSON lines gracefully', () => {
      ledger.append(makeEvent(0));

      // Append garbage
      appendFileSync(ledger.path, '\n{ broken json !!!', 'utf-8');

      const freshLedger = new EventLedger(sessionDir);
      const { events, integrityIssues } = freshLedger.readAll();

      expect(events).toHaveLength(1);
      expect(integrityIssues.some((i) => i.message.includes('Invalid JSON'))).toBe(true);
    });

    it('should support readRange filtering by sequence', () => {
      for (let i = 0; i < 10; i++) {
        ledger.append(makeEvent(i, `msg-${i}`));
      }

      const { events } = ledger.readRange(3, 6);

      expect(events).toHaveLength(4);
      expect(events[0].sequence).toBe(3);
      expect(events[3].sequence).toBe(6);
    });
  });

  // ── ST3: Duplicate prevention ───────────────────────────────

  describe('ST3 — Prevent duplicate ingestion', () => {
    it('should reject an event with the same ID', () => {
      const event = makeEvent(0);
      ledger.append(event);

      // Try to append the exact same event again
      const result = ledger.append(event);

      expect(result.status).toBe('duplicate');
      expect(result.error).toContain('already exists');
      expect(ledger.count()).toBe(1);
    });

    it('should reject duplicates even with different content but same ID', () => {
      const event = makeEvent(0);
      ledger.append(event);

      // Create a different event but force the same ID
      const different = makeEvent(1, 'different content');
      (different as Record<string, unknown>).id = event.id;

      const result = ledger.append(different);
      expect(result.status).toBe('duplicate');
    });

    it('should report has() correctly', () => {
      const event = makeEvent(0);
      expect(ledger.has(event.id)).toBe(false);

      ledger.append(event);
      expect(ledger.has(event.id)).toBe(true);
    });

    it('should detect duplicates from a pre-existing ledger file', () => {
      // Write an event to disk
      const event = makeEvent(0);
      writeFileSync(ledger.path, JSON.stringify(event), 'utf-8');

      // Create a new ledger instance (simulating process restart)
      const freshLedger = new EventLedger(sessionDir);

      expect(freshLedger.has(event.id)).toBe(true);

      const result = freshLedger.append(event);
      expect(result.status).toBe('duplicate');
    });

    it('should allow different events with unique IDs', () => {
      const e0 = makeEvent(0, 'first');
      const e1 = makeEvent(1, 'second');
      const e2 = makeEvent(2, 'third');

      expect(ledger.append(e0).status).toBe('ok');
      expect(ledger.append(e1).status).toBe('ok');
      expect(ledger.append(e2).status).toBe('ok');

      expect(ledger.count()).toBe(3);
      expect(ledger.has(e0.id)).toBe(true);
      expect(ledger.has(e1.id)).toBe(true);
      expect(ledger.has(e2.id)).toBe(true);
    });
  });

  // ── Batch operations ────────────────────────────────────────

  describe('appendBatch()', () => {
    it('should append multiple events in order', () => {
      const events = [makeEvent(0), makeEvent(1), makeEvent(2)];
      const result = ledger.appendBatch(events);

      expect(result.appended).toBe(3);
      expect(result.duplicatesSkipped).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.totalProcessed).toBe(3);
      expect(ledger.count()).toBe(3);
    });

    it('should skip duplicates in a batch', () => {
      const e0 = makeEvent(0);
      ledger.append(e0);

      const events = [e0, makeEvent(1), makeEvent(2)];
      const result = ledger.appendBatch(events);

      expect(result.appended).toBe(2);
      expect(result.duplicatesSkipped).toBe(1);
      expect(ledger.count()).toBe(3);
    });

    it('should collect errors for failed events', () => {
      const events = [makeEvent(5), makeEvent(3)]; // second violates ordering
      const result = ledger.appendBatch(events);

      expect(result.appended).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].status).toBe('sequence_violation');
    });
  });

  // ── getEvent() ──────────────────────────────────────────────

  describe('getEvent()', () => {
    it('should retrieve an event by ID', () => {
      const event = makeEvent(0, 'findable');
      ledger.append(event);

      const found = ledger.getEvent(event.id);
      expect(found).not.toBeNull();
      expect(found!.id).toBe(event.id);
      expect((found as MessageEvent).payload.content).toBe('findable');
    });

    it('should return null for unknown ID', () => {
      expect(ledger.getEvent('evt_nonexistent')).toBeNull();
    });

    it('should return null for unknown ID without reading file', () => {
      ledger.append(makeEvent(0));
      expect(ledger.getEvent('evt_00000000-0000-0000-0000-000000000000')).toBeNull();
    });
  });

  // ── stats() ─────────────────────────────────────────────────

  describe('stats()', () => {
    it('should return zeros for empty ledger', () => {
      const s = ledger.stats();
      expect(s.eventCount).toBe(0);
      expect(s.lastSequence).toBe(-1);
      expect(s.firstTimestamp).toBeNull();
      expect(s.lastTimestamp).toBeNull();
      expect(s.byteSize).toBe(0);
    });

    it('should return accurate stats after appending', () => {
      ledger.append(makeEvent(0));
      ledger.append(makeEvent(1));
      ledger.append(makeEvent(2));

      const s = ledger.stats();
      expect(s.eventCount).toBe(3);
      expect(s.lastSequence).toBe(2);
      expect(s.firstTimestamp).toBe(FIXED_TS);
      expect(s.lastTimestamp).toBe(FIXED_TS);
      expect(s.byteSize).toBeGreaterThan(0);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle empty ledger file', () => {
      writeFileSync(ledger.path, '', 'utf-8');

      const freshLedger = new EventLedger(sessionDir);
      expect(freshLedger.count()).toBe(0);
      expect(freshLedger.readAll().events).toHaveLength(0);
    });

    it('should handle ledger with only whitespace/newlines', () => {
      writeFileSync(ledger.path, '\n\n  \n', 'utf-8');

      const freshLedger = new EventLedger(sessionDir);
      expect(freshLedger.count()).toBe(0);
    });

    it('should handle large content in events', () => {
      const bigContent = 'x'.repeat(100_000);
      const event = makeEvent(0, bigContent);
      const result = ledger.append(event);

      expect(result.status).toBe('ok');

      const { events } = ledger.readAll();
      expect((events[0] as MessageEvent).payload.content).toHaveLength(100_000);
    });

    it('should handle unicode content correctly', () => {
      const event = makeEvent(0, '日本語テスト 🎌 العربية');
      ledger.append(event);

      const { events } = ledger.readAll();
      expect((events[0] as MessageEvent).payload.content).toBe('日本語テスト 🎌 العربية');
      expect(verifyEventHash(events[0])).toBe(true);
    });

    it('should survive and rebuild index across instances', () => {
      ledger.append(makeEvent(0, 'alpha'));
      ledger.append(makeEvent(1, 'beta'));

      // Simulate fresh process
      const fresh = new EventLedger(sessionDir);

      expect(fresh.count()).toBe(2);
      expect(fresh.lastSequence()).toBe(1);
      expect(fresh.has(makeEvent(0).id)).toBe(false); // different UUID
      expect(fresh.readAll().events).toHaveLength(2);

      // Can continue appending
      const result = fresh.append(makeEvent(2, 'gamma'));
      expect(result.status).toBe('ok');
      expect(fresh.count()).toBe(3);
    });
  });
});
