/**
 * Transfer repair engine.
 *
 * When verification checks fail, the repair loop:
 *   ST1: Identifies which checks failed or were incomplete
 *   ST2: Retrieves targeted source evidence for each failure
 *   ST3: Allows re-scoring and classifies results as
 *        passed / repaired / unresolved
 *
 * The repair cycle is bounded: it runs at most maxCycles
 * times to prevent infinite loops.
 */

import { listSessions } from '../projects/session-store';
import { openLedger } from '../ledger/event-ledger';
import { CheckStatuses, Criticalities } from './types';
import { scoreCheck } from './scorer';
import type { VerificationCheck, VerificationReport } from './types';
import type { ContinuumEvent } from '../events/types';

// ─── Repair status ──────────────────────────────────────────

export const RepairStatuses = {
  PASSED_INITIALLY: 'passed_initially',
  REPAIRED: 'repaired',
  UNRESOLVED: 'unresolved',
  SKIPPED: 'skipped',
} as const;

export type RepairStatus = (typeof RepairStatuses)[keyof typeof RepairStatuses];

// ─── Repair item ────────────────────────────────────────────

export interface RepairItem {
  checkId: string;
  dimension: string;
  criticality: string;
  question: string;
  expectedAnswer: string;
  repairStatus: RepairStatus;
  /** Evidence retrieved to help the agent answer correctly */
  evidence: RepairEvidence[];
  /** Number of repair attempts made */
  repairAttempts: number;
  /** Score before repair */
  originalScore: number | null;
  /** Score after repair */
  repairedScore: number | null;
  /** Final explanation */
  explanation: string;
}

export interface RepairEvidence {
  eventId: string;
  type: string;
  timestamp: string;
  /** Relevant content from the event */
  content: string;
  /** Why this event is relevant to the check */
  relevance: string;
}

// ─── Repair report ──────────────────────────────────────────

export interface RepairReport {
  projectId: string;
  generatedAt: string;

  items: RepairItem[];

  /** Summary counts */
  passedInitially: number;
  repaired: number;
  unresolved: number;
  skipped: number;
  totalChecks: number;

  /** Whether the transfer is now verified */
  verified: boolean;
  /** Number of repair cycles that were run */
  cyclesRun: number;
  /** Max cycles allowed */
  maxCycles: number;

  /** Critical items that remain unresolved */
  criticalUnresolved: RepairItem[];
}

// ─── ST1: Identify failed checks ────────────────────────────

export function identifyFailures(report: VerificationReport): VerificationCheck[] {
  return report.checks.filter(
    (c) => c.status === CheckStatuses.FAILED || c.status === CheckStatuses.SKIPPED,
  );
}

export function identifyCriticalFailures(report: VerificationReport): VerificationCheck[] {
  return report.checks.filter(
    (c) =>
      (c.status === CheckStatuses.FAILED || c.status === CheckStatuses.SKIPPED) &&
      c.criticality === Criticalities.CRITICAL,
  );
}

// ─── ST2: Retrieve targeted evidence ────────────────────────

function loadAllEvents(workspaceRoot: string, projectId: string): ContinuumEvent[] {
  const sessions = listSessions(workspaceRoot, projectId);
  const all: ContinuumEvent[] = [];
  for (const s of sessions) {
    all.push(...openLedger(workspaceRoot, projectId, s.id).readAll().events);
  }
  all.sort((a, b) => a.sequence - b.sequence);
  return all;
}

function extractEventContent(event: ContinuumEvent): string {
  const payload = event.payload as unknown as Record<string, unknown>;

  switch (event.type) {
    case 'message':
      return (payload.content as string) ?? '';
    case 'tool_call':
      return `${payload.toolName}: ${JSON.stringify(payload.input ?? {}).slice(0, 200)}`;
    case 'tool_result':
      return `${payload.toolName}: ${((payload.output as string) ?? '').slice(0, 300)}`;
    case 'command':
      return `$ ${payload.command}`;
    case 'command_output':
      return `[exit ${payload.exitCode ?? '?'}] ${((payload.stdout as string) ?? '').slice(0, 300)}`;
    case 'artifact':
      return `${payload.action}: ${payload.uri}`;
    case 'system':
      return `${payload.action}${payload.message ? ': ' + payload.message : ''}`;
    default:
      return JSON.stringify(payload).slice(0, 200);
  }
}

export function retrieveEvidence(
  workspaceRoot: string,
  projectId: string,
  check: VerificationCheck,
): RepairEvidence[] {
  const evidence: RepairEvidence[] = [];
  const allEvents = loadAllEvents(workspaceRoot, projectId);

  // 1. Direct source events referenced by the check
  for (const eventId of check.sourceEventIds) {
    const event = allEvents.find((e) => e.id === eventId);
    if (event) {
      evidence.push({
        eventId: event.id,
        type: event.type,
        timestamp: event.timestamp,
        content: extractEventContent(event),
        relevance: `Direct source for: ${check.sourceCategory}`,
      });
    }
  }

  // 2. If no direct sources, search for keyword matches in events
  if (evidence.length === 0) {
    const keywords = check.expectedAnswer
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 4)
      .slice(0, 5);

    for (const event of allEvents) {
      const content = extractEventContent(event).toLowerCase();
      const matches = keywords.filter((kw) => content.includes(kw));

      if (matches.length >= 2 || (matches.length >= 1 && keywords.length <= 2)) {
        evidence.push({
          eventId: event.id,
          type: event.type,
          timestamp: event.timestamp,
          content: extractEventContent(event),
          relevance: `Keyword match: ${matches.join(', ')}`,
        });

        if (evidence.length >= 5) break;
      }
    }
  }

  return evidence;
}

// ─── Build repair context for a failed check ────────────────

export function buildRepairContext(check: VerificationCheck, evidence: RepairEvidence[]): string {
  const lines: string[] = [
    `## Repair: ${check.dimension}`,
    '',
    `**Question:** ${check.question}`,
    '',
    `**Expected:** ${check.expectedAnswer}`,
    '',
    '**Supporting evidence:**',
    '',
  ];

  if (evidence.length === 0) {
    lines.push('_No direct evidence found. Answer based on the project context above._');
  } else {
    for (const e of evidence) {
      lines.push(`- [${e.type}] ${e.timestamp.slice(0, 19)} (${e.eventId})`);
      lines.push(`  ${e.content.slice(0, 300)}`);
      lines.push(`  _${e.relevance}_`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── ST3: Run repair cycle ──────────────────────────────────

export interface RepairCycleInput {
  workspaceRoot: string;
  projectId: string;
  report: VerificationReport;
  /** Answers provided after receiving repair evidence */
  repairedAnswers: Map<string, string>;
  /** Max repair cycles (default 3) */
  maxCycles?: number;
  /** Current cycle number */
  currentCycle?: number;
}

export function runRepairCycle(input: RepairCycleInput): RepairReport {
  const {
    workspaceRoot,
    projectId,
    report,
    repairedAnswers,
    maxCycles = 3,
    currentCycle = 1,
  } = input;

  const items: RepairItem[] = [];

  for (const check of report.checks) {
    // Already passed
    if (check.status === CheckStatuses.PASSED) {
      items.push({
        checkId: check.id,
        dimension: check.dimension,
        criticality: check.criticality,
        question: check.question,
        expectedAnswer: check.expectedAnswer,
        repairStatus: RepairStatuses.PASSED_INITIALLY,
        evidence: [],
        repairAttempts: 0,
        originalScore: check.score,
        repairedScore: check.score,
        explanation: 'Passed on initial verification.',
      });
      continue;
    }

    // Skipped — no answer provided at all
    if (check.status === CheckStatuses.SKIPPED && !repairedAnswers.has(check.id)) {
      items.push({
        checkId: check.id,
        dimension: check.dimension,
        criticality: check.criticality,
        question: check.question,
        expectedAnswer: check.expectedAnswer,
        repairStatus: RepairStatuses.SKIPPED,
        evidence: [],
        repairAttempts: 0,
        originalScore: null,
        repairedScore: null,
        explanation: 'No answer provided during verification or repair.',
      });
      continue;
    }

    // Failed or skipped with new answer — attempt repair
    const evidence = retrieveEvidence(workspaceRoot, projectId, check);
    const newAnswer = repairedAnswers.get(check.id);

    if (newAnswer) {
      // Score the repaired answer
      const repairedCheck = { ...check, actualAnswer: newAnswer };
      const repairedScore = scoreCheck(repairedCheck);

      const threshold = check.criticality === Criticalities.CRITICAL ? 0.8 : 0.6;
      const passed = repairedScore >= threshold;

      items.push({
        checkId: check.id,
        dimension: check.dimension,
        criticality: check.criticality,
        question: check.question,
        expectedAnswer: check.expectedAnswer,
        repairStatus: passed ? RepairStatuses.REPAIRED : RepairStatuses.UNRESOLVED,
        evidence,
        repairAttempts: currentCycle,
        originalScore: check.score,
        repairedScore,
        explanation: passed
          ? `Repaired on cycle ${currentCycle}. Score improved from ${check.score?.toFixed(2) ?? '—'} to ${repairedScore.toFixed(2)}.`
          : `Still failing after cycle ${currentCycle}. Score: ${repairedScore.toFixed(2)} (threshold: ${threshold}).`,
      });
    } else {
      // No new answer provided for this failed check
      items.push({
        checkId: check.id,
        dimension: check.dimension,
        criticality: check.criticality,
        question: check.question,
        expectedAnswer: check.expectedAnswer,
        repairStatus: RepairStatuses.UNRESOLVED,
        evidence,
        repairAttempts: currentCycle,
        originalScore: check.score,
        repairedScore: null,
        explanation: `No repaired answer provided for this check after ${currentCycle} cycle(s).`,
      });
    }
  }

  // Summary
  const passedInitially = items.filter(
    (i) => i.repairStatus === RepairStatuses.PASSED_INITIALLY,
  ).length;
  const repaired = items.filter((i) => i.repairStatus === RepairStatuses.REPAIRED).length;
  const unresolved = items.filter((i) => i.repairStatus === RepairStatuses.UNRESOLVED).length;
  const skipped = items.filter((i) => i.repairStatus === RepairStatuses.SKIPPED).length;

  const criticalUnresolved = items.filter(
    (i) => i.repairStatus === RepairStatuses.UNRESOLVED && i.criticality === Criticalities.CRITICAL,
  );

  const verified = criticalUnresolved.length === 0 && unresolved === 0;

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    items,
    passedInitially,
    repaired,
    unresolved,
    skipped,
    totalChecks: items.length,
    verified,
    cyclesRun: currentCycle,
    maxCycles,
    criticalUnresolved,
  };
}

// ─── Build full repair evidence package ─────────────────────

export function buildRepairPackage(
  workspaceRoot: string,
  projectId: string,
  report: VerificationReport,
): string {
  const failures = identifyFailures(report);

  if (failures.length === 0) {
    return '## No repairs needed — all verification checks passed.';
  }

  const sections: string[] = [
    '# Continuum — Transfer Repair Package',
    '',
    `${failures.length} check(s) need repair. Please review the evidence below and answer each question.`,
    '',
  ];

  for (let i = 0; i < failures.length; i++) {
    const check = failures[i];
    const evidence = retrieveEvidence(workspaceRoot, projectId, check);

    const critLabel = check.criticality === Criticalities.CRITICAL ? ' **[CRITICAL]**' : '';

    sections.push(`### Repair ${i + 1}/${failures.length}${critLabel}`);
    sections.push('');
    sections.push(buildRepairContext(check, evidence));
    sections.push('---');
    sections.push('');
  }

  return sections.join('\n');
}
