/**
 * Save and load working state from disk.
 *
 * State is stored as state.json inside the project directory
 * and can be regenerated from events at any time.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { WorkingState } from './types';

const STATE_FILENAME = 'working-state.json';

export function statePath(workspaceRoot: string, projectId: string): string {
  return join(workspaceRoot, 'projects', projectId, STATE_FILENAME);
}

export function saveWorkingState(
  workspaceRoot: string,
  projectId: string,
  state: WorkingState,
): void {
  const path = statePath(workspaceRoot, projectId);
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
