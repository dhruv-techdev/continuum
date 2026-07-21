import { Command } from 'commander';
import {
  DEFAULT_ROOT,
  getState,
  openDB,
  closeDB,
  search,
  countIndexed,
  recoverWorkspace,
  ensureFTS,
} from '@dhruv-techdev/continuum-core';
import type { SearchResult } from '@dhruv-techdev/continuum-core';

function requireActiveProject(root: string): string {
  const state = getState(root);
  if (!state.activeProjectId) {
    console.error('\n✗ No active project.');
    console.error('  Run "continuum project select <id>" first.\n');
    process.exit(1);
  }
  return state.activeProjectId;
}

function formatResult(result: SearchResult, index: number, verbose: boolean): string {
  const lines: string[] = [];

  const typeLabel = result.type.padEnd(14);
  const ts = result.timestamp.slice(0, 19).replace('T', ' ');

  lines.push(`  ${index + 1}. [${typeLabel}] ${ts}`);
  lines.push(`     ID:      ${result.eventId}`);
  lines.push(`     Session: ${result.sessionId.slice(0, 24)}…`);
  lines.push(`     Source:  ${result.source}`);
  lines.push(`     Match:   ${result.excerpt}`);

  if (verbose) {
    const preview =
      result.content.length > 200 ? result.content.slice(0, 200) + '…' : result.content;
    lines.push(`     Content: ${preview}`);
  }

  return lines.join('\n');
}

export function registerSearchCommand(program: Command): void {
  program
    .command('search <query>')
    .description('Search project history using exact-text matching')
    .option('-t, --type <type>', 'Filter by event type (message, tool_call, command, etc.)')
    .option('-s, --session <id>', 'Filter by session ID')
    .option('--source <name>', 'Filter by event source')
    .option('--after <timestamp>', 'Only events after this ISO timestamp')
    .option('--before <timestamp>', 'Only events before this ISO timestamp')
    .option('-n, --limit <count>', 'Max results', (v) => parseInt(v, 10), 20)
    .option('--verbose', 'Show full content in results', false)
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((query: string, opts) => {
      const projectId = requireActiveProject(opts.root);

      // Ensure DB and FTS are synced
      const db = openDB(opts.root);
      ensureFTS(db);

      const indexed = countIndexed(db, projectId);
      if (indexed === 0) {
        console.log('\n  No events indexed. Running sync first...\n');
        recoverWorkspace(db, opts.root);
      }

      const results = search(db, {
        projectId,
        query,
        type: opts.type,
        sessionId: opts.session,
        sourceFilter: opts.source,
        after: opts.after,
        before: opts.before,
        limit: opts.limit,
      });

      closeDB(opts.root);

      if (results.length === 0) {
        console.log(`\n  No results for "${query}".\n`);
        console.log('  Tips:');
        console.log('    - Run "continuum db sync" to ensure all events are indexed');
        console.log('    - Try simpler keywords or remove filters');
        console.log('    - Use quotes for exact phrases: \'"exact phrase"\'');
        console.log('');
        return;
      }

      console.log(`\n─── Search: "${query}" — ${results.length} result(s)\n`);

      for (let i = 0; i < results.length; i++) {
        console.log(formatResult(results[i], i, opts.verbose));
        console.log('');
      }
    });
}
