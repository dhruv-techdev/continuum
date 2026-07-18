/**
 * Bootstrap context generator.
 *
 * Produces a layered text package that can be injected into
 * a fresh session's system prompt or first message so the
 * receiving agent understands the project state.
 *
 * Layers follow the product spec:
 *   L0 — Orientation (project identity)
 *   L1 — Active state (objective, progress, blockers, next)
 *   L2 — Governing context (constraints, decisions, failures)
 */

import type { WorkingState, Statement, BootstrapContext } from './types';
import type { Project } from '../projects/types';

// ─── Helpers ────────────────────────────────────────────────

function formatStatements(statements: Statement[], label: string): string {
  if (statements.length === 0) return '';

  const lines = [`### ${label}`];
  for (const s of statements) {
    const conf = s.confidence === 'high' ? '' : ` [${s.confidence} confidence]`;
    lines.push(`- ${s.text}${conf}`);
  }
  return lines.join('\n');
}

function countStatements(state: WorkingState): number {
  return (
    state.objectives.length +
    state.constraints.length +
    state.decisions.length +
    state.nextActions.length +
    state.completed.length +
    state.failures.length +
    state.assumptions.length +
    state.openQuestions.length
  );
}

// ─── L0: Orientation ────────────────────────────────────────

function buildOrientation(project: Project, state: WorkingState): string {
  const lines: string[] = [
    '## L0 — Project Orientation',
    '',
    `**Project:** ${project.title}`,
  ];

  if (project.description) {
    lines.push(`**Description:** ${project.description}`);
  }

  lines.push(`**Sessions:** ${state.sessionIds.length}`);
  lines.push(`**Events processed:** ${state.totalEventsProcessed}`);

  // Summarize the primary objective if we have one
  if (state.objectives.length > 0) {
    const primary = state.objectives[0];
    lines.push('', `**Primary objective:** ${primary.text}`);
  }

  return lines.join('\n');
}

// ─── L1: Active state ───────────────────────────────────────

function buildActiveState(state: WorkingState): string {
  const sections: string[] = ['## L1 — Active State', ''];

  // Objectives
  if (state.objectives.length > 0) {
    sections.push(formatStatements(state.objectives, 'Objectives'));
    sections.push('');
  }

  // Completed work (progress indicator)
  if (state.completed.length > 0) {
    sections.push(formatStatements(state.completed, 'Completed Work'));
    sections.push('');
  }

  // Next actions
  if (state.nextActions.length > 0) {
    sections.push(formatStatements(state.nextActions, 'Next Actions'));
    sections.push('');
  }

  // Open questions (blockers)
  if (state.openQuestions.length > 0) {
    sections.push(formatStatements(state.openQuestions, 'Open Questions'));
    sections.push('');
  }

  if (sections.length === 2) {
    sections.push('No active state extracted from conversation history.');
    sections.push('');
  }

  return sections.join('\n');
}

// ─── L2: Governing context ──────────────────────────────────

function buildGoverningContext(state: WorkingState): string {
  const sections: string[] = ['## L2 — Governing Context', ''];

  if (state.constraints.length > 0) {
    sections.push(formatStatements(state.constraints, 'Constraints & Requirements'));
    sections.push('');
  }

  if (state.decisions.length > 0) {
    sections.push(formatStatements(state.decisions, 'Decisions Made'));
    sections.push('');
  }

  if (state.failures.length > 0) {
    sections.push(formatStatements(state.failures, 'Failed Approaches (avoid repeating)'));
    sections.push('');
  }

  if (state.assumptions.length > 0) {
    sections.push(formatStatements(state.assumptions, 'Assumptions'));
    sections.push('');
  }

  if (sections.length === 2) {
    sections.push('No governing context extracted from conversation history.');
    sections.push('');
  }

  return sections.join('\n');
}

// ─── Build complete bootstrap ───────────────────────────────

export function generateBootstrap(
  project: Project,
  state: WorkingState,
): BootstrapContext {
  const orientation = buildOrientation(project, state);
  const activeState = buildActiveState(state);
  const governingContext = buildGoverningContext(state);

  const combined = [
    '# Continuum — Project Context Transfer',
    '',
    'This context was automatically extracted from the project history.',
    'Every statement below was derived from recorded session events.',
    '',
    orientation,
    '',
    activeState,
    governingContext,
    '---',
    `Generated at: ${new Date().toISOString()}`,
    `Statements extracted: ${countStatements(state)}`,
    `Events covered: ${state.totalEventsProcessed}`,
  ].join('\n');

  return {
    orientation,
    activeState,
    governingContext,
    combined,
    statementCount: countStatements(state),
    eventsCovered: state.totalEventsProcessed,
    generatedAt: new Date().toISOString(),
  };
}
