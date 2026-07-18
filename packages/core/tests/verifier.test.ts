import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { verifyLedger } from '../src/ledger/verifier';
import { EventLedger } from '../src/ledger/event-ledger';
import { createEvent, EventTypes, MessageRoles, computeEventHash } from '../src/events/index';
import type { MessageEvent } from '../src/events/types';

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

describe('verifyLedger()', () => {
  let dir: string;
  let ledgerPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'continuum-verify-test-'));
    ledgerPath = join(dir, 'events.jsonl');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // ── Clean ledger ────────────────────────────────────────────

  describe('clean ledger', () => {
    it('should pass for an empty/nonexistent ledger', () => {
      const report = verifyLedger(join(dir, 'nonexistent.jsonl'));
      // Nonexistent ledger is an error — can't verify what doesn't exist
      expect(report.passed).toBe(false);
      expect(report.issues[0].category).toBe('parse');
    });

    it('should pass for a valid ledger with sequential events', () => {
      const ledger = new EventLedger(dir);
      ledger.append(makeEvent(0, 'first'));
      ledger.append(makeEvent(1, 'second'));
      ledger.append(makeEvent(2, 'third'));

      const report = verifyLedger(ledgerPath);

      expect(report.passed).toBe(true);
      expect(report.totalEvents).toBe(3);
      expect(report.validEvents).toBe(3);
      expect(report.issues).toHaveLength(0);
      expect(report.firstTimestamp).toBe(FIXED_TS);
      expect(report.lastTimestamp).toBe(FIXED_TS);
      expect(report.byteSize).toBeGreaterThan(0);
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should pass for a single event', () => {
      const ledger = new EventLedger(dir);
      ledger.append(makeEvent(0));

      const report = verifyLedger(ledgerPath);
      expect(report.passed).toBe(true);
      expect(report.totalEvents).toBe(1);
      expect(report.validEvents).toBe(1);
    });
  });

  // ── ST1: Deterministic serialization (hash check) ──────────

  describe('ST1 — Deterministic serialization', () => {
    it('should detect tampered payload content', () => {
      const ledger = new EventLedger(dir);
      ledger.append(makeEvent(0, 'original'));

      // Tamper with the file
      let raw = readFile(ledgerPath);
      raw = raw.replace('original', 'TAMPERED');
      writeFileSync(ledgerPath, raw, 'utf-8');

      const report = verifyLedger(ledgerPath);
      expect(report.passed).toBe(false);
      expect(report.issues.some((i) => i.category === 'hash')).toBe(true);
    });

    it('should detect tampered sequence number', () => {
      const event = makeEvent(0, 'test');
      const json = JSON.stringify(event);
      // Change sequence 0 to 99 in the JSON
      const tampered = json.replace('"sequence":0', '"sequence":99');
      writeFileSync(ledgerPath, tampered, 'utf-8');

      const report = verifyLedger(ledgerPath);
      expect(report.passed).toBe(false);
      expect(report.issues.some((i) => i.category === 'hash')).toBe(true);
    });

    it('should detect tampered timestamp', () => {
      const event = makeEvent(0);
      const json = JSON.stringify(event);
      const tampered = json.replace(FIXED_TS, '2099-01-01T00:00:00.000Z');
      writeFileSync(ledgerPath, tampered, 'utf-8');

      const report = verifyLedger(ledgerPath);
      expect(report.passed).toBe(false);
    });
  });

  // ── ST2: SHA-256 hash for every event ──────────────────────

  describe('ST2 — SHA-256 hash verification', () => {
    it('should pass when all hashes match', () => {
      const ledger = new EventLedger(dir);
      for (let i = 0; i < 5; i++) {
        ledger.append(makeEvent(i));
      }

      const report = verifyLedger(ledgerPath);
      expect(report.passed).toBe(true);
      expect(report.validEvents).toBe(5);
    });

    it('should detect a replaced hash value', () => {
      const event = makeEvent(0);
      const json = JSON.stringify(event);
      // Replace the real hash with a fake one
      const fakeHash = 'a'.repeat(64);
      const tampered = json.replace(event.hash, fakeHash);
      writeFileSync(ledgerPath, tampered, 'utf-8');

      const report = verifyLedger(ledgerPath);
      expect(report.passed).toBe(false);
      expect(report.issues.some((i) => i.category === 'hash')).toBe(true);
    });

    it('should report each tampered event individually', () => {
      const ledger = new EventLedger(dir);
      ledger.append(makeEvent(0, 'clean-1'));
      ledger.append(makeEvent(1, 'clean-2'));
      ledger.append(makeEvent(2, 'clean-3'));

      // Tamper with middle event only
      let raw = readFile(ledgerPath);
      raw = raw.replace('clean-2', 'DIRTY-2');
      writeFileSync(ledgerPath, raw, 'utf-8');

      const report = verifyLedger(ledgerPath);
      expect(report.passed).toBe(false);

      const hashIssues = report.issues.filter((i) => i.category === 'hash');
      expect(hashIssues).toHaveLength(1);
      expect(hashIssues[0].line).toBe(2);
    });
  });

  // ── Sequence ordering ──────────────────────────────────────

  describe('sequence ordering', () => {
    it('should detect out-of-order sequences', () => {
      const e0 = makeEvent(5);
      const e1 = makeEvent(2);
      writeFileSync(ledgerPath, JSON.stringify(e0) + '\n' + JSON.stringify(e1), 'utf-8');

      const report = verifyLedger(ledgerPath);
      expect(report.passed).toBe(false);
      expect(report.issues.some((i) => i.category === 'sequence')).toBe(true);
    });

    it('should detect equal sequences', () => {
      const e0 = makeEvent(3, 'first');
      // Create second event with same sequence but different ID
      const e1 = createEvent({
        type: EventTypes.MESSAGE,
        projectId: 'proj_test',
        sessionId: 'sess_test',
        sequence: 3,
        source: 'test',
        timestamp: FIXED_TS,
        payload: { role: MessageRoles.ASSISTANT, content: 'second' },
      });
      writeFileSync(ledgerPath, JSON.stringify(e0) + '\n' + JSON.stringify(e1), 'utf-8');

      const report = verifyLedger(ledgerPath);
      expect(report.passed).toBe(false);
      expect(report.issues.some((i) => i.category === 'sequence')).toBe(true);
    });

    it('should allow gaps in sequence numbers', () => {
      const ledger = new EventLedger(dir);
      ledger.append(makeEvent(0));
      ledger.append(makeEvent(10));
      ledger.append(makeEvent(20));

      const report = verifyLedger(ledgerPath);
      expect(report.passed).toBe(true);
      expect(report.issues.filter((i) => i.category === 'sequence')).toHaveLength(0);
    });
  });

  // ── Duplicate IDs ──────────────────────────────────────────

  describe('duplicate IDs', () => {
    it('should detect duplicate event IDs', () => {
      const event = makeEvent(0);
      // Write the same event twice (bypassing the ledger's dedup)
      writeFileSync(ledgerPath, JSON.stringify(event) + '\n' + JSON.stringify(event), 'utf-8');

      const report = verifyLedger(ledgerPath);
      expect(report.passed).toBe(false);
      expect(report.issues.some((i) => i.category === 'duplicate')).toBe(true);
    });
  });

  // ── Schema validation ──────────────────────────────────────

  describe('schema validation', () => {
    it('should detect invalid JSON lines', () => {
      const ledger = new EventLedger(dir);
      ledger.append(makeEvent(0));
      appendFileSync(ledgerPath, '\n{ broken json !!!', 'utf-8');

      const report = verifyLedger(ledgerPath);
      expect(report.passed).toBe(false);
      expect(report.issues.some((i) => i.category === 'parse')).toBe(true);
    });

    it('should detect events with missing required fields', () => {
      writeFileSync(ledgerPath, JSON.stringify({ type: 'message' }), 'utf-8');

      const report = verifyLedger(ledgerPath);
      expect(report.passed).toBe(false);
      expect(report.issues.some((i) => i.category === 'schema')).toBe(true);
    });
  });

  // ── Cross-event consistency ────────────────────────────────

  describe('cross-event consistency', () => {
    it('should warn when projectId differs across events', () => {
      const e0 = createEvent({
        type: EventTypes.MESSAGE,
        projectId: 'proj_aaa',
        sessionId: 'sess_test',
        sequence: 0,
        source: 'test',
        timestamp: FIXED_TS,
        payload: { role: MessageRoles.USER, content: 'one' },
      });
      const e1 = createEvent({
        type: EventTypes.MESSAGE,
        projectId: 'proj_bbb',
        sessionId: 'sess_test',
        sequence: 1,
        source: 'test',
        timestamp: FIXED_TS,
        payload: { role: MessageRoles.USER, content: 'two' },
      });
      writeFileSync(ledgerPath, JSON.stringify(e0) + '\n' + JSON.stringify(e1), 'utf-8');

      const report = verifyLedger(ledgerPath);
      // Warnings don't fail the report
      expect(report.issues.some((i) => i.category === 'consistency')).toBe(true);
      expect(report.issues.find((i) => i.category === 'consistency')!.severity).toBe('warning');
    });

    it('should warn when sessionId differs across events', () => {
      const e0 = createEvent({
        type: EventTypes.MESSAGE,
        projectId: 'proj_test',
        sessionId: 'sess_aaa',
        sequence: 0,
        source: 'test',
        timestamp: FIXED_TS,
        payload: { role: MessageRoles.USER, content: 'one' },
      });
      const e1 = createEvent({
        type: EventTypes.MESSAGE,
        projectId: 'proj_test',
        sessionId: 'sess_bbb',
        sequence: 1,
        source: 'test',
        timestamp: FIXED_TS,
        payload: { role: MessageRoles.USER, content: 'two' },
      });
      writeFileSync(ledgerPath, JSON.stringify(e0) + '\n' + JSON.stringify(e1), 'utf-8');

      const report = verifyLedger(ledgerPath);
      expect(report.issues.some((i) =>
        i.category === 'consistency' && i.message.includes('sessionId'),
      )).toBe(true);
    });
  });

  // ── Edge cases ──────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle empty file', () => {
      writeFileSync(ledgerPath, '', 'utf-8');
      const report = verifyLedger(ledgerPath);
      expect(report.passed).toBe(true);
      expect(report.totalEvents).toBe(0);
    });

    it('should handle file with only newlines', () => {
      writeFileSync(ledgerPath, '\n\n\n', 'utf-8');
      const report = verifyLedger(ledgerPath);
      expect(report.passed).toBe(true);
      expect(report.totalEvents).toBe(0);
    });

    it('should handle unicode content in events', () => {
      const ledger = new EventLedger(dir);
      ledger.append(makeEvent(0, '日本語テスト 🚀'));

      const report = verifyLedger(ledgerPath);
      expect(report.passed).toBe(true);
    });

    it('should report multiple issues from a single corrupted ledger', () => {
      // Line 1: valid
      const e0 = makeEvent(0);
      // Line 2: broken JSON
      // Line 3: tampered hash
      const e2 = makeEvent(2);
      const tampered = JSON.stringify(e2).replace(e2.hash, 'b'.repeat(64));

      writeFileSync(
        ledgerPath,
        JSON.stringify(e0) + '\n{ broken\n' + tampered,
        'utf-8',
      );

      const report = verifyLedger(ledgerPath);
      expect(report.passed).toBe(false);
      expect(report.issues.length).toBeGreaterThanOrEqual(2);

      const categories = report.issues.map((i) => i.category);
      expect(categories).toContain('parse');
      expect(categories).toContain('hash');
    });
  });
});

// ─── Helper ─────────────────────────────────────────────────

function readFile(path: string): string {
  const { readFileSync } = require('fs');
  return readFileSync(path, 'utf-8');
}
