import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Project, CreateProjectInput, StoreResult } from './types';
import { generateProjectId } from './types';

const PROJECTS_DIR = 'projects';
const PROJECT_MANIFEST = 'project.json';

function projectsRoot(workspaceRoot: string): string {
  return join(workspaceRoot, PROJECTS_DIR);
}

function projectDir(workspaceRoot: string, projectId: string): string {
  return join(projectsRoot(workspaceRoot), projectId);
}

function projectManifestPath(workspaceRoot: string, projectId: string): string {
  return join(projectDir(workspaceRoot, projectId), PROJECT_MANIFEST);
}

// Date.now() resolution isn't fine enough to keep rapid, same-tick creations
// ordered, so bump forward by 1ms whenever a collision would occur.
let lastTimestampMs = 0;

function nextTimestamp(): string {
  const nowMs = Math.max(Date.now(), lastTimestampMs + 1);
  lastTimestampMs = nowMs;
  return new Date(nowMs).toISOString();
}

// ─── Read ───────────────────────────────────────────────────────

export function getProject(workspaceRoot: string, projectId: string): Project | null {
  const manifestPath = projectManifestPath(workspaceRoot, projectId);

  if (!existsSync(manifestPath)) return null;

  try {
    const raw = readFileSync(manifestPath, 'utf-8');
    return JSON.parse(raw) as Project;
  } catch {
    return null;
  }
}

export function listProjects(workspaceRoot: string): Project[] {
  const root = projectsRoot(workspaceRoot);

  if (!existsSync(root)) return [];

  const entries = readdirSync(root, { withFileTypes: true });
  const projects: Project[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('proj_')) continue;

    const project = getProject(workspaceRoot, entry.name);
    if (project) projects.push(project);
  }

  // Most recently updated first
  projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return projects;
}

// ─── Write ──────────────────────────────────────────────────────

export function createProject(
  workspaceRoot: string,
  input: CreateProjectInput,
): StoreResult<Project> {
  const root = projectsRoot(workspaceRoot);

  if (!existsSync(root)) {
    return { data: null, error: `Projects directory not found at ${root}. Run "continuum init" first.` };
  }

  const title = input.title.trim();
  if (title.length === 0) {
    return { data: null, error: 'Project title cannot be empty.' };
  }

  const now = nextTimestamp();
  const project: Project = {
    id: generateProjectId(),
    title,
    description: input.description?.trim() ?? '',
    createdAt: now,
    updatedAt: now,
  };

  const dir = projectDir(workspaceRoot, project.id);

  try {
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, 'sessions'), { recursive: true });
    writeFileSync(
      join(dir, PROJECT_MANIFEST),
      JSON.stringify(project, null, 2) + '\n',
      'utf-8',
    );
  } catch (err) {
    return { data: null, error: `Failed to create project: ${(err as Error).message}` };
  }

  return { data: project, error: null };
}
