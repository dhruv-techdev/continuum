/**
 * Transfer verification check types.
 *
 * Checks are generated from the project's structured state
 * and used to test whether a receiving agent has correctly
 * reconstructed the working context.
 */

import { randomUUID } from 'crypto';

export function generateCheckId(): string {
  return `chk_${randomUUID().slice(0, 12)}`;
}

// ─── Check dimensions (from product spec §9.2) ─────────────

export const CheckDimensions = {
  OBJECTIVE_ACCURACY: 'objective_accuracy',
  CONSTRAINT_RECALL: 'constraint_recall',
  DECISION_CONTINUITY: 'decision_continuity',
  PROGRESS_ACCURACY: 'progress_accuracy',
  FAILURE_AWARENESS: 'failure_awareness',
  EVIDENCE_GROUNDING: 'evidence_grounding',
  CONTRADICTION_RATE: 'contradiction_rate',
  CONTINUATION_READINESS: 'continuation_readiness',
} as const;

export type CheckDimension = (typeof CheckDimensions)[keyof typeof CheckDimensions];

// ─── Check criticality ──────────────────────────────────────

export const Criticalities = {
  CRITICAL: 'critical',
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
} as const;

export type Criticality = (typeof Criticalities)[keyof typeof Criticalities];

// ─── Check status ───────────────────────────────────────────

export const CheckStatuses = {
  PENDING: 'pending',
  PASSED: 'passed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const;

export type CheckStatus = (typeof CheckStatuses)[keyof typeof CheckStatuses];

// ─── Verification check ────────────────────────────────────

export interface VerificationCheck {
  id: string;
  dimension: CheckDimension;
  criticality: Criticality;
  /** The question or assertion to verify */
  question: string;
  /** The expected correct answer or fact */
  expectedAnswer: string;
  /** Source event IDs that support the expected answer */
  sourceEventIds: string[];
  /** Category of the source statement */
  sourceCategory: string;
  status: CheckStatus;
  /** Actual answer provided during verification (filled during scoring) */
  actualAnswer: string | null;
  /** Score 0-1 for this check (filled during scoring) */
  score: number | null;
  /** Why it passed or failed */
  explanation: string | null;
}

// ─── Verification scores (ST3) ──────────────────────────────

export interface DimensionScore {
  dimension: CheckDimension;
  label: string;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
  skippedChecks: number;
  score: number;
  target: number;
  met: boolean;
}

export interface VerificationReport {
  projectId: string;
  capsuleId: string | null;
  generatedAt: string;
  scoredAt: string | null;

  checks: VerificationCheck[];
  dimensionScores: DimensionScore[];

  /** Overall scores (ST3) */
  overallScore: number;
  completeness: number;
  correctness: number;
  groundingRate: number;
  contradictionCount: number;

  /** Verdict */
  passed: boolean;
  criticalFailures: number;
  totalChecks: number;
  passedChecks: number;
  failedChecks: number;
}
