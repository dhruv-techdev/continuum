import type { WorkingState, Statement, BootstrapContext } from './types';
import { StatementStatuses } from './types';
import type { Project } from '../projects/types';

function formatStatements(statements: Statement[], label: string): string {
  const active = statements.filter((s) => s.status === StatementStatuses.ACTIVE);
  if (active.length === 0) return '';

  const lines = [`### ${label}`];
  for (const s of active) {
    const conf = s.confidence === 'high' ? '' : ` [${s.confidence} confidence]`;
    lines.push(`- ${s.text}${conf}`);
  }
  return lines.join('\n');
}

function countActive(state: WorkingState): number {
  const all = [
    ...state.objectives, ...state.requirements, ...state.constraints,
    ...state.decisions, ...state.nextActions, ...state.completed,
    ...state.failures, ...state.assumptions, ...state.openQuestions,
  ];
  return all.filter((s) => s.status === StatementStatuses.ACTIVE).length;
}

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

  const activeObj = state.objectives.filter((o) => o.status === StatementStatuses.ACTIVE);
  if (activeObj.length > 0) {
    lines.push('', `**Primary objective:** ${activeObj[0].text}`);
  }

  return lines.join('\n');
}

function buildActiveState(state: WorkingState): string {
  const sections: string[] = ['## L1 — Active State', ''];

  const parts = [
    formatStatements(state.objectives, 'Objectives'),
    formatStatements(state.requirements, 'Requirements'),
    formatStatements(state.completed, 'Completed Work'),
    formatStatements(state.nextActions, 'Next Actions'),
    formatStatements(state.openQuestions, 'Open Questions'),
  ].filter((s) => s.length > 0);

  if (parts.length === 0) {
    sections.push('No active state extracted from conversation history.');
  } else {
    sections.push(...parts.flatMap((p) => [p, '']));
  }

  sections.push('');
  return sections.join('\n');
}

function buildGoverningContext(state: WorkingState): string {
  const sections: string[] = ['## L2 — Governing Context', ''];

  const parts = [
    formatStatements(state.constraints, 'Constraints & Prohibitions'),
    formatStatements(state.decisions, 'Decisions Made'),
    formatStatements(state.failures, 'Failed Approaches (avoid repeating)'),
    formatStatements(state.assumptions, 'Assumptions'),
  ].filter((s) => s.length > 0);

  if (parts.length === 0) {
    sections.push('No governing context extracted from conversation history.');
  } else {
    sections.push(...parts.flatMap((p) => [p, '']));
  }

  sections.push('');
  return sections.join('\n');
}

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
    `Active statements: ${countActive(state)}`,
    `Events covered: ${state.totalEventsProcessed}`,
  ].join('\n');

  return {
    orientation,
    activeState,
    governingContext,
    combined,
    statementCount: countActive(state),
    eventsCovered: state.totalEventsProcessed,
    generatedAt: new Date().toISOString(),
  };
}
