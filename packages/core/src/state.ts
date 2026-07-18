import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const STATE_FILENAME = 'state.json';

export interface WorkspaceState {
  activeProjectId: string | null;
  activeSessionId: string | null;
}

function statePath(workspaceRoot: string): string {
  return join(workspaceRoot, STATE_FILENAME);
}

function emptyState(): WorkspaceState {
  return { activeProjectId: null, activeSessionId: null };
}

export function getState(workspaceRoot: string): WorkspaceState {
  const path = statePath(workspaceRoot);

  if (!existsSync(path)) return emptyState();

  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      activeProjectId: typeof parsed.activeProjectId === 'string' ? parsed.activeProjectId : null,
      activeSessionId: typeof parsed.activeSessionId === 'string' ? parsed.activeSessionId : null,
    };
  } catch {
    return emptyState();
  }
}

export function setState(workspaceRoot: string, state: WorkspaceState): void {
  writeFileSync(statePath(workspaceRoot), JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

export function setActiveProject(workspaceRoot: string, projectId: string | null): void {
  const state = getState(workspaceRoot);
  state.activeProjectId = projectId;
  // Switching projects clears the active session
  state.activeSessionId = null;
  setState(workspaceRoot, state);
}

export function setActiveSession(workspaceRoot: string, sessionId: string | null): void {
  const state = getState(workspaceRoot);
  state.activeSessionId = sessionId;
  setState(workspaceRoot, state);
}
