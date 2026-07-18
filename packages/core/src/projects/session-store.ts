import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Session, StartSessionInput, StoreResult } from './types';
import { generateSessionId, SessionStatuses } from './types';
import { getProject } from './project-store';

const SESSIONS_DIR = 'sessions';
const SESSION_MANIFEST = 'session.json';

function sessionsRoot(workspaceRoot: string, projectId: string): string {
  return join(workspaceRoot, 'projects', projectId, SESSIONS_DIR);
}

function sessionDir(workspaceRoot: string, projectId: string, sessionId: string): string {
  return join(sessionsRoot(workspaceRoot, projectId), sessionId);
}

function sessionManifestPath(
  workspaceRoot: string,
  projectId: string,
  sessionId: string,
): string {
  return join(sessionDir(workspaceRoot, projectId, sessionId), SESSION_MANIFEST);
}

// ─── Read ───────────────────────────────────────────────────────

export function getSession(
  workspaceRoot: string,
  projectId: string,
  sessionId: string,
): Session | null {
  const manifestPath = sessionManifestPath(workspaceRoot, projectId, sessionId);

  if (!existsSync(manifestPath)) return null;

  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function listSessions(workspaceRoot: string, projectId: string): Session[] {
  const root = sessionsRoot(workspaceRoot, projectId);

  if (!existsSync(root)) return [];

  const entries = readdirSync(root, { withFileTypes: true });
  const sessions: Session[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('sess_')) continue;

    const session = getSession(workspaceRoot, projectId, entry.name);
    if (session) sessions.push(session);
  }

  // Active sessions first, then most recent
  sessions.sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === SessionStatuses.ACTIVE ? -1 : 1;
    }
    return b.startedAt.localeCompare(a.startedAt);
  });

  return sessions;
}

// ─── Write ──────────────────────────────────────────────────────

export function startSession(
  workspaceRoot: string,
  input: StartSessionInput,
): StoreResult<Session> {
  const project = getProject(workspaceRoot, input.projectId);
  if (!project) {
    return { data: null, error: `Project "${input.projectId}" not found.` };
  }

  const session: Session = {
    id: generateSessionId(),
    projectId: input.projectId,
    provider: input.provider?.trim() || 'unknown',
    model: input.model?.trim() || 'unknown',
    status: SessionStatuses.ACTIVE,
    startedAt: new Date().toISOString(),
    closedAt: null,
    eventCount: 0,
  };

  const dir = sessionDir(workspaceRoot, input.projectId, session.id);

  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, SESSION_MANIFEST),
      JSON.stringify(session, null, 2) + '\n',
      'utf-8',
    );
  } catch (err) {
    return { data: null, error: `Failed to start session: ${(err as Error).message}` };
  }

  return { data: session, error: null };
}

export function closeSession(
  workspaceRoot: string,
  projectId: string,
  sessionId: string,
): StoreResult<Session> {
  const session = getSession(workspaceRoot, projectId, sessionId);

  if (!session) {
    return { data: null, error: `Session "${sessionId}" not found in project "${projectId}".` };
  }

  if (session.status === SessionStatuses.CLOSED) {
    return { data: null, error: `Session "${sessionId}" is already closed.` };
  }

  const updated: Session = {
    ...session,
    status: SessionStatuses.CLOSED,
    closedAt: new Date().toISOString(),
  };

  try {
    writeFileSync(
      sessionManifestPath(workspaceRoot, projectId, sessionId),
      JSON.stringify(updated, null, 2) + '\n',
      'utf-8',
    );
  } catch (err) {
    return { data: null, error: `Failed to close session: ${(err as Error).message}` };
  }

  return { data: updated, error: null };
}
