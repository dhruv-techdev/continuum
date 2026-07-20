/**
 * Decision tracking with active/rejected/superseded lifecycle.
 *
 * A decision records what was chosen, why, what alternatives
 * existed, and whether it was later replaced.
 */

import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// ─── Types (ST1) ────────────────────────────────────────────

export function generateDecisionId(): string {
  return `dec_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export const DecisionStatuses = {
  ACTIVE: 'active',
  REJECTED: 'rejected',
  SUPERSEDED: 'superseded',
} as const;

export type DecisionStatus = (typeof DecisionStatuses)[keyof typeof DecisionStatuses];

export interface Decision {
  id: string;
  projectId: string;
  /** What was decided */
  choice: string;
  /** Why this was chosen */
  rationale: string;
  /** What alternatives were considered */
  alternatives: string[];
  /** If rejected, why */
  rejectionReason: string | null;
  /** If superseded, the ID of the replacing decision */
  supersededBy: string | null;
  status: DecisionStatus;
  /** Event IDs that support this decision */
  sourceEventIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateDecisionInput {
  projectId: string;
  choice: string;
  rationale?: string;
  alternatives?: string[];
  sourceEventIds?: string[];
}

// ─── Persistence ────────────────────────────────────────────

const FILENAME = 'decisions.json';

function filePath(workspaceRoot: string, projectId: string): string {
  return join(workspaceRoot, 'projects', projectId, FILENAME);
}

export function loadDecisions(workspaceRoot: string, projectId: string): Decision[] {
  const path = filePath(workspaceRoot, projectId);
  if (!existsSync(path)) return [];

  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Decision[];
  } catch {
    return [];
  }
}

function saveDecisions(workspaceRoot: string, projectId: string, decisions: Decision[]): void {
  writeFileSync(
    filePath(workspaceRoot, projectId),
    JSON.stringify(decisions, null, 2) + '\n',
    'utf-8',
  );
}

// ─── Operations ─────────────────────────────────────────────

export function createDecision(workspaceRoot: string, input: CreateDecisionInput): Decision {
  const now = new Date().toISOString();
  const decisions = loadDecisions(workspaceRoot, input.projectId);

  const decision: Decision = {
    id: generateDecisionId(),
    projectId: input.projectId,
    choice: input.choice.trim(),
    rationale: input.rationale?.trim() ?? '',
    alternatives: input.alternatives?.map((a) => a.trim()) ?? [],
    rejectionReason: null,
    supersededBy: null,
    status: DecisionStatuses.ACTIVE,
    sourceEventIds: input.sourceEventIds ?? [],
    createdAt: now,
    updatedAt: now,
  };

  decisions.push(decision);
  saveDecisions(workspaceRoot, input.projectId, decisions);

  return decision;
}

export function rejectDecision(
  workspaceRoot: string,
  projectId: string,
  decisionId: string,
  reason: string,
): Decision | null {
  const decisions = loadDecisions(workspaceRoot, projectId);
  const decision = decisions.find((d) => d.id === decisionId);

  if (!decision) return null;

  decision.status = DecisionStatuses.REJECTED;
  decision.rejectionReason = reason;
  decision.updatedAt = new Date().toISOString();

  saveDecisions(workspaceRoot, projectId, decisions);
  return decision;
}

export function supersedeDecision(
  workspaceRoot: string,
  projectId: string,
  oldDecisionId: string,
  newInput: CreateDecisionInput,
): { old: Decision; new: Decision } | null {
  const decisions = loadDecisions(workspaceRoot, projectId);
  const old = decisions.find((d) => d.id === oldDecisionId);

  if (!old) return null;

  const now = new Date().toISOString();

  const newDecision: Decision = {
    id: generateDecisionId(),
    projectId,
    choice: newInput.choice.trim(),
    rationale: newInput.rationale?.trim() ?? '',
    alternatives: [...(newInput.alternatives ?? []), old.choice],
    rejectionReason: null,
    supersededBy: null,
    status: DecisionStatuses.ACTIVE,
    sourceEventIds: newInput.sourceEventIds ?? [],
    createdAt: now,
    updatedAt: now,
  };

  old.status = DecisionStatuses.SUPERSEDED;
  old.supersededBy = newDecision.id;
  old.updatedAt = now;

  decisions.push(newDecision);
  saveDecisions(workspaceRoot, projectId, decisions);

  return { old, new: newDecision };
}

export function listDecisions(
  workspaceRoot: string,
  projectId: string,
  includeInactive = false,
): Decision[] {
  const all = loadDecisions(workspaceRoot, projectId);
  if (includeInactive) return all;
  return all.filter((d) => d.status === DecisionStatuses.ACTIVE);
}

export function getDecision(
  workspaceRoot: string,
  projectId: string,
  decisionId: string,
): Decision | null {
  const all = loadDecisions(workspaceRoot, projectId);
  return all.find((d) => d.id === decisionId) ?? null;
}
