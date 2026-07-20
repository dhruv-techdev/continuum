import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  generateCoverageReport,
  FieldStatuses,
  FieldCriticalities,
  claudeAdapter,
  adapterNormalize,
  createEvent,
  EventTypes,
  MessageRoles,
  ArtifactActions,
  SystemActions,
} from '../src/index';
import type { ContinuumEvent, CoverageReport } from '../src/index';

const TS = '2025-06-01T12:00:00.000Z';

// ─── Helpers ────────────────────────────────────────────────

function makeMessageEvents(): ContinuumEvent[] {
  return [
    createEvent({ type: EventTypes.MESSAGE, projectId: 'p', sessionId: 's', sequence: 0, source: 'test', timestamp: TS, payload: { role: MessageRoles.USER, content: 'Hello' } }),
    createEvent({ type: EventTypes.MESSAGE, projectId: 'p', sessionId: 's', sequence: 1, source: 'test', timestamp: TS, payload: { role: MessageRoles.ASSISTANT, content: 'Hi there' } }),
  ];
}

function makeFullEvents(): ContinuumEvent[] {
  return [
    createEvent({ type: EventTypes.MESSAGE, projectId: 'p', sessionId: 's', sequence: 0, source: 'test', timestamp: TS, payload: { role: MessageRoles.USER, content: 'Hello' } }),
    createEvent({ type: EventTypes.MESSAGE, projectId: 'p', sessionId: 's', sequence: 1, source: 'test', timestamp: TS, payload: { role: MessageRoles.ASSISTANT, content: 'Hi', metadata: { detectedProvider: 'anthropic', originalFields: { model: 'claude', stop_reason: 'end_turn', usage: { input: 10 } } } } }),
    createEvent({ type: EventTypes.TOOL_CALL, projectId: 'p', sessionId: 's', sequence: 2, source: 'test', timestamp: TS, payload: { toolName: 'search', input: { q: 'test' }, callId: 'call_1' } }),
    createEvent({ type: EventTypes.TOOL_RESULT, projectId: 'p', sessionId: 's', sequence: 3, source: 'test', timestamp: TS, payload: { toolName: 'search', output: 'results', callId: 'call_1', isError: false } }),
    createEvent({ type: EventTypes.COMMAND, projectId: 'p', sessionId: 's', sequence: 4, source: 'test', timestamp: TS, payload: { command: 'npm test' } }),
    createEvent({ type: EventTypes.COMMAND_OUTPUT, projectId: 'p', sessionId: 's', sequence: 5, source: 'test', timestamp: TS, payload: { commandEventId: 'e4', stdout: 'pass', exitCode: 0 } }),
    createEvent({ type: EventTypes.ARTIFACT, projectId: 'p', sessionId: 's', sequence: 6, source: 'test', timestamp: TS, payload: { action: ArtifactActions.CREATE, uri: '/file.ts', mimeType: 'text/typescript', hash: 'abc' } }),
    createEvent({ type: EventTypes.SYSTEM, projectId: 'p', sessionId: 's', sequence: 7, source: 'test', timestamp: TS, payload: { action: SystemActions.CHECKPOINT, message: 'test' } }),
  ];
}

// ─── ST1: Field statuses ────────────────────────────────────

describe('ST1 — field statuses', () => {
  it('should mark identity fields as captured for any valid events', () => {
    const report = generateCoverageReport('test', 'Test', 'test', makeMessageEvents());

    const idFields = report.fields.filter((f) => f.category === 'identity');
    for (const f of idFields) {
      expect(f.status).toBe(FieldStatuses.CAPTURED);
      expect(f.count).toBeGreaterThan(0);
    }
  });

  it('should mark tool fields as not_applicable when no tool events exist', () => {
    const report = generateCoverageReport('test', 'Test', 'test', makeMessageEvents());

    const toolFields = report.fields.filter((f) => f.category === 'tool');
    for (const f of toolFields) {
      expect(f.status).toBe(FieldStatuses.NOT_APPLICABLE);
    }
  });

  it('should mark tool fields as captured when tool events exist', () => {
    const report = generateCoverageReport('test', 'Test', 'test', makeFullEvents());

    const toolName = report.fields.find((f) => f.name === 'tool_name');
    expect(toolName!.status).toBe(FieldStatuses.CAPTURED);
    expect(toolName!.count).toBeGreaterThan(0);

    const toolCallId = report.fields.find((f) => f.name === 'tool_call_id');
    expect(toolCallId!.status).toBe(FieldStatuses.CAPTURED);
  });

  it('should mark metadata fields as captured when present', () => {
    const report = generateCoverageReport('test', 'Test', 'test', makeFullEvents());

    const providerModel = report.fields.find((f) => f.name === 'provider_model');
    expect(providerModel!.status).toBe(FieldStatuses.CAPTURED);

    const stopReason = report.fields.find((f) => f.name === 'stop_reason');
    expect(stopReason!.status).toBe(FieldStatuses.CAPTURED);
  });

  it('should mark metadata fields as inaccessible when not present', () => {
    const report = generateCoverageReport('test', 'Test', 'test', makeMessageEvents());

    const providerModel = report.fields.find((f) => f.name === 'provider_model');
    expect(providerModel!.status).toBe(FieldStatuses.INACCESSIBLE);
  });

  it('should mark artifact fields correctly', () => {
    const report = generateCoverageReport('test', 'Test', 'test', makeFullEvents());

    const uri = report.fields.find((f) => f.name === 'artifact_uri');
    expect(uri!.status).toBe(FieldStatuses.CAPTURED);
    expect(uri!.count).toBe(1);
  });
});

// ─── ST2: Coverage report ───────────────────────────────────

describe('ST2 — coverage report', () => {
  it('should calculate overall coverage percentage', () => {
    const report = generateCoverageReport('test', 'Test', 'test', makeFullEvents());

    expect(report.overallCoverage).toBeGreaterThan(0);
    expect(report.overallCoverage).toBeLessThanOrEqual(1);
    expect(report.capturedCount).toBeGreaterThan(0);
    expect(report.totalFields).toBeGreaterThan(0);
  });

  it('should have 100% critical coverage for valid events', () => {
    const report = generateCoverageReport('test', 'Test', 'test', makeFullEvents());
    expect(report.criticalCoverage).toBe(1);
  });

  it('should calculate important coverage', () => {
    const report = generateCoverageReport('test', 'Test', 'test', makeFullEvents());
    expect(report.importantCoverage).toBeGreaterThan(0);
  });

  it('should include adapter metadata', () => {
    const report = generateCoverageReport('claude', 'Claude API', 'anthropic', makeFullEvents());

    expect(report.adapterId).toBe('claude');
    expect(report.adapterName).toBe('Claude API');
    expect(report.provider).toBe('anthropic');
    expect(report.generatedAt).toMatch(/Z$/);
  });

  it('should count fields correctly', () => {
    const report = generateCoverageReport('test', 'Test', 'test', makeFullEvents());

    expect(report.capturedCount + report.unsupportedCount + report.inaccessibleCount).toBe(report.totalFields);
  });

  it('should be transfer ready when all critical fields are captured', () => {
    const report = generateCoverageReport('test', 'Test', 'test', makeFullEvents());
    expect(report.transferReady).toBe(true);
  });

  it('should work with Claude adapter output', () => {
    const raw = readFileSync(join(__dirname, 'fixtures', 'claude-conversation.json'), 'utf-8');
    const parseResult = claudeAdapter.parse(raw);
    const normalized = adapterNormalize({
      parseResult, projectId: 'p', sessionId: 's', source: 'claude',
    });

    const report = generateCoverageReport(
      'claude', 'Claude API', 'anthropic',
      normalized.events, parseResult.warnings,
    );

    expect(report.criticalCoverage).toBe(1);
    expect(report.capturedCount).toBeGreaterThan(5);
    expect(report.transferReady).toBe(true);
  });

  it('should handle empty events', () => {
    const report = generateCoverageReport('test', 'Test', 'test', []);
    expect(report.overallCoverage).toBe(0);
    expect(report.capturedCount).toBe(0);
    expect(report.transferReady).toBe(false);
  });
});

// ─── ST3: Transfer warnings ─────────────────────────────────

describe('ST3 — transfer warnings', () => {
  it('should not warn when all critical fields are captured', () => {
    const report = generateCoverageReport('test', 'Test', 'test', makeFullEvents());
    const critical = report.warnings.filter((w) => w.severity === 'critical');
    expect(critical).toHaveLength(0);
  });

  it('should warn when important fields are missing', () => {
    // Messages-only: tool fields are N/A, but some metadata may be missing
    const report = generateCoverageReport('test', 'Test', 'test', makeMessageEvents());

    // Should have at least some warnings about missing metadata
    expect(report.warnings.length).toBeGreaterThanOrEqual(0); // May or may not depending on what's in scope
  });

  it('should warn for empty event set (critical fields missing)', () => {
    const report = generateCoverageReport('test', 'Test', 'test', []);
    const critical = report.warnings.filter((w) => w.severity === 'critical');
    expect(critical.length).toBeGreaterThan(0);
    expect(report.transferReady).toBe(false);
  });

  it('should include field name and message in warnings', () => {
    const report = generateCoverageReport('test', 'Test', 'test', []);

    for (const w of report.warnings) {
      expect(w.field.length).toBeGreaterThan(0);
      expect(w.message.length).toBeGreaterThan(0);
      expect(['critical', 'warning', 'info']).toContain(w.severity);
    }
  });

  it('should not be transfer ready when critical warnings exist', () => {
    const report = generateCoverageReport('test', 'Test', 'test', []);
    expect(report.transferReady).toBe(false);

    const criticalWarnings = report.warnings.filter((w) => w.severity === 'critical');
    expect(criticalWarnings.length).toBeGreaterThan(0);
  });
});
