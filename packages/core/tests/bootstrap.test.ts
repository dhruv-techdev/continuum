import { describe, it, expect } from 'vitest';
import {
  extractWorkingState,
  generateBootstrap,
  createEvent,
  EventTypes,
  MessageRoles,
} from '../src/index';
import type { Project } from '../src/index';

const TS = '2025-06-01T12:00:00.000Z';
const PID = 'proj_test';
const SID = 'sess_test';

const TEST_PROJECT: Project = {
  id: PID,
  title: 'Test CLI Project',
  description: 'A test project for bootstrap generation',
  createdAt: TS,
  updatedAt: TS,
};

function msg(seq: number, role: 'user' | 'assistant', content: string) {
  return createEvent({
    type: EventTypes.MESSAGE,
    projectId: PID,
    sessionId: SID,
    sequence: seq,
    source: 'test',
    timestamp: TS,
    payload: { role: role === 'user' ? MessageRoles.USER : MessageRoles.ASSISTANT, content },
  });
}

describe('generateBootstrap()', () => {
  it('should produce all three layers', () => {
    const events = [
      msg(0, 'user', 'The goal is to build a context continuity platform.'),
      msg(1, 'user', 'The system must preserve events without modification.'),
      msg(2, 'user', "Let's use TypeScript for the implementation."),
      msg(3, 'assistant', 'Done, I have set up the project structure with four packages.'),
      msg(4, 'user', 'Next step is to implement the event schema.'),
    ];

    const state = extractWorkingState(PID, events);
    const bootstrap = generateBootstrap(TEST_PROJECT, state);

    // L0
    expect(bootstrap.orientation).toContain('Test CLI Project');
    expect(bootstrap.orientation).toContain('A test project');

    // L1
    expect(bootstrap.activeState).toContain('L1');

    // L2
    expect(bootstrap.governingContext).toContain('L2');

    // Combined
    expect(bootstrap.combined).toContain('L0');
    expect(bootstrap.combined).toContain('L1');
    expect(bootstrap.combined).toContain('L2');
    expect(bootstrap.combined).toContain('Continuum');
  });

  it('should include objectives in active state', () => {
    const events = [
      msg(0, 'user', 'I want to create a tool for AI context transfer.'),
    ];
    const state = extractWorkingState(PID, events);
    const bootstrap = generateBootstrap(TEST_PROJECT, state);

    expect(bootstrap.activeState).toContain('Objectives');
    expect(bootstrap.activeState).toContain('context transfer');
  });

  it('should include constraints in governing context', () => {
    const events = [
      msg(0, 'user', 'The system must never silently drop an acknowledged event.'),
    ];
    const state = extractWorkingState(PID, events);
    const bootstrap = generateBootstrap(TEST_PROJECT, state);

    expect(bootstrap.governingContext).toContain('Constraints');
    expect(bootstrap.governingContext).toContain('must never');
  });

  it('should include decisions in governing context', () => {
    const events = [
      msg(0, 'user', 'We decided to use append-only JSONL for storage.'),
    ];
    const state = extractWorkingState(PID, events);
    const bootstrap = generateBootstrap(TEST_PROJECT, state);

    expect(bootstrap.governingContext).toContain('Decisions');
    expect(bootstrap.governingContext).toContain('JSONL');
  });

  it('should include failures as things to avoid', () => {
    const events = [
      msg(0, 'user', 'I tried using protobuf but it failed with schema evolution issues.'),
    ];
    const state = extractWorkingState(PID, events);
    const bootstrap = generateBootstrap(TEST_PROJECT, state);

    expect(bootstrap.governingContext).toContain('Failed Approaches');
  });

  it('should handle empty state gracefully', () => {
    const state = extractWorkingState(PID, []);
    const bootstrap = generateBootstrap(TEST_PROJECT, state);

    expect(bootstrap.combined).toContain('Test CLI Project');
    expect(bootstrap.combined).toContain('No active state');
    expect(bootstrap.statementCount).toBe(0);
    expect(bootstrap.eventsCovered).toBe(0);
  });

  it('should track metadata correctly', () => {
    const events = [
      msg(0, 'user', 'The goal is to test metadata tracking.'),
      msg(1, 'user', 'We must validate all inputs.'),
    ];
    const state = extractWorkingState(PID, events);
    const bootstrap = generateBootstrap(TEST_PROJECT, state);

    expect(bootstrap.statementCount).toBeGreaterThanOrEqual(2);
    expect(bootstrap.eventsCovered).toBe(2);
    expect(bootstrap.generatedAt).toMatch(/Z$/);
  });
});
