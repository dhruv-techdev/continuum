import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  // Models (ST1)
  MODEL_PRESETS, getModelPreset, getUsableBudget, listPresetIds,
  // Ranker (ST2)
  scoreStatement, scoreDecision, scoreTask, scoreAttempt,
  rankItems, selectByBudget,
  // Dedup (ST3)
  deduplicateItems, formatDeduplicatedItem,
  // Helpers
  StatementStatuses, StatementCategories, ConfidenceLevels,
  DecisionStatuses, TaskStatuses, AttemptOutcomes,
} from '../src/index';
import type { Statement, Decision, Task, Attempt, ScoredItem } from '../src/index';

// ─── ST1: Model presets ─────────────────────────────────────

describe('ST1 — model presets', () => {
  it('should have presets for major providers', () => {
    expect(getModelPreset('claude-sonnet')).not.toBeNull();
    expect(getModelPreset('gpt-4o')).not.toBeNull();
    expect(getModelPreset('gemini-pro')).not.toBeNull();
    expect(getModelPreset('llama-70b')).not.toBeNull();
  });

  it('should have size-based presets', () => {
    expect(getModelPreset('small')).not.toBeNull();
    expect(getModelPreset('medium')).not.toBeNull();
    expect(getModelPreset('large')).not.toBeNull();
  });

  it('should calculate usable budget correctly', () => {
    const preset = getModelPreset('claude-sonnet')!;
    expect(preset.usableBudget).toBe(preset.contextWindow - preset.systemReserve - preset.responseReserve);
    expect(preset.usableBudget).toBeGreaterThan(0);
  });

  it('should return null for unknown model', () => {
    expect(getModelPreset('nonexistent-model')).toBeNull();
  });

  it('should be case-insensitive', () => {
    expect(getModelPreset('Claude-Sonnet')).not.toBeNull();
    expect(getModelPreset('GPT-4O')).not.toBeNull();
  });

  it('should list all preset IDs', () => {
    const ids = listPresetIds();
    expect(ids.length).toBeGreaterThanOrEqual(10);
    expect(ids).toContain('claude-sonnet');
    expect(ids).toContain('gpt-4o');
  });

  it('should compute usable budget from raw values', () => {
    expect(getUsableBudget(128000, 2000, 4096)).toBe(121904);
    expect(getUsableBudget(8192, 500, 2048)).toBe(5644);
    expect(getUsableBudget(100, 50, 60)).toBe(0); // clamped to 0
  });

  it('should have small < medium < large budgets', () => {
    const small = getModelPreset('small')!.usableBudget;
    const medium = getModelPreset('medium')!.usableBudget;
    const large = getModelPreset('large')!.usableBudget;
    expect(small).toBeLessThan(medium);
    expect(medium).toBeLessThan(large);
  });
});

// ─── ST2: Criticality ranking ───────────────────────────────

describe('ST2 — criticality ranking', () => {
  function makeStatement(overrides: Partial<Statement> = {}): Statement {
    return {
      id: 'stmt_test',
      category: StatementCategories.OBJECTIVE,
      text: 'Test statement',
      confidence: ConfidenceLevels.HIGH,
      status: StatementStatuses.ACTIVE,
      sourceEventIds: ['evt_1'],
      sourceSequence: 5,
      extractedAt: new Date().toISOString(),
      replacedBy: null,
      corrects: null,
      correctionNote: null,
      ...overrides,
    };
  }

  describe('scoreStatement()', () => {
    it('should score objectives higher than completed work', () => {
      const obj = scoreStatement(makeStatement({ category: StatementCategories.OBJECTIVE }), 10);
      const comp = scoreStatement(makeStatement({ category: StatementCategories.COMPLETED }), 10);
      expect(obj.score).toBeGreaterThan(comp.score);
    });

    it('should score constraints higher than assumptions', () => {
      const constraint = scoreStatement(makeStatement({ category: StatementCategories.CONSTRAINT }), 10);
      const assumption = scoreStatement(makeStatement({ category: StatementCategories.ASSUMPTION }), 10);
      expect(constraint.score).toBeGreaterThan(assumption.score);
    });

    it('should score high confidence higher than low', () => {
      const high = scoreStatement(makeStatement({ confidence: ConfidenceLevels.HIGH }), 10);
      const low = scoreStatement(makeStatement({ confidence: ConfidenceLevels.LOW }), 10);
      expect(high.score).toBeGreaterThan(low.score);
    });

    it('should score active higher than superseded', () => {
      const active = scoreStatement(makeStatement({ status: StatementStatuses.ACTIVE }), 10);
      const superseded = scoreStatement(makeStatement({ status: StatementStatuses.SUPERSEDED }), 10);
      expect(active.score).toBeGreaterThan(superseded.score);
    });

    it('should boost score for recent events', () => {
      const recent = scoreStatement(makeStatement({ sourceSequence: 10 }), 10);
      const old = scoreStatement(makeStatement({ sourceSequence: 1 }), 10);
      expect(recent.score).toBeGreaterThan(old.score);
    });

    it('should boost score when focus topic matches', () => {
      const matching = scoreStatement(makeStatement({ text: 'Use JSONL for storage' }), 10, 'JSONL');
      const nonMatching = scoreStatement(makeStatement({ text: 'Use JSONL for storage' }), 10);
      expect(matching.score).toBeGreaterThan(nonMatching.score);
    });

    it('should include score breakdown', () => {
      const scored = scoreStatement(makeStatement(), 10, 'test');
      expect(scored.scoreBreakdown).toHaveProperty('categoryScore');
      expect(scored.scoreBreakdown).toHaveProperty('confidenceScore');
      expect(scored.scoreBreakdown).toHaveProperty('statusScore');
      expect(scored.scoreBreakdown).toHaveProperty('recencyScore');
      expect(scored.scoreBreakdown).toHaveProperty('relevanceBoost');
    });
  });

  describe('scoreDecision()', () => {
    it('should score active decisions higher than rejected', () => {
      const active: Decision = { id: 'd1', projectId: 'p', choice: 'JSONL', rationale: '', alternatives: [], rejectionReason: null, supersededBy: null, status: DecisionStatuses.ACTIVE, sourceEventIds: [], createdAt: '', updatedAt: '' };
      const rejected: Decision = { ...active, id: 'd2', status: DecisionStatuses.REJECTED };

      expect(scoreDecision(active).score).toBeGreaterThan(scoreDecision(rejected).score);
    });
  });

  describe('scoreTask()', () => {
    it('should score active/blocked tasks higher than completed', () => {
      const active: Task = { id: 't1', projectId: 'p', description: 'Build MCP', status: TaskStatuses.ACTIVE, dependencies: [], blockedReason: null, completionNote: null, sourceEventIds: [], createdAt: '', updatedAt: '', completedAt: null };
      const completed: Task = { ...active, id: 't2', status: TaskStatuses.COMPLETED };

      expect(scoreTask(active).score).toBeGreaterThan(scoreTask(completed).score);
    });
  });

  describe('scoreAttempt()', () => {
    it('should score failures higher than successes (they need to be remembered)', () => {
      const failure: Attempt = { id: 'a1', projectId: 'p', approach: 'SQLite', outcome: AttemptOutcomes.FAILURE, failureReason: 'ARM', observations: '', relatedId: null, sourceEventIds: [], createdAt: '' };
      const success: Attempt = { ...failure, id: 'a2', outcome: AttemptOutcomes.SUCCESS };

      expect(scoreAttempt(failure).score).toBeGreaterThan(scoreAttempt(success).score);
    });
  });

  describe('rankItems()', () => {
    it('should sort by score descending', () => {
      const items: ScoredItem[] = [
        { id: '1', text: 'low', score: 10, category: 'a', sourceIds: [], scoreBreakdown: { categoryScore: 10, confidenceScore: 0, statusScore: 0, recencyScore: 0, relevanceBoost: 0 } },
        { id: '2', text: 'high', score: 100, category: 'a', sourceIds: [], scoreBreakdown: { categoryScore: 100, confidenceScore: 0, statusScore: 0, recencyScore: 0, relevanceBoost: 0 } },
        { id: '3', text: 'mid', score: 50, category: 'a', sourceIds: [], scoreBreakdown: { categoryScore: 50, confidenceScore: 0, statusScore: 0, recencyScore: 0, relevanceBoost: 0 } },
      ];

      const ranked = rankItems(items);
      expect(ranked[0].id).toBe('2');
      expect(ranked[1].id).toBe('3');
      expect(ranked[2].id).toBe('1');
    });
  });

  describe('selectByBudget()', () => {
    it('should select items within budget', () => {
      const items: ScoredItem[] = [
        { id: '1', text: 'a'.repeat(100), score: 100, category: 'a', sourceIds: [], scoreBreakdown: { categoryScore: 100, confidenceScore: 0, statusScore: 0, recencyScore: 0, relevanceBoost: 0 } },
        { id: '2', text: 'b'.repeat(100), score: 80, category: 'a', sourceIds: [], scoreBreakdown: { categoryScore: 80, confidenceScore: 0, statusScore: 0, recencyScore: 0, relevanceBoost: 0 } },
        { id: '3', text: 'c'.repeat(100), score: 60, category: 'a', sourceIds: [], scoreBreakdown: { categoryScore: 60, confidenceScore: 0, statusScore: 0, recencyScore: 0, relevanceBoost: 0 } },
      ];

      const { selected, excluded } = selectByBudget(items, 60);

      expect(selected.length).toBeLessThan(3);
      expect(excluded.length).toBeGreaterThan(0);
      // Highest priority items should be selected
      expect(selected[0].id).toBe('1');
    });

    it('should select all when budget is unlimited', () => {
      const items: ScoredItem[] = [
        { id: '1', text: 'test', score: 100, category: 'a', sourceIds: [], scoreBreakdown: { categoryScore: 100, confidenceScore: 0, statusScore: 0, recencyScore: 0, relevanceBoost: 0 } },
      ];

      const { selected, excluded } = selectByBudget(items, 0);
      expect(selected).toHaveLength(1);
      expect(excluded).toHaveLength(0);
    });
  });
});

// ─── ST3: Deduplication ─────────────────────────────────────

describe('ST3 — deduplication', () => {
  describe('deduplicateItems()', () => {
    it('should merge exact duplicates', () => {
      const items: ScoredItem[] = [
        { id: 'a', text: 'Use JSONL for the ledger format.', score: 100, category: 'decision', sourceIds: ['evt_1'], scoreBreakdown: { categoryScore: 80, confidenceScore: 20, statusScore: 0, recencyScore: 0, relevanceBoost: 0 } },
        { id: 'b', text: 'Use JSONL for the ledger format.', score: 80, category: 'decision', sourceIds: ['evt_2'], scoreBreakdown: { categoryScore: 80, confidenceScore: 0, statusScore: 0, recencyScore: 0, relevanceBoost: 0 } },
      ];

      const result = deduplicateItems(items);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('a'); // highest scored kept
      expect(result[0].mergedCount).toBe(1);
      expect(result[0].allSourceIds).toContain('evt_1');
      expect(result[0].allSourceIds).toContain('evt_2');
    });

    it('should merge similar text (after normalization)', () => {
      const items: ScoredItem[] = [
        { id: 'a', text: 'The system must preserve all events without modification.', score: 100, category: 'constraint', sourceIds: ['evt_1'], scoreBreakdown: { categoryScore: 85, confidenceScore: 15, statusScore: 0, recencyScore: 0, relevanceBoost: 0 } },
        { id: 'b', text: 'the system must preserve all events without modification', score: 80, category: 'constraint', sourceIds: ['evt_3'], scoreBreakdown: { categoryScore: 85, confidenceScore: 0, statusScore: 0, recencyScore: 0, relevanceBoost: 0 } },
      ];

      const result = deduplicateItems(items);
      expect(result).toHaveLength(1);
      expect(result[0].allSourceIds).toHaveLength(2);
    });

    it('should NOT merge genuinely different items', () => {
      const items: ScoredItem[] = [
        { id: 'a', text: 'Use JSONL for the primary ledger format.', score: 100, category: 'decision', sourceIds: ['evt_1'], scoreBreakdown: { categoryScore: 80, confidenceScore: 20, statusScore: 0, recencyScore: 0, relevanceBoost: 0 } },
        { id: 'b', text: 'Build the MCP server for agent integration.', score: 80, category: 'task', sourceIds: ['evt_2'], scoreBreakdown: { categoryScore: 75, confidenceScore: 5, statusScore: 0, recencyScore: 0, relevanceBoost: 0 } },
      ];

      const result = deduplicateItems(items);
      expect(result).toHaveLength(2);
    });

    it('should handle empty input', () => {
      expect(deduplicateItems([])).toHaveLength(0);
    });

    it('should handle single item', () => {
      const items: ScoredItem[] = [
        { id: 'a', text: 'Only item', score: 50, category: 'x', sourceIds: ['e1'], scoreBreakdown: { categoryScore: 50, confidenceScore: 0, statusScore: 0, recencyScore: 0, relevanceBoost: 0 } },
      ];
      const result = deduplicateItems(items);
      expect(result).toHaveLength(1);
      expect(result[0].mergedCount).toBe(0);
    });

    it('should merge substring matches', () => {
      const items: ScoredItem[] = [
        { id: 'a', text: 'The system must preserve all events without modification and ensure ordering is maintained.', score: 100, category: 'c', sourceIds: ['e1'], scoreBreakdown: { categoryScore: 85, confidenceScore: 15, statusScore: 0, recencyScore: 0, relevanceBoost: 0 } },
        { id: 'b', text: 'The system must preserve all events without modification.', score: 80, category: 'c', sourceIds: ['e2'], scoreBreakdown: { categoryScore: 85, confidenceScore: 0, statusScore: 0, recencyScore: 0, relevanceBoost: 0 } },
      ];

      const result = deduplicateItems(items);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('a'); // longer version kept (higher score)
    });
  });

  describe('formatDeduplicatedItem()', () => {
    it('should show merge count when duplicates exist', () => {
      const item = {
        id: 'a', text: 'Use JSONL.', score: 100, category: 'decision',
        sourceIds: ['e1'], mergedCount: 2, allSourceIds: ['e1', 'e2', 'e3'],
        scoreBreakdown: { categoryScore: 80, confidenceScore: 20, statusScore: 0, recencyScore: 0, relevanceBoost: 0 },
      };

      const formatted = formatDeduplicatedItem(item);
      expect(formatted).toContain('[3 sources]');
      expect(formatted).toContain('refs:');
    });

    it('should not show merge indicator for single-source items', () => {
      const item = {
        id: 'a', text: 'Unique item.', score: 50, category: 'x',
        sourceIds: ['e1'], mergedCount: 0, allSourceIds: ['e1'],
        scoreBreakdown: { categoryScore: 50, confidenceScore: 0, statusScore: 0, recencyScore: 0, relevanceBoost: 0 },
      };

      const formatted = formatDeduplicatedItem(item);
      expect(formatted).not.toContain('sources');
    });
  });
});
