import type { MetadataDB } from './database';
import { openLedger } from '../ledger/event-ledger';
import { listProjects } from '../projects/project-store';
import { listSessions } from '../projects/session-store';
import { loadRegistry } from '../artifacts/registry';
import {
  syncProject,
  syncSession,
  syncEvents,
  syncArtifacts,
  getWatermark,
  setWatermark,
} from './sync';
import { ensureFTS, indexEvents } from './fts';

export interface RecoveryResult {
  projectsSynced: number;
  sessionsSynced: number;
  eventsRecovered: number;
  eventsIndexed: number;
  artifactsSynced: number;
  errors: string[];
  durationMs: number;
}

export function recoverSession(
  db: MetadataDB,
  workspaceRoot: string,
  projectId: string,
  sessionId: string,
): { eventsRecovered: number; error: string | null } {
  const watermark = getWatermark(db, sessionId);
  const ledger = openLedger(workspaceRoot, projectId, sessionId);
  const { events } = ledger.readAll();

  const unsyncedEvents = events.filter((e) => e.sequence > watermark);

  if (unsyncedEvents.length === 0) {
    return { eventsRecovered: 0, error: null };
  }

  try {
    syncEvents(db, unsyncedEvents);
    indexEvents(db, unsyncedEvents);

    const newWatermark = unsyncedEvents[unsyncedEvents.length - 1].sequence;
    setWatermark(db, sessionId, newWatermark);

    return { eventsRecovered: unsyncedEvents.length, error: null };
  } catch (err) {
    return {
      eventsRecovered: 0,
      error: `Failed to sync session ${sessionId}: ${(err as Error).message}`,
    };
  }
}

export function recoverWorkspace(
  db: MetadataDB,
  workspaceRoot: string,
): RecoveryResult {
  const start = Date.now();
  const result: RecoveryResult = {
    projectsSynced: 0,
    sessionsSynced: 0,
    eventsRecovered: 0,
    eventsIndexed: 0,
    artifactsSynced: 0,
    errors: [],
    durationMs: 0,
  };

  ensureFTS(db);

  const projects = listProjects(workspaceRoot);

  for (const project of projects) {
    try {
      syncProject(db, project);
      result.projectsSynced++;
    } catch (err) {
      result.errors.push(`Project ${project.id}: ${(err as Error).message}`);
      continue;
    }

    const sessions = listSessions(workspaceRoot, project.id);
    for (const session of sessions) {
      try {
        syncSession(db, session);
        result.sessionsSynced++;
      } catch (err) {
        result.errors.push(`Session ${session.id}: ${(err as Error).message}`);
        continue;
      }

      const { eventsRecovered, error } = recoverSession(
        db, workspaceRoot, project.id, session.id,
      );
      result.eventsRecovered += eventsRecovered;
      result.eventsIndexed += eventsRecovered;
      if (error) result.errors.push(error);
    }

    try {
      const artifacts = loadRegistry(workspaceRoot, project.id);
      if (artifacts.length > 0) {
        syncArtifacts(db, artifacts);
        result.artifactsSynced += artifacts.length;
      }
    } catch (err) {
      result.errors.push(`Artifacts for ${project.id}: ${(err as Error).message}`);
    }
  }

  result.durationMs = Date.now() - start;
  return result;
}
