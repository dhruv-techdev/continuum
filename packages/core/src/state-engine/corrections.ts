/**
 * User corrections for derived statements.
 *
 * Corrections create a new statement that links back to the
 * original, preserving the full correction history. The
 * original is marked superseded or rejected, never deleted.
 */

import type { WorkingState, Statement, CorrectionInput, StatementCategory } from './types';
import { StatementStatuses } from './types';
import { generateStatementId } from './extractor';

export interface CorrectionResult {
  original: Statement;
  corrected: Statement | null;
  error: string | null;
}

function findStatement(state: WorkingState, id: string): { statement: Statement; list: Statement[] } | null {
  const categories: Statement[][] = [
    state.objectives, state.requirements, state.constraints,
    state.decisions, state.nextActions, state.completed,
    state.failures, state.assumptions, state.openQuestions,
  ];

  for (const list of categories) {
    const found = list.find((s) => s.id === id);
    if (found) return { statement: found, list };
  }

  return null;
}

function getCategoryList(state: WorkingState, category: StatementCategory): Statement[] {
  const map: Record<string, Statement[]> = {
    objective: state.objectives,
    requirement: state.requirements,
    constraint: state.constraints,
    decision: state.decisions,
    next_action: state.nextActions,
    completed: state.completed,
    failure: state.failures,
    assumption: state.assumptions,
    open_question: state.openQuestions,
  };
  return map[category] ?? [];
}

/**
 * Apply a correction to a statement in the working state.
 * Mutates the state in place and returns the result.
 */
export function correctStatement(
  state: WorkingState,
  input: CorrectionInput,
): CorrectionResult {
  const match = findStatement(state, input.statementId);

  if (!match) {
    return {
      original: null as unknown as Statement,
      corrected: null,
      error: `Statement "${input.statementId}" not found.`,
    };
  }

  const { statement: original } = match;

  // Create the corrected version
  const corrected: Statement = {
    id: generateStatementId(),
    category: input.newCategory ?? original.category,
    text: input.newText ?? original.text,
    confidence: input.newConfidence ?? original.confidence,
    status: StatementStatuses.ACTIVE,
    sourceEventIds: [...original.sourceEventIds],
    sourceSequence: original.sourceSequence,
    extractedAt: new Date().toISOString(),
    replacedBy: null,
    corrects: original.id,
    correctionNote: input.note,
  };

  // Mark original as corrected
  original.status = StatementStatuses.USER_CORRECTED;
  original.replacedBy = corrected.id;
  original.correctionNote = input.note;

  // Add corrected statement to the appropriate category list
  const targetList = getCategoryList(state, corrected.category);
  targetList.push(corrected);

  return { original, corrected, error: null };
}

/**
 * Reject a statement — mark it as rejected without creating a replacement.
 */
export function rejectStatement(
  state: WorkingState,
  statementId: string,
  note: string,
): CorrectionResult {
  const match = findStatement(state, statementId);

  if (!match) {
    return {
      original: null as unknown as Statement,
      corrected: null,
      error: `Statement "${statementId}" not found.`,
    };
  }

  const { statement: original } = match;
  original.status = StatementStatuses.REJECTED;
  original.correctionNote = note;

  return { original, corrected: null, error: null };
}

/**
 * Get all active statements across all categories.
 */
export function getActiveStatements(state: WorkingState): Statement[] {
  const all = [
    ...state.objectives, ...state.requirements, ...state.constraints,
    ...state.decisions, ...state.nextActions, ...state.completed,
    ...state.failures, ...state.assumptions, ...state.openQuestions,
  ];

  return all.filter((s) => s.status === StatementStatuses.ACTIVE);
}

/**
 * Get correction history for a statement.
 */
export function getCorrectionChain(state: WorkingState, statementId: string): Statement[] {
  const all = [
    ...state.objectives, ...state.requirements, ...state.constraints,
    ...state.decisions, ...state.nextActions, ...state.completed,
    ...state.failures, ...state.assumptions, ...state.openQuestions,
  ];

  const chain: Statement[] = [];
  let currentId: string | null = statementId;

  // Walk backwards to find the original
  while (currentId) {
    const stmt = all.find((s) => s.id === currentId);
    if (!stmt) break;
    chain.unshift(stmt);
    currentId = stmt.corrects;
  }

  // Walk forwards to find replacements
  let current = all.find((s) => s.id === statementId);
  while (current?.replacedBy) {
    const next = all.find((s) => s.id === current!.replacedBy);
    if (!next) break;
    if (!chain.includes(next)) chain.push(next);
    current = next;
  }

  return chain;
}
