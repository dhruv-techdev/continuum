import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace,
  createProject,
  startSession,
  parseJSON,
  parseMarkdown,
  normalizeToEvents,
  importTranscript,
  getSession,
  EventTypes,
} from '../src/index';
import type { ParseResult } from '../src/index';

describe('normalizeToEvents()', () => {
  const projectId = 'proj_test';
  const sessionId = 'sess_test';
  const source = 'test';

  function normalize(parseResult: ParseResult) {
    return normalizeToEvents({ parseResult, projectId, sessionId, source });
  }

  it('should convert parsed messages to ContinuumEvents', () => {
    const parseResult = parseJSON(JSON.stringify([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' },
    ]));

    const output = normalize(parseResult);

    expect(output.events).toHaveLength(2);
    expect(output.events[0].type).toBe(EventTypes.MESSAGE);
    expect(output.events[0].projectId).toBe(projectId);
    expect(output.events[0].sessionId).toBe(sessionId);
    expect(output.events[0].sequence).toBe(0);

    const payload0 = (output.events[0] as { payload: { role: string; content: string } }).payload;
    expect(payload0.role).toBe('user');
    expect(payload0.content).toBe('Hello');

    expect(output.events[1].sequence).toBe(1);
  });

  it('should coerce unknown roles to user and preserve original in metadata', () => {
    const parseResult = parseJSON(JSON.stringify([
      { role: 'moderator', content: 'Check this' },
    ]));

    const output = normalize(parseResult);

    expect(output.events).toHaveLength(1);
    const payload = (output.events[0] as { payload: { role: string; metadata?: Record<string, unknown> } }).payload;
    expect(payload.role).toBe('user');
    expect(payload.metadata?.originalRole).toBe('moderator');
    expect(output.warnings.some((w) => w.type === 'coerced')).toBe(true);
  });

  it('should preserve unmapped fields in metadata', () => {
    const parseResult = parseJSON(JSON.stringify([
      { role: 'user', content: 'hi', name: 'Bob', tool_calls: [] },
    ]));

    const output = normalize(parseResult);
    const payload = (output.events[0] as { payload: { metadata?: Record<string, unknown> } }).payload;
    const original = payload.metadata?.originalFields as Record<string, unknown>;
    expect(original).toHaveProperty('name', 'Bob');
    expect(original).toHaveProperty('tool_calls');
  });

  it('should propagate detected provider', () => {
    const parseResult: ParseResult = {
      messages: [{ role: 'user', content: 'hi', unmappedFields: {} }],
      format: 'json',
      warnings: [],
      detectedProvider: 'openai',
    };

    const output = normalize(parseResult);
    const payload = (output.events[0] as { payload: { metadata?: Record<string, unknown> } }).payload;
    expect(payload.metadata?.detectedProvider).toBe('openai');
  });

  it('should track correct stats', () => {
    const parseResult = parseJSON(JSON.stringify([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'system', content: 'three' },
    ]));

    const output = normalize(parseResult);
    expect(output.stats.totalParsed).toBe(3);
    expect(output.stats.eventsCreated).toBe(3);
    expect(output.stats.skipped).toBe(0);
  });

  it('should work with markdown-parsed input', () => {
    const parseResult = parseMarkdown(`## User
Hello

## Assistant
World`);

    const output = normalize(parseResult);
    expect(output.events).toHaveLength(2);
  });
});

describe('importTranscript()', () => {
  let root: string;
  let projectId: string;
  let sessionId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-import-test-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Import Test' }).data!;
    projectId = proj.id;
    const sess = startSession(root, { projectId }).data!;
    sessionId = sess.id;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should write events to events.jsonl', () => {
    const parseResult = parseJSON(JSON.stringify([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]));

    const result = importTranscript(root, projectId, sessionId, parseResult, 'test');

    expect(result.eventCount).toBe(2);

    const ledgerPath = join(root, 'projects', projectId, 'sessions', sessionId, 'events.jsonl');
    expect(existsSync(ledgerPath)).toBe(true);

    const lines = readFileSync(ledgerPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const event0 = JSON.parse(lines[0]);
    expect(event0.type).toBe('message');
    expect(event0.payload.role).toBe('user');
    expect(event0.payload.content).toBe('Hello');
  });

  it('should update session eventCount', () => {
    const parseResult = parseJSON(JSON.stringify([
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
    ]));

    importTranscript(root, projectId, sessionId, parseResult, 'test');

    const session = getSession(root, projectId, sessionId);
    expect(session!.eventCount).toBe(3);
  });

  it('should append on second import', () => {
    const first = parseJSON(JSON.stringify([{ role: 'user', content: 'first' }]));
    const second = parseJSON(JSON.stringify([{ role: 'user', content: 'second' }]));

    importTranscript(root, projectId, sessionId, first, 'test');
    importTranscript(root, projectId, sessionId, second, 'test');

    const ledgerPath = join(root, 'projects', projectId, 'sessions', sessionId, 'events.jsonl');
    const lines = readFileSync(ledgerPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const session = getSession(root, projectId, sessionId);
    expect(session!.eventCount).toBe(2);
  });

  it('should return correct stats and warnings', () => {
    const parseResult = parseJSON(JSON.stringify([
      { role: 'user', content: '', name: 'Bob' },
    ]));

    const result = importTranscript(root, projectId, sessionId, parseResult, 'test');

    expect(result.stats.totalParsed).toBe(1);
    expect(result.stats.eventsCreated).toBe(1);
    expect(result.stats.warningCount).toBeGreaterThan(0);
  });
});
