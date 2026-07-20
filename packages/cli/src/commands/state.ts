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
  listStateHistory,
  correctStatement,
  rejectStatement,
  getActiveStatements,
  StatementStatuses,
  VALID_CATEGORIES,
} from '@continuum/core';
import type { Statement, WorkingState, ContinuumEvent, StatementCategory } from '@continuum/core';

function requireActiveProject(root: string): string {
  const state = getWorkspaceState(root);
  if (!state.activeProjectId) {
    console.error('\n✗ No active project. Run "continuum project select <id>" first.\n');
    process.exit(1);
  }
  return state.activeProjectId;
}

function loadAllEvents(root: string, projectId: string): ContinuumEvent[] {
  const sessions = listSessions(root, projectId);
  const allEvents: ContinuumEvent[] = [];
  for (const session of sessions) {
    const { events } = openLedger(root, projectId, session.id).readAll();
    allEvents.push(...events);
  }
  allEvents.sort((a, b) => a.sequence - b.sequence);
  return allEvents;
}

function ensureState(root: string, projectId: string, refresh: boolean): WorkingState {
  if (!refresh) {
    const cached = loadWorkingState(root, projectId);
    if (cached) return cached;
  }

  const events = loadAllEvents(root, projectId);
  if (events.length === 0) {
    console.log('\n  No events found. Import a transcript first.\n');
    process.exit(0);
  }

  const state = extractWorkingState(projectId, events);
  saveWorkingState(root, projectId, state);
  return state;
}

function formatStatement(s: Statement, showProvenance: boolean): string {
  const statusIcon =
    s.status === 'active'
      ? '●'
      : s.status === 'user_corrected'
        ? '✎'
        : s.status === 'rejected'
          ? '✗'
          : '○';
  const conf = s.confidence === 'high' ? '' : ` [${s.confidence}]`;
  const src =
    showProvenance && s.sourceEventIds.length > 0 ? ` ← ${s.sourceEventIds[0].slice(0, 16)}…` : '';
  const note = s.correctionNote ? ` (${s.correctionNote})` : '';
  return `    ${statusIcon} ${s.text}${conf}${src}${note}`;
}

function formatSection(
  statements: Statement[],
  label: string,
  showProvenance: boolean,
  showAll: boolean,
): string {
  const visible = showAll
    ? statements
    : statements.filter((s) => s.status === StatementStatuses.ACTIVE);
  if (visible.length === 0) return '';

  const lines = [`  ${label} (${visible.length}):\n`];
  for (const s of visible) {
    lines.push(formatStatement(s, showProvenance));
  }
  lines.push('');
  return lines.join('\n');
}

export function registerStateCommand(program: Command): void {
  const state = program.command('state').description('Manage project working state');

  // ── show ────────────────────────────────────────────────

  state
    .command('show')
    .description('Show the current extracted working state')
    .option('--refresh', 'Re-extract from events (ST3)', false)
    .option('--all', 'Include corrected/rejected statements', false)
    .option('--provenance', 'Show source event IDs', false)
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireActiveProject(opts.root);
      const project = getProject(opts.root, projectId)!;
      const working = ensureState(opts.root, projectId, opts.refresh);

      const active = getActiveStatements(working);

      console.log(`\n─── Working State: ${project.title}`);
      console.log(
        `    Version: ${working.stateVersion}  Events: ${working.totalEventsProcessed}  Active statements: ${active.length}\n`,
      );

      const sections = [
        formatSection(working.objectives, 'Objectives', opts.provenance, opts.all),
        formatSection(working.requirements, 'Requirements', opts.provenance, opts.all),
        formatSection(working.constraints, 'Constraints', opts.provenance, opts.all),
        formatSection(working.decisions, 'Decisions', opts.provenance, opts.all),
        formatSection(working.nextActions, 'Next Actions', opts.provenance, opts.all),
        formatSection(working.completed, 'Completed', opts.provenance, opts.all),
        formatSection(working.failures, 'Failed Approaches', opts.provenance, opts.all),
        formatSection(working.assumptions, 'Assumptions', opts.provenance, opts.all),
        formatSection(working.openQuestions, 'Open Questions', opts.provenance, opts.all),
      ].filter((s) => s.length > 0);

      if (sections.length === 0) {
        console.log('  No structured state extracted.\n');
      } else {
        console.log(sections.join(''));
      }
    });

  // ── bootstrap ───────────────────────────────────────────

  state
    .command('bootstrap')
    .description('Generate a bootstrap context package')
    .option('--refresh', 'Re-extract from events', false)
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireActiveProject(opts.root);
      const project = getProject(opts.root, projectId)!;
      const working = ensureState(opts.root, projectId, opts.refresh);
      const bootstrap = generateBootstrap(project, working);
      console.log('\n' + bootstrap.combined + '\n');
    });

  // ── regenerate (ST3) ────────────────────────────────────

  state
    .command('regenerate')
    .description('Re-derive working state from the immutable ledger')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireActiveProject(opts.root);

      const previous = loadWorkingState(opts.root, projectId);
      const events = loadAllEvents(opts.root, projectId);

      if (events.length === 0) {
        console.log('\n  No events found.\n');
        return;
      }

      const fresh = extractWorkingState(projectId, events);
      saveWorkingState(opts.root, projectId, fresh);

      const active = getActiveStatements(fresh);
      const prevCount = previous ? getActiveStatements(previous).length : 0;
      const delta = active.length - prevCount;
      const deltaStr = delta > 0 ? `(+${delta})` : delta < 0 ? `(${delta})` : '(no change)';

      console.log(`\n✓ State regenerated from ${events.length} events\n`);
      console.log(`  Active statements: ${active.length} ${deltaStr}`);
      console.log(`  Previous version archived in state-history/\n`);
    });

  // ── correct ─────────────────────────────────────────────

  state
    .command('correct <statementId>')
    .description('Correct an extracted statement')
    .option('--text <newText>', 'Corrected text')
    .option('--category <cat>', 'Corrected category')
    .option('--note <reason>', 'Reason for correction', 'User correction')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((statementId: string, opts) => {
      const projectId = requireActiveProject(opts.root);
      const working = ensureState(opts.root, projectId, false);

      if (opts.category && !VALID_CATEGORIES.includes(opts.category)) {
        console.error(
          `\n✗ Invalid category "${opts.category}". Valid: ${VALID_CATEGORIES.join(', ')}\n`,
        );
        process.exit(1);
      }

      const result = correctStatement(working, {
        statementId,
        newText: opts.text,
        newCategory: opts.category as StatementCategory | undefined,
        note: opts.note,
      });

      if (result.error) {
        console.error(`\n✗ ${result.error}\n`);
        process.exit(1);
      }

      saveWorkingState(opts.root, projectId, working);

      console.log('\n✓ Statement corrected\n');
      console.log(`  Original:  ${result.original.text.slice(0, 80)}…`);
      console.log(`  Status:    ${result.original.status}`);
      if (result.corrected) {
        console.log(`  Corrected: ${result.corrected.text.slice(0, 80)}`);
        console.log(`  New ID:    ${result.corrected.id}`);
      }
      console.log(`  Note:      ${opts.note}\n`);
    });

  // ── reject ──────────────────────────────────────────────

  state
    .command('reject <statementId>')
    .description('Reject an incorrect extracted statement')
    .option('--note <reason>', 'Reason for rejection', 'Incorrect extraction')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((statementId: string, opts) => {
      const projectId = requireActiveProject(opts.root);
      const working = ensureState(opts.root, projectId, false);

      const result = rejectStatement(working, statementId, opts.note);

      if (result.error) {
        console.error(`\n✗ ${result.error}\n`);
        process.exit(1);
      }

      saveWorkingState(opts.root, projectId, working);

      console.log('\n✓ Statement rejected\n');
      console.log(`  Statement: ${result.original.text.slice(0, 80)}…`);
      console.log(`  Note:      ${opts.note}\n`);
    });

  // ── history ─────────────────────────────────────────────

  state
    .command('history')
    .description('List archived state versions')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireActiveProject(opts.root);
      const files = listStateHistory(opts.root, projectId);

      if (files.length === 0) {
        console.log('\n  No state history. History is created when state is regenerated.\n');
        return;
      }

      console.log(`\n  State history (${files.length} version(s)):\n`);
      for (const f of files) {
        console.log(`    ${f}`);
      }
      console.log('');
    });
}
