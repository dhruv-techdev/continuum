/**
 * Task tracking with pending/active/completed/blocked lifecycle.
 */

import { randomUUID } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export function generateTaskId(): string {
  return `task_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export const TaskStatuses = {
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  BLOCKED: 'blocked',
} as const;

export type TaskStatus = (typeof TaskStatuses)[keyof typeof TaskStatuses];

export const VALID_TASK_STATUSES: readonly TaskStatus[] = Object.values(TaskStatuses);

export interface Task {
  id: string;
  projectId: string;
  description: string;
  status: TaskStatus;
  /** IDs of tasks that must complete before this one */
  dependencies: string[];
  /** Why it's blocked (if status is blocked) */
  blockedReason: string | null;
  /** Completion notes */
  completionNote: string | null;
  /** Event IDs related to this task */
  sourceEventIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CreateTaskInput {
  projectId: string;
  description: string;
  dependencies?: string[];
  sourceEventIds?: string[];
}

// ─── Persistence ────────────────────────────────────────────

const FILENAME = 'tasks.json';

function filePath(workspaceRoot: string, projectId: string): string {
  return join(workspaceRoot, 'projects', projectId, FILENAME);
}

export function loadTasks(workspaceRoot: string, projectId: string): Task[] {
  const path = filePath(workspaceRoot, projectId);
  if (!existsSync(path)) return [];

  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Task[];
  } catch {
    return [];
  }
}

function saveTasks(workspaceRoot: string, projectId: string, tasks: Task[]): void {
  writeFileSync(filePath(workspaceRoot, projectId), JSON.stringify(tasks, null, 2) + '\n', 'utf-8');
}

// ─── Operations ─────────────────────────────────────────────

export function createTask(workspaceRoot: string, input: CreateTaskInput): Task {
  const now = new Date().toISOString();
  const tasks = loadTasks(workspaceRoot, input.projectId);

  const task: Task = {
    id: generateTaskId(),
    projectId: input.projectId,
    description: input.description.trim(),
    status: TaskStatuses.PENDING,
    dependencies: input.dependencies ?? [],
    blockedReason: null,
    completionNote: null,
    sourceEventIds: input.sourceEventIds ?? [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };

  tasks.push(task);
  saveTasks(workspaceRoot, input.projectId, tasks);

  return task;
}

export function updateTaskStatus(
  workspaceRoot: string,
  projectId: string,
  taskId: string,
  status: TaskStatus,
  note?: string,
): Task | null {
  const tasks = loadTasks(workspaceRoot, projectId);
  const task = tasks.find((t) => t.id === taskId);

  if (!task) return null;

  const now = new Date().toISOString();
  task.status = status;
  task.updatedAt = now;

  if (status === TaskStatuses.COMPLETED) {
    task.completedAt = now;
    task.completionNote = note ?? null;
  } else if (status === TaskStatuses.BLOCKED) {
    task.blockedReason = note ?? null;
  }

  saveTasks(workspaceRoot, projectId, tasks);
  return task;
}

export function listTasks(
  workspaceRoot: string,
  projectId: string,
  statusFilter?: TaskStatus,
): Task[] {
  const all = loadTasks(workspaceRoot, projectId);
  if (!statusFilter) return all;
  return all.filter((t) => t.status === statusFilter);
}

export function getTask(workspaceRoot: string, projectId: string, taskId: string): Task | null {
  return loadTasks(workspaceRoot, projectId).find((t) => t.id === taskId) ?? null;
}
