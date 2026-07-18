import { describe, it, expect } from 'vitest';
import {
  extractWorkingState,
  createEvent,
  EventTypes,
  MessageRoles,
  StatementCategories,
} from '../src/index';
import type { ContinuumEvent, WorkingState } from '../src/index';

const TS = '2025-06-01T12:00:00.000Z';
const PID = 'proj_test';
const SID = 'sess_test';

function msg(seq: number, role: 'user' | 'assistant', content: string): ContinuumEvent {
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

describe('extractWorkingState()', () => {
  // ── ST1: Extract objectives ─────────────────────────────────

  describe('objectives', () => {
    it('should extract explicit "goal is" statements', () => {
      const events = [
        msg(0, 'user', 'The goal is to build a CLI tool for context transfer.'),
      ];
      const state = extractWorkingState(PID, events);
      expect(state.objectives.length).toBeGreaterThanOrEqual(1);
      expect(state.objectives[0].text).toContain('goal is');
    });

    it('should extract "I want to" statements from user', () => {
      const events = [
        msg(0, 'user', 'I want to create a monorepo with shared types.'),
      ];
      const state = extractWorkingState(PID, events);
      expect(state.objectives.some((o) => o.text.includes('monorepo'))).toBe(true);
    });

    it('should extract "trying to" from user messages', () => {
      const events = [
        msg(0, 'user', 'I am trying to set up event sourcing for my project.'),
      ];
      const state = extractWorkingState(PID, events);
      expect(state.objectives.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── ST1: Extract constraints ────────────────────────────────

  describe('constraints', () => {
    it('should extract "must" constraints', () => {
      const events = [
        msg(0, 'user', 'The system must preserve event ordering at all times.'),
      ];
      const state = extractWorkingState(PID, events);
      expect(state.constraints.length).toBeGreaterThanOrEqual(1);
      expect(state.constraints[0].text).toContain('must preserve');
    });

    it('should extract "cannot" prohibitions', () => {
      const events = [
        msg(0, 'user', 'We cannot use any external database for storage.'),
      ];
      const state = extractWorkingState(PID, events);
      expect(state.constraints.some((c) => c.text.includes('cannot'))).toBe(true);
    });

    it('should extract "avoid" statements', () => {
      const events = [
        msg(0, 'assistant', 'We should avoid using global mutable state in the module.'),
      ];
      const state = extractWorkingState(PID, events);
      expect(state.constraints.some((c) => c.text.includes('avoid'))).toBe(true);
    });
  });

  // ── ST1: Extract decisions ──────────────────────────────────

  describe('decisions', () => {
    it('should extract "decided to" decisions', () => {
      const events = [
        msg(0, 'user', 'I decided to use JSONL for the event ledger format.'),
      ];
      const state = extractWorkingState(PID, events);
      expect(state.decisions.length).toBeGreaterThanOrEqual(1);
      expect(state.decisions[0].text).toContain('JSONL');
    });

    it('should extract "going with" decisions', () => {
      const events = [
        msg(0, 'assistant', 'We are going with pnpm workspaces for the monorepo.'),
      ];
      const state = extractWorkingState(PID, events);
      expect(state.decisions.some((d) => d.text.includes('pnpm'))).toBe(true);
    });

    it('should extract "let\'s use" decisions', () => {
      const events = [
        msg(0, 'user', "Let's use vitest for all our test suites."),
      ];
      const state = extractWorkingState(PID, events);
      expect(state.decisions.some((d) => d.text.includes('vitest'))).toBe(true);
    });
  });

  // ── ST1: Extract next actions ───────────────────────────────

  describe('next actions', () => {
    it('should extract "next step" actions', () => {
      const events = [
        msg(0, 'assistant', 'The next step is to implement the MCP server interface.'),
      ];
      const state = extractWorkingState(PID, events);
      expect(state.nextActions.length).toBeGreaterThanOrEqual(1);
      expect(state.nextActions[0].text).toContain('MCP server');
    });

    it('should extract "todo" items', () => {
      const events = [
        msg(0, 'user', 'TODO: add proper error handling to the import command.'),
      ];
      const state = extractWorkingState(PID, events);
      expect(state.nextActions.some((a) => a.text.includes('error handling'))).toBe(true);
    });
  });

  // ── Other categories ────────────────────────────────────────

  describe('other categories', () => {
    it('should extract completed work from assistant messages', () => {
      const events = [
        msg(0, 'assistant', 'I have implemented the event schema with seven event types.'),
      ];
      const state = extractWorkingState(PID, events);
      expect(state.completed.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract failures', () => {
      const events = [
        msg(0, 'user', 'I tried using sqlite but it failed with a linking error on ARM.'),
      ];
      const state = extractWorkingState(PID, events);
      expect(state.failures.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract assumptions', () => {
      const events = [
        msg(0, 'user', 'I am assuming the user has Node 18 or higher installed.'),
      ];
      const state = extractWorkingState(PID, events);
      expect(state.assumptions.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract open questions', () => {
      const events = [
        msg(0, 'user', 'Should we support multiple capsule versions or just the latest?'),
      ];
      const state = extractWorkingState(PID, events);
      expect(state.openQuestions.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── ST2: Source event linking ───────────────────────────────

  describe('ST2 — provenance', () => {
    it('should link every statement to its source event ID', () => {
      const events = [
        msg(0, 'user', 'The goal is to build a context transfer system.'),
        msg(1, 'user', 'We must use append-only storage.'),
        msg(2, 'user', 'I decided to use TypeScript.'),
      ];
      const state = extractWorkingState(PID, events);

      const allStatements = [
        ...state.objectives,
        ...state.constraints,
        ...state.decisions,
      ];

      expect(allStatements.length).toBeGreaterThanOrEqual(3);

      for (const s of allStatements) {
        expect(s.sourceEventIds.length).toBeGreaterThanOrEqual(1);
        expect(s.sourceEventIds[0]).toMatch(/^evt_/);
        expect(s.sourceSequence).toBeGreaterThanOrEqual(0);
      }
    });

    it('should link to the correct source event', () => {
      const events = [
        msg(0, 'user', 'Something neutral here without signal phrases.'),
        msg(1, 'user', 'The goal is to reduce context loss during handoffs.'),
      ];
      const state = extractWorkingState(PID, events);

      const objective = state.objectives.find((o) => o.text.includes('context loss'));
      expect(objective).toBeDefined();
      expect(objective!.sourceEventIds[0]).toBe(events[1].id);
      expect(objective!.sourceSequence).toBe(1);
    });
  });

  // ── Multi-event extraction ──────────────────────────────────

  describe('multi-event extraction', () => {
    it('should extract from a realistic conversation', () => {
      const events = [
        msg(0, 'user', 'I want to build a CLI tool that captures AI session state.'),
        msg(1, 'assistant', 'I have set up the project with four packages: cli, core, mcp, and web.'),
        msg(2, 'user', 'The system must never silently drop an event. This is a hard requirement.'),
        msg(3, 'user', "Let's use JSONL as the storage format for now."),
        msg(4, 'assistant', "Done, I have implemented the append-only JSONL ledger with hash verification."),
        msg(5, 'user', 'I tried using sqlite but it failed with compatibility issues on ARM Macs.'),
        msg(6, 'user', 'Next step is to add the MCP server for agent integration.'),
        msg(7, 'user', 'Should we support importing from multiple providers at once?'),
      ];

      const state = extractWorkingState(PID, events);

      expect(state.objectives.length).toBeGreaterThanOrEqual(1);
      expect(state.constraints.length).toBeGreaterThanOrEqual(1);
      expect(state.decisions.length).toBeGreaterThanOrEqual(1);
      expect(state.completed.length).toBeGreaterThanOrEqual(1);
      expect(state.failures.length).toBeGreaterThanOrEqual(1);
      expect(state.nextActions.length).toBeGreaterThanOrEqual(1);
      expect(state.openQuestions.length).toBeGreaterThanOrEqual(1);

      // All statements have provenance
      const all = [
        ...state.objectives, ...state.constraints, ...state.decisions,
        ...state.completed, ...state.failures, ...state.nextActions,
        ...state.openQuestions,
      ];
      for (const s of all) {
        expect(s.sourceEventIds.length).toBeGreaterThanOrEqual(1);
        expect(s.id).toMatch(/^stmt_/);
      }
    });

    it('should skip non-message events', () => {
      const events = [
        createEvent({
          type: EventTypes.SYSTEM,
          projectId: PID, sessionId: SID, sequence: 0, source: 'test', timestamp: TS,
          payload: { action: 'session_start' as const, message: 'Session started' },
        }),
        msg(1, 'user', 'The goal is to test extraction.'),
      ];
      const state = extractWorkingState(PID, events);
      expect(state.objectives.length).toBeGreaterThanOrEqual(1);
      expect(state.totalEventsProcessed).toBe(2);
    });

    it('should handle empty events array', () => {
      const state = extractWorkingState(PID, []);
      expect(state.objectives).toEqual([]);
      expect(state.constraints).toEqual([]);
      expect(state.totalEventsProcessed).toBe(0);
    });

    it('should track session IDs from events', () => {
      const events = [
        msg(0, 'user', 'The goal is to test session tracking.'),
        createEvent({
          type: EventTypes.MESSAGE,
          projectId: PID, sessionId: 'sess_other', sequence: 1, source: 'test', timestamp: TS,
          payload: { role: MessageRoles.USER, content: 'Must support multiple sessions.' },
        }),
      ];
      const state = extractWorkingState(PID, events);
      expect(state.sessionIds).toContain(SID);
      expect(state.sessionIds).toContain('sess_other');
    });
  });

  // ── Edge cases ──────────────────────────────────────────────

  describe('edge cases', () => {
    it('should skip code blocks', () => {
      const events = [
        msg(0, 'assistant', '```typescript\nconst goal is = "not a real goal";\nexport const must = true;\n```'),
      ];
      const state = extractWorkingState(PID, events);
      // Code fragments should not be extracted as objectives/constraints
      expect(state.objectives.length).toBe(0);
    });

    it('should skip very short sentences', () => {
      const events = [
        msg(0, 'user', 'OK. Yes. No. Done. The goal is to build a real application.'),
      ];
      const state = extractWorkingState(PID, events);
      // Should only pick up the long sentence
      const all = [...state.objectives, ...state.constraints, ...state.decisions];
      for (const s of all) {
        expect(s.text.length).toBeGreaterThanOrEqual(10);
      }
    });
  });
});
