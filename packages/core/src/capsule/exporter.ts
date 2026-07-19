/**
 * Capsule exporter.
 *
 * Packages the project ledger, structured state, tracking data,
 * artifact references (and optionally stored content), and an
 * integrity manifest into a portable .ctx directory or .ctx.zip.
 *
 * ST1: Packages ledger + state + artifacts
 * ST2: Generates integrity manifest with per-file SHA-256 hashes
 * ST3: Exposes via `continuum capsule export`
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
  statSync,
} from 'fs';
import { join, basename } from 'path';
import { createHash } from 'crypto';
import { buildManifest } from './builder';
import type { BuildManifestInput } from './builder';
import type { CapsuleFileHash, CapsuleManifest } from './types';

// ─── Export options ─────────────────────────────────────────

export interface ExportOptions {
  workspaceRoot: string;
  projectId: string;
  /** Output directory for the .ctx package */
  outputDir: string;
  /** Include stored artifact content */
  includeArtifactContent?: boolean;
  /** Session IDs to include (all if omitted) */
  sessionFilter?: string[];
  /** Human-readable notes */
  notes?: string;
  /** Expiry timestamp */
  expiresAt?: string;
}

export interface ExportResult {
  capsulePath: string;
  capsuleId: string;
  manifest: CapsuleManifest;
  filesCopied: number;
  totalSize: number;
  error: string | null;
}

// ─── Helpers ────────────────────────────────────────────────

function hashFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function copyIfExists(src: string, dest: string): boolean {
  if (!existsSync(src)) return false;
  copyFileSync(src, dest);
  return true;
}

function dirSize(dirPath: string): number {
  if (!existsSync(dirPath)) return 0;

  let total = 0;
  const entries = readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isFile()) {
      total += statSync(fullPath).size;
    } else if (entry.isDirectory()) {
      total += dirSize(fullPath);
    }
  }

  return total;
}

// ─── ST1: Package everything ────────────────────────────────

export function exportCapsule(options: ExportOptions): ExportResult {
  const { workspaceRoot, projectId, outputDir } = options;
  const projectDir = join(workspaceRoot, 'projects', projectId);

  if (!existsSync(projectDir)) {
    return {
      capsulePath: '', capsuleId: '', manifest: null as unknown as CapsuleManifest,
      filesCopied: 0, totalSize: 0,
      error: `Project directory not found: ${projectDir}`,
    };
  }

  // Build the manifest first so we have the capsule ID
  const manifest = buildManifest({
    workspaceRoot,
    projectId,
    notes: options.notes,
    expiresAt: options.expiresAt,
    sessionFilter: options.sessionFilter,
  });

  // Create the capsule directory
  const capsuleName = `${manifest.project.title.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase()}.ctx`;
  const capsulePath = join(outputDir, capsuleName);

  try {
    mkdirSync(capsulePath, { recursive: true });
  } catch (err) {
    return {
      capsulePath, capsuleId: manifest.capsuleId, manifest,
      filesCopied: 0, totalSize: 0,
      error: `Cannot create capsule directory: ${(err as Error).message}`,
    };
  }

  let filesCopied = 0;
  const integrityFiles: CapsuleFileHash[] = [];

  // ── Combine event ledgers from all included sessions (ST1) ──

  const sessionsDir = join(projectDir, 'sessions');
  const allEventLines: string[] = [];

  for (const sessionId of manifest.project.sessionIds) {
    const ledgerPath = join(sessionsDir, sessionId, 'events.jsonl');
    if (!existsSync(ledgerPath)) continue;

    const raw = readFileSync(ledgerPath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    allEventLines.push(...lines);
  }

  const combinedLedger = allEventLines.join('\n') + (allEventLines.length > 0 ? '\n' : '');
  const ledgerOutPath = join(capsulePath, 'events.jsonl');
  writeFileSync(ledgerOutPath, combinedLedger, 'utf-8');
  filesCopied++;

  integrityFiles.push({
    path: 'events.jsonl',
    hash: hashFile(ledgerOutPath),
    size: statSync(ledgerOutPath).size,
  });

  // ── Copy state (ST1) ────────────────────────────────────

  const stateSrc = join(projectDir, 'working-state.json');
  const stateDest = join(capsulePath, 'state.json');
  if (copyIfExists(stateSrc, stateDest)) {
    filesCopied++;
    integrityFiles.push({ path: 'state.json', hash: hashFile(stateDest), size: statSync(stateDest).size });
  }

  // ── Copy tracking files (ST1) ───────────────────────────

  for (const filename of ['decisions.json', 'tasks.json', 'attempts.json']) {
    const src = join(projectDir, filename);
    const dest = join(capsulePath, filename);
    if (copyIfExists(src, dest)) {
      filesCopied++;
      integrityFiles.push({ path: filename, hash: hashFile(dest), size: statSync(dest).size });
    }
  }

  // ── Copy artifact registry and optionally content (ST1) ─

  const registrySrc = join(projectDir, 'artifacts.json');
  const registryDest = join(capsulePath, 'artifacts.json');
  if (copyIfExists(registrySrc, registryDest)) {
    filesCopied++;
    integrityFiles.push({ path: 'artifacts.json', hash: hashFile(registryDest), size: statSync(registryDest).size });
  }

  if (options.includeArtifactContent) {
    const artSrc = join(projectDir, 'artifacts');
    const artDest = join(capsulePath, 'artifacts');

    if (existsSync(artSrc)) {
      mkdirSync(artDest, { recursive: true });
      const artFiles = readdirSync(artSrc);

      for (const artFile of artFiles) {
        const srcPath = join(artSrc, artFile);
        const destPath = join(artDest, artFile);

        if (statSync(srcPath).isFile()) {
          copyFileSync(srcPath, destPath);
          filesCopied++;
          integrityFiles.push({
            path: `artifacts/${artFile}`,
            hash: hashFile(destPath),
            size: statSync(destPath).size,
          });
        }
      }
    }
  }

  // ── Copy session manifests ──────────────────────────────

  const sessionsOutDir = join(capsulePath, 'sessions');
  mkdirSync(sessionsOutDir, { recursive: true });

  for (const sessionId of manifest.project.sessionIds) {
    const sessionManifest = join(sessionsDir, sessionId, 'session.json');
    if (existsSync(sessionManifest)) {
      const dest = join(sessionsOutDir, `${sessionId}.json`);
      copyFileSync(sessionManifest, dest);
      filesCopied++;
      integrityFiles.push({
        path: `sessions/${sessionId}.json`,
        hash: hashFile(dest),
        size: statSync(dest).size,
      });
    }
  }

  // ── Copy project manifest ──────────────────────────────

  const projManifestSrc = join(projectDir, 'project.json');
  const projManifestDest = join(capsulePath, 'project.json');
  if (copyIfExists(projManifestSrc, projManifestDest)) {
    filesCopied++;
    integrityFiles.push({ path: 'project.json', hash: hashFile(projManifestDest), size: statSync(projManifestDest).size });
  }

  // ── Create evaluations directory (placeholder) ──────────

  const evalsDir = join(capsulePath, 'evaluations');
  mkdirSync(evalsDir, { recursive: true });

  // ── ST2: Write integrity manifest ──────────────────────

  const integrityManifest = {
    algorithm: 'sha256' as const,
    files: integrityFiles,
    computedAt: new Date().toISOString(),
  };

  const integrityPath = join(capsulePath, 'integrity.json');
  writeFileSync(integrityPath, JSON.stringify(integrityManifest, null, 2) + '\n', 'utf-8');
  filesCopied++;

  // ── Update manifest with final integrity and write it ───

  manifest.integrity = integrityManifest;

  const manifestPath = join(capsulePath, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  filesCopied++;

  const totalSize = dirSize(capsulePath);

  return {
    capsulePath,
    capsuleId: manifest.capsuleId,
    manifest,
    filesCopied,
    totalSize,
    error: null,
  };
}

// ─── Verify an exported capsule against its integrity.json ──

export interface VerifyCapsuleResult {
  valid: boolean;
  filesChecked: number;
  mismatches: Array<{ path: string; expected: string; actual: string }>;
  missing: string[];
  error: string | null;
}

export function verifyCapsuleIntegrity(capsulePath: string): VerifyCapsuleResult {
  const integrityPath = join(capsulePath, 'integrity.json');

  if (!existsSync(integrityPath)) {
    return { valid: false, filesChecked: 0, mismatches: [], missing: ['integrity.json'], error: 'integrity.json not found.' };
  }

  let integrity: { files: CapsuleFileHash[] };
  try {
    integrity = JSON.parse(readFileSync(integrityPath, 'utf-8'));
  } catch {
    return { valid: false, filesChecked: 0, mismatches: [], missing: [], error: 'integrity.json is not valid JSON.' };
  }

  const mismatches: Array<{ path: string; expected: string; actual: string }> = [];
  const missing: string[] = [];
  let filesChecked = 0;

  for (const entry of integrity.files) {
    const fullPath = join(capsulePath, entry.path);

    if (!existsSync(fullPath)) {
      missing.push(entry.path);
      continue;
    }

    filesChecked++;
    const actual = hashFile(fullPath);

    if (actual !== entry.hash) {
      mismatches.push({ path: entry.path, expected: entry.hash, actual });
    }
  }

  return {
    valid: mismatches.length === 0 && missing.length === 0,
    filesChecked,
    mismatches,
    missing,
    error: null,
  };
}
