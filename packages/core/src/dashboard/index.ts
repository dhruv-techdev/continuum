/**
 * Dashboard data aggregator.
 *
 * Collects project-wide stats from all subsystems into
 * a single snapshot for display.
 */

import { getProject } from '../projects/project-store';
import { listSessions } from '../projects/session-store';
import { openLedger } from '../ledger/event-ledger';
import { loadWorkingState, getActiveStatements } from '../state-engine/index';
import { listDecisions } from '../tracking/decisions';
import { listTasks } from '../tracking/tasks';
import { listAttempts, getFailedAttempts } from '../tracking/attempts';
import { loadRegistry } from '../artifacts/registry';
import { loadLatestReport, listReports } from '../verification/persistence';

// ─── Dashboard snapshot ─────────────────────────────────────

export interface DashboardSnapshot {
  generatedAt: string;

  // ST1: Project overview
  project: {
    id: string;
    title: string;
    description: string;
    createdAt: string;
  };

  sessions: {
    total: number;
    active: number;
    closed: number;
    list: Array<{
      id: string;
      provider: string;
      model: string;
      status: string;
      eventCount: number;
      startedAt: string;
    }>;
  };

  events: {
    total: number;
    byType: Record<string, number>;
    bySource: Record<string, number>;
    firstTimestamp: string | null;
    lastTimestamp: string | null;
  };

  // ST2: Working state
  state: {
    available: boolean;
    objectives: string[];
    constraints: string[];
    requirements: string[];
    nextActions: string[];
    openQuestions: string[];
    totalStatements: number;
  };

  tasks: {
    total: number;
    pending: number;
    active: number;
    completed: number;
    blocked: number;
    blockedItems: Array<{ description: string; reason: string }>;
  };

  decisions: {
    total: number;
    active: number;
    rejected: number;
    superseded: number;
    recentDecisions: Array<{ choice: string; status: string }>;
  };

  attempts: {
    total: number;
    successes: number;
    failures: number;
    recentFailures: Array<{ approach: string; reason: string }>;
  };

  artifacts: {
    total: number;
    stored: number;
    referenced: number;
  };

  // ST3: Verification
  verification: {
    reportCount: number;
    latestReport: {
      passed: boolean;
      overallScore: number;
      correctness: number;
      completeness: number;
      totalChecks: number;
      passedChecks: number;
      failedChecks: number;
      criticalFailures: number;
      scoredAt: string;
    } | null;
  };
}

// ─── Build dashboard ────────────────────────────────────────

export function buildDashboard(workspaceRoot: string, projectId: string): DashboardSnapshot | null {
  const project = getProject(workspaceRoot, projectId);
  if (!project) return null;

  const sessions = listSessions(workspaceRoot, projectId);

  // Load all events
  let totalEvents = 0;
  const byType: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let firstTs: string | null = null;
  let lastTs: string | null = null;

  for (const session of sessions) {
    const { events } = openLedger(workspaceRoot, projectId, session.id).readAll();
    totalEvents += events.length;

    for (const event of events) {
      byType[event.type] = (byType[event.type] ?? 0) + 1;
      bySource[event.source] = (bySource[event.source] ?? 0) + 1;

      if (!firstTs || event.timestamp < firstTs) firstTs = event.timestamp;
      if (!lastTs || event.timestamp > lastTs) lastTs = event.timestamp;
    }
  }

  // State
  const state = loadWorkingState(workspaceRoot, projectId);
  const activeStatements = state ? getActiveStatements(state) : [];

  // Tasks
  const tasks = listTasks(workspaceRoot, projectId);
  const blockedTasks = tasks.filter((t) => t.status === 'blocked');

  // Decisions
  const allDecisions = listDecisions(workspaceRoot, projectId, true);
  const activeDecisions = allDecisions.filter((d) => d.status === 'active');

  // Attempts
  const allAttempts = listAttempts(workspaceRoot, projectId);
  const failedAttempts = getFailedAttempts(workspaceRoot, projectId);

  // Artifacts
  const artifacts = loadRegistry(workspaceRoot, projectId);
  const activeArtifacts = artifacts.filter((a) => a.status === 'active');

  // Verification
  const latestReport = loadLatestReport(workspaceRoot, projectId);
  const reportFiles = listReports(workspaceRoot, projectId);

  return {
    generatedAt: new Date().toISOString(),

    project: {
      id: projectId,
      title: project.title,
      description: project.description,
      createdAt: project.createdAt,
    },

    sessions: {
      total: sessions.length,
      active: sessions.filter((s) => s.status === 'active').length,
      closed: sessions.filter((s) => s.status === 'closed').length,
      list: sessions.map((s) => ({
        id: s.id,
        provider: s.provider,
        model: s.model,
        status: s.status,
        eventCount: s.eventCount,
        startedAt: s.startedAt,
      })),
    },

    events: {
      total: totalEvents,
      byType,
      bySource,
      firstTimestamp: firstTs,
      lastTimestamp: lastTs,
    },

    state: {
      available: !!state,
      objectives: state ? state.objectives.filter((s) => s.status === 'active').map((s) => s.text) : [],
      constraints: state ? state.constraints.filter((s) => s.status === 'active').map((s) => s.text) : [],
      requirements: state ? (state.requirements ?? []).filter((s) => s.status === 'active').map((s) => s.text) : [],
      nextActions: state ? state.nextActions.filter((s) => s.status === 'active').map((s) => s.text) : [],
      openQuestions: state ? state.openQuestions.filter((s) => s.status === 'active').map((s) => s.text) : [],
      totalStatements: activeStatements.length,
    },

    tasks: {
      total: tasks.length,
      pending: tasks.filter((t) => t.status === 'pending').length,
      active: tasks.filter((t) => t.status === 'active').length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      blocked: blockedTasks.length,
      blockedItems: blockedTasks.map((t) => ({
        description: t.description,
        reason: t.blockedReason ?? 'unknown',
      })),
    },

    decisions: {
      total: allDecisions.length,
      active: activeDecisions.length,
      rejected: allDecisions.filter((d) => d.status === 'rejected').length,
      superseded: allDecisions.filter((d) => d.status === 'superseded').length,
      recentDecisions: activeDecisions.slice(-5).map((d) => ({ choice: d.choice, status: d.status })),
    },

    attempts: {
      total: allAttempts.length,
      successes: allAttempts.filter((a) => a.outcome === 'success').length,
      failures: failedAttempts.length,
      recentFailures: failedAttempts.slice(-3).map((a) => ({
        approach: a.approach,
        reason: a.failureReason ?? a.outcome,
      })),
    },

    artifacts: {
      total: activeArtifacts.length,
      stored: activeArtifacts.filter((a) => a.storageMode === 'content').length,
      referenced: activeArtifacts.filter((a) => a.storageMode === 'reference').length,
    },

    verification: {
      reportCount: reportFiles.length,
      latestReport: latestReport ? {
        passed: latestReport.passed,
        overallScore: latestReport.overallScore,
        correctness: latestReport.correctness,
        completeness: latestReport.completeness,
        totalChecks: latestReport.totalChecks,
        passedChecks: latestReport.passedChecks,
        failedChecks: latestReport.failedChecks,
        criticalFailures: latestReport.criticalFailures,
        scoredAt: latestReport.scoredAt ?? '',
      } : null,
    },
  };
}
