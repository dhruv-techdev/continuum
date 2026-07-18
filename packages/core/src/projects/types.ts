import { randomUUID } from 'crypto';

// ─── IDs ────────────────────────────────────────────────────────

export function generateProjectId(): string {
  return `proj_${randomUUID()}`;
}

export function generateSessionId(): string {
  return `sess_${randomUUID()}`;
}

// ─── Session status ─────────────────────────────────────────────

export const SessionStatuses = {
  ACTIVE: 'active',
  CLOSED: 'closed',
} as const;

export type SessionStatus = (typeof SessionStatuses)[keyof typeof SessionStatuses];

// ─── Models ─────────────────────────────────────────────────────

export interface Project {
  id: string;
  title: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  projectId: string;
  provider: string;
  model: string;
  status: SessionStatus;
  startedAt: string;
  closedAt: string | null;
  eventCount: number;
}

// ─── Inputs ─────────────────────────────────────────────────────

export interface CreateProjectInput {
  title: string;
  description?: string;
}

export interface StartSessionInput {
  projectId: string;
  provider?: string;
  model?: string;
}

// ─── Operation result ───────────────────────────────────────────

export interface StoreResult<T> {
  data: T | null;
  error: string | null;
}
