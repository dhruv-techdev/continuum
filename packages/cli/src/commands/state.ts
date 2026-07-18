import { Command } from 'commander';
import {
  DEFAULT_ROOT,
  getState as getWorkspaceState,
  getProject,
  listSessions,
  openLedger,
  extractWorkingState,
  generateBootstrap,
  saveWorkingState,
  loadWorkingState,
  ConfidenceLevels,
} from '@continuum/core';
import type { Statement, WorkingState, ContinuumEvent } from '@continuum/core';

function requireActiveProject(root: string): string {
  const state = getWorkspaceState(root);
  if (!state.activeProjectId) {
    console.error('\n✗ No active project.');
    console.error('  Run "continuum project select <id>" first.\n');
    process.exit(1);
  }
  return state.activeProjectId;
}

function loadAllEvents(root: string, projectId: string): ContinuumEvent[] {
  const sessions = listSessions(root, projectId);
  const allEvents: ContinuumEvent[] = [];

  for (const session of sessions) {
    const ledger = openLedger(root, projectId, session.id);
    const { events } = ledger.readAll();
    allEvents.push(...events);
  }

  allEvents.sort((a, b) => a.sequence - b.sequence);
  return allEvents;
}

function formatStatementList(statements: Statement[], label: string): string {
  if (statements.length === 0) return '';

  const lines: string[] = [`  ${label} (${statements.length}):\n`];

  for (const s of statements) {
    const conf = s.confidence === ConfidenceLevels.HIGH ? '' : ` [${s.confidence}]`;
    const src = s.sourceEventIds.length > 0 ? ` ← ${s.sourceEventIds[0].slice(0, 16)}…` : '';
    lines.push(`    • ${s.text}${conf}${src}`);
  }

  lines.push('');
  return lines.join('\n');
}

export function registerStateCommand(program: Command): void {
  const state = program
    .command('state')
    .description('View and extract project working state');

  // ── show ────────────────────────────────────────────────

  state
    .command('show')
    .description('Show the current extracted working state')
    .option('--refresh', 'Re-extract from events instead of loading cached state', false)
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireActiveProject(opts.root);
      const project = getProject(opts.root, projectId);

      if (!project) {
        console.error(`\n✗ Project "${projectId}" not found.\n`);
        process.exit(1);
      }

      let working: WorkingState | null = null;

      if (!opts.refresh) {
        working = loadWorkingState(opts.root, projectId);
      }

      if (!working) {
        const events = loadAllEvents(opts.root, projectId);

        if (events.length === 0) {
          console.log('\n  No events found. Import a transcript first.\n');
          return;
        }

        working = extractWorkingState(projectId, events);
        saveWorkingState(opts.root, projectId, working);
      }

      console.log(`\n─── Working State: ${project.title}\n`);
      console.log(`  Sessions: ${working.sessionIds.length}`);
      console.log(`  Events:   ${working.totalEventsProcessed}`);
      console.log('');

      const sections = [
        formatStatementList(working.objectives, 'Objectives'),
        formatStatementList(working.constraints, 'Constraints'),
        formatStatementList(working.decisions, 'Decisions'),
        formatStatementList(working.nextActions, 'Next Actions'),
        formatStatementList(working.completed, 'Completed'),
        formatStatementList(working.failures, 'Failed Approaches'),
        formatStatementList(working.assumptions, 'Assumptions'),
        formatStatementList(working.openQuestions, 'Open Questions'),
      ].filter((s) => s.length > 0);

      if (sections.length === 0) {
        console.log('  No structured state extracted. The conversation may be too short or lack clear signal phrases.\n');
      } else {
        console.log(sections.join(''));
      }
    });

  // ── bootstrap ───────────────────────────────────────────

  state
    .command('bootstrap')
    .description('Generate a bootstrap context package for a fresh session')
    .option('--refresh', 'Re-extract from events', false)
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireActiveProject(opts.root);
      const project = getProject(opts.root, projectId);

      if (!project) {
        console.error(`\n✗ Project "${projectId}" not found.\n`);
        process.exit(1);
      }

      let working: WorkingState | null = null;

      if (!opts.refresh) {
        working = loadWorkingState(opts.root, projectId);
      }

      if (!working) {
        const events = loadAllEvents(opts.root, projectId);

        if (events.length === 0) {
          console.log('\n  No events found. Import a transcript first.\n');
          return;
        }

        working = extractWorkingState(projectId, events);
        saveWorkingState(opts.root, projectId, working);
      }

      const bootstrap = generateBootstrap(project, working);

      console.log('\n' + bootstrap.combined + '\n');
    });
}
