/**
 * Artifact registry.
 *
 * Maintains a registry.json file inside the project directory
 * that indexes all known artifacts with their metadata. Optionally
 * copies file content into the project's artifacts/ store (ST3).
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  statSync,
  copyFileSync,
} from 'fs';
import { join, basename, extname } from 'path';
import { createHash } from 'crypto';
import { detectMimeType } from './mime';
import {
  generateArtifactId,
  StorageModes,
  ArtifactStatuses,
} from './types';
import type {
  ArtifactEntry,
  RegisterArtifactInput,
  RegisterResult,
  StorageMode,
} from './types';

const REGISTRY_FILENAME = 'artifacts.json';
const ARTIFACTS_DIR = 'artifacts';

// ─── Paths ──────────────────────────────────────────────────

function registryPath(workspaceRoot: string, projectId: string): string {
  return join(workspaceRoot, 'projects', projectId, REGISTRY_FILENAME);
}

function artifactsDir(workspaceRoot: string, projectId: string): string {
  return join(workspaceRoot, 'projects', projectId, ARTIFACTS_DIR);
}

// ─── File hashing (ST2) ────────────────────────────────────

export function hashFileContent(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash('sha256').update(content).digest('hex');
}

// ─── Registry I/O (ST1) ────────────────────────────────────

export function loadRegistry(workspaceRoot: string, projectId: string): ArtifactEntry[] {
  const path = registryPath(workspaceRoot, projectId);

  if (!existsSync(path)) return [];

  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRegistry(
  workspaceRoot: string,
  projectId: string,
  entries: ArtifactEntry[],
): void {
  const path = registryPath(workspaceRoot, projectId);
  writeFileSync(path, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
}

// ─── Lookup ─────────────────────────────────────────────────

export function findArtifactByUri(
  workspaceRoot: string,
  projectId: string,
  uri: string,
): ArtifactEntry | null {
  const entries = loadRegistry(workspaceRoot, projectId);
  // Find the latest active version for this URI
  return entries
    .filter((e) => e.uri === uri && e.status === ArtifactStatuses.ACTIVE)
    .sort((a, b) => b.version - a.version)[0] ?? null;
}

export function findArtifactById(
  workspaceRoot: string,
  projectId: string,
  artifactId: string,
): ArtifactEntry | null {
  const entries = loadRegistry(workspaceRoot, projectId);
  return entries.find((e) => e.id === artifactId) ?? null;
}

export function listArtifacts(
  workspaceRoot: string,
  projectId: string,
  includeInactive = false,
): ArtifactEntry[] {
  const entries = loadRegistry(workspaceRoot, projectId);

  if (includeInactive) return entries;

  return entries.filter((e) => e.status === ArtifactStatuses.ACTIVE);
}

// ─── Register (ST1 + ST2 + ST3) ────────────────────────────

export function registerArtifact(
  workspaceRoot: string,
  input: RegisterArtifactInput,
): RegisterResult {
  const { projectId, uri } = input;

  const projectDir = join(workspaceRoot, 'projects', projectId);
  if (!existsSync(projectDir)) {
    return { artifact: null, error: `Project "${projectId}" not found.`, isUpdate: false };
  }

  // Resolve file metadata (ST2)
  const isLocalFile = existsSync(uri);
  let size = 0;
  let hash = '';
  let mimeType = input.mimeType ?? 'application/octet-stream';

  if (isLocalFile) {
    const stat = statSync(uri);
    size = stat.size;
    hash = hashFileContent(uri);
    if (!input.mimeType) {
      mimeType = detectMimeType(uri);
    }
  }

  const storageMode: StorageMode = input.storageMode ?? StorageModes.REFERENCE;

  // Check for existing entry at same URI
  const entries = loadRegistry(workspaceRoot, projectId);
  const existing = entries
    .filter((e) => e.uri === uri && e.status === ArtifactStatuses.ACTIVE)
    .sort((a, b) => b.version - a.version)[0];

  let isUpdate = false;

  // If same hash, nothing changed — just link the event if needed
  if (existing && existing.hash === hash && hash !== '') {
    if (input.linkedEventId && !existing.linkedEventIds.includes(input.linkedEventId)) {
      existing.linkedEventIds.push(input.linkedEventId);
      existing.updatedAt = new Date().toISOString();
      saveRegistry(workspaceRoot, projectId, entries);
    }
    return { artifact: existing, error: null, isUpdate: false };
  }

  // Supersede old version if content changed
  if (existing && existing.hash !== hash) {
    existing.status = ArtifactStatuses.SUPERSEDED;
    existing.updatedAt = new Date().toISOString();
    isUpdate = true;
  }

  // Store content if mode is CONTENT and file exists (ST3)
  let storedPath: string | null = null;

  if (storageMode === StorageModes.CONTENT && isLocalFile) {
    const artDir = artifactsDir(workspaceRoot, projectId);
    mkdirSync(artDir, { recursive: true });

    const ext = extname(uri);
    const storedName = `${generateArtifactId()}${ext}`;
    const destPath = join(artDir, storedName);

    try {
      copyFileSync(uri, destPath);
      storedPath = storedName;
    } catch (err) {
      return {
        artifact: null,
        error: `Failed to copy artifact content: ${(err as Error).message}`,
        isUpdate: false,
      };
    }
  }

  const now = new Date().toISOString();
  const newVersion = existing ? existing.version + 1 : 1;

  const entry: ArtifactEntry = {
    id: generateArtifactId(),
    projectId,
    uri,
    fileName: basename(uri),
    mimeType,
    size,
    hash,
    version: newVersion,
    storageMode,
    storedPath,
    description: input.description?.trim() ?? '',
    linkedEventIds: input.linkedEventId ? [input.linkedEventId] : [],
    status: ArtifactStatuses.ACTIVE,
    registeredAt: now,
    updatedAt: now,
  };

  entries.push(entry);
  saveRegistry(workspaceRoot, projectId, entries);

  return { artifact: entry, error: null, isUpdate };
}

// ─── Link an event to an existing artifact ──────────────────

export function linkEventToArtifact(
  workspaceRoot: string,
  projectId: string,
  artifactId: string,
  eventId: string,
): boolean {
  const entries = loadRegistry(workspaceRoot, projectId);
  const entry = entries.find((e) => e.id === artifactId);

  if (!entry) return false;
  if (entry.linkedEventIds.includes(eventId)) return true;

  entry.linkedEventIds.push(eventId);
  entry.updatedAt = new Date().toISOString();
  saveRegistry(workspaceRoot, projectId, entries);

  return true;
}

// ─── Delete (soft) ──────────────────────────────────────────

export function deleteArtifact(
  workspaceRoot: string,
  projectId: string,
  artifactId: string,
): boolean {
  const entries = loadRegistry(workspaceRoot, projectId);
  const entry = entries.find((e) => e.id === artifactId);

  if (!entry) return false;

  entry.status = ArtifactStatuses.DELETED;
  entry.updatedAt = new Date().toISOString();
  saveRegistry(workspaceRoot, projectId, entries);

  return true;
}
