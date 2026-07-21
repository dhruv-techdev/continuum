import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace,
  logAudit,
  timedSync,
  readAuditLog,
  getAuditStats,
  AuditOperations,
  AuditOutcomes,
} from '../src/index';

describe('audit logger', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-audit-'));
    initWorkspace(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // ── ST1: Record operations ──────────────────────────────

  describe('ST1 — logAudit()', () => {
    it('should write an audit entry to the log file', () => {
      const entry = logAudit(root, AuditOperations.IMPORT, AuditOutcomes.SUCCESS, {
        file: 'transcript.json',
        eventsCreated: 5,
      }, { projectId: 'proj_123' });

      expect(entry.id).toMatch(/^aud_/);
      expect(entry.operation).toBe('import');
      expect(entry.outcome).toBe('success');
      expect(entry.projectId).toBe('proj_123');
      expect(entry.details.eventsCreated).toBe(5);

      expect(existsSync(join(root, 'logs', 'audit.jsonl'))).toBe(true);
    });

    it('should record export operations', () => {
      logAudit(root, AuditOperations.CAPSULE_EXPORT, AuditOutcomes.SUCCESS, {
        capsuleId: 'cap_abc',
        eventsIncluded: 10,
      });

      const entries = readAuditLog(root);
      expect(entries).toHaveLength(1);
      expect(entries[0].operation).toBe('capsule_export');
    });

    it('should record search operations', () => {
      logAudit(root, AuditOperations.SEARCH, AuditOutcomes.SUCCESS, {
        query: 'JSONL',
        resultCount: 3,
      });

      const entries = readAuditLog(root);
      expect(entries[0].details.query).toBe('JSONL');
    });

    it('should record transfer operations', () => {
      logAudit(root, AuditOperations.TRANSFER, AuditOutcomes.SUCCESS, {
        targetModel: 'gpt-4o',
        tokenBudget: 128000,
      });

      const entries = readAuditLog(root);
      expect(entries[0].operation).toBe('transfer');
    });

    it('should record multiple entries in sequence', () => {
      logAudit(root, AuditOperations.PROJECT_CREATE, AuditOutcomes.SUCCESS, { title: 'Test' });
      logAudit(root, AuditOperations.SESSION_START, AuditOutcomes.SUCCESS, {});
      logAudit(root, AuditOperations.IMPORT, AuditOutcomes.SUCCESS, { events: 5 });
      logAudit(root, AuditOperations.SEARCH, AuditOutcomes.SUCCESS, { query: 'test' });

      const entries = readAuditLog(root);
      expect(entries).toHaveLength(4);
    });
  });

  // ── ST2: Record verification and privacy operations ─────

  describe('ST2 — verification and privacy', () => {
    it('should record verification operations', () => {
      logAudit(root, AuditOperations.VERIFY_GENERATE, AuditOutcomes.SUCCESS, { checkCount: 15 });
      logAudit(root, AuditOperations.VERIFY_SCORE, AuditOutcomes.SUCCESS, { passed: true, score: 0.95 });

      const entries = readAuditLog(root, { operation: AuditOperations.VERIFY_SCORE });
      expect(entries).toHaveLength(1);
      expect(entries[0].details.passed).toBe(true);
    });

    it('should record repair operations', () => {
      logAudit(root, AuditOperations.VERIFY_REPAIR, AuditOutcomes.PARTIAL, {
        repaired: 3,
        unresolved: 1,
      });

      const entries = readAuditLog(root);
      expect(entries[0].outcome).toBe('partial');
      expect(entries[0].details.repaired).toBe(3);
    });

    it('should record redaction scans', () => {
      logAudit(root, AuditOperations.REDACTION_SCAN, AuditOutcomes.SUCCESS, {
        secretsFound: 2,
        redacted: 2,
        riskLevel: 'low',
      });

      const entries = readAuditLog(root);
      expect(entries[0].details.secretsFound).toBe(2);
    });

    it('should record state operations', () => {
      logAudit(root, AuditOperations.STATE_EXTRACT, AuditOutcomes.SUCCESS, { statements: 12 });
      logAudit(root, AuditOperations.STATE_CORRECT, AuditOutcomes.SUCCESS, {
        statementId: 'stmt_abc',
        action: 'corrected',
      });

      const entries = readAuditLog(root);
      expect(entries).toHaveLength(2);
    });

    it('should record ledger verification', () => {
      logAudit(root, AuditOperations.LEDGER_VERIFY, AuditOutcomes.SUCCESS, {
        sessionId: 'sess_123',
        eventsVerified: 50,
        issues: 0,
      });

      const entries = readAuditLog(root);
      expect(entries[0].details.eventsVerified).toBe(50);
    });
  });

  // ── ST3: Errors, durations, and outcomes ────────────────

  describe('ST3 — errors, durations, outcomes', () => {
    it('should record error details', () => {
      logAudit(root, AuditOperations.IMPORT, AuditOutcomes.FAILURE, {
        file: 'broken.json',
      }, {
        projectId: 'proj_123',
        error: 'Invalid JSON: unexpected token at line 5',
      });

      const entries = readAuditLog(root);
      expect(entries[0].outcome).toBe('failure');
      expect(entries[0].error).toContain('Invalid JSON');
    });

    it('should record duration in milliseconds', () => {
      logAudit(root, AuditOperations.DB_SYNC, AuditOutcomes.SUCCESS, {
        eventsIndexed: 100,
      }, {
        durationMs: 342,
      });

      const entries = readAuditLog(root);
      expect(entries[0].durationMs).toBe(342);
    });

    it('should track duration automatically with timedSync', () => {
      const result = timedSync(
        root,
        AuditOperations.SEARCH,
        'proj_test',
        () => {
          // Simulate some work
          let sum = 0;
          for (let i = 0; i < 1000; i++) sum += i;
          return sum;
        },
        (r) => ({ resultCount: 5, sum: r }),
      );

      expect(result).toBe(499500);

      const entries = readAuditLog(root);
      expect(entries).toHaveLength(1);
      expect(entries[0].operation).toBe('search');
      expect(entries[0].outcome).toBe('success');
      expect(entries[0].durationMs).not.toBeNull();
      expect(entries[0].durationMs!).toBeGreaterThanOrEqual(0);
      expect(entries[0].details.resultCount).toBe(5);
    });

    it('should record failure in timedSync when function throws', () => {
      expect(() =>
        timedSync(root, AuditOperations.DB_SYNC, 'proj_test', () => {
          throw new Error('Database corruption');
        }),
      ).toThrow('Database corruption');

      const entries = readAuditLog(root);
      expect(entries).toHaveLength(1);
      expect(entries[0].outcome).toBe('failure');
      expect(entries[0].error).toContain('Database corruption');
      expect(entries[0].durationMs).not.toBeNull();
    });

    it('should record transfer outcomes in stats', () => {
      logAudit(root, AuditOperations.CAPSULE_EXPORT, AuditOutcomes.SUCCESS, {});
      logAudit(root, AuditOperations.CAPSULE_EXPORT, AuditOutcomes.SUCCESS, {});
      logAudit(root, AuditOperations.CAPSULE_IMPORT, AuditOutcomes.SUCCESS, {});
      logAudit(root, AuditOperations.VERIFY_SCORE, AuditOutcomes.SUCCESS, { passed: true });
      logAudit(root, AuditOperations.VERIFY_REPAIR, AuditOutcomes.PARTIAL, {});
      logAudit(root, AuditOperations.REDACTION_SCAN, AuditOutcomes.SUCCESS, {});

      const stats = getAuditStats(root);

      expect(stats.transferOutcomes.exports).toBe(2);
      expect(stats.transferOutcomes.imports).toBe(1);
      expect(stats.transferOutcomes.verifications).toBe(1);
      expect(stats.transferOutcomes.repairs).toBe(1);
      expect(stats.transferOutcomes.scans).toBe(1);
    });
  });

  // ── Querying ────────────────────────────────────────────

  describe('querying', () => {
    beforeEach(() => {
      logAudit(root, AuditOperations.PROJECT_CREATE, AuditOutcomes.SUCCESS, {}, { projectId: 'proj_a' });
      logAudit(root, AuditOperations.IMPORT, AuditOutcomes.SUCCESS, { events: 5 }, { projectId: 'proj_a' });
      logAudit(root, AuditOperations.IMPORT, AuditOutcomes.FAILURE, {}, { projectId: 'proj_a', error: 'bad file' });
      logAudit(root, AuditOperations.SEARCH, AuditOutcomes.SUCCESS, {}, { projectId: 'proj_b' });
      logAudit(root, AuditOperations.CAPSULE_EXPORT, AuditOutcomes.SUCCESS, {}, { projectId: 'proj_a' });
    });

    it('should filter by operation', () => {
      const entries = readAuditLog(root, { operation: AuditOperations.IMPORT });
      expect(entries).toHaveLength(2);
    });

    it('should filter by outcome', () => {
      const entries = readAuditLog(root, { outcome: AuditOutcomes.FAILURE });
      expect(entries).toHaveLength(1);
      expect(entries[0].error).toBe('bad file');
    });

    it('should filter by project', () => {
      const entries = readAuditLog(root, { projectId: 'proj_b' });
      expect(entries).toHaveLength(1);
      expect(entries[0].operation).toBe('search');
    });

    it('should limit results', () => {
      const entries = readAuditLog(root, { limit: 2 });
      expect(entries).toHaveLength(2);
    });

    it('should return newest first', () => {
      const entries = readAuditLog(root);
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i - 1].timestamp >= entries[i].timestamp).toBe(true);
      }
    });

    it('should combine filters', () => {
      const entries = readAuditLog(root, {
        operation: AuditOperations.IMPORT,
        outcome: AuditOutcomes.SUCCESS,
      });
      expect(entries).toHaveLength(1);
    });
  });

  // ── Statistics ──────────────────────────────────────────

  describe('getAuditStats()', () => {
    beforeEach(() => {
      logAudit(root, AuditOperations.IMPORT, AuditOutcomes.SUCCESS, {}, { durationMs: 100 });
      logAudit(root, AuditOperations.IMPORT, AuditOutcomes.SUCCESS, {}, { durationMs: 200 });
      logAudit(root, AuditOperations.IMPORT, AuditOutcomes.FAILURE, {}, { durationMs: 50, error: 'oops' });
      logAudit(root, AuditOperations.SEARCH, AuditOutcomes.SUCCESS, {}, { durationMs: 30 });
      logAudit(root, AuditOperations.CAPSULE_EXPORT, AuditOutcomes.SUCCESS, {}, { durationMs: 500 });
    });

    it('should count total entries', () => {
      const stats = getAuditStats(root);
      expect(stats.totalEntries).toBe(5);
    });

    it('should count by operation', () => {
      const stats = getAuditStats(root);
      expect(stats.byOperation.import).toBe(3);
      expect(stats.byOperation.search).toBe(1);
      expect(stats.byOperation.capsule_export).toBe(1);
    });

    it('should count by outcome', () => {
      const stats = getAuditStats(root);
      expect(stats.byOutcome.success).toBe(4);
      expect(stats.byOutcome.failure).toBe(1);
    });

    it('should count errors', () => {
      const stats = getAuditStats(root);
      expect(stats.errorCount).toBe(1);
    });

    it('should calculate average durations per operation', () => {
      const stats = getAuditStats(root);
      // import: (100 + 200 + 50) / 3 ≈ 117
      expect(stats.avgDurationMs.import).toBeGreaterThan(100);
      expect(stats.avgDurationMs.import).toBeLessThan(120);
      expect(stats.avgDurationMs.search).toBe(30);
      expect(stats.avgDurationMs.capsule_export).toBe(500);
    });

    it('should track first and last entry timestamps', () => {
      const stats = getAuditStats(root);
      expect(stats.firstEntry).not.toBeNull();
      expect(stats.lastEntry).not.toBeNull();
      expect(stats.lastEntry! >= stats.firstEntry!).toBe(true);
    });

    it('should filter stats by project', () => {
      logAudit(root, AuditOperations.SEARCH, AuditOutcomes.SUCCESS, {}, { projectId: 'proj_x' });

      const allStats = getAuditStats(root);
      const projStats = getAuditStats(root, 'proj_x');

      expect(projStats.totalEntries).toBe(1);
      expect(allStats.totalEntries).toBeGreaterThan(projStats.totalEntries);
    });

    it('should handle empty log', () => {
      const emptyRoot = mkdtempSync(join(tmpdir(), 'continuum-audit-empty-'));
      initWorkspace(emptyRoot);

      const stats = getAuditStats(emptyRoot);
      expect(stats.totalEntries).toBe(0);
      expect(stats.errorCount).toBe(0);
      expect(stats.firstEntry).toBeNull();

      rmSync(emptyRoot, { recursive: true, force: true });
    });
  });

  // ── Edge cases ──────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle reading non-existent log file', () => {
      const emptyRoot = mkdtempSync(join(tmpdir(), 'continuum-audit-none-'));
      const entries = readAuditLog(emptyRoot);
      expect(entries).toHaveLength(0);
      rmSync(emptyRoot, { recursive: true, force: true });
    });

    it('should create log directory if it does not exist', () => {
      const freshRoot = mkdtempSync(join(tmpdir(), 'continuum-audit-fresh-'));
      logAudit(freshRoot, AuditOperations.ERROR, AuditOutcomes.FAILURE, {}, { error: 'test error' });

      expect(existsSync(join(freshRoot, 'logs', 'audit.jsonl'))).toBe(true);
      rmSync(freshRoot, { recursive: true, force: true });
    });

    it('should generate unique IDs for each entry', () => {
      logAudit(root, AuditOperations.SEARCH, AuditOutcomes.SUCCESS, {});
      logAudit(root, AuditOperations.SEARCH, AuditOutcomes.SUCCESS, {});

      const entries = readAuditLog(root);
      expect(entries[0].id).not.toBe(entries[1].id);
    });

    it('should include session ID when provided', () => {
      logAudit(root, AuditOperations.CAPTURE, AuditOutcomes.SUCCESS, {}, {
        projectId: 'proj_1',
        sessionId: 'sess_1',
      });

      const entries = readAuditLog(root);
      expect(entries[0].sessionId).toBe('sess_1');
    });

    it('should handle null fields correctly', () => {
      logAudit(root, AuditOperations.ERROR, AuditOutcomes.FAILURE, {});

      const entries = readAuditLog(root);
      expect(entries[0].projectId).toBeNull();
      expect(entries[0].sessionId).toBeNull();
      expect(entries[0].durationMs).toBeNull();
      expect(entries[0].error).toBeNull();
    });
  });
});
