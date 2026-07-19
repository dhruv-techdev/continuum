import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  initWorkspace,
  createProject,
  startSession,
  importTranscript,
  parseJSON,
  extractWorkingState,
  saveWorkingState,
  loadWorkingState,
  listStateHistory,
  correctStatement,
  rejectStatement,
  getActiveStatements,
  getCorrectionChain,
  createEvent,
  EventTypes,
  MessageRoles,
  StatementStatuses,
  StatementCategories,
  openLedger,
} from '../src/index';
import type { WorkingState, ContinuumEvent } from '../src/index';

const TS = '2025-06-01T12:00:00.000Z';

function msg(pid: string, sid: string, seq: number, role: 'user' | 'assistant', content: string): ContinuumEvent {
  return createEvent({
    type: EventTypes.MESSAGE,
    projectId: pid, sessionId: sid, sequence: seq,
    source: 'test', timestamp: TS,
    payload: { role: role === 'user' ? MessageRoles.USER : MessageRoles.ASSISTANT, content },
  });
}

function makeState(pid: string): WorkingState {
  const events = [
    msg(pid, 'sess_1', 0, 'user', 'The goal is to build a context transfer platform.'),
    msg(pid, 'sess_1', 1, 'user', 'The system must preserve all events without modification.'),
    msg(pid, 'sess_1', 2, 'user', 'The requirement is to support multiple AI providers.'),
    msg(pid, 'sess_1', 3, 'user', "Let's use JSONL for the storage format."),
    msg(pid, 'sess_1', 4, 'user', 'I tried SQLite but it failed with linking errors.'),
    msg(pid, 'sess_1', 5, 'user', 'Should we support real-time streaming capture?'),
  ];
  return extractWorkingState(pid, events);
}

describe('extractWorkingState — requirements', () => {
  it('should extract requirements as a separate category', () => {
    const state = makeState('p1');
    expect(state.requirements.length).toBeGreaterThanOrEqual(1);
    expect(state.requirements[0].category).toBe(StatementCategories.REQUIREMENT);
  });
});

describe('correctStatement()', () => {
  it('should create a corrected statement and mark original', () => {
    const state = makeState('p1');
    const original = state.objectives[0];

    const result = correctStatement(state, {
      statementId: original.id,
      newText: 'Build a verified context continuity system.',
      note: 'More specific wording',
    });

    expect(result.error).toBeNull();
    expect(result.original.status).toBe(StatementStatuses.USER_CORRECTED);
    expect(result.original.replacedBy).toBe(result.corrected!.id);
    expect(result.corrected!.text).toBe('Build a verified context continuity system.');
    expect(result.corrected!.corrects).toBe(original.id);
    expect(result.corrected!.status).toBe(StatementStatuses.ACTIVE);
    expect(result.corrected!.correctionNote).toBe('More specific wording');
  });

  it('should preserve source event IDs in corrected statement', () => {
    const state = makeState('p1');
    const original = state.objectives[0];

    const result = correctStatement(state, {
      statementId: original.id,
      newText: 'Corrected text',
      note: 'test',
    });

    expect(result.corrected!.sourceEventIds).toEqual(original.sourceEventIds);
    expect(result.corrected!.sourceSequence).toBe(original.sourceSequence);
  });

  it('should allow reclassifying to a different category', () => {
    const state = makeState('p1');
    const original = state.constraints[0];

    correctStatement(state, {
      statementId: original.id,
      newCategory: StatementCategories.REQUIREMENT,
      note: 'This is a requirement, not a constraint',
    });

    // The corrected statement should be in requirements
    const corrected = state.requirements.find((s) => s.corrects === original.id);
    expect(corrected).toBeDefined();
    expect(corrected!.category).toBe(StatementCategories.REQUIREMENT);
  });

  it('should error for nonexistent statement', () => {
    const state = makeState('p1');
    const result = correctStatement(state, {
      statementId: 'stmt_nonexistent',
      note: 'test',
    });
    expect(result.error).toContain('not found');
  });
});

describe('rejectStatement()', () => {
  it('should mark statement as rejected', () => {
    const state = makeState('p1');
    const target = state.constraints[0];

    const result = rejectStatement(state, target.id, 'False positive');

    expect(result.error).toBeNull();
    expect(result.original.status).toBe(StatementStatuses.REJECTED);
    expect(result.original.correctionNote).toBe('False positive');
    expect(result.corrected).toBeNull();
  });

  it('should exclude rejected from active statements', () => {
    const state = makeState('p1');
    const before = getActiveStatements(state).length;

    rejectStatement(state, state.constraints[0].id, 'wrong');

    const after = getActiveStatements(state).length;
    expect(after).toBe(before - 1);
  });

  it('should error for nonexistent statement', () => {
    const state = makeState('p1');
    const result = rejectStatement(state, 'stmt_nope', 'test');
    expect(result.error).toContain('not found');
  });
});

describe('getActiveStatements()', () => {
  it('should return only active statements', () => {
    const state = makeState('p1');
    const all = getActiveStatements(state);
    for (const s of all) {
      expect(s.status).toBe(StatementStatuses.ACTIVE);
    }
  });

  it('should decrease after rejection', () => {
    const state = makeState('p1');
    const before = getActiveStatements(state).length;
    rejectStatement(state, state.objectives[0].id, 'wrong');
    expect(getActiveStatements(state).length).toBe(before - 1);
  });

  it('should stay same count after correction (old removed, new added)', () => {
    const state = makeState('p1');
    const before = getActiveStatements(state).length;
    correctStatement(state, { statementId: state.objectives[0].id, newText: 'Better', note: 'fix' });
    expect(getActiveStatements(state).length).toBe(before);
  });
});

describe('getCorrectionChain()', () => {
  it('should return chain of corrections', () => {
    const state = makeState('p1');
    const original = state.objectives[0];

    const r1 = correctStatement(state, { statementId: original.id, newText: 'V2', note: 'first fix' });
    const r2 = correctStatement(state, { statementId: r1.corrected!.id, newText: 'V3', note: 'second fix' });

    const chain = getCorrectionChain(state, original.id);

    expect(chain.length).toBeGreaterThanOrEqual(3);
    expect(chain[0].id).toBe(original.id);
    expect(chain[0].text).toContain('goal');
    expect(chain[1].text).toBe('V2');
    expect(chain[2].text).toBe('V3');
  });

  it('should return single item for uncorrected statement', () => {
    const state = makeState('p1');
    const chain = getCorrectionChain(state, state.objectives[0].id);
    expect(chain).toHaveLength(1);
  });
});

describe('persistence — regeneration (ST3)', () => {
  let root: string;
  let projectId: string;
  let sessionId: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'continuum-regen-test-'));
    initWorkspace(root);
    const proj = createProject(root, { title: 'Regen Test' }).data!;
    projectId = proj.id;
    const sess = startSession(root, { projectId }).data!;
    sessionId = sess.id;

    const parseResult = parseJSON(JSON.stringify([
      { role: 'user', content: 'The goal is to build a transfer tool.' },
      { role: 'user', content: 'The system must preserve ordering.' },
      { role: 'user', content: "Let's use JSONL format." },
    ]));
    importTranscript(root, projectId, sessionId, parseResult, 'test');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should extract, save, and reload state', () => {
    const events = openLedger(root, projectId, sessionId).readAll().events;
    const state = extractWorkingState(projectId, events);
    saveWorkingState(root, projectId, state);

    const loaded = loadWorkingState(root, projectId);
    expect(loaded).not.toBeNull();
    expect(loaded!.objectives.length).toBe(state.objectives.length);
    expect(loaded!.stateVersion).toBe(state.stateVersion);
  });

  it('should archive old state on re-save', () => {
    const events = openLedger(root, projectId, sessionId).readAll().events;
    const state = extractWorkingState(projectId, events);

    saveWorkingState(root, projectId, state);
    saveWorkingState(root, projectId, state);

    const history = listStateHistory(root, projectId);
    expect(history.length).toBeGreaterThanOrEqual(1);
  });

  it('should regenerate from ledger and produce same categories', () => {
    const events = openLedger(root, projectId, sessionId).readAll().events;

    const first = extractWorkingState(projectId, events);
    saveWorkingState(root, projectId, first);

    // Regenerate
    const second = extractWorkingState(projectId, events);

    expect(second.objectives.length).toBe(first.objectives.length);
    expect(second.constraints.length).toBe(first.constraints.length);
    expect(second.decisions.length).toBe(first.decisions.length);
  });

  it('should produce different state after new events are added', () => {
    const events = openLedger(root, projectId, sessionId).readAll().events;
    const first = extractWorkingState(projectId, events);
    saveWorkingState(root, projectId, first);

    // Add more events
    const parseResult = parseJSON(JSON.stringify([
      { role: 'user', content: 'I tried protobuf but it failed with schema issues.' },
      { role: 'user', content: 'Next step is to add the MCP server.' },
    ]));
    importTranscript(root, projectId, sessionId, parseResult, 'test');

    const moreEvents = openLedger(root, projectId, sessionId).readAll().events;
    const second = extractWorkingState(projectId, moreEvents);

    expect(second.totalEventsProcessed).toBeGreaterThan(first.totalEventsProcessed);
    expect(second.failures.length).toBeGreaterThan(first.failures.length);
  });
});
