import { randomUUID } from 'crypto';

export function generateArtifactId(): string {
  return `art_${randomUUID().slice(0, 12)}`;
}

// ─── Storage mode (ST3) ─────────────────────────────────────

export const StorageModes = {
  /** Copy file content into the workspace artifact store */
  CONTENT: 'content',
  /** Store only path, hash, and metadata — no content copy */
  REFERENCE: 'reference',
} as const;

export type StorageMode = (typeof StorageModes)[keyof typeof StorageModes];

// ─── Artifact status ────────────────────────────────────────

export const ArtifactStatuses = {
  ACTIVE: 'active',
  DELETED: 'deleted',
  SUPERSEDED: 'superseded',
} as const;

export type ArtifactStatus = (typeof ArtifactStatuses)[keyof typeof ArtifactStatuses];

// ─── Registry entry (ST1 + ST2) ─────────────────────────────

export interface ArtifactEntry {
  id: string;
  projectId: string;
  /** Original file path or URI */
  uri: string;
  /** File name extracted from URI */
  fileName: string;
  /** MIME type (ST2) */
  mimeType: string;
  /** File size in bytes (ST2) */
  size: number;
  /** SHA-256 hash of file content (ST2) */
  hash: string;
  /** Version number — increments on updates to the same URI */
  version: number;
  /** How the artifact is stored (ST3) */
  storageMode: StorageMode;
  /** Path to stored content relative to artifacts dir (null if reference-only) */
  storedPath: string | null;
  /** Human-readable description */
  description: string;
  /** Event IDs that reference this artifact */
  linkedEventIds: string[];
  status: ArtifactStatus;
  registeredAt: string;
  updatedAt: string;
}

// ─── Inputs ─────────────────────────────────────────────────

export interface RegisterArtifactInput {
  projectId: string;
  /** File path on disk or URI */
  uri: string;
  /** Override MIME type detection */
  mimeType?: string;
  description?: string;
  /** Storage mode override (defaults to project config or 'reference') */
  storageMode?: StorageMode;
  /** Event ID to link to this artifact */
  linkedEventId?: string;
}

export interface RegisterResult {
  artifact: ArtifactEntry | null;
  error: string | null;
  isUpdate: boolean;
}
