/**
 * MCP tool implementations for Continuum context.
 *
 * Each tool maps to a product spec MCP tool:
 *   ST2: context.resume, context.get_state, context.search
 *   ST3: context.get_source, context.get_decisions, context.get_attempts
 */

import {
  DEFAULT_ROOT,
  getState,
  getProject,
  listProjects,
  listSessions,
  openLedger,
  buildContextPackage,
  buildSingleLayer,
  ContextLayers,
  extractWorkingState,
  loadWorkingState,
  saveWorkingState,
  getActiveStatements,
  listDecisions,
  getDecision,
  listTasks,
  listAttempts,
  getFailedAttempts,
  getAttempt,
  openDB,
  closeDB,
  ensureFTS,
  search,
  recoverWorkspace,
  countIndexed,
  getEventById,
} from '@continuum/core';
import type { ContinuumEvent } from '@continuum/core';

// ─── Shared helpers ─────────────────────────────────────────

function resolveProjectId(root: string, projectIdArg?: string): string | null {
  if (projectIdArg) return projectIdArg;
  const state = getState(root);
  return state.activeProjectId;
}

function loadAllEvents(root: string, projectId: string): ContinuumEvent[] {
  const sessions = listSessions(root, projectId);
  const all: ContinuumEvent[] = [];
  for (const s of sessions) {
    const { events } = openLedger(root, projectId, s.id).readAll();
    all.push(...events);
  }
  all.sort((a, b) => a.sequence - b.sequence);
  return all;
}

function ensureState(root: string, projectId: string) {
  let state = loadWorkingState(root, projectId);
  if (!state) {
    const events = loadAllEvents(root, projectId);
    state = extractWorkingState(projectId, events);
    saveWorkingState(root, projectId, state);
  }
  return state;
}

// ─── Tool definitions ───────────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, root: string) => unknown;
}

// ─── ST2: context.resume ────────────────────────────────────

export const contextResume: ToolDef = {
  name: 'context.resume',
  description: 'Return the task-specific bootstrap package (L0+L1+L2) for continuing work. This is the first tool to call when resuming a project.',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: { type: 'string', description: 'Project ID (uses active project if omitted)' },
      token_budget: { type: 'number', description: 'Max tokens for the context package (0 = unlimited)' },
    },
  },
  handler: (args, root) => {
    const projectId = resolveProjectId(root, args.project_id as string | undefined);
    if (!projectId) return { error: 'No active project. Provide project_id or select a project first.' };

    const project = getProject(root, projectId);
    if (!project) return { error: `Project "${projectId}" not found.` };

    const pkg = buildContextPackage({
      workspaceRoot: root,
      projectId,
      tokenBudget: (args.token_budget as number) ?? 0,
      layers: [ContextLayers.L0_ORIENTATION, ContextLayers.L1_ACTIVE_STATE, ContextLayers.L2_GOVERNING],
    });

    return {
      project: { id: projectId, title: project.title },
      context: pkg.combined,
      tokens: pkg.totalTokens,
      layers: pkg.includedLayers,
      excluded: pkg.excludedLayers,
    };
  },
};

// ─── ST2: context.get_state ─────────────────────────────────

export const contextGetState: ToolDef = {
  name: 'context.get_state',
  description: 'Retrieve current objective, progress, blockers, and next actions for the project.',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: { type: 'string', description: 'Project ID (uses active project if omitted)' },
    },
  },
  handler: (args, root) => {
    const projectId = resolveProjectId(root, args.project_id as string | undefined);
    if (!projectId) return { error: 'No active project.' };

    const state = ensureState(root, projectId);
    const active = getActiveStatements(state);
    const tasks = listTasks(root, projectId);

    return {
      project_id: projectId,
      total_events: state.totalEventsProcessed,
      objectives: state.objectives.filter((s) => s.status === 'active').map((s) => ({ text: s.text, confidence: s.confidence, sources: s.sourceEventIds })),
      requirements: (state.requirements ?? []).filter((s) => s.status === 'active').map((s) => ({ text: s.text, sources: s.sourceEventIds })),
      constraints: state.constraints.filter((s) => s.status === 'active').map((s) => ({ text: s.text, sources: s.sourceEventIds })),
      next_actions: state.nextActions.filter((s) => s.status === 'active').map((s) => ({ text: s.text, sources: s.sourceEventIds })),
      open_questions: state.openQuestions.filter((s) => s.status === 'active').map((s) => ({ text: s.text, sources: s.sourceEventIds })),
      tasks: {
        active: tasks.filter((t) => t.status === 'active').map((t) => ({ id: t.id, description: t.description })),
        blocked: tasks.filter((t) => t.status === 'blocked').map((t) => ({ id: t.id, description: t.description, reason: t.blockedReason })),
        pending: tasks.filter((t) => t.status === 'pending').map((t) => ({ id: t.id, description: t.description })),
        completed_count: tasks.filter((t) => t.status === 'completed').length,
      },
      active_statement_count: active.length,
    };
  },
};

// ─── ST2: context.search ────────────────────────────────────

export const contextSearch: ToolDef = {
  name: 'context.search',
  description: 'Search across raw events, derived state, entities, and artifacts using full-text search.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      project_id: { type: 'string', description: 'Project ID (uses active project if omitted)' },
      type: { type: 'string', description: 'Filter by event type (message, tool_call, command, etc.)' },
      limit: { type: 'number', description: 'Max results (default 10)' },
    },
    required: ['query'],
  },
  handler: (args, root) => {
    const projectId = resolveProjectId(root, args.project_id as string | undefined);
    if (!projectId) return { error: 'No active project.' };

    const query = args.query as string;
    if (!query || query.trim().length === 0) return { error: 'Query cannot be empty.' };

    const db = openDB(root);
    ensureFTS(db);

    if (countIndexed(db, projectId) === 0) {
      recoverWorkspace(db, root);
    }

    const results = search(db, {
      projectId,
      query,
      type: args.type as string | undefined,
      limit: (args.limit as number) ?? 10,
    });

    closeDB(root);

    return {
      query,
      result_count: results.length,
      results: results.map((r) => ({
        event_id: r.eventId,
        type: r.type,
        timestamp: r.timestamp,
        source: r.source,
        excerpt: r.excerpt,
        content: r.content.slice(0, 500),
      })),
    };
  },
};

// ─── ST3: context.get_source ────────────────────────────────

export const contextGetSource: ToolDef = {
  name: 'context.get_source',
  description: 'Return the untouched source payload for one or more event IDs. Use this to verify any derived claim.',
  inputSchema: {
    type: 'object',
    properties: {
      event_ids: {
        type: 'array',
        items: { type: 'string' },
        description: 'One or more event IDs to retrieve',
      },
      project_id: { type: 'string', description: 'Project ID (uses active project if omitted)' },
    },
    required: ['event_ids'],
  },
  handler: (args, root) => {
    const projectId = resolveProjectId(root, args.project_id as string | undefined);
    if (!projectId) return { error: 'No active project.' };

    const eventIds = args.event_ids as string[];
    if (!eventIds || eventIds.length === 0) return { error: 'Provide at least one event_id.' };

    const sessions = listSessions(root, projectId);
    const allEvents: ContinuumEvent[] = [];

    for (const session of sessions) {
      const { events } = openLedger(root, projectId, session.id).readAll();
      allEvents.push(...events);
    }

    const found: Array<{ id: string; type: string; sequence: number; timestamp: string; source: string; payload: unknown }> = [];
    const missing: string[] = [];

    for (const id of eventIds) {
      const event = allEvents.find((e) => e.id === id);
      if (event) {
        found.push({
          id: event.id,
          type: event.type,
          sequence: event.sequence,
          timestamp: event.timestamp,
          source: event.source,
          payload: event.payload,
        });
      } else {
        missing.push(id);
      }
    }

    return { found, missing, total_requested: eventIds.length, total_found: found.length };
  },
};

// ─── ST3: context.get_decisions ─────────────────────────────

export const contextGetDecisions: ToolDef = {
  name: 'context.get_decisions',
  description: 'Return active, rejected, and superseded decisions with rationale and alternatives.',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: { type: 'string', description: 'Project ID (uses active project if omitted)' },
      include_inactive: { type: 'boolean', description: 'Include rejected and superseded decisions (default false)' },
    },
  },
  handler: (args, root) => {
    const projectId = resolveProjectId(root, args.project_id as string | undefined);
    if (!projectId) return { error: 'No active project.' };

    const includeInactive = (args.include_inactive as boolean) ?? false;
    const decisions = listDecisions(root, projectId, includeInactive);

    return {
      count: decisions.length,
      decisions: decisions.map((d) => ({
        id: d.id,
        choice: d.choice,
        rationale: d.rationale,
        alternatives: d.alternatives,
        status: d.status,
        rejection_reason: d.rejectionReason,
        superseded_by: d.supersededBy,
        source_event_ids: d.sourceEventIds,
        created_at: d.createdAt,
      })),
    };
  },
};

// ─── ST3: context.get_attempts ──────────────────────────────

export const contextGetAttempts: ToolDef = {
  name: 'context.get_attempts',
  description: 'Return previous approaches, failures, and outcomes so that already-failed work is not repeated.',
  inputSchema: {
    type: 'object',
    properties: {
      project_id: { type: 'string', description: 'Project ID (uses active project if omitted)' },
      failures_only: { type: 'boolean', description: 'Only return failed and abandoned attempts (default false)' },
    },
  },
  handler: (args, root) => {
    const projectId = resolveProjectId(root, args.project_id as string | undefined);
    if (!projectId) return { error: 'No active project.' };

    const failuresOnly = (args.failures_only as boolean) ?? false;
    const attempts = failuresOnly
      ? getFailedAttempts(root, projectId)
      : listAttempts(root, projectId);

    return {
      count: attempts.length,
      attempts: attempts.map((a) => ({
        id: a.id,
        approach: a.approach,
        outcome: a.outcome,
        failure_reason: a.failureReason,
        observations: a.observations,
        related_id: a.relatedId,
        source_event_ids: a.sourceEventIds,
        created_at: a.createdAt,
      })),
    };
  },
};

// ─── All tools ──────────────────────────────────────────────

export const ALL_TOOLS: ToolDef[] = [
  contextResume,
  contextGetState,
  contextSearch,
  contextGetSource,
  contextGetDecisions,
  contextGetAttempts,
];
