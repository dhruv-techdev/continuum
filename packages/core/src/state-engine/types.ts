/**
 * Working state model for Continuum.
 *
 * Every statement is evidence-linked: it carries the IDs of the
 * source events it was derived from. No statement exists without
 * provenance (ST2).
 */

// ─── Statement categories (ST1) ─────────────────────────────

export const StatementCategories = {
  OBJECTIVE: 'objective',
  CONSTRAINT: 'constraint',
  DECISION: 'decision',
  NEXT_ACTION: 'next_action',
  COMPLETED: 'completed',
  FAILURE: 'failure',
  ASSUMPTION: 'assumption',
  OPEN_QUESTION: 'open_question',
} as const;

export type StatementCategory = (typeof StatementCategories)[keyof typeof StatementCategories];

// ─── Confidence ─────────────────────────────────────────────

export const ConfidenceLevels = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
} as const;

export type ConfidenceLevel = (typeof ConfidenceLevels)[keyof typeof ConfidenceLevels];

// ─── Statement (ST2 — every statement links to sources) ─────

export interface Statement {
  id: string;
  category: StatementCategory;
  text: string;
  confidence: ConfidenceLevel;
  /** Event IDs this statement was derived from (ST2) */
  sourceEventIds: string[];
  /** Sequence number of the primary source event */
  sourceSequence: number;
  /** ISO timestamp of extraction */
  extractedAt: string;
}

// ─── Working state (ST1) ────────────────────────────────────

export interface WorkingState {
  projectId: string;
  sessionIds: string[];
  extractedAt: string;
  totalEventsProcessed: number;

  /** Primary goal of the project/conversation */
  objectives: Statement[];
  /** Hard requirements and prohibitions */
  constraints: Statement[];
  /** Choices made (active decisions) */
  decisions: Statement[];
  /** Immediate next steps */
  nextActions: Statement[];
  /** Work already completed */
  completed: Statement[];
  /** Approaches that failed */
  failures: Statement[];
  /** Things assumed to be true */
  assumptions: Statement[];
  /** Unresolved questions */
  openQuestions: Statement[];
}

// ─── Bootstrap context layers (ST3) ─────────────────────────

export interface BootstrapContext {
  /** L0 — Project identity and one-paragraph purpose */
  orientation: string;
  /** L1 — Objective, current task, progress, blockers, next actions */
  activeState: string;
  /** L2 — Constraints, confirmed decisions, rejected paths */
  governingContext: string;
  /** Full combined text for injection into a prompt */
  combined: string;
  /** Metadata */
  statementCount: number;
  eventsCovered: number;
  generatedAt: string;
}
