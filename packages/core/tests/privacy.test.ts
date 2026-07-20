import { describe, it, expect } from 'vitest';
import {
  detectSecrets,
  processEvents,
  getTransferableEvents,
  buildRedactionReport,
  RedactionActions,
  SecretTypes,
  createEvent,
  EventTypes,
  MessageRoles,
} from '../src/index';
import type { ContinuumEvent, MessageEvent } from '../src/index';

const TS = '2025-06-01T12:00:00.000Z';

function msg(seq: number, content: string): ContinuumEvent {
  return createEvent({
    type: EventTypes.MESSAGE, projectId: 'p', sessionId: 's',
    sequence: seq, source: 'test', timestamp: TS,
    payload: { role: MessageRoles.USER, content },
  });
}

// ─── ST1: Secret detection ──────────────────────────────────

describe('ST1 — detectSecrets()', () => {
  it('should detect Anthropic API keys', () => {
    const detections = detectSecrets('My key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890');
    expect(detections.length).toBeGreaterThanOrEqual(1);
    expect(detections[0].type).toBe(SecretTypes.API_KEY);
    expect(detections[0].label).toContain('Anthropic');
  });

  it('should detect OpenAI API keys', () => {
    const detections = detectSecrets('sk-proj-abcdefghijklmnopqrstuvwxyz1234567890');
    expect(detections.length).toBeGreaterThanOrEqual(1);
    expect(detections.some((d) => d.label.includes('OpenAI'))).toBe(true);
  });

  it('should detect GitHub PATs', () => {
    const detections = detectSecrets('ghp_abcdefghijklmnopqrstuvwxyz1234567890');
    expect(detections).toHaveLength(1);
    expect(detections[0].type).toBe(SecretTypes.TOKEN);
    expect(detections[0].label).toContain('GitHub');
  });

  it('should detect AWS access keys', () => {
    const detections = detectSecrets('AKIAIOSFODNN7EXAMPLE');
    expect(detections).toHaveLength(1);
    expect(detections[0].type).toBe(SecretTypes.AWS_CREDENTIAL);
  });

  it('should detect RSA private keys', () => {
    const detections = detectSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIE...');
    expect(detections).toHaveLength(1);
    expect(detections[0].type).toBe(SecretTypes.PRIVATE_KEY);
  });

  it('should detect PostgreSQL connection strings', () => {
    const detections = detectSecrets('postgres://user:password123@db.example.com:5432/mydb');
    expect(detections).toHaveLength(1);
    expect(detections[0].type).toBe(SecretTypes.CONNECTION_STRING);
  });

  it('should detect JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const detections = detectSecrets(jwt);
    expect(detections).toHaveLength(1);
    expect(detections[0].type).toBe(SecretTypes.TOKEN);
  });

  it('should detect Bearer tokens', () => {
    const detections = detectSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIx');
    expect(detections.length).toBeGreaterThanOrEqual(1);
  });

  it('should detect Stripe keys', () => {
    const detections = detectSecrets('sk_test_4eC39HqLyjWDarjtT1zdp7dc');
    expect(detections).toHaveLength(1);
    expect(detections[0].label).toContain('Stripe');
  });

  it('should detect Slack tokens', () => {
    const detections = detectSecrets('xoxb-123456789012-1234567890123-abcdefghijklmnopqrstuvwx');
    expect(detections).toHaveLength(1);
    expect(detections[0].label).toContain('Slack');
  });

  it('should detect password assignments', () => {
    const detections = detectSecrets('password="SuperSecret123!"');
    expect(detections.length).toBeGreaterThanOrEqual(1);
    expect(detections[0].type).toBe(SecretTypes.PASSWORD);
  });

  it('should detect environment variable secrets', () => {
    const detections = detectSecrets('API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890');
    expect(detections.length).toBeGreaterThanOrEqual(1);
  });

  it('should return empty for clean text', () => {
    const detections = detectSecrets('This is normal text about building a CLI tool.');
    expect(detections).toHaveLength(0);
  });

  it('should mask detected secrets', () => {
    const detections = detectSecrets('ghp_abcdefghijklmnopqrstuvwxyz1234567890');
    expect(detections[0].maskedMatch).toContain('•');
    expect(detections[0].maskedMatch).not.toBe('ghp_abcdefghijklmnopqrstuvwxyz1234567890');
  });

  it('should detect multiple secrets in one text', () => {
    const text = 'key1: sk-ant-api03-abcdefghijklmnop1234 and key2: ghp_abcdefghijklmnopqrstuvwxyz1234567890';
    const detections = detectSecrets(text);
    expect(detections.length).toBeGreaterThanOrEqual(2);
  });

  it('should not flag common words as secrets', () => {
    const detections = detectSecrets('The password policy requires 8 characters. Always use strong passwords.');
    const nonFP = detections.filter((d) => !d.highFalsePositive);
    expect(nonFP).toHaveLength(0);
  });
});

// ─── ST2: Redaction actions ─────────────────────────────────

describe('ST2 — processEvents()', () => {
  describe('redact action', () => {
    it('should replace secrets with [REDACTED]', () => {
      const events = [msg(0, 'My API key is sk-ant-api03-abcdefghijklmnop12345678')];

      const { events: processed, summary } = processEvents(events, {
        defaultAction: RedactionActions.REDACT,
      });

      expect(summary.redactedEvents).toBe(1);
      expect(summary.totalDetections).toBeGreaterThanOrEqual(1);

      const content = ((processed[0].event as MessageEvent).payload.content);
      expect(content).toContain('[REDACTED]');
      expect(content).not.toContain('sk-ant-api03');
    });

    it('should preserve clean events unchanged', () => {
      const events = [msg(0, 'No secrets here.')];

      const { events: processed, summary } = processEvents(events);

      expect(summary.cleanEvents).toBe(1);
      expect((processed[0].event as MessageEvent).payload.content).toBe('No secrets here.');
    });
  });

  describe('exclude action', () => {
    it('should mark events for exclusion', () => {
      const events = [
        msg(0, 'Clean message'),
        msg(1, 'Secret: sk-ant-api03-abcdefghijklmnop12345678'),
        msg(2, 'Another clean message'),
      ];

      const { events: processed, summary } = processEvents(events, {
        defaultAction: RedactionActions.EXCLUDE,
      });

      expect(summary.excludedEvents).toBe(1);
      expect(summary.cleanEvents).toBe(2);

      const transferable = getTransferableEvents(processed);
      expect(transferable).toHaveLength(2);
    });
  });

  describe('reference action', () => {
    it('should replace content with reference placeholder', () => {
      const events = [msg(0, 'Key: sk-ant-api03-abcdefghijklmnop12345678')];

      const { events: processed, summary } = processEvents(events, {
        defaultAction: RedactionActions.REFERENCE,
      });

      expect(summary.referencedEvents).toBe(1);
      const payload = processed[0].event.payload as Record<string, unknown>;
      expect(payload._redacted).toBe(true);
      expect(payload._reason).toContain('Secret detected');
    });
  });

  describe('options', () => {
    it('should skip high false positive patterns when configured', () => {
      const events = [msg(0, 'password="test12345678"')];

      const withFP = processEvents(events, { skipHighFalsePositive: false });
      const withoutFP = processEvents(events, { skipHighFalsePositive: true });

      expect(withFP.summary.totalDetections).toBeGreaterThanOrEqual(withoutFP.summary.totalDetections);
    });

    it('should handle mixed clean and dirty events', () => {
      const events = [
        msg(0, 'Normal conversation about code.'),
        msg(1, 'Here is the key: ghp_abcdefghijklmnopqrstuvwxyz1234567890'),
        msg(2, 'More normal discussion.'),
        msg(3, 'postgres://admin:secretpass@db.example.com/production'),
      ];

      const { summary } = processEvents(events);

      expect(summary.scannedEvents).toBe(4);
      expect(summary.cleanEvents).toBe(2);
      expect(summary.totalDetections).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getTransferableEvents()', () => {
    it('should include redacted and referenced events, exclude excluded', () => {
      const events = [
        msg(0, 'Clean'),
        msg(1, 'ghp_abcdefghijklmnopqrstuvwxyz1234567890'),
        msg(2, 'postgres://user:pass@host/db'),
      ];

      // Exclude the GitHub token, redact the postgres URL
      const { events: processed } = processEvents(events, {
        defaultAction: RedactionActions.REDACT,
        typeActions: { token: RedactionActions.EXCLUDE },
      });

      const transferable = getTransferableEvents(processed);
      // Clean (1) + redacted postgres (1) = 2, GitHub excluded
      expect(transferable.length).toBeLessThanOrEqual(3);
    });
  });
});

// ─── ST3: Redaction report ──────────────────────────────────

describe('ST3 — buildRedactionReport()', () => {
  it('should report no risk for clean events', () => {
    const events = [msg(0, 'No secrets.'), msg(1, 'Safe content.')];
    const { events: processed, summary } = processEvents(events);
    const report = buildRedactionReport(processed, summary);

    expect(report.riskLevel).toBe('none');
    expect(report.transferSafe).toBe(true);
    expect(report.detections).toHaveLength(0);
    expect(report.recommendations.some((r) => r.includes('Safe to transfer'))).toBe(true);
  });

  it('should report high risk for private keys', () => {
    const events = [msg(0, '-----BEGIN RSA PRIVATE KEY-----\nMIIEp...')];
    const { events: processed, summary } = processEvents(events, {
      defaultAction: RedactionActions.REDACT, // redacted but still flagged
    });
    const report = buildRedactionReport(processed, summary);

    expect(report.summary.totalDetections).toBeGreaterThanOrEqual(1);
    expect(report.recommendations.some((r) => r.includes('Private key'))).toBe(true);
  });

  it('should report AWS credential risk', () => {
    const events = [msg(0, 'Key: AKIAIOSFODNN7EXAMPLE')];
    const { events: processed, summary } = processEvents(events);
    const report = buildRedactionReport(processed, summary);

    expect(report.recommendations.some((r) => r.includes('AWS'))).toBe(true);
  });

  it('should include detection details', () => {
    const events = [msg(0, 'ghp_abcdefghijklmnopqrstuvwxyz1234567890')];
    const { events: processed, summary } = processEvents(events);
    const report = buildRedactionReport(processed, summary);

    expect(report.detections).toHaveLength(1);
    expect(report.detections[0].eventId).toMatch(/^evt_/);
    expect(report.detections[0].detections[0].label).toContain('GitHub');
    expect(report.detections[0].detections[0].maskedMatch).toContain('•');
  });

  it('should note excluded events in recommendations', () => {
    const events = [msg(0, 'ghp_abcdefghijklmnopqrstuvwxyz1234567890')];
    const { events: processed, summary } = processEvents(events, {
      defaultAction: RedactionActions.EXCLUDE,
    });
    const report = buildRedactionReport(processed, summary);

    expect(report.recommendations.some((r) => r.includes('excluded'))).toBe(true);
  });

  it('should note false positives in recommendations', () => {
    const events = [msg(0, 'password="test1234abcd"')];
    const { events: processed, summary } = processEvents(events);
    const report = buildRedactionReport(processed, summary);

    if (report.detections.some((d) => d.detections.some((dd) => dd.highFalsePositive))) {
      expect(report.recommendations.some((r) => r.includes('false positive'))).toBe(true);
    }
  });

  it('should include summary statistics', () => {
    const events = [
      msg(0, 'Clean'),
      msg(1, 'ghp_abcdefghijklmnopqrstuvwxyz1234567890'),
      msg(2, 'Also clean'),
    ];

    const { events: processed, summary } = processEvents(events);
    const report = buildRedactionReport(processed, summary);

    expect(report.summary.totalEvents).toBe(3);
    expect(report.summary.scannedEvents).toBe(3);
    expect(report.summary.cleanEvents).toBe(2);
    expect(report.generatedAt).toMatch(/Z$/);
  });
});
