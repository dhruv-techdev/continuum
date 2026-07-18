import { describe, it, expect } from 'vitest';
import {
  // Constants
  EVENT_SCHEMA_VERSION,
  EventTypes,
  VALID_EVENT_TYPES,
  MessageRoles,
  ArtifactActions,
  SystemActions,

  // Hash
  canonicalize,
  computeEventHash,
  verifyEventHash,

  // Factory
  createEvent,
  generateEventId,

  // Validation
  validateEvent,
  isValidEventType,
  isCompatibleSchemaVersion,
} from '../src/index';

import type { ContinuumEvent, MessageEvent } from '../src/index';

// ─── Helpers ────────────────────────────────────────────────────

const FIXED_TIMESTAMP = '2025-01-15T10:30:00.000Z';

function makeMessageEvent(overrides: Record<string, unknown> = {}): MessageEvent {
  return createEvent({
    type: EventTypes.MESSAGE,
    projectId: 'proj_001',
    sessionId: 'sess_001',
    sequence: 0,
    source: 'test',
    timestamp: FIXED_TIMESTAMP,
    payload: { role: MessageRoles.USER, content: 'Hello world' },
    ...overrides,
  });
}

// ─── Constants ──────────────────────────────────────────────────

describe('EVENT_SCHEMA_VERSION', () => {
  it('should be a valid semver string', () => {
    expect(EVENT_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('EventTypes', () => {
  it('should define exactly 7 event types', () => {
    expect(VALID_EVENT_TYPES).toHaveLength(7);
  });

  it('should include all expected types', () => {
    expect(VALID_EVENT_TYPES).toContain('message');
    expect(VALID_EVENT_TYPES).toContain('tool_call');
    expect(VALID_EVENT_TYPES).toContain('tool_result');
    expect(VALID_EVENT_TYPES).toContain('command');
    expect(VALID_EVENT_TYPES).toContain('command_output');
    expect(VALID_EVENT_TYPES).toContain('artifact');
    expect(VALID_EVENT_TYPES).toContain('system');
  });
});

// ─── Canonical hashing ──────────────────────────────────────────

describe('canonicalize()', () => {
  it('should sort object keys alphabetically', () => {
    const a = canonicalize({ z: 1, a: 2 });
    const b = canonicalize({ a: 2, z: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"z":1}');
  });

  it('should sort nested object keys recursively', () => {
    const a = canonicalize({ outer: { z: 1, a: 2 } });
    const b = canonicalize({ outer: { a: 2, z: 1 } });
    expect(a).toBe(b);
  });

  it('should preserve array order (arrays are ordered)', () => {
    const result = canonicalize([3, 1, 2]);
    expect(result).toBe('[3,1,2]');
  });

  it('should handle null and undefined', () => {
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize(undefined)).toBe(undefined);
  });

  it('should handle strings with special characters', () => {
    const result = canonicalize({ emoji: '🚀', newline: 'line1\nline2' });
    expect(result).toContain('🚀');
    expect(result).toContain('\\n');
  });

  it('should handle empty objects and arrays', () => {
    expect(canonicalize({})).toBe('{}');
    expect(canonicalize([])).toBe('[]');
  });

  it('should handle booleans and numbers', () => {
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize(3.14)).toBe('3.14');
  });
});

describe('computeEventHash()', () => {
  it('should return a 64-character hex string', () => {
    const hash = computeEventHash('message', 'p1', 's1', 0, FIXED_TIMESTAMP, 'test', {});
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should be deterministic — same inputs produce same hash', () => {
    const a = computeEventHash('message', 'p1', 's1', 0, FIXED_TIMESTAMP, 'test', { role: 'user' });
    const b = computeEventHash('message', 'p1', 's1', 0, FIXED_TIMESTAMP, 'test', { role: 'user' });
    expect(a).toBe(b);
  });

  it('should differ when any field changes', () => {
    const base = computeEventHash('message', 'p1', 's1', 0, FIXED_TIMESTAMP, 'test', {});
    const diffType = computeEventHash('command', 'p1', 's1', 0, FIXED_TIMESTAMP, 'test', {});
    const diffSeq = computeEventHash('message', 'p1', 's1', 1, FIXED_TIMESTAMP, 'test', {});
    const diffPayload = computeEventHash('message', 'p1', 's1', 0, FIXED_TIMESTAMP, 'test', { x: 1 });

    expect(base).not.toBe(diffType);
    expect(base).not.toBe(diffSeq);
    expect(base).not.toBe(diffPayload);
  });

  it('should produce the same hash regardless of payload key order', () => {
    const a = computeEventHash('message', 'p1', 's1', 0, FIXED_TIMESTAMP, 'test', { b: 2, a: 1 });
    const b = computeEventHash('message', 'p1', 's1', 0, FIXED_TIMESTAMP, 'test', { a: 1, b: 2 });
    expect(a).toBe(b);
  });
});

describe('verifyEventHash()', () => {
  it('should return true for an untampered event', () => {
    const event = makeMessageEvent();
    expect(verifyEventHash(event)).toBe(true);
  });

  it('should return false when payload is tampered', () => {
    const event = makeMessageEvent();
    (event.payload as Record<string, unknown>).content = 'tampered';
    expect(verifyEventHash(event)).toBe(false);
  });

  it('should return false when sequence is tampered', () => {
    const event = makeMessageEvent();
    (event as Record<string, unknown>).sequence = 999;
    expect(verifyEventHash(event)).toBe(false);
  });

  it('should return false when timestamp is tampered', () => {
    const event = makeMessageEvent();
    (event as Record<string, unknown>).timestamp = '2099-01-01T00:00:00.000Z';
    expect(verifyEventHash(event)).toBe(false);
  });
});

// ─── Factory ────────────────────────────────────────────────────

describe('generateEventId()', () => {
  it('should match evt_<uuid> format', () => {
    const id = generateEventId();
    expect(id).toMatch(/^evt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('should produce unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateEventId()));
    expect(ids.size).toBe(100);
  });
});

describe('createEvent()', () => {
  it('should create a message event with all base fields', () => {
    const event = makeMessageEvent();
    expect(event.type).toBe('message');
    expect(event.id).toMatch(/^evt_/);
    expect(event.projectId).toBe('proj_001');
    expect(event.sessionId).toBe('sess_001');
    expect(event.sequence).toBe(0);
    expect(event.timestamp).toBe(FIXED_TIMESTAMP);
    expect(event.schemaVersion).toBe(EVENT_SCHEMA_VERSION);
    expect(event.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(event.source).toBe('test');
    expect(event.payload.role).toBe('user');
    expect(event.payload.content).toBe('Hello world');
  });

  it('should auto-generate timestamp when not provided', () => {
    const before = new Date().toISOString();
    const event = createEvent({
      type: EventTypes.MESSAGE,
      projectId: 'p1',
      sessionId: 's1',
      sequence: 0,
      source: 'test',
      payload: { role: MessageRoles.USER, content: 'hi' },
    });
    const after = new Date().toISOString();
    expect(event.timestamp >= before).toBe(true);
    expect(event.timestamp <= after).toBe(true);
  });

  it('should accept an id override', () => {
    const event = createEvent({
      type: EventTypes.MESSAGE,
      projectId: 'p1',
      sessionId: 's1',
      sequence: 0,
      source: 'test',
      id: 'evt_00000000-0000-0000-0000-000000000001',
      payload: { role: MessageRoles.USER, content: 'hi' },
    });
    expect(event.id).toBe('evt_00000000-0000-0000-0000-000000000001');
  });

  it('should create a tool_call event', () => {
    const event = createEvent({
      type: EventTypes.TOOL_CALL,
      projectId: 'p1',
      sessionId: 's1',
      sequence: 1,
      source: 'test',
      timestamp: FIXED_TIMESTAMP,
      payload: { toolName: 'web_search', input: { query: 'test' }, callId: 'call_1' },
    });
    expect(event.type).toBe('tool_call');
    expect(event.payload.toolName).toBe('web_search');
    expect(event.payload.callId).toBe('call_1');
    expect(verifyEventHash(event)).toBe(true);
  });

  it('should create a tool_result event', () => {
    const event = createEvent({
      type: EventTypes.TOOL_RESULT,
      projectId: 'p1',
      sessionId: 's1',
      sequence: 2,
      source: 'test',
      timestamp: FIXED_TIMESTAMP,
      payload: { toolName: 'web_search', output: 'result data', isError: false },
    });
    expect(event.type).toBe('tool_result');
    expect(event.payload.isError).toBe(false);
    expect(verifyEventHash(event)).toBe(true);
  });

  it('should create a command event', () => {
    const event = createEvent({
      type: EventTypes.COMMAND,
      projectId: 'p1',
      sessionId: 's1',
      sequence: 3,
      source: 'test',
      timestamp: FIXED_TIMESTAMP,
      payload: { command: 'npm test', cwd: '/app', shell: '/bin/bash' },
    });
    expect(event.type).toBe('command');
    expect(event.payload.command).toBe('npm test');
    expect(verifyEventHash(event)).toBe(true);
  });

  it('should create a command_output event', () => {
    const event = createEvent({
      type: EventTypes.COMMAND_OUTPUT,
      projectId: 'p1',
      sessionId: 's1',
      sequence: 4,
      source: 'test',
      timestamp: FIXED_TIMESTAMP,
      payload: { commandEventId: 'evt_abc', stdout: 'PASS', exitCode: 0 },
    });
    expect(event.type).toBe('command_output');
    expect(event.payload.exitCode).toBe(0);
    expect(verifyEventHash(event)).toBe(true);
  });

  it('should create an artifact event', () => {
    const event = createEvent({
      type: EventTypes.ARTIFACT,
      projectId: 'p1',
      sessionId: 's1',
      sequence: 5,
      source: 'test',
      timestamp: FIXED_TIMESTAMP,
      payload: { action: ArtifactActions.CREATE, uri: 'file:///app/main.ts', mimeType: 'text/typescript', size: 1024 },
    });
    expect(event.type).toBe('artifact');
    expect(event.payload.action).toBe('create');
    expect(verifyEventHash(event)).toBe(true);
  });

  it('should create a system event', () => {
    const event = createEvent({
      type: EventTypes.SYSTEM,
      projectId: 'p1',
      sessionId: 's1',
      sequence: 6,
      source: 'test',
      timestamp: FIXED_TIMESTAMP,
      payload: { action: SystemActions.SESSION_START, message: 'Session started' },
    });
    expect(event.type).toBe('system');
    expect(event.payload.action).toBe('session_start');
    expect(verifyEventHash(event)).toBe(true);
  });

  it('should produce valid hashes for all event types', () => {
    // Every event created by the factory should self-verify.
    const events: ContinuumEvent[] = [
      makeMessageEvent(),
      createEvent({ type: EventTypes.TOOL_CALL, projectId: 'p', sessionId: 's', sequence: 0, source: 't', timestamp: FIXED_TIMESTAMP, payload: { toolName: 'x', input: {} } }),
      createEvent({ type: EventTypes.TOOL_RESULT, projectId: 'p', sessionId: 's', sequence: 0, source: 't', timestamp: FIXED_TIMESTAMP, payload: { toolName: 'x', output: 'ok' } }),
      createEvent({ type: EventTypes.COMMAND, projectId: 'p', sessionId: 's', sequence: 0, source: 't', timestamp: FIXED_TIMESTAMP, payload: { command: 'ls' } }),
      createEvent({ type: EventTypes.COMMAND_OUTPUT, projectId: 'p', sessionId: 's', sequence: 0, source: 't', timestamp: FIXED_TIMESTAMP, payload: { commandEventId: 'e1' } }),
      createEvent({ type: EventTypes.ARTIFACT, projectId: 'p', sessionId: 's', sequence: 0, source: 't', timestamp: FIXED_TIMESTAMP, payload: { action: ArtifactActions.CREATE, uri: '/f' } }),
      createEvent({ type: EventTypes.SYSTEM, projectId: 'p', sessionId: 's', sequence: 0, source: 't', timestamp: FIXED_TIMESTAMP, payload: { action: SystemActions.CHECKPOINT } }),
    ];

    for (const event of events) {
      expect(verifyEventHash(event)).toBe(true);
    }
  });
});

// ─── Validation ─────────────────────────────────────────────────

describe('isValidEventType()', () => {
  it('should accept all valid types', () => {
    for (const t of VALID_EVENT_TYPES) {
      expect(isValidEventType(t)).toBe(true);
    }
  });

  it('should reject invalid types', () => {
    expect(isValidEventType('invalid')).toBe(false);
    expect(isValidEventType('')).toBe(false);
    expect(isValidEventType(42)).toBe(false);
    expect(isValidEventType(null)).toBe(false);
  });
});

describe('isCompatibleSchemaVersion()', () => {
  it('should accept the current version', () => {
    expect(isCompatibleSchemaVersion(EVENT_SCHEMA_VERSION)).toBe(true);
  });

  it('should accept same major, different minor', () => {
    const major = EVENT_SCHEMA_VERSION.split('.')[0];
    expect(isCompatibleSchemaVersion(`${major}.99.99`)).toBe(true);
  });

  it('should reject different major version', () => {
    const major = parseInt(EVENT_SCHEMA_VERSION.split('.')[0], 10);
    expect(isCompatibleSchemaVersion(`${major + 1}.0.0`)).toBe(false);
  });

  it('should reject non-semver strings', () => {
    expect(isCompatibleSchemaVersion('bad')).toBe(false);
    expect(isCompatibleSchemaVersion('')).toBe(false);
  });
});

describe('validateEvent()', () => {
  it('should pass for a valid factory-created event', () => {
    const event = makeMessageEvent();
    expect(validateEvent(event)).toEqual([]);
  });

  it('should pass for every event type', () => {
    const events: ContinuumEvent[] = [
      makeMessageEvent(),
      createEvent({ type: EventTypes.TOOL_CALL, projectId: 'p', sessionId: 's', sequence: 0, source: 't', timestamp: FIXED_TIMESTAMP, payload: { toolName: 'x', input: {} } }),
      createEvent({ type: EventTypes.TOOL_RESULT, projectId: 'p', sessionId: 's', sequence: 0, source: 't', timestamp: FIXED_TIMESTAMP, payload: { toolName: 'x', output: '' } }),
      createEvent({ type: EventTypes.COMMAND, projectId: 'p', sessionId: 's', sequence: 0, source: 't', timestamp: FIXED_TIMESTAMP, payload: { command: 'ls' } }),
      createEvent({ type: EventTypes.COMMAND_OUTPUT, projectId: 'p', sessionId: 's', sequence: 0, source: 't', timestamp: FIXED_TIMESTAMP, payload: { commandEventId: 'e1' } }),
      createEvent({ type: EventTypes.ARTIFACT, projectId: 'p', sessionId: 's', sequence: 0, source: 't', timestamp: FIXED_TIMESTAMP, payload: { action: ArtifactActions.REFERENCE, uri: '/f' } }),
      createEvent({ type: EventTypes.SYSTEM, projectId: 'p', sessionId: 's', sequence: 0, source: 't', timestamp: FIXED_TIMESTAMP, payload: { action: SystemActions.SESSION_END } }),
    ];

    for (const event of events) {
      const errors = validateEvent(event);
      expect(errors).toEqual([]);
    }
  });

  // ── Base field failures ──

  it('should reject non-object input', () => {
    expect(validateEvent('string')).toHaveLength(1);
    expect(validateEvent(null)).toHaveLength(1);
    expect(validateEvent(42)).toHaveLength(1);
  });

  it('should catch invalid event ID format', () => {
    const event = { ...makeMessageEvent(), id: 'bad_id' };
    const errors = validateEvent(event);
    expect(errors.some((e) => e.field === 'id')).toBe(true);
  });

  it('should catch empty projectId', () => {
    const event = { ...makeMessageEvent(), projectId: '' };
    const errors = validateEvent(event);
    expect(errors.some((e) => e.field === 'projectId')).toBe(true);
  });

  it('should catch empty sessionId', () => {
    const event = { ...makeMessageEvent(), sessionId: '   ' };
    const errors = validateEvent(event);
    expect(errors.some((e) => e.field === 'sessionId')).toBe(true);
  });

  it('should catch invalid timestamp', () => {
    const event = { ...makeMessageEvent(), timestamp: 'not-a-date' };
    const errors = validateEvent(event);
    expect(errors.some((e) => e.field === 'timestamp')).toBe(true);
  });

  it('should catch non-UTC timestamp', () => {
    const event = { ...makeMessageEvent(), timestamp: '2025-01-15T10:30:00+05:00' };
    const errors = validateEvent(event);
    expect(errors.some((e) => e.field === 'timestamp')).toBe(true);
  });

  it('should catch negative sequence', () => {
    const event = { ...makeMessageEvent(), sequence: -1 };
    const errors = validateEvent(event);
    expect(errors.some((e) => e.field === 'sequence')).toBe(true);
  });

  it('should catch non-integer sequence', () => {
    const event = { ...makeMessageEvent(), sequence: 1.5 };
    const errors = validateEvent(event);
    expect(errors.some((e) => e.field === 'sequence')).toBe(true);
  });

  it('should catch invalid hash format', () => {
    const event = { ...makeMessageEvent(), hash: 'short' };
    const errors = validateEvent(event);
    expect(errors.some((e) => e.field === 'hash')).toBe(true);
  });

  it('should catch empty source', () => {
    const event = { ...makeMessageEvent(), source: '' };
    const errors = validateEvent(event);
    expect(errors.some((e) => e.field === 'source')).toBe(true);
  });

  it('should catch invalid event type', () => {
    const event = { ...makeMessageEvent(), type: 'unknown_type' };
    const errors = validateEvent(event);
    expect(errors.some((e) => e.field === 'type')).toBe(true);
  });

  it('should catch incompatible schema version', () => {
    const event = { ...makeMessageEvent(), schemaVersion: '99.0.0' };
    const errors = validateEvent(event);
    expect(errors.some((e) => e.field === 'schemaVersion')).toBe(true);
  });

  // ── Hash integrity ──

  it('should detect tampered payload via hash mismatch', () => {
    const event = makeMessageEvent();
    // Tamper and recompute a fake valid-looking hash won't match
    const tampered = { ...event, payload: { role: 'user', content: 'tampered' } };
    const errors = validateEvent(tampered);
    expect(errors.some((e) => e.field === 'hash' && e.message.includes('modified'))).toBe(true);
  });

  // ── Payload-specific failures ──

  it('should catch invalid message role', () => {
    const event = makeMessageEvent();
    (event.payload as Record<string, unknown>).role = 'admin';
    // Recompute hash so the hash check doesn't mask the payload error
    const raw = { ...event, hash: '0'.repeat(64) };
    const errors = validateEvent(raw);
    expect(errors.some((e) => e.field === 'payload.role')).toBe(true);
  });

  it('should catch non-string message content', () => {
    const raw = {
      ...makeMessageEvent(),
      payload: { role: 'user', content: 123 },
      hash: '0'.repeat(64),
    };
    const errors = validateEvent(raw);
    expect(errors.some((e) => e.field === 'payload.content')).toBe(true);
  });

  it('should catch missing tool_call toolName', () => {
    const event = createEvent({
      type: EventTypes.TOOL_CALL,
      projectId: 'p', sessionId: 's', sequence: 0, source: 't', timestamp: FIXED_TIMESTAMP,
      payload: { toolName: 'x', input: {} },
    });
    const raw = { ...event, payload: { toolName: '', input: {} }, hash: '0'.repeat(64) };
    const errors = validateEvent(raw);
    expect(errors.some((e) => e.field === 'payload.toolName')).toBe(true);
  });

  it('should catch non-object tool_call input', () => {
    const event = createEvent({
      type: EventTypes.TOOL_CALL,
      projectId: 'p', sessionId: 's', sequence: 0, source: 't', timestamp: FIXED_TIMESTAMP,
      payload: { toolName: 'x', input: {} },
    });
    const raw = { ...event, payload: { toolName: 'x', input: 'bad' }, hash: '0'.repeat(64) };
    const errors = validateEvent(raw);
    expect(errors.some((e) => e.field === 'payload.input')).toBe(true);
  });

  it('should catch invalid artifact action', () => {
    const event = createEvent({
      type: EventTypes.ARTIFACT,
      projectId: 'p', sessionId: 's', sequence: 0, source: 't', timestamp: FIXED_TIMESTAMP,
      payload: { action: ArtifactActions.CREATE, uri: '/f' },
    });
    const raw = { ...event, payload: { action: 'explode', uri: '/f' }, hash: '0'.repeat(64) };
    const errors = validateEvent(raw);
    expect(errors.some((e) => e.field === 'payload.action')).toBe(true);
  });

  it('should catch invalid system action', () => {
    const event = createEvent({
      type: EventTypes.SYSTEM,
      projectId: 'p', sessionId: 's', sequence: 0, source: 't', timestamp: FIXED_TIMESTAMP,
      payload: { action: SystemActions.CHECKPOINT },
    });
    const raw = { ...event, payload: { action: 'self_destruct' }, hash: '0'.repeat(64) };
    const errors = validateEvent(raw);
    expect(errors.some((e) => e.field === 'payload.action')).toBe(true);
  });

  it('should catch negative artifact size', () => {
    const event = createEvent({
      type: EventTypes.ARTIFACT,
      projectId: 'p', sessionId: 's', sequence: 0, source: 't', timestamp: FIXED_TIMESTAMP,
      payload: { action: ArtifactActions.CREATE, uri: '/f' },
    });
    const raw = { ...event, payload: { action: 'create', uri: '/f', size: -100 }, hash: '0'.repeat(64) };
    const errors = validateEvent(raw);
    expect(errors.some((e) => e.field === 'payload.size')).toBe(true);
  });

  it('should catch non-integer exitCode in command_output', () => {
    const event = createEvent({
      type: EventTypes.COMMAND_OUTPUT,
      projectId: 'p', sessionId: 's', sequence: 0, source: 't', timestamp: FIXED_TIMESTAMP,
      payload: { commandEventId: 'e1' },
    });
    const raw = { ...event, payload: { commandEventId: 'e1', exitCode: 1.5 }, hash: '0'.repeat(64) };
    const errors = validateEvent(raw);
    expect(errors.some((e) => e.field === 'payload.exitCode')).toBe(true);
  });

  it('should catch null payload', () => {
    const event = { ...makeMessageEvent(), payload: null };
    const errors = validateEvent(event);
    expect(errors.some((e) => e.field === 'payload')).toBe(true);
  });
});
