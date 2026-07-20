/**
 * Capsule importer.
 *
 * Reads a .ctx directory, validates its structure, verifies
 * integrity, and imports the contents into a new project
 * within the local workspace.
 *
 * ST1: Validates structure and schema version
 * ST2: Verifies event hashes and file integrity
 * ST3: Rejects corrupted/incompatible capsules with clear errors
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  statSync,
} from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import { validateManifest, isCompatibleCapsuleVersion } from './validator';
import { verifyCapsuleIntegrity } from './exporter';
import { verifyEventHash } from '../events/hash';
import { validateEvent } from '../events/validation';
import { generateProjectId } from '../projects/types';
import type { CapsuleManifest, ManifestValidationError } from './types';
import type { ContinuumEvent } from '../events/types';

// ─── Validation phases ──────────────────────────────────────

export const ImportPhases = {
  STRUCTURE: 'structure',
  SCHEMA: 'schema',
  INTEGRITY: 'integrity',
  EVENTS: 'events',
  IMPORT: 'import',
} as const;

export type ImportPhase = (typeof ImportPhases)[keyof typeof ImportPhases];

export interface ImportIssue {
  phase: ImportPhase;
  severity: 'error' | 'warning';
  message: string;
}

// ─── Import result ──────────────────────────────────────────

export interface CapsuleImportResult {
  success: boolean;
  projectId: string | null;
  capsuleId: string | null;
  projectTitle: string | null;
  eventsImported: number;
  sessionsImported: number;
  issues: ImportIssue[];
  phasesCompleted: ImportPhase[];
}

// ─── Import options ─────────────────────────────────────────

export interface CapsuleImportOptions {
  workspaceRoot: string;
  capsulePath: string;
  /** Override the project title */
  title?: string;
  /** Skip integrity verification (not recommended) */
  skipIntegrity?: boolean;
  /** Skip individual event hash verification */
  skipEventHashes?: boolean;
  /** Import even if warnings exist (still reject errors) */
  allowWarnings?: boolean;
}

// ─── ST1: Structure validation ──────────────────────────────

function validateStructure(capsulePath: string): ImportIssue[] {
  const issues: ImportIssue[] = [];

  if (!existsSync(capsulePath)) {
    issues.push({ phase: ImportPhases.STRUCTURE, severity: 'error', message: `Capsule path not found: ${capsulePath}` });
    return issues;
  }

  const stat = statSync(capsulePath);
  if (!stat.isDirectory()) {
    issues.push({ phase: ImportPhases.STRUCTURE, severity: 'error', message: 'Capsule path must be a directory (*.ctx).' });
    return issues;
  }

  // Required files
  const manifestPath = join(capsulePath, 'manifest.json');
  if (!existsSync(manifestPath)) {
    issues.push({ phase: ImportPhases.STRUCTURE, severity: 'error', message: 'Missing manifest.json — not a valid capsule.' });
  }

  const integrityPath = join(capsulePath, 'integrity.json');
  if (!existsSync(integrityPath)) {
    issues.push({ phase: ImportPhases.STRUCTURE, severity: 'warning', message: 'Missing integrity.json — cannot verify file hashes.' });
  }

  const eventsPath = join(capsulePath, 'events.jsonl');
  if (!existsSync(eventsPath)) {
    issues.push({ phase: ImportPhases.STRUCTURE, severity: 'warning', message: 'Missing events.jsonl — capsule has no event history.' });
  }

  return issues;
}

// ─── ST1: Schema validation ─────────────────────────────────

function validateSchema(capsulePath: string): { manifest: CapsuleManifest | null; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const manifestPath = join(capsulePath, 'manifest.json');

  if (!existsSync(manifestPath)) {
    return { manifest: null, issues };
  }

  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf-8');
  } catch (err) {
    issues.push({ phase: ImportPhases.SCHEMA, severity: 'error', message: `Cannot read manifest.json: ${(err as Error).message}` });
    return { manifest: null, issues };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    issues.push({ phase: ImportPhases.SCHEMA, severity: 'error', message: 'manifest.json is not valid JSON.' });
    return { manifest: null, issues };
  }

  // Check schema version compatibility
  const manifest = parsed as Record<string, unknown>;
  if (typeof manifest.schemaVersion === 'string') {
    if (!isCompatibleCapsuleVersion(manifest.schemaVersion as string)) {
      issues.push({
        phase: ImportPhases.SCHEMA,
        severity: 'error',
        message: `Incompatible capsule schema version "${manifest.schemaVersion}". This tool supports version 1.x.x.`,
      });
    }
  }

  // Validate all manifest fields
  const manifestErrors = validateManifest(parsed);
  for (const err of manifestErrors) {
    issues.push({ phase: ImportPhases.SCHEMA, severity: 'error', message: `${err.field}: ${err.message}` });
  }

  if (issues.some((i) => i.severity === 'error')) {
    return { manifest: null, issues };
  }

  return { manifest: parsed as CapsuleManifest, issues };
}

// ─── ST2: Integrity verification ────────────────────────────

function verifyIntegrity(capsulePath: string): ImportIssue[] {
  const issues: ImportIssue[] = [];
  const result = verifyCapsuleIntegrity(capsulePath);

  if (result.error) {
    issues.push({ phase: ImportPhases.INTEGRITY, severity: 'warning', message: result.error });
    return issues;
  }

  for (const missing of result.missing) {
    issues.push({ phase: ImportPhases.INTEGRITY, severity: 'error', message: `File missing from capsule: ${missing}` });
  }

  for (const mismatch of result.mismatches) {
    issues.push({
      phase: ImportPhases.INTEGRITY,
      severity: 'error',
      message: `Hash mismatch for ${mismatch.path}: expected ${mismatch.expected.slice(0, 16)}…, got ${mismatch.actual.slice(0, 16)}…`,
    });
  }

  return issues;
}

// ─── ST2: Event hash verification ───────────────────────────

function verifyEvents(capsulePath: string): { events: ContinuumEvent[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const events: ContinuumEvent[] = [];
  const eventsPath = join(capsulePath, 'events.jsonl');

  if (!existsSync(eventsPath)) {
    return { events, issues };
  }

  const raw = readFileSync(eventsPath, 'utf-8');
  const lines = raw.split('\n');
  let lineNum = 0;

  for (const line of lines) {
    lineNum++;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed);
    } catch (err) {
      issues.push({ phase: ImportPhases.EVENTS, severity: 'error', message: `Line ${lineNum}: invalid JSON — ${(err as Error).message}` });
      continue;
    }

    // Validate event schema
    const validationErrors = validateEvent(event);
    // Separate hash errors for clearer reporting
    const hashErrors = validationErrors.filter((e) => e.field === 'hash' && e.message.includes('modified'));
    const otherErrors = validationErrors.filter((e) => !(e.field === 'hash' && e.message.includes('modified')));

    for (const err of otherErrors) {
      issues.push({ phase: ImportPhases.EVENTS, severity: 'error', message: `Line ${lineNum} (${event.id ?? '?'}): ${err.field} — ${err.message}` });
    }

    if (hashErrors.length > 0) {
      issues.push({ phase: ImportPhases.EVENTS, severity: 'error', message: `Line ${lineNum} (${event.id ?? '?'}): content hash does not match. Event may have been tampered with.` });
    }

    if (otherErrors.length === 0 && hashErrors.length === 0) {
      events.push(event as unknown as ContinuumEvent);
    }
  }

  return { events, issues };
}

// ─── Import into workspace ──────────────────────────────────

function doImport(
  workspaceRoot: string,
  capsulePath: string,
  manifest: CapsuleManifest,
  events: ContinuumEvent[],
  titleOverride?: string,
): { projectId: string; sessionsImported: number; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];

  const projectId = generateProjectId();
  const projectDir = join(workspaceRoot, 'projects', projectId);

  try {
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(join(projectDir, 'sessions'), { recursive: true });
  } catch (err) {
    issues.push({ phase: ImportPhases.IMPORT, severity: 'error', message: `Cannot create project directory: ${(err as Error).message}` });
    return { projectId, sessionsImported: 0, issues };
  }

  // Write project.json
  const projectMeta = {
    id: projectId,
    title: titleOverride ?? manifest.project.title,
    description: manifest.project.description ?? '',
    createdAt: manifest.project.createdAt,
    updatedAt: new Date().toISOString(),
    importedFrom: manifest.capsuleId,
    originalProjectId: manifest.project.id,
  };

  writeFileSync(join(projectDir, 'project.json'), JSON.stringify(projectMeta, null, 2) + '\n', 'utf-8');

  // Group events by session
  const eventsBySession = new Map<string, ContinuumEvent[]>();
  for (const event of events) {
    const existing = eventsBySession.get(event.sessionId) ?? [];
    existing.push(event);
    eventsBySession.set(event.sessionId, existing);
  }

  // Create sessions and write ledgers
  let sessionsImported = 0;

  for (const [sessionId, sessionEvents] of eventsBySession) {
    const sessionDir = join(projectDir, 'sessions', sessionId);
    mkdirSync(sessionDir, { recursive: true });

    // Sort by sequence
    sessionEvents.sort((a, b) => a.sequence - b.sequence);

    // Write session manifest
    const sessionMeta = {
      id: sessionId,
      projectId,
      provider: 'imported',
      model: 'unknown',
      status: 'closed',
      startedAt: sessionEvents[0]?.timestamp ?? new Date().toISOString(),
      closedAt: sessionEvents[sessionEvents.length - 1]?.timestamp ?? new Date().toISOString(),
      eventCount: sessionEvents.length,
    };

    // Try to read original session metadata from capsule
    const capsuleSessionPath = join(capsulePath, 'sessions', `${sessionId}.json`);
    if (existsSync(capsuleSessionPath)) {
      try {
        const origSession = JSON.parse(readFileSync(capsuleSessionPath, 'utf-8'));
        sessionMeta.provider = origSession.provider ?? 'imported';
        sessionMeta.model = origSession.model ?? 'unknown';
        sessionMeta.status = origSession.status ?? 'closed';
        sessionMeta.startedAt = origSession.startedAt ?? sessionMeta.startedAt;
        sessionMeta.closedAt = origSession.closedAt ?? sessionMeta.closedAt;
      } catch {
        // Use defaults
      }
    }

    writeFileSync(join(sessionDir, 'session.json'), JSON.stringify(sessionMeta, null, 2) + '\n', 'utf-8');

    // Write events.jsonl
    const ledgerLines = sessionEvents.map((e) => JSON.stringify(e)).join('\n');
    writeFileSync(join(sessionDir, 'events.jsonl'), ledgerLines + '\n', 'utf-8');

    sessionsImported++;
  }

  // Copy optional files from capsule
  const optionalFiles = ['state.json', 'decisions.json', 'tasks.json', 'attempts.json', 'artifacts.json'];
  for (const filename of optionalFiles) {
    const srcPath = join(capsulePath, filename === 'state.json' ? 'state.json' : filename);
    const destPath = join(projectDir, filename === 'state.json' ? 'working-state.json' : filename);

    if (existsSync(srcPath)) {
      try {
        copyFileSync(srcPath, destPath);
      } catch {
        issues.push({ phase: ImportPhases.IMPORT, severity: 'warning', message: `Could not copy ${filename}.` });
      }
    }
  }

  // Copy stored artifacts if present
  const artSrc = join(capsulePath, 'artifacts');
  if (existsSync(artSrc) && statSync(artSrc).isDirectory()) {
    const artDest = join(projectDir, 'artifacts');
    mkdirSync(artDest, { recursive: true });

    try {
      const artFiles = readdirSync(artSrc);
      for (const f of artFiles) {
        const srcFile = join(artSrc, f);
        if (statSync(srcFile).isFile()) {
          copyFileSync(srcFile, join(artDest, f));
        }
      }
    } catch {
      issues.push({ phase: ImportPhases.IMPORT, severity: 'warning', message: 'Could not copy some artifact content.' });
    }
  }

  return { projectId, sessionsImported, issues };
}

// ─── Main import function ───────────────────────────────────

export function importCapsule(options: CapsuleImportOptions): CapsuleImportResult {
  const result: CapsuleImportResult = {
    success: false,
    projectId: null,
    capsuleId: null,
    projectTitle: null,
    eventsImported: 0,
    sessionsImported: 0,
    issues: [],
    phasesCompleted: [],
  };

  // Phase 1: Structure (ST1)
  const structureIssues = validateStructure(options.capsulePath);
  result.issues.push(...structureIssues);

  if (structureIssues.some((i) => i.severity === 'error')) {
    return result;
  }
  result.phasesCompleted.push(ImportPhases.STRUCTURE);

  // Phase 2: Schema (ST1)
  const { manifest, issues: schemaIssues } = validateSchema(options.capsulePath);
  result.issues.push(...schemaIssues);

  if (!manifest || schemaIssues.some((i) => i.severity === 'error')) {
    return result;
  }

  result.capsuleId = manifest.capsuleId;
  result.projectTitle = options.title ?? manifest.project.title;
  result.phasesCompleted.push(ImportPhases.SCHEMA);

  // Phase 3: Integrity (ST2)
  if (!options.skipIntegrity) {
    const integrityIssues = verifyIntegrity(options.capsulePath);
    result.issues.push(...integrityIssues);

    if (integrityIssues.some((i) => i.severity === 'error')) {
      return result;
    }
  }
  result.phasesCompleted.push(ImportPhases.INTEGRITY);

  // Phase 4: Event verification (ST2)
  let validEvents: ContinuumEvent[] = [];

  if (!options.skipEventHashes) {
    const { events, issues: eventIssues } = verifyEvents(options.capsulePath);
    result.issues.push(...eventIssues);
    validEvents = events;

    if (eventIssues.some((i) => i.severity === 'error') && !options.allowWarnings) {
      return result;
    }
  } else {
    // Load events without hash verification
    const eventsPath = join(options.capsulePath, 'events.jsonl');
    if (existsSync(eventsPath)) {
      const raw = readFileSync(eventsPath, 'utf-8');
      const lines = raw.split('\n').filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          validEvents.push(JSON.parse(line) as ContinuumEvent);
        } catch {
          // Skip invalid
        }
      }
    }
  }
  result.phasesCompleted.push(ImportPhases.EVENTS);

  // Phase 5: Import (ST3 — reject if errors, proceed if clean)
  const hasErrors = result.issues.some((i) => i.severity === 'error');
  if (hasErrors && !options.allowWarnings) {
    return result;
  }

  const { projectId, sessionsImported, issues: importIssues } = doImport(
    options.workspaceRoot,
    options.capsulePath,
    manifest,
    validEvents,
    options.title,
  );

  result.issues.push(...importIssues);

  if (importIssues.some((i) => i.severity === 'error')) {
    return result;
  }

  result.phasesCompleted.push(ImportPhases.IMPORT);
  result.success = true;
  result.projectId = projectId;
  result.eventsImported = validEvents.length;
  result.sessionsImported = sessionsImported;

  return result;
}
