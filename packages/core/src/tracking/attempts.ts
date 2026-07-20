/**
 * Attempt tracking: records what was tried, the outcome, and
 * why it failed so the same approach isn't repeated.
 */

import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export function generateAttemptId(): string {
  return `att_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export const AttemptOutcomes = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  PARTIAL: 'partial',
  ABANDONED: 'abandoned',
} as const;

export type AttemptOutcome = (typeof AttemptOutcomes)[keyof typeof AttemptOutcomes];

export interface Attempt {
  id: string;
  projectId: string;
  /** What approach was tried */
  approach: string;
  outcome: AttemptOutcome;
  /** Why it failed or was abandoned */
  failureReason: string | null;
  /** What was learned */
  observations: string;
  /** Related task or decision ID */
  relatedId: string | null;
  /** Event IDs that document this attempt */
  sourceEventIds: string[];
  createdAt: string;
}

export interface CreateAttemptInput {
  projectId: string;
  approach: string;
  outcome: AttemptOutcome;
  failureReason?: string;
  observations?: string;
  relatedId?: string;
  sourceEventIds?: string[];
}

// ─── Persistence ────────────────────────────────────────────

const FILENAME = 'attempts.json';

function filePath(workspaceRoot: string, projectId: string): string {
  return join(workspaceRoot, 'projects', projectId, FILENAME);
}

export function loadAttempts(workspaceRoot: string, projectId: string): Attempt[] {
  const path = filePath(workspaceRoot, projectId);
  if (!existsSync(path)) return [];

  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Attempt[];
  } catch {
    return [];
  }
}

function saveAttempts(workspaceRoot: string, projectId: string, attempts: Attempt[]): void {
  writeFileSync(
    filePath(workspaceRoot, projectId),
    JSON.stringify(attempts, null, 2) + '\n',
    'utf-8',
  );
}

// ─── Operations ─────────────────────────────────────────────

export function recordAttempt(workspaceRoot: string, input: CreateAttemptInput): Attempt {
  const attempts = loadAttempts(workspaceRoot, input.projectId);

  const attempt: Attempt = {
    id: generateAttemptId(),
    projectId: input.projectId,
    approach: input.approach.trim(),
    outcome: input.outcome,
    failureReason: input.failureReason?.trim() ?? null,
    observations: input.observations?.trim() ?? '',
    relatedId: input.relatedId ?? null,
    sourceEventIds: input.sourceEventIds ?? [],
    createdAt: new Date().toISOString(),
  };

  attempts.push(attempt);
  saveAttempts(workspaceRoot, input.projectId, attempts);

  return attempt;
}

export function listAttempts(
  workspaceRoot: string,
  projectId: string,
  outcomeFilter?: AttemptOutcome,
): Attempt[] {
  const all = loadAttempts(workspaceRoot, projectId);
  if (!outcomeFilter) return all;
  return all.filter((a) => a.outcome === outcomeFilter);
}

export function getFailedAttempts(workspaceRoot: string, projectId: string): Attempt[] {
  return loadAttempts(workspaceRoot, projectId).filter(
    (a) => a.outcome === AttemptOutcomes.FAILURE || a.outcome === AttemptOutcomes.ABANDONED,
  );
}

export function getAttempt(
  workspaceRoot: string,
  projectId: string,
  attemptId: string,
): Attempt | null {
  return loadAttempts(workspaceRoot, projectId).find((a) => a.id === attemptId) ?? null;
}
