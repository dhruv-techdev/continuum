/**
 * Generate verification checks from structured project state.
 *
 * ST1: Checks from objectives and constraints
 * ST2: Checks from decisions, progress, and failures
 */

import type { WorkingState, Statement } from '../state-engine/types';
import type { Decision } from '../tracking/decisions';
import type { Task } from '../tracking/tasks';
import type { Attempt } from '../tracking/attempts';
import {
  generateCheckId,
  CheckDimensions,
  Criticalities,
  CheckStatuses,
} from './types';
import type {
  VerificationCheck,
  CheckDimension,
  Criticality,
} from './types';

// ─── Helpers ────────────────────────────────────────────────

function createCheck(
  dimension: CheckDimension,
  criticality: Criticality,
  question: string,
  expectedAnswer: string,
  sourceEventIds: string[],
  sourceCategory: string,
): VerificationCheck {
  return {
    id: generateCheckId(),
    dimension,
    criticality,
    question,
    expectedAnswer,
    sourceEventIds,
    sourceCategory,
    status: CheckStatuses.PENDING,
    actualAnswer: null,
    score: null,
    explanation: null,
  };
}

function truncate(text: string, max = 200): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

// ─── ST1: Objective checks ──────────────────────────────────

function generateObjectiveChecks(state: WorkingState): VerificationCheck[] {
  const checks: VerificationCheck[] = [];
  const objectives = state.objectives.filter((s) => s.status === 'active');

  for (const obj of objectives) {
    checks.push(createCheck(
      CheckDimensions.OBJECTIVE_ACCURACY,
      Criticalities.CRITICAL,
      'What is the primary objective or goal of this project?',
      truncate(obj.text),
      obj.sourceEventIds,
      'objective',
    ));
  }

  if (objectives.length === 0) {
    checks.push(createCheck(
      CheckDimensions.OBJECTIVE_ACCURACY,
      Criticalities.HIGH,
      'Can you describe what this project is about and what it aims to achieve?',
      'No explicit objective was extracted, but the project context should give enough information to infer the purpose.',
      [],
      'objective',
    ));
  }

  return checks;
}

// ─── ST1: Constraint checks ─────────────────────────────────

function generateConstraintChecks(state: WorkingState): VerificationCheck[] {
  const checks: VerificationCheck[] = [];

  const constraints = state.constraints.filter((s) => s.status === 'active');
  const requirements = (state.requirements ?? []).filter((s) => s.status === 'active');

  for (const c of constraints) {
    checks.push(createCheck(
      CheckDimensions.CONSTRAINT_RECALL,
      Criticalities.CRITICAL,
      `What constraints or prohibitions apply to this project? Specifically, are you aware of: "${truncate(c.text, 80)}"?`,
      truncate(c.text),
      c.sourceEventIds,
      'constraint',
    ));
  }

  for (const r of requirements) {
    checks.push(createCheck(
      CheckDimensions.CONSTRAINT_RECALL,
      Criticalities.HIGH,
      `What are the requirements for this project? Specifically: "${truncate(r.text, 80)}"?`,
      truncate(r.text),
      r.sourceEventIds,
      'requirement',
    ));
  }

  return checks;
}

// ─── ST2: Decision checks ───────────────────────────────────

function generateDecisionChecks(
  state: WorkingState,
  decisions: Decision[],
): VerificationCheck[] {
  const checks: VerificationCheck[] = [];

  // From tracked decisions
  const activeDecisions = decisions.filter((d) => d.status === 'active');

  for (const d of activeDecisions) {
    checks.push(createCheck(
      CheckDimensions.DECISION_CONTINUITY,
      Criticalities.HIGH,
      `What decision was made regarding: "${truncate(d.choice, 60)}"? What was the rationale?`,
      `Decision: ${d.choice}. Rationale: ${d.rationale || 'not stated'}. Alternatives considered: ${d.alternatives.join(', ') || 'none recorded'}.`,
      d.sourceEventIds,
      'decision',
    ));
  }

  // From extracted state decisions
  const stateDecisions = state.decisions.filter((s) => s.status === 'active');
  for (const d of stateDecisions) {
    // Avoid duplicating checks if the decision is also in the tracker
    const alreadyCovered = activeDecisions.some(
      (ad) => d.text.toLowerCase().includes(ad.choice.toLowerCase().slice(0, 20)),
    );
    if (alreadyCovered) continue;

    checks.push(createCheck(
      CheckDimensions.DECISION_CONTINUITY,
      Criticalities.MEDIUM,
      `Are you aware of this decision: "${truncate(d.text, 80)}"?`,
      truncate(d.text),
      d.sourceEventIds,
      'decision',
    ));
  }

  // Rejected decisions (should NOT be repeated)
  const rejectedDecisions = decisions.filter((d) => d.status === 'rejected');
  for (const d of rejectedDecisions) {
    checks.push(createCheck(
      CheckDimensions.DECISION_CONTINUITY,
      Criticalities.MEDIUM,
      `Was "${truncate(d.choice, 60)}" adopted or rejected? Why?`,
      `REJECTED. Reason: ${d.rejectionReason ?? 'not stated'}.`,
      d.sourceEventIds,
      'decision_rejected',
    ));
  }

  return checks;
}

// ─── ST2: Progress checks ───────────────────────────────────

function generateProgressChecks(
  state: WorkingState,
  tasks: Task[],
): VerificationCheck[] {
  const checks: VerificationCheck[] = [];

  const completed = tasks.filter((t) => t.status === 'completed');
  const active = tasks.filter((t) => t.status === 'active');
  const blocked = tasks.filter((t) => t.status === 'blocked');
  const pending = tasks.filter((t) => t.status === 'pending');

  // Overall progress
  if (tasks.length > 0) {
    checks.push(createCheck(
      CheckDimensions.PROGRESS_ACCURACY,
      Criticalities.HIGH,
      'How many tasks are completed, active, blocked, and pending?',
      `Completed: ${completed.length}, Active: ${active.length}, Blocked: ${blocked.length}, Pending: ${pending.length}. Total: ${tasks.length}.`,
      [],
      'progress',
    ));
  }

  // Specific blocked items
  for (const t of blocked) {
    checks.push(createCheck(
      CheckDimensions.PROGRESS_ACCURACY,
      Criticalities.HIGH,
      `What is blocking the task "${truncate(t.description, 60)}"?`,
      `Blocked because: ${t.blockedReason ?? 'reason not stated'}.`,
      t.sourceEventIds,
      'task_blocked',
    ));
  }

  // Next actions
  const nextActions = state.nextActions.filter((s) => s.status === 'active');
  if (nextActions.length > 0) {
    checks.push(createCheck(
      CheckDimensions.CONTINUATION_READINESS,
      Criticalities.CRITICAL,
      'What is the next action or step to take in this project?',
      nextActions.map((n) => truncate(n.text)).join('; '),
      nextActions.flatMap((n) => n.sourceEventIds),
      'next_action',
    ));
  }

  return checks;
}

// ─── ST2: Failure checks ────────────────────────────────────

function generateFailureChecks(
  state: WorkingState,
  attempts: Attempt[],
): VerificationCheck[] {
  const checks: VerificationCheck[] = [];

  const failed = attempts.filter((a) => a.outcome === 'failure' || a.outcome === 'abandoned');

  for (const a of failed) {
    checks.push(createCheck(
      CheckDimensions.FAILURE_AWARENESS,
      Criticalities.HIGH,
      `Has "${truncate(a.approach, 60)}" been tried before? What happened?`,
      `YES — it was tried and ${a.outcome}. Reason: ${a.failureReason ?? 'not stated'}. Learned: ${a.observations || 'nothing recorded'}.`,
      a.sourceEventIds,
      'attempt_failed',
    ));
  }

  // From extracted state failures
  const stateFailures = state.failures.filter((s) => s.status === 'active');
  for (const f of stateFailures) {
    const alreadyCovered = failed.some(
      (a) => f.text.toLowerCase().includes(a.approach.toLowerCase().slice(0, 20)),
    );
    if (alreadyCovered) continue;

    checks.push(createCheck(
      CheckDimensions.FAILURE_AWARENESS,
      Criticalities.MEDIUM,
      `Are you aware of this failure: "${truncate(f.text, 80)}"?`,
      truncate(f.text),
      f.sourceEventIds,
      'failure',
    ));
  }

  return checks;
}

// ─── Evidence grounding checks ──────────────────────────────

function generateGroundingChecks(state: WorkingState): VerificationCheck[] {
  const checks: VerificationCheck[] = [];

  // Pick a sample of critical statements and check if sources can be cited
  const critical = [
    ...state.objectives.filter((s) => s.status === 'active'),
    ...state.constraints.filter((s) => s.status === 'active'),
    ...(state.requirements ?? []).filter((s) => s.status === 'active'),
  ];

  const sample = critical.slice(0, 5);

  for (const stmt of sample) {
    if (stmt.sourceEventIds.length > 0) {
      checks.push(createCheck(
        CheckDimensions.EVIDENCE_GROUNDING,
        Criticalities.HIGH,
        `Can you cite the source event for: "${truncate(stmt.text, 80)}"? The event ID should be: ${stmt.sourceEventIds[0]}`,
        `Source event: ${stmt.sourceEventIds[0]}`,
        stmt.sourceEventIds,
        stmt.category,
      ));
    }
  }

  return checks;
}

// ─── Continuation readiness ─────────────────────────────────

function generateContinuationChecks(state: WorkingState): VerificationCheck[] {
  const checks: VerificationCheck[] = [];

  const openQuestions = state.openQuestions.filter((s) => s.status === 'active');
  if (openQuestions.length > 0) {
    checks.push(createCheck(
      CheckDimensions.CONTINUATION_READINESS,
      Criticalities.MEDIUM,
      'What open questions remain unresolved in this project?',
      openQuestions.map((q) => truncate(q.text)).join('; '),
      openQuestions.flatMap((q) => q.sourceEventIds),
      'open_question',
    ));
  }

  const assumptions = state.assumptions.filter((s) => s.status === 'active');
  if (assumptions.length > 0) {
    checks.push(createCheck(
      CheckDimensions.CONTINUATION_READINESS,
      Criticalities.MEDIUM,
      'What assumptions is this project operating under?',
      assumptions.map((a) => truncate(a.text)).join('; '),
      assumptions.flatMap((a) => a.sourceEventIds),
      'assumption',
    ));
  }

  return checks;
}

// ─── Generate all checks ───────────────────────────────────

export interface GenerateChecksInput {
  state: WorkingState;
  decisions: Decision[];
  tasks: Task[];
  attempts: Attempt[];
}

export function generateChecks(input: GenerateChecksInput): VerificationCheck[] {
  const { state, decisions, tasks, attempts } = input;

  return [
    ...generateObjectiveChecks(state),
    ...generateConstraintChecks(state),
    ...generateDecisionChecks(state, decisions),
    ...generateProgressChecks(state, tasks),
    ...generateFailureChecks(state, attempts),
    ...generateGroundingChecks(state),
    ...generateContinuationChecks(state),
  ];
}
