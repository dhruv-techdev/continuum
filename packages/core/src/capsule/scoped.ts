/**
 * Scoped shareable capsule.
 *
 * ST1: Filter capsule content by task, event type, artifact, session, date range
 * ST2: Exclude redacted and restricted content via privacy scanner
 * ST3: Encrypt the capsule with a passphrase using AES-256-GCM
 */

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  statSync,
  copyFileSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import { createHash, randomBytes, createCipheriv, createDecipheriv, scryptSync } from 'crypto';
import { listSessions } from '../projects/session-store';
import { getProject } from '../projects/project-store';
import { openLedger } from '../ledger/event-ledger';
import { processEvents, getTransferableEvents, buildRedactionReport, RedactionActions } from '../privacy/index';
import { buildManifest } from './builder';
import type { CapsuleManifest } from './types';
import type { ContinuumEvent } from '../events/types';
import type { ProcessOptions, RedactionReport } from '../privacy/index';

// ─── Scope filter (ST1) ─────────────────────────────────────

export interface ScopeFilter {
  /** Include only these session IDs */
  sessionIds?: string[];
  /** Include only these event types */
  eventTypes?: string[];
  /** Include only events after this ISO timestamp */
  after?: string;
  /** Include only events before this ISO timestamp */
  before?: string;
  /** Include only events matching these source patterns */
  sources?: string[];
  /** Include only events mentioning these keywords in content */
  keywords?: string[];
  /** Exclude events with these IDs */
  excludeEventIds?: string[];
}

function matchesScope(event: ContinuumEvent, scope: ScopeFilter): boolean {
  if (scope.sessionIds && !scope.sessionIds.includes(event.sessionId)) return false;
  if (scope.eventTypes && !scope.eventTypes.includes(event.type)) return false;
  if (scope.after && event.timestamp <= scope.after) return false;
  if (scope.before && event.timestamp >= scope.before) return false;
  if (scope.excludeEventIds && scope.excludeEventIds.includes(event.id)) return false;

  if (scope.sources) {
    const matches = scope.sources.some((s) => event.source.includes(s));
    if (!matches) return false;
  }

  if (scope.keywords && scope.keywords.length > 0) {
    const payload = JSON.stringify(event.payload).toLowerCase();
    const matches = scope.keywords.some((kw) => payload.includes(kw.toLowerCase()));
    if (!matches) return false;
  }

  return true;
}

// ─── Scoped export options ──────────────────────────────────

export interface ScopedExportOptions {
  workspaceRoot: string;
  projectId: string;
  outputDir: string;
  /** Content scope filter (ST1) */
  scope?: ScopeFilter;
  /** Privacy processing options (ST2) */
  privacy?: ProcessOptions & {
    /** Run the privacy scanner before export */
    enabled?: boolean;
  };
  /** Encryption passphrase (ST3) — if provided, capsule is encrypted */
  passphrase?: string;
  /** Include optional files */
  includeState?: boolean;
  includeTracking?: boolean;
  includeArtifacts?: boolean;
  /** Capsule metadata */
  notes?: string;
  expiresAt?: string;
}

export interface ScopedExportResult {
  capsulePath: string;
  capsuleId: string;
  eventsIncluded: number;
  eventsExcluded: number;
  eventsByScope: number;
  eventsByPrivacy: number;
  encrypted: boolean;
  redactionReport: RedactionReport | null;
  manifest: CapsuleManifest;
  error: string | null;
}

// ─── ST3: Encryption ────────────────────────────────────────

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32);
}

export function encryptFile(filePath: string, passphrase: string): void {
  const plaintext = readFileSync(filePath);
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(passphrase, salt);
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: salt (32) + iv (16) + authTag (16) + encrypted data
  const output = Buffer.concat([salt, iv, authTag, encrypted]);
  writeFileSync(filePath + '.enc', output);

  // Remove the original
  unlinkSync(filePath);
}

export function decryptFile(encFilePath: string, passphrase: string): Buffer {
  const data = readFileSync(encFilePath);

  const salt = data.subarray(0, SALT_LENGTH);
  const iv = data.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = data.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);

  const key = deriveKey(passphrase, salt);
  const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// ─── Build scoped capsule ───────────────────────────────────

export function exportScopedCapsule(options: ScopedExportOptions): ScopedExportResult {
  const { workspaceRoot, projectId, outputDir } = options;
  const project = getProject(workspaceRoot, projectId);

  if (!project) {
    return {
      capsulePath: '', capsuleId: '', eventsIncluded: 0, eventsExcluded: 0,
      eventsByScope: 0, eventsByPrivacy: 0, encrypted: false,
      redactionReport: null, manifest: null as unknown as CapsuleManifest,
      error: `Project "${projectId}" not found.`,
    };
  }

  // Load all events
  const sessions = listSessions(workspaceRoot, projectId);
  let allEvents: ContinuumEvent[] = [];

  for (const session of sessions) {
    const { events } = openLedger(workspaceRoot, projectId, session.id).readAll();
    allEvents.push(...events);
  }

  allEvents.sort((a, b) => a.sequence - b.sequence);
  const totalBefore = allEvents.length;

  // ST1: Apply scope filter
  let scopedEvents = allEvents;
  if (options.scope) {
    scopedEvents = allEvents.filter((e) => matchesScope(e, options.scope!));
  }
  const eventsByScope = totalBefore - scopedEvents.length;

  // ST2: Apply privacy scanner
  let finalEvents = scopedEvents;
  let redactionReport: RedactionReport | null = null;
  let eventsByPrivacy = 0;

  if (options.privacy?.enabled !== false) {
    const privacyOpts: ProcessOptions = {
      defaultAction: options.privacy?.defaultAction ?? RedactionActions.REDACT,
      skipHighFalsePositive: options.privacy?.skipHighFalsePositive,
      patternActions: options.privacy?.patternActions,
      typeActions: options.privacy?.typeActions,
    };

    const { events: processed, summary } = processEvents(scopedEvents, privacyOpts);
    redactionReport = buildRedactionReport(processed, summary);
    finalEvents = getTransferableEvents(processed);
    eventsByPrivacy = scopedEvents.length - finalEvents.length;
  }

  // Create capsule directory
  const safeName = project.title.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const capsuleName = `${safeName}-scoped.ctx`;
  const capsulePath = join(outputDir, capsuleName);

  try {
    mkdirSync(capsulePath, { recursive: true });
  } catch (err) {
    return {
      capsulePath, capsuleId: '', eventsIncluded: finalEvents.length, eventsExcluded: eventsByScope + eventsByPrivacy,
      eventsByScope, eventsByPrivacy, encrypted: false, redactionReport,
      manifest: null as unknown as CapsuleManifest,
      error: `Cannot create directory: ${(err as Error).message}`,
    };
  }

  // Write filtered events
  const ledgerContent = finalEvents.map((e) => JSON.stringify(e)).join('\n') + (finalEvents.length > 0 ? '\n' : '');
  writeFileSync(join(capsulePath, 'events.jsonl'), ledgerContent, 'utf-8');

  // Write project.json
  writeFileSync(join(capsulePath, 'project.json'), JSON.stringify({
    id: projectId,
    title: project.title,
    description: project.description,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    scoped: true,
  }, null, 2) + '\n', 'utf-8');

  // Copy optional files
  const projectDir = join(workspaceRoot, 'projects', projectId);

  if (options.includeState !== false) {
    const stateSrc = join(projectDir, 'working-state.json');
    if (existsSync(stateSrc)) copyFileSync(stateSrc, join(capsulePath, 'state.json'));
  }

  if (options.includeTracking !== false) {
    for (const f of ['decisions.json', 'tasks.json', 'attempts.json']) {
      const src = join(projectDir, f);
      if (existsSync(src)) copyFileSync(src, join(capsulePath, f));
    }
  }

  if (options.includeArtifacts) {
    const regSrc = join(projectDir, 'artifacts.json');
    if (existsSync(regSrc)) copyFileSync(regSrc, join(capsulePath, 'artifacts.json'));
  }

  // Write scope metadata
  writeFileSync(join(capsulePath, 'scope.json'), JSON.stringify({
    filter: options.scope ?? null,
    totalEvents: totalBefore,
    includedEvents: finalEvents.length,
    excludedByScope: eventsByScope,
    excludedByPrivacy: eventsByPrivacy,
    privacyEnabled: options.privacy?.enabled !== false,
    generatedAt: new Date().toISOString(),
  }, null, 2) + '\n', 'utf-8');

  // Write redaction report if applicable
  if (redactionReport) {
    writeFileSync(join(capsulePath, 'redaction-report.json'), JSON.stringify(redactionReport, null, 2) + '\n', 'utf-8');
  }

  // Build integrity
  const integrityFiles: Array<{ path: string; hash: string; size: number }> = [];
  const capsuleFiles = readdirSync(capsulePath).filter((f) => statSync(join(capsulePath, f)).isFile());

  for (const f of capsuleFiles) {
    const fullPath = join(capsulePath, f);
    integrityFiles.push({
      path: f,
      hash: createHash('sha256').update(readFileSync(fullPath)).digest('hex'),
      size: statSync(fullPath).size,
    });
  }

  writeFileSync(join(capsulePath, 'integrity.json'), JSON.stringify({
    algorithm: 'sha256',
    files: integrityFiles,
    computedAt: new Date().toISOString(),
  }, null, 2) + '\n', 'utf-8');

  // Build manifest
  const manifest = buildManifest({
    workspaceRoot,
    projectId,
    notes: options.notes,
    expiresAt: options.expiresAt,
    sessionFilter: options.scope?.sessionIds,
  });

  // Override manifest counts with scoped values
  manifest.ledger.eventCount = finalEvents.length;
  writeFileSync(join(capsulePath, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

  // ST3: Encrypt if passphrase provided
  let encrypted = false;

  if (options.passphrase) {
    const filesToEncrypt = readdirSync(capsulePath)
      .filter((f) => f !== 'manifest.json' && !f.endsWith('.enc') && statSync(join(capsulePath, f)).isFile());

    for (const f of filesToEncrypt) {
      encryptFile(join(capsulePath, f), options.passphrase);
    }

    // Update manifest to indicate encryption
    const encManifest = { ...manifest, encrypted: true, encryptedFiles: filesToEncrypt.map((f) => f + '.enc') };
    writeFileSync(join(capsulePath, 'manifest.json'), JSON.stringify(encManifest, null, 2) + '\n', 'utf-8');
    encrypted = true;
  }

  return {
    capsulePath,
    capsuleId: manifest.capsuleId,
    eventsIncluded: finalEvents.length,
    eventsExcluded: eventsByScope + eventsByPrivacy,
    eventsByScope,
    eventsByPrivacy,
    encrypted,
    redactionReport,
    manifest,
    error: null,
  };
}
