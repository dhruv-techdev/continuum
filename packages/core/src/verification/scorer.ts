/**
 * Verification scoring.
 *
 * ST3: Scores correctness, completeness, grounding, and contradictions.
 *
 * In Phase 1, scoring is deterministic: it checks whether the
 * expected answer's key terms appear in the actual answer.
 * Model-graded evaluation will be added in a later phase.
 */

import {
  CheckDimensions,
  CheckStatuses,
  Criticalities,
} from './types';
import type {
  VerificationCheck,
  VerificationReport,
  DimensionScore,
  CheckDimension,
} from './types';

// ─── Deterministic scoring ──────────────────────────────────

/**
 * Score a single check by comparing actual answer to expected.
 * Returns a score between 0 and 1.
 */
export function scoreCheck(check: VerificationCheck): number {
  if (!check.actualAnswer || check.actualAnswer.trim().length === 0) {
    return 0;
  }

  const expected = check.expectedAnswer.toLowerCase();
  const actual = check.actualAnswer.toLowerCase();

  // Extract key terms from expected answer (words > 3 chars)
  const expectedWords = new Set(
    expected.split(/\W+/).filter((w) => w.length > 3),
  );

  if (expectedWords.size === 0) return actual.length > 0 ? 0.5 : 0;

  // Count how many key terms appear in the actual answer
  let matches = 0;
  for (const word of expectedWords) {
    if (actual.includes(word)) matches++;
  }

  const ratio = matches / expectedWords.size;

  // Bonus for substantial overlap
  if (ratio >= 0.8) return 1.0;
  if (ratio >= 0.6) return 0.8;
  if (ratio >= 0.4) return 0.6;
  if (ratio >= 0.2) return 0.4;
  if (ratio > 0) return 0.2;

  return 0;
}

/**
 * Apply scores to a set of checks and update their status.
 */
export function scoreChecks(
  checks: VerificationCheck[],
  answers: Map<string, string>,
): VerificationCheck[] {
  for (const check of checks) {
    const answer = answers.get(check.id);

    if (answer === undefined) {
      check.status = CheckStatuses.SKIPPED;
      check.score = null;
      check.explanation = 'No answer provided.';
      continue;
    }

    check.actualAnswer = answer;
    const score = scoreCheck(check);
    check.score = score;

    const threshold = check.criticality === Criticalities.CRITICAL ? 0.8 : 0.6;

    if (score >= threshold) {
      check.status = CheckStatuses.PASSED;
      check.explanation = `Score ${score.toFixed(2)} meets threshold ${threshold}.`;
    } else {
      check.status = CheckStatuses.FAILED;
      check.explanation = `Score ${score.toFixed(2)} below threshold ${threshold}.`;
    }
  }

  return checks;
}

// ─── Dimension scoring ──────────────────────────────────────

const DIMENSION_LABELS: Record<string, string> = {
  objective_accuracy: 'Objective Accuracy',
  constraint_recall: 'Constraint Recall',
  decision_continuity: 'Decision Continuity',
  progress_accuracy: 'Progress Accuracy',
  failure_awareness: 'Failure Awareness',
  evidence_grounding: 'Evidence Grounding',
  contradiction_rate: 'Contradiction Rate',
  continuation_readiness: 'Continuation Readiness',
};

const DIMENSION_TARGETS: Record<string, number> = {
  objective_accuracy: 1.0,
  constraint_recall: 1.0,
  decision_continuity: 0.95,
  progress_accuracy: 0.98,
  failure_awareness: 0.95,
  evidence_grounding: 1.0,
  contradiction_rate: 1.0,
  continuation_readiness: 0.9,
};

function computeDimensionScore(checks: VerificationCheck[], dimension: CheckDimension): DimensionScore {
  const dimChecks = checks.filter((c) => c.dimension === dimension);
  const passed = dimChecks.filter((c) => c.status === CheckStatuses.PASSED).length;
  const failed = dimChecks.filter((c) => c.status === CheckStatuses.FAILED).length;
  const skipped = dimChecks.filter((c) => c.status === CheckStatuses.SKIPPED).length;
  const total = dimChecks.length;

  const scored = total - skipped;
  const score = scored > 0 ? passed / scored : 1.0;
  const target = DIMENSION_TARGETS[dimension] ?? 0.9;

  return {
    dimension,
    label: DIMENSION_LABELS[dimension] ?? dimension,
    totalChecks: total,
    passedChecks: passed,
    failedChecks: failed,
    skippedChecks: skipped,
    score,
    target,
    met: score >= target,
  };
}

// ─── Build verification report (ST3) ────────────────────────

export function buildReport(
  projectId: string,
  checks: VerificationCheck[],
  capsuleId?: string,
): VerificationReport {
  const dimensions = Object.values(CheckDimensions) as CheckDimension[];
  const dimensionScores = dimensions
    .map((d) => computeDimensionScore(checks, d))
    .filter((d) => d.totalChecks > 0);

  const totalChecks = checks.length;
  const passedChecks = checks.filter((c) => c.status === CheckStatuses.PASSED).length;
  const failedChecks = checks.filter((c) => c.status === CheckStatuses.FAILED).length;
  const scoredChecks = checks.filter((c) => c.score !== null);

  // Overall scores
  const correctness = scoredChecks.length > 0
    ? scoredChecks.reduce((sum, c) => sum + (c.score ?? 0), 0) / scoredChecks.length
    : 0;

  const completeness = totalChecks > 0 ? passedChecks / totalChecks : 0;

  // Grounding: checks in the evidence_grounding dimension
  const groundingChecks = checks.filter((c) => c.dimension === CheckDimensions.EVIDENCE_GROUNDING);
  const groundingPassed = groundingChecks.filter((c) => c.status === CheckStatuses.PASSED).length;
  const groundingRate = groundingChecks.length > 0 ? groundingPassed / groundingChecks.length : 1.0;

  // Contradictions: failed critical checks are potential contradictions
  const contradictionCount = checks.filter(
    (c) => c.status === CheckStatuses.FAILED && c.criticality === Criticalities.CRITICAL,
  ).length;

  const overallScore = dimensionScores.length > 0
    ? dimensionScores.reduce((sum, d) => sum + d.score, 0) / dimensionScores.length
    : 0;

  // Verdict: pass only if all critical checks pass and no unresolved contradictions
  const criticalFailures = checks.filter(
    (c) => c.criticality === Criticalities.CRITICAL && c.status === CheckStatuses.FAILED,
  ).length;

  const passed = criticalFailures === 0 && contradictionCount === 0;

  return {
    projectId,
    capsuleId: capsuleId ?? null,
    generatedAt: new Date().toISOString(),
    scoredAt: scoredChecks.length > 0 ? new Date().toISOString() : null,
    checks,
    dimensionScores,
    overallScore,
    completeness,
    correctness,
    groundingRate,
    contradictionCount,
    passed,
    criticalFailures,
    totalChecks,
    passedChecks,
    failedChecks,
  };
}
