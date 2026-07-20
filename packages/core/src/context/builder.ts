/**
 * Layered context package builder.
 *
 * Generates L0-L4 layers from project data and assembles
 * them into a combined context string, respecting a token budget.
 */

import { getProject } from '../projects/project-store';
import { listSessions } from '../projects/session-store';
import { openLedger } from '../ledger/event-ledger';
import {
  extractWorkingState,
  loadWorkingState,
} from '../state-engine/index';
import { loadDecisions } from '../tracking/decisions';
import { loadTasks } from '../tracking/tasks';
import { getFailedAttempts } from '../tracking/attempts';
import { estimateTokens, trimToTokenBudget } from './tokens';
import { ContextLayers } from './types';
import type { ContextLayer, LayerContent, ContextPackage, ContextBuildOptions } from './types';
import type { ContinuumEvent } from '../events/types';

// ─── Load all events ────────────────────────────────────────

function loadAllEvents(workspaceRoot: string, projectId: string): ContinuumEvent[] {
  const sessions = listSessions(workspaceRoot, projectId);
  const all: ContinuumEvent[] = [];

  for (const session of sessions) {
    const { events } = openLedger(workspaceRoot, projectId, session.id).readAll();
    all.push(...events);
  }

  all.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.sequence - b.sequence);
  return all;
}

// ─── L0: Orientation (ST1) ──────────────────────────────────

function buildL0(workspaceRoot: string, projectId: string, events: ContinuumEvent[]): LayerContent {
  const project = getProject(workspaceRoot, projectId)!;
  const sessions = listSessions(workspaceRoot, projectId);

  const lines: string[] = ['## L0 — Project Orientation', '', `**Project:** ${project.title}`];

  if (project.description) lines.push(`**Description:** ${project.description}`);

  lines.push(`**Sessions:** ${sessions.length}`);
  lines.push(`**Total events:** ${events.length}`);

  if (events.length > 0) {
    lines.push(
      `**Time span:** ${events[0].timestamp.slice(0, 19)} → ${events[events.length - 1].timestamp.slice(0, 19)}`,
    );
  }

  // Try to find the primary objective
  const state = loadWorkingState(workspaceRoot, projectId);
  if (state) {
    const activeObj = state.objectives.filter((o) => o.status === 'active');
    if (activeObj.length > 0) {
      lines.push('', `**Primary objective:** ${activeObj[0].text}`);
    }
  }

  const content = lines.join('\n');
  return {
    layer: ContextLayers.L0_ORIENTATION,
    label: 'Project Orientation',
    content,
    tokenEstimate: estimateTokens(content),
    loadBehavior: 'always',
  };
}

// ─── L1: Active state (ST2) ────────────────────────────────

function buildL1(workspaceRoot: string, projectId: string, events: ContinuumEvent[]): LayerContent {
  let state = loadWorkingState(workspaceRoot, projectId);
  if (!state) {
    state = extractWorkingState(projectId, events);
  }

  const tasks = loadTasks(workspaceRoot, projectId);
  const activeTasks = tasks.filter((t) => t.status === 'active' || t.status === 'pending');
  const blockedTasks = tasks.filter((t) => t.status === 'blocked');
  const completedTasks = tasks.filter((t) => t.status === 'completed');

  const sections: string[] = ['## L1 — Active State', ''];

  // Objectives
  const activeObj = state.objectives.filter((s) => s.status === 'active');
  if (activeObj.length > 0) {
    sections.push('### Objectives');
    for (const o of activeObj) sections.push(`- ${o.text}`);
    sections.push('');
  }

  // Current tasks
  if (activeTasks.length > 0) {
    sections.push('### Active Tasks');
    for (const t of activeTasks) sections.push(`- [${t.status}] ${t.description}`);
    sections.push('');
  }

  // Completed work
  if (completedTasks.length > 0) {
    sections.push(`### Completed (${completedTasks.length})`);
    for (const t of completedTasks.slice(-5))
      sections.push(`- ✓ ${t.description}${t.completionNote ? ` — ${t.completionNote}` : ''}`);
    if (completedTasks.length > 5) sections.push(`- … and ${completedTasks.length - 5} more`);
    sections.push('');
  }

  // Blockers
  if (blockedTasks.length > 0) {
    sections.push('### Blocked');
    for (const t of blockedTasks)
      sections.push(`- ✗ ${t.description}: ${t.blockedReason ?? 'unknown reason'}`);
    sections.push('');
  }

  // Next actions from state
  const nextActions = state.nextActions.filter((s) => s.status === 'active');
  if (nextActions.length > 0) {
    sections.push('### Next Actions');
    for (const n of nextActions) sections.push(`- ${n.text}`);
    sections.push('');
  }

  // Open questions
  const openQ = state.openQuestions.filter((s) => s.status === 'active');
  if (openQ.length > 0) {
    sections.push('### Open Questions');
    for (const q of openQ) sections.push(`- ${q.text}`);
    sections.push('');
  }

  if (sections.length <= 2) {
    sections.push('No active state available.');
    sections.push('');
  }

  const content = sections.join('\n');
  return {
    layer: ContextLayers.L1_ACTIVE_STATE,
    label: 'Active State',
    content,
    tokenEstimate: estimateTokens(content),
    loadBehavior: 'always',
  };
}

// ─── L2: Governing context (ST2) ───────────────────────────

function buildL2(workspaceRoot: string, projectId: string, events: ContinuumEvent[]): LayerContent {
  let state = loadWorkingState(workspaceRoot, projectId);
  if (!state) {
    state = extractWorkingState(projectId, events);
  }

  const decisions = loadDecisions(workspaceRoot, projectId);
  const activeDecisions = decisions.filter((d) => d.status === 'active');
  const rejectedDecisions = decisions.filter((d) => d.status === 'rejected');
  const failedAttempts = getFailedAttempts(workspaceRoot, projectId);

  const sections: string[] = ['## L2 — Governing Context', ''];

  // Constraints
  const constraints = [...(state.requirements ?? []), ...state.constraints].filter(
    (s) => s.status === 'active',
  );
  if (constraints.length > 0) {
    sections.push('### Constraints & Requirements');
    for (const c of constraints) sections.push(`- ${c.text}`);
    sections.push('');
  }

  // Active decisions
  if (activeDecisions.length > 0) {
    sections.push('### Active Decisions');
    for (const d of activeDecisions) {
      sections.push(`- **${d.choice}**${d.rationale ? ` — ${d.rationale}` : ''}`);
      if (d.alternatives.length > 0)
        sections.push(`  Alternatives considered: ${d.alternatives.join(', ')}`);
    }
    sections.push('');
  }

  // Rejected decisions
  if (rejectedDecisions.length > 0) {
    sections.push('### Rejected Approaches');
    for (const d of rejectedDecisions) {
      sections.push(`- ~~${d.choice}~~ — ${d.rejectionReason ?? 'rejected'}`);
    }
    sections.push('');
  }

  // Failed attempts
  if (failedAttempts.length > 0) {
    sections.push('### Failed Attempts (do not repeat)');
    for (const a of failedAttempts) {
      sections.push(`- **${a.approach}** — ${a.failureReason ?? a.outcome}`);
      if (a.observations) sections.push(`  Learned: ${a.observations}`);
    }
    sections.push('');
  }

  // Assumptions
  const assumptions = state.assumptions.filter((s) => s.status === 'active');
  if (assumptions.length > 0) {
    sections.push('### Assumptions');
    for (const a of assumptions) sections.push(`- ${a.text}`);
    sections.push('');
  }

  if (sections.length <= 2) {
    sections.push('No governing context available.');
    sections.push('');
  }

  const content = sections.join('\n');
  return {
    layer: ContextLayers.L2_GOVERNING,
    label: 'Governing Context',
    content,
    tokenEstimate: estimateTokens(content),
    loadBehavior: 'continuation',
  };
}

// ─── L3: Supporting evidence (ST3) ──────────────────────────

function extractPreview(event: ContinuumEvent): string {
  const payload = event.payload as unknown as Record<string, unknown>;

  switch (event.type) {
    case 'message':
      return (payload.content as string) ?? '';
    case 'tool_call':
      return `[tool_call] ${payload.toolName}: ${JSON.stringify(payload.input ?? {}).slice(0, 100)}`;
    case 'tool_result':
      return `[tool_result] ${payload.toolName}: ${((payload.output as string) ?? '').slice(0, 200)}`;
    case 'command':
      return `$ ${payload.command}`;
    case 'command_output':
      return `[exit ${payload.exitCode ?? '?'}] ${((payload.stdout as string) ?? '').slice(0, 200)}`;
    case 'artifact':
      return `[artifact] ${payload.action}: ${payload.uri}`;
    case 'system':
      return `[system] ${payload.action}${payload.message ? ': ' + payload.message : ''}`;
    default:
      return JSON.stringify(payload).slice(0, 100);
  }
}

function buildL3(
  workspaceRoot: string,
  projectId: string,
  events: ContinuumEvent[],
  focusTopic?: string,
  maxEvents = 30,
): LayerContent {
  const sections: string[] = ['## L3 — Supporting Evidence', ''];

  let relevant: ContinuumEvent[];

  if (focusTopic) {
    const topicLower = focusTopic.toLowerCase();
    relevant = events.filter((e) => {
      const preview = extractPreview(e).toLowerCase();
      return preview.includes(topicLower);
    });

    sections.push(`_Filtered for topic: "${focusTopic}" — ${relevant.length} matching event(s)_`);
    sections.push('');
  } else {
    // Take the most recent events as the most likely to be relevant
    relevant = events.slice(-maxEvents);
  }

  const toShow = relevant.slice(-maxEvents);

  if (toShow.length === 0) {
    sections.push('No matching evidence found.');
    sections.push('');
  } else {
    for (const event of toShow) {
      const ts = event.timestamp.slice(0, 19).replace('T', ' ');
      const preview = extractPreview(event);
      const trimmedPreview = preview.length > 300 ? preview.slice(0, 300) + '…' : preview;

      sections.push(`**[${event.type}]** ${ts} (${event.id})`);
      sections.push(trimmedPreview);
      sections.push('');
    }
  }

  if (relevant.length > maxEvents) {
    sections.push(
      `_${relevant.length - maxEvents} more event(s) available. Use context.get_source or search to retrieve._`,
    );
    sections.push('');
  }

  const content = sections.join('\n');
  return {
    layer: ContextLayers.L3_EVIDENCE,
    label: 'Supporting Evidence',
    content,
    tokenEstimate: estimateTokens(content),
    loadBehavior: 'selected',
  };
}

// ─── L4: Complete archive (ST3) ─────────────────────────────

function buildL4(
  _workspaceRoot: string,
  _projectId: string,
  events: ContinuumEvent[],
  maxEvents = 100,
): LayerContent {
  const sections: string[] = ['## L4 — Complete Archive', ''];

  sections.push(`_${events.length} total event(s) in the project ledger._`);
  sections.push(
    '_This layer is for on-demand retrieval. Showing the last ' +
      Math.min(events.length, maxEvents) +
      ' events._',
  );
  sections.push('');

  const toShow = events.slice(-maxEvents);

  for (const event of toShow) {
    sections.push(
      JSON.stringify({
        id: event.id,
        type: event.type,
        seq: event.sequence,
        ts: event.timestamp,
        payload: event.payload,
      }),
    );
  }

  if (events.length > maxEvents) {
    sections.push('');
    sections.push(
      `_${events.length - maxEvents} earlier event(s) omitted. Retrieve with event IDs or search._`,
    );
  }

  sections.push('');

  const content = sections.join('\n');
  return {
    layer: ContextLayers.L4_ARCHIVE,
    label: 'Complete Archive',
    content,
    tokenEstimate: estimateTokens(content),
    loadBehavior: 'on_demand',
  };
}

// ─── Assemble context package ───────────────────────────────

export function buildContextPackage(options: ContextBuildOptions): ContextPackage {
  const { workspaceRoot, projectId } = options;
  const project = getProject(workspaceRoot, projectId);

  if (!project) {
    throw new Error(`Project "${projectId}" not found.`);
  }

  const events = loadAllEvents(workspaceRoot, projectId);
  const requestedLayers = options.layers ?? [
    ContextLayers.L0_ORIENTATION,
    ContextLayers.L1_ACTIVE_STATE,
    ContextLayers.L2_GOVERNING,
  ];
  const budget = options.tokenBudget ?? 0;

  // Build all requested layers
  const builtLayers: LayerContent[] = [];

  for (const layer of requestedLayers) {
    switch (layer) {
      case ContextLayers.L0_ORIENTATION:
        builtLayers.push(buildL0(workspaceRoot, projectId, events));
        break;
      case ContextLayers.L1_ACTIVE_STATE:
        builtLayers.push(buildL1(workspaceRoot, projectId, events));
        break;
      case ContextLayers.L2_GOVERNING:
        builtLayers.push(buildL2(workspaceRoot, projectId, events));
        break;
      case ContextLayers.L3_EVIDENCE:
        builtLayers.push(
          buildL3(workspaceRoot, projectId, events, options.focusTopic, options.maxEvidenceEvents),
        );
        break;
      case ContextLayers.L4_ARCHIVE:
        builtLayers.push(buildL4(workspaceRoot, projectId, events, options.maxArchiveEvents));
        break;
    }
  }

  // Apply token budget
  const includedLayers: ContextLayer[] = [];
  const excludedLayers: ContextLayer[] = [];
  const finalLayers: LayerContent[] = [];
  let runningTokens = 0;

  for (const layer of builtLayers) {
    if (budget > 0 && runningTokens + layer.tokenEstimate > budget) {
      // Try trimming
      const remaining = budget - runningTokens;
      if (remaining > 100) {
        const trimmed = trimToTokenBudget(layer.content, remaining);
        finalLayers.push({ ...layer, content: trimmed, tokenEstimate: estimateTokens(trimmed) });
        runningTokens += estimateTokens(trimmed);
        includedLayers.push(layer.layer);
      } else {
        excludedLayers.push(layer.layer);
      }
    } else {
      finalLayers.push(layer);
      runningTokens += layer.tokenEstimate;
      includedLayers.push(layer.layer);
    }
  }

  // Combine
  const header = [
    '# Continuum — Context Transfer Package',
    '',
    `Project: ${project.title}`,
    `Generated: ${new Date().toISOString()}`,
    `Layers: ${includedLayers.join(', ')}`,
    `Estimated tokens: ~${runningTokens}`,
    '',
    '---',
    '',
  ].join('\n');

  const combined = header + finalLayers.map((l) => l.content).join('\n\n---\n\n');

  return {
    projectId,
    projectTitle: project.title,
    generatedAt: new Date().toISOString(),
    layers: finalLayers,
    combined,
    totalTokens: estimateTokens(combined),
    tokenBudget: budget,
    includedLayers,
    excludedLayers,
  };
}

// ─── Build a single layer ───────────────────────────────────

export function buildSingleLayer(
  workspaceRoot: string,
  projectId: string,
  layer: ContextLayer,
  focusTopic?: string,
  maxEvents?: number,
): LayerContent {
  const events = loadAllEvents(workspaceRoot, projectId);

  switch (layer) {
    case ContextLayers.L0_ORIENTATION:
      return buildL0(workspaceRoot, projectId, events);
    case ContextLayers.L1_ACTIVE_STATE:
      return buildL1(workspaceRoot, projectId, events);
    case ContextLayers.L2_GOVERNING:
      return buildL2(workspaceRoot, projectId, events);
    case ContextLayers.L3_EVIDENCE:
      return buildL3(workspaceRoot, projectId, events, focusTopic, maxEvents);
    case ContextLayers.L4_ARCHIVE:
      return buildL4(workspaceRoot, projectId, events, maxEvents);
    default:
      throw new Error(`Unknown layer: ${layer}`);
  }
}
