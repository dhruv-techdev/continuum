/**
 * Criticality-based content ranking.
 *
 * Assigns a priority score to each piece of content so that
 * when a token budget forces trimming, the most important
 * information survives. Higher score = higher priority.
 *
 * Scoring dimensions:
 *   - Category weight (objectives > constraints > decisions > …)
 *   - Confidence level (high > medium > low)
 *   - Recency (more recent = higher priority)
 *   - Status (active > superseded/corrected)
 *   - Task relevance (matching focus topic boosts score)
 */

import type { Statement } from '../state-engine/types';
import type { Decision } from '../tracking/decisions';
import type { Task } from '../tracking/tasks';
import type { Attempt } from '../tracking/attempts';

// ─── Score weights ──────────────────────────────────────────

const CATEGORY_WEIGHTS: Record<string, number> = {
  objective: 100,
  requirement: 90,
  constraint: 85,
  decision: 80,
  next_action: 75,
  failure: 70,
  completed: 40,
  assumption: 50,
  open_question: 60,
};

const CONFIDENCE_WEIGHTS: Record<string, number> = {
  high: 20,
  medium: 10,
  low: 5,
};

const STATUS_WEIGHTS: Record<string, number> = {
  active: 30,
  pending: 25,
  blocked: 20,
  completed: 10,
  superseded: 5,
  rejected: 5,
  user_corrected: 5,
  failure: 15,
  abandoned: 10,
  partial: 12,
  success: 8,
};

// ─── Scored item ────────────────────────────────────────────

export interface ScoredItem {
  id: string;
  text: string;
  score: number;
  category: string;
  sourceIds: string[];
  /** Debug breakdown */
  scoreBreakdown: {
    categoryScore: number;
    confidenceScore: number;
    statusScore: number;
    recencyScore: number;
    relevanceBoost: number;
  };
}

// ─── Score a statement ──────────────────────────────────────

function recencyScore(sequence: number, maxSequence: number): number {
  if (maxSequence <= 0) return 0;
  return Math.round((sequence / maxSequence) * 15);
}

function relevanceBoost(text: string, focusTopic?: string): number {
  if (!focusTopic) return 0;
  const lower = text.toLowerCase();
  const topic = focusTopic.toLowerCase();

  if (lower.includes(topic)) return 25;

  // Partial word matching
  const words = topic.split(/\s+/);
  const matches = words.filter((w) => lower.includes(w)).length;
  if (matches > 0) return Math.round((matches / words.length) * 15);

  return 0;
}

export function scoreStatement(
  stmt: Statement,
  maxSequence: number,
  focusTopic?: string,
): ScoredItem {
  const categoryScore = CATEGORY_WEIGHTS[stmt.category] ?? 30;
  const confidenceScore = CONFIDENCE_WEIGHTS[stmt.confidence] ?? 5;
  const statusScore = STATUS_WEIGHTS[stmt.status] ?? 10;
  const recency = recencyScore(stmt.sourceSequence, maxSequence);
  const boost = relevanceBoost(stmt.text, focusTopic);

  return {
    id: stmt.id,
    text: stmt.text,
    score: categoryScore + confidenceScore + statusScore + recency + boost,
    category: stmt.category,
    sourceIds: stmt.sourceEventIds,
    scoreBreakdown: {
      categoryScore,
      confidenceScore,
      statusScore,
      recencyScore: recency,
      relevanceBoost: boost,
    },
  };
}

export function scoreDecision(dec: Decision, focusTopic?: string): ScoredItem {
  const categoryScore = CATEGORY_WEIGHTS.decision;
  const statusScore = STATUS_WEIGHTS[dec.status] ?? 10;
  const boost = relevanceBoost(dec.choice, focusTopic);

  return {
    id: dec.id,
    text: `Decision: ${dec.choice}${dec.rationale ? ' — ' + dec.rationale : ''}`,
    score: categoryScore + statusScore + boost,
    category: 'decision',
    sourceIds: dec.sourceEventIds,
    scoreBreakdown: { categoryScore, confidenceScore: 0, statusScore, recencyScore: 0, relevanceBoost: boost },
  };
}

export function scoreTask(task: Task, focusTopic?: string): ScoredItem {
  const base = task.status === 'active' || task.status === 'blocked' ? 75 : 40;
  const statusScore = STATUS_WEIGHTS[task.status] ?? 10;
  const boost = relevanceBoost(task.description, focusTopic);

  return {
    id: task.id,
    text: `[${task.status}] ${task.description}`,
    score: base + statusScore + boost,
    category: 'task',
    sourceIds: task.sourceEventIds,
    scoreBreakdown: { categoryScore: base, confidenceScore: 0, statusScore, recencyScore: 0, relevanceBoost: boost },
  };
}

export function scoreAttempt(att: Attempt, focusTopic?: string): ScoredItem {
  const base = att.outcome === 'failure' || att.outcome === 'abandoned' ? 70 : 30;
  const statusScore = STATUS_WEIGHTS[att.outcome] ?? 10;
  const boost = relevanceBoost(att.approach, focusTopic);

  return {
    id: att.id,
    text: `[${att.outcome}] ${att.approach}${att.failureReason ? ': ' + att.failureReason : ''}`,
    score: base + statusScore + boost,
    category: 'attempt',
    sourceIds: att.sourceEventIds,
    scoreBreakdown: { categoryScore: base, confidenceScore: 0, statusScore, recencyScore: 0, relevanceBoost: boost },
  };
}

// ─── Rank all items together ────────────────────────────────

export function rankItems(items: ScoredItem[]): ScoredItem[] {
  return [...items].sort((a, b) => b.score - a.score);
}

/**
 * Select items that fit within a token budget.
 * Items are selected in priority order until the budget is exhausted.
 */
export function selectByBudget(
  ranked: ScoredItem[],
  tokenBudget: number,
  charsPerToken = 4,
): { selected: ScoredItem[]; excluded: ScoredItem[]; tokensUsed: number } {
  const selected: ScoredItem[] = [];
  const excluded: ScoredItem[] = [];
  let tokensUsed = 0;

  for (const item of ranked) {
    const itemTokens = Math.ceil(item.text.length / charsPerToken);

    if (tokenBudget > 0 && tokensUsed + itemTokens > tokenBudget) {
      excluded.push(item);
    } else {
      selected.push(item);
      tokensUsed += itemTokens;
    }
  }

  return { selected, excluded, tokensUsed };
}
