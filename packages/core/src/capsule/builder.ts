/**
 * Build a capsule manifest from project data on disk.
 */

import { existsSync, readFileSync, statSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash, randomUUID } from 'crypto';
import { VERSION } from '../index';
import { EVENT_SCHEMA_VERSION } from '../events/types';
import { CAPSULE_SCHEMA_VERSION } from './types';
import type {
  CapsuleManifest,
  CapsuleProjectMeta,
  CapsuleLedgerSection,
  CapsuleStateSection,
  CapsuleTrackingSection,
  CapsuleTrackingFile,
  CapsuleArtifactSection,
  CapsuleIntegritySection,
  CapsuleFileHash,
} from './types';

// ─── Helpers ────────────────────────────────────────────────

function hashFile(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

function fileSize(filePath: string): number {
  return statSync(filePath).size;
}

function generateCapsuleId(): string {
  return `cap_${randomUUID()}`;
}

// ─── Build manifest ─────────────────────────────────────────

export interface BuildManifestInput {
  workspaceRoot: string;
  projectId: string;
  notes?: string;
  expiresAt?: string;
  sessionFilter?: string[];
}

export function buildManifest(input: BuildManifestInput): CapsuleManifest {
  const { workspaceRoot, projectId } = input;
  const projectDir = join(workspaceRoot, 'projects', projectId);

  // ── Project metadata (ST1) ──────────────────────────────

  const projectManifest = JSON.parse(
    readFileSync(join(projectDir, 'project.json'), 'utf-8'),
  );

  const sessionsDir = join(projectDir, 'sessions');
  const sessionIds: string[] = [];

  if (existsSync(sessionsDir)) {
    const entries = readdirSync(sessionsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('sess_')) {
        if (!input.sessionFilter || input.sessionFilter.includes(entry.name)) {
          sessionIds.push(entry.name);
        }
      }
    }
  }

  const project: CapsuleProjectMeta = {
    id: projectId,
    title: projectManifest.title,
    description: projectManifest.description ?? '',
    createdAt: projectManifest.createdAt,
    sessionIds,
    sessionCount: sessionIds.length,
  };

  // ── Ledger (ST2) ────────────────────────────────────────

  const allEvents: string[] = [];
  let firstTimestamp: string | null = null;
  let lastTimestamp: string | null = null;
  const eventTypesSet = new Set<string>();

  for (const sessionId of sessionIds) {
    const ledgerPath = join(sessionsDir, sessionId, 'events.jsonl');
    if (!existsSync(ledgerPath)) continue;

    const raw = readFileSync(ledgerPath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);

    for (const line of lines) {
      allEvents.push(line);
      try {
        const event = JSON.parse(line);
        if (event.type) eventTypesSet.add(event.type);
        if (event.timestamp) {
          if (!firstTimestamp || event.timestamp < firstTimestamp) firstTimestamp = event.timestamp;
          if (!lastTimestamp || event.timestamp > lastTimestamp) lastTimestamp = event.timestamp;
        }
      } catch {
        // Skip malformed lines in manifest building
      }
    }
  }

  const combinedLedgerContent = allEvents.join('\n') + (allEvents.length > 0 ? '\n' : '');
  const ledgerHash = createHash('sha256').update(combinedLedgerContent, 'utf-8').digest('hex');

  const ledger: CapsuleLedgerSection = {
    path: 'events.jsonl',
    eventCount: allEvents.length,
    eventTypes: [...eventTypesSet].sort(),
    firstTimestamp,
    lastTimestamp,
    fileHash: ledgerHash,
    fileSize: Buffer.byteLength(combinedLedgerContent, 'utf-8'),
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
  };

  // ── State (ST2) ─────────────────────────────────────────

  let state: CapsuleStateSection | null = null;
  const statePath = join(projectDir, 'working-state.json');

  if (existsSync(statePath)) {
    const raw = readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw);

    const categoryCounts: Record<string, number> = {};
    let activeCount = 0;

    for (const cat of ['objectives', 'requirements', 'constraints', 'decisions', 'nextActions', 'completed', 'failures', 'assumptions', 'openQuestions']) {
      const arr = parsed[cat] ?? [];
      const active = arr.filter((s: { status: string }) => s.status === 'active');
      categoryCounts[cat] = active.length;
      activeCount += active.length;
    }

    state = {
      path: 'state.json',
      stateVersion: parsed.stateVersion ?? 1,
      extractedAt: parsed.extractedAt ?? '',
      activeStatements: activeCount,
      categoryCounts,
      fileHash: hashFile(statePath),
    };
  }

  // ── Tracking (ST2) ──────────────────────────────────────

  function buildTrackingFile(filename: string): CapsuleTrackingFile | null {
    const path = join(projectDir, filename);
    if (!existsSync(path)) return null;

    try {
      const raw = readFileSync(path, 'utf-8');
      const arr = JSON.parse(raw);
      return {
        path: filename,
        count: Array.isArray(arr) ? arr.length : 0,
        fileHash: hashFile(path),
      };
    } catch {
      return null;
    }
  }

  const decisionsFile = buildTrackingFile('decisions.json');
  const tasksFile = buildTrackingFile('tasks.json');
  const attemptsFile = buildTrackingFile('attempts.json');

  const tracking: CapsuleTrackingSection | null =
    decisionsFile || tasksFile || attemptsFile
      ? { decisions: decisionsFile, tasks: tasksFile, attempts: attemptsFile }
      : null;

  // ── Artifacts (ST2) ─────────────────────────────────────

  let artifacts: CapsuleArtifactSection | null = null;
  const registryPath = join(projectDir, 'artifacts.json');

  if (existsSync(registryPath)) {
    const raw = readFileSync(registryPath, 'utf-8');
    const arr = JSON.parse(raw);
    const total = Array.isArray(arr) ? arr.length : 0;
    const stored = Array.isArray(arr) ? arr.filter((a: { storageMode: string }) => a.storageMode === 'content').length : 0;

    artifacts = {
      registryPath: 'artifacts.json',
      storagePath: existsSync(join(projectDir, 'artifacts')) ? 'artifacts/' : null,
      totalArtifacts: total,
      storedCount: stored,
      referenceCount: total - stored,
      registryHash: hashFile(registryPath),
    };
  }

  // ── Integrity ─────────────────────────────────────────

  const integrityFiles: CapsuleFileHash[] = [];

  // Always include the combined ledger
  integrityFiles.push({ path: 'events.jsonl', hash: ledgerHash, size: ledger.fileSize });

  // Include state if present
  if (state && existsSync(statePath)) {
    integrityFiles.push({ path: 'state.json', hash: state.fileHash, size: fileSize(statePath) });
  }

  // Include tracking files
  for (const tf of [decisionsFile, tasksFile, attemptsFile]) {
    if (tf) {
      const fullPath = join(projectDir, tf.path);
      integrityFiles.push({ path: tf.path, hash: tf.fileHash, size: fileSize(fullPath) });
    }
  }

  // Include artifact registry
  if (artifacts) {
    integrityFiles.push({ path: 'artifacts.json', hash: artifacts.registryHash, size: fileSize(registryPath) });
  }

  const integrity: CapsuleIntegritySection = {
    algorithm: 'sha256',
    files: integrityFiles,
    computedAt: new Date().toISOString(),
  };

  // ── Assemble manifest ───────────────────────────────────

  return {
    schemaVersion: CAPSULE_SCHEMA_VERSION,
    capsuleId: generateCapsuleId(),
    createdAt: new Date().toISOString(),
    createdBy: `continuum@${VERSION}`,
    project,
    ledger,
    state,
    tracking,
    artifacts,
    evaluations: null,
    integrity,
    notes: input.notes ?? null,
    expiresAt: input.expiresAt ?? null,
    sessionFilter: input.sessionFilter ?? null,
    redactions: null,
  };
}
