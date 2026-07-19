/**
 * Evidence-linked structured state model.
 *
 * Every statement tracks:
 *   - Category (ST1): what kind of information it is
 *   - Confidence (ST2): how certain the extraction is
 *   - Status (ST2): whether it's active, superseded, or corrected
 *   - Source IDs (ST2): which events it was derived from
 */

// ─── Statement categories (ST1) ─────────────────────────────

export const StatementCategories = {
  OBJECTIVE: 'objective',
  REQUIREMENT: 'requirement',
  CONSTRAINT: 'constraint',
  DECISION: 'decision',
  NEXT_ACTION: 'next_action',
  COMPLETED: 'completed',
  FAILURE: 'failure',
  ASSUMPTION: 'assumption',
  OPEN_QUESTION: 'open_question',
} as const;

export type StatementCategory = (typeof StatementCategories)[keyof typeof StatementCategories];

export const VALID_CATEGORIES: readonly StatementCategory[] = Object.values(StatementCategories);

// ─── Confidence (ST2) ───────────────────────────────────────

export const ConfidenceLevels = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
} as const;

export type ConfidenceLevel = (typeof ConfidenceLevels)[keyof typeof ConfidenceLevels];

// ─── Statement status (ST2) ─────────────────────────────────

export const StatementStatuses = {
  ACTIVE: 'active',
  SUPERSEDED: 'superseded',
  REJECTED: 'rejected',
  USER_CORRECTED: 'user_corrected',
} as const;

export type StatementStatus = (typeof StatementStatuses)[keyof typeof StatementStatuses];

// ─── Statement (ST1 + ST2) ──────────────────────────────────

export interface Statement {
  id: string;
  category: StatementCategory;
  text: string;
  confidence: ConfidenceLevel;
  status: StatementStatus;
  /** Event IDs this statement was derived from (ST2) */
  sourceEventIds: string[];
  /** Sequence number of the primary source event */
  sourceSequence: number;
  /** ISO timestamp of extraction */
  extractedAt: string;
  /** If superseded or corrected, the ID of the replacing statement */
  replacedBy: string | null;
  /** If this is a correction, the ID of the statement it corrects */
  corrects: string | null;
  /** User-provided note on why this was corrected/rejected */
  correctionNote: string | null;
}

// ─── Working state ──────────────────────────────────────────

export interface WorkingState {
  projectId: string;
  sessionIds: string[];
  extractedAt: string;
  totalEventsProcessed: number;
  /** Schema version for forward compatibility */
  stateVersion: number;

  objectives: Statement[];
  requirements: Statement[];
  constraints: Statement[];
  decisions: Statement[];
  nextActions: Statement[];
  completed: Statement[];
  failures: Statement[];
  assumptions: Statement[];
  openQuestions: Statement[];
}

// ─── Bootstrap context layers ───────────────────────────────

export interface BootstrapContext {
  orientation: string;
  activeState: string;
  governingContext: string;
  combined: string;
  statementCount: number;
  eventsCovered: number;
  generatedAt: string;
}

// ─── Correction input ───────────────────────────────────────

export interface CorrectionInput {
  /** ID of the statement to correct */
  statementId: string;
  /** New text (if correcting content) */
  newText?: string;
  /** New category (if reclassifying) */
  newCategory?: StatementCategory;
  /** New confidence */
  newConfidence?: ConfidenceLevel;
  /** Reason for correction */
  note: string;
}
