import { Command } from 'commander';
import {
  DEFAULT_ROOT,
  getState,
  openDB,
  closeDB,
  recoverWorkspace,
  countAllEvents,
  getTimeline,
} from '@dhruv-techdev/continuum-core';
import type { TimelineEntry } from '@dhruv-techdev/continuum-core';

function requireActiveProject(root: string): string {
  const state = getState(root);
  if (!state.activeProjectId) {
    console.error('\n✗ No active project.');
    console.error('  Run "continuum project select <id>" first.\n');
    process.exit(1);
  }
  return state.activeProjectId;
}

function ensureSynced(root: string, projectId: string): void {
  const db = openDB(root);
  if (countAllEvents(db, projectId) === 0) {
    console.log('  Syncing database...\n');
    recoverWorkspace(db, root);
  }
}

const TYPE_ICONS: Record<string, string> = {
  message: '💬',
  tool_call: '🔧',
  tool_result: '📋',
  command: '⌨️',
  command_output: '📄',
  artifact: '📎',
  system: '⚙️',
};

function formatEntry(entry: TimelineEntry, index: number, showPayload: boolean): string {
  const lines: string[] = [];
  const icon = TYPE_ICONS[entry.type] ?? '•';
  const ts = entry.timestamp.slice(0, 19).replace('T', ' ');
  const seqStr = `#${entry.sequence}`;

  lines.push(`  ${seqStr.padEnd(6)} ${icon} ${ts}  [${entry.type}]`);
  lines.push(`         ${entry.preview}`);

  if (showPayload) {
    lines.push(`         ID:      ${entry.id}`);
    lines.push(`         Session: ${entry.sessionId}`);
    lines.push(`         Source:  ${entry.source}`);
    lines.push(`         Hash:    ${entry.hash.slice(0, 16)}…`);
  }

  return lines.join('\n');
}

export function registerTimelineCommand(program: Command): void {
  program
    .command('timeline')
    .description('View a chronological timeline of project events')
    .option('-s, --session <id>', 'Filter by session ID')
    .option('-t, --type <types>', 'Filter by event type(s), comma-separated')
    .option('--source <name>', 'Filter by event source')
    .option('--after <timestamp>', 'Only events after this ISO timestamp')
    .option('--before <timestamp>', 'Only events before this ISO timestamp')
    .option('--from <seq>', 'From sequence number', parseInt)
    .option('--to <seq>', 'To sequence number', parseInt)
    .option('-n, --limit <count>', 'Max events to show', (v) => parseInt(v, 10), 50)
    .option('--offset <n>', 'Skip first N events', (v) => parseInt(v, 10), 0)
    .option('--desc', 'Show newest first', false)
    .option('--verbose', 'Show full event details', false)
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireActiveProject(opts.root);
      ensureSynced(opts.root, projectId);

      const db = openDB(opts.root);

      const types = opts.type ? opts.type.split(',').map((t: string) => t.trim()) : undefined;

      const result = getTimeline(db, {
        projectId,
        sessionId: opts.session,
        types,
        source: opts.source,
        after: opts.after,
        before: opts.before,
        fromSequence: opts.from,
        toSequence: opts.to,
        limit: opts.limit,
        offset: opts.offset,
        order: opts.desc ? 'desc' : 'asc',
      });

      closeDB(opts.root);

      if (result.entries.length === 0) {
        console.log('\n  No events match the given filters.\n');

        if (types || opts.session || opts.after || opts.before) {
          console.log(
            '  Try removing some filters or run "continuum db sync" to update the index.\n',
          );
        }
        return;
      }

      const rangeLabel =
        opts.offset > 0
          ? ` (${opts.offset + 1}–${opts.offset + result.entries.length} of ${result.total})`
          : result.total > result.entries.length
            ? ` (showing ${result.entries.length} of ${result.total})`
            : '';

      console.log(`\n─── Timeline: ${result.total} event(s)${rangeLabel}\n`);

      for (let i = 0; i < result.entries.length; i++) {
        console.log(formatEntry(result.entries[i], i, opts.verbose));
        console.log('');
      }

      if (result.hasMore) {
        const nextOffset = (opts.offset ?? 0) + result.entries.length;
        console.log(
          `  → More events available. Use --offset ${nextOffset} to see the next page.\n`,
        );
      }
    });
}
