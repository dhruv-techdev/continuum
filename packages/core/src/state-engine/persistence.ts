import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import type { WorkingState } from './types';

const STATE_FILENAME = 'working-state.json';
const HISTORY_DIR = 'state-history';

export function statePath(workspaceRoot: string, projectId: string): string {
  return join(workspaceRoot, 'projects', projectId, STATE_FILENAME);
}

function historyDir(workspaceRoot: string, projectId: string): string {
  return join(workspaceRoot, 'projects', projectId, HISTORY_DIR);
}

/**
 * Save working state. If a previous version exists, archive it
 * so regeneration can be compared against prior extractions.
 */
export function saveWorkingState(
  workspaceRoot: string,
  projectId: string,
  state: WorkingState,
): void {
  const path = statePath(workspaceRoot, projectId);

  // Archive previous version if it exists
  if (existsSync(path)) {
    const hDir = historyDir(workspaceRoot, projectId);
    mkdirSync(hDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = join(hDir, `state-${timestamp}.json`);

    try {
      copyFileSync(path, archivePath);
    } catch {
      // Non-fatal: history is informational
    }
  }

  writeFileSync(path, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

export function loadWorkingState(
  workspaceRoot: string,
  projectId: string,
): WorkingState | null {
  const path = statePath(workspaceRoot, projectId);

  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as WorkingState;
  } catch {
    return null;
  }
}

/**
 * List archived state versions for comparison.
 */
export function listStateHistory(
  workspaceRoot: string,
  projectId: string,
): string[] {
  const hDir = historyDir(workspaceRoot, projectId);

  if (!existsSync(hDir)) return [];

  const { readdirSync } = require('fs');
  const entries = readdirSync(hDir) as string[];

  return entries
    .filter((f: string) => f.startsWith('state-') && f.endsWith('.json'))
    .sort()
    .reverse();
}
