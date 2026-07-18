import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace,
  createProject,
  startSession,
  openLedger,
  createEvent,
  EventTypes,
  MessageRoles,
  quickCapture,
  ingestFromFile,
  ingestRawEvents,
  updateSessionAfterCapture,
  getSession,
} from '../src/index';
import type { MessageEvent } from '../src/index';

const TS = '2025-06-01T12:00:00.000Z';

describe('capture — quickCapture()', () => {
  let root: string;
  let projectId: string;
  let sessionId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-capture-test-'));
    initWorkspace(root);
    projectId = createProject(root, { title: 'Capture Test' }).data!.id;
    sessionId = startSession(root, { projectId }).data!.id;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should capture a message event and append to ledger', () => {
    const result = quickCapture({
      workspaceRoot: root,
      projectId,
      sessionId,
      type: EventTypes.MESSAGE,
      source: 'test',
      payload: { role: MessageRoles.USER, content: 'Hello from capture' },
    });

    expect(result.appended).toBe(1);
    expect(result.errors).toHaveLength(0);

    const ledger = openLedger(root, projectId, sessionId);
    const { events } = ledger.readAll();
    expect(events).toHaveLength(1);
    expect((events[0] as MessageEvent).payload.content).toBe('Hello from capture');
  });

  it('should auto-increment sequence numbers', () => {
    quickCapture({
      workspaceRoot: root, projectId, sessionId,
      type: EventTypes.MESSAGE, source: 'test',
      payload: { role: MessageRoles.USER, content: 'first' },
    });
    quickCapture({
      workspaceRoot: root, projectId, sessionId,
      type: EventTypes.MESSAGE, source: 'test',
      payload: { role: MessageRoles.ASSISTANT, content: 'second' },
    });
    quickCapture({
      workspaceRoot: root, projectId, sessionId,
      type: EventTypes.MESSAGE, source: 'test',
      payload: { role: MessageRoles.USER, content: 'third' },
    });

    const ledger = openLedger(root, projectId, sessionId);
    const { events } = ledger.readAll();

    expect(events).toHaveLength(3);
    expect(events[0].sequence).toBe(0);
    expect(events[1].sequence).toBe(1);
    expect(events[2].sequence).toBe(2);
  });

  it('should capture a command event', () => {
    const result = quickCapture({
      workspaceRoot: root, projectId, sessionId,
      type: EventTypes.COMMAND, source: 'test',
      payload: { command: 'npm test', cwd: '/app' },
    });

    expect(result.appended).toBe(1);
    const ledger = openLedger(root, projectId, sessionId);
    const { events } = ledger.readAll();
    expect(events[0].type).toBe('command');
  });

  it('should capture a system event', () => {
    const result = quickCapture({
      workspaceRoot: root, projectId, sessionId,
      type: EventTypes.SYSTEM, source: 'test',
      payload: { action: 'checkpoint' as const, message: 'Before refactor' },
    });

    expect(result.appended).toBe(1);
  });
});

describe('capture — ingestFromFile()', () => {
  let root: string;
  let projectId: string;
  let sessionId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-ingest-file-'));
    initWorkspace(root);
    projectId = createProject(root, { title: 'File Ingest' }).data!.id;
    sessionId = startSession(root, { projectId }).data!.id;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should ingest events from a JSONL file', () => {
    const e0 = createEvent({
      type: EventTypes.MESSAGE, projectId, sessionId,
      sequence: 0, source: 'test', timestamp: TS,
      payload: { role: MessageRoles.USER, content: 'line one' },
    });
    const e1 = createEvent({
      type: EventTypes.MESSAGE, projectId, sessionId,
      sequence: 1, source: 'test', timestamp: TS,
      payload: { role: MessageRoles.ASSISTANT, content: 'line two' },
    });

    const filePath = join(root, 'events.jsonl');
    writeFileSync(filePath, JSON.stringify(e0) + '\n' + JSON.stringify(e1), 'utf-8');

    const result = ingestFromFile(root, projectId, sessionId, filePath);

    expect(result.appended).toBe(2);
    expect(result.parseErrors).toBe(0);
    expect(result.validationErrors).toBe(0);
  });

  it('should ingest events from a JSON array file', () => {
    const events = [
      createEvent({
        type: EventTypes.MESSAGE, projectId, sessionId,
        sequence: 0, source: 'test', timestamp: TS,
        payload: { role: MessageRoles.USER, content: 'array item' },
      }),
    ];

    const filePath = join(root, 'events.json');
    writeFileSync(filePath, JSON.stringify(events), 'utf-8');

    const result = ingestFromFile(root, projectId, sessionId, filePath);
    expect(result.appended).toBe(1);
  });

  it('should skip duplicates from file', () => {
    const event = createEvent({
      type: EventTypes.MESSAGE, projectId, sessionId,
      sequence: 0, source: 'test', timestamp: TS,
      payload: { role: MessageRoles.USER, content: 'dupe' },
    });

    const filePath = join(root, 'events.jsonl');
    writeFileSync(filePath, JSON.stringify(event), 'utf-8');

    ingestFromFile(root, projectId, sessionId, filePath);
    const result = ingestFromFile(root, projectId, sessionId, filePath);

    expect(result.appended).toBe(0);
    expect(result.duplicatesSkipped).toBe(1);
  });

  it('should report parse errors for invalid JSON lines', () => {
    const filePath = join(root, 'bad.jsonl');
    writeFileSync(filePath, '{ broken json\n{"also": "broken', 'utf-8');

    const result = ingestFromFile(root, projectId, sessionId, filePath);

    expect(result.appended).toBe(0);
    expect(result.parseErrors).toBe(2);
    expect(result.errors).toHaveLength(2);
  });

  it('should report validation errors for structurally invalid events', () => {
    const filePath = join(root, 'invalid.jsonl');
    writeFileSync(filePath, JSON.stringify({ type: 'message', id: 'bad' }), 'utf-8');

    const result = ingestFromFile(root, projectId, sessionId, filePath);

    expect(result.appended).toBe(0);
    expect(result.validationErrors).toBe(1);
  });

  it('should error for nonexistent file', () => {
    const result = ingestFromFile(root, projectId, sessionId, '/no/such/file.jsonl');

    expect(result.appended).toBe(0);
    expect(result.parseErrors).toBe(1);
    expect(result.errors[0].message).toContain('not found');
  });
});

describe('capture — ingestRawEvents()', () => {
  let root: string;
  let projectId: string;
  let sessionId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-ingest-raw-'));
    initWorkspace(root);
    projectId = createProject(root, { title: 'Raw Ingest' }).data!.id;
    sessionId = startSession(root, { projectId }).data!.id;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should ingest events from a raw JSONL string', () => {
    const e0 = createEvent({
      type: EventTypes.MESSAGE, projectId, sessionId,
      sequence: 0, source: 'stdin', timestamp: TS,
      payload: { role: MessageRoles.USER, content: 'from stdin' },
    });

    const result = ingestRawEvents(root, projectId, sessionId, JSON.stringify(e0));

    expect(result.appended).toBe(1);
    expect(result.totalProcessed).toBe(1);
  });

  it('should handle empty input', () => {
    const result = ingestRawEvents(root, projectId, sessionId, '');
    expect(result.appended).toBe(0);
    expect(result.totalProcessed).toBe(0);
  });

  it('should handle mixed valid and invalid lines', () => {
    const valid = createEvent({
      type: EventTypes.MESSAGE, projectId, sessionId,
      sequence: 0, source: 'stdin', timestamp: TS,
      payload: { role: MessageRoles.USER, content: 'valid' },
    });

    const raw = JSON.stringify(valid) + '\n{ broken\n' + JSON.stringify({ type: 'bad' });
    const result = ingestRawEvents(root, projectId, sessionId, raw);

    expect(result.appended).toBe(1);
    expect(result.parseErrors).toBe(1);
    expect(result.validationErrors).toBe(1);
  });
});

describe('updateSessionAfterCapture()', () => {
  let root: string;
  let projectId: string;
  let sessionId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-update-sess-'));
    initWorkspace(root);
    projectId = createProject(root, { title: 'Update Test' }).data!.id;
    sessionId = startSession(root, { projectId }).data!.id;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should increment session event count', () => {
    updateSessionAfterCapture(root, projectId, sessionId, 5);
    const session = getSession(root, projectId, sessionId);
    expect(session!.eventCount).toBe(5);
  });

  it('should accumulate across calls', () => {
    updateSessionAfterCapture(root, projectId, sessionId, 3);
    updateSessionAfterCapture(root, projectId, sessionId, 2);
    const session = getSession(root, projectId, sessionId);
    expect(session!.eventCount).toBe(5);
  });

  it('should do nothing for zero new events', () => {
    updateSessionAfterCapture(root, projectId, sessionId, 0);
    const session = getSession(root, projectId, sessionId);
    expect(session!.eventCount).toBe(0);
  });
});
