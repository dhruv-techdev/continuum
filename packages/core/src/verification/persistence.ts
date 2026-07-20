import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { VerificationReport, VerificationCheck } from './types';

function evalsDir(workspaceRoot: string, projectId: string): string {
  return join(workspaceRoot, 'projects', projectId, 'evaluations');
}

export function saveReport(
  workspaceRoot: string,
  projectId: string,
  report: VerificationReport,
): string {
  const dir = evalsDir(workspaceRoot, projectId);
  mkdirSync(dir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = randomUUID().slice(0, 8);
  const filename = `eval-${timestamp}-${suffix}.json`;
  const path = join(dir, filename);

  writeFileSync(path, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  return path;
}

export function loadLatestReport(
  workspaceRoot: string,
  projectId: string,
): VerificationReport | null {
  const dir = evalsDir(workspaceRoot, projectId);
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir)
    .filter((f) => f.startsWith('eval-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  try {
    return JSON.parse(readFileSync(join(dir, files[0]), 'utf-8'));
  } catch {
    return null;
  }
}

export function listReports(workspaceRoot: string, projectId: string): string[] {
  const dir = evalsDir(workspaceRoot, projectId);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.startsWith('eval-') && f.endsWith('.json'))
    .sort()
    .reverse();
}

export function saveChecks(
  workspaceRoot: string,
  projectId: string,
  checks: VerificationCheck[],
): string {
  const dir = evalsDir(workspaceRoot, projectId);
  mkdirSync(dir, { recursive: true });

  const path = join(dir, 'pending-checks.json');
  writeFileSync(path, JSON.stringify(checks, null, 2) + '\n', 'utf-8');
  return path;
}

export function loadPendingChecks(
  workspaceRoot: string,
  projectId: string,
): VerificationCheck[] | null {
  const path = join(evalsDir(workspaceRoot, projectId), 'pending-checks.json');
  if (!existsSync(path)) return null;

  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}
