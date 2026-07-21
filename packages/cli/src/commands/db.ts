import { Command } from 'commander';
import { existsSync, statSync, unlinkSync } from 'fs';
import {
  DEFAULT_ROOT,
  openDB,
  closeDB,
  dbPath,
  recoverWorkspace,
  countAllEvents,
  getState,
} from '@dhruv-techdev/continuum-core';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function registerDbCommand(program: Command): void {
  const db = program.command('db').description('Manage the local metadata database');

  // ── db sync ─────────────────────────────────────────────

  db.command('sync')
    .description('Synchronize filesystem data into the SQLite index')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      console.log('\n  Syncing workspace to metadata database...\n');

      const mdb = openDB(opts.root);
      const result = recoverWorkspace(mdb, opts.root);
      closeDB(opts.root);

      console.log(`  ✓ Sync complete (${result.durationMs}ms)\n`);
      console.log(`    Projects:   ${result.projectsSynced}`);
      console.log(`    Sessions:   ${result.sessionsSynced}`);
      console.log(`    Events:     ${result.eventsRecovered} indexed`);
      console.log(`    Artifacts:  ${result.artifactsSynced}`);

      if (result.errors.length > 0) {
        console.log(`\n    Errors (${result.errors.length}):`);
        for (const err of result.errors) {
          console.log(`      ✗ ${err}`);
        }
      }

      console.log('');
    });

  // ── db status ───────────────────────────────────────────

  db.command('status')
    .description('Show database status and statistics')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const path = dbPath(opts.root);
      const exists = existsSync(path);

      console.log('\n─── Metadata Database\n');
      console.log(`  Path:     ${path}`);
      console.log(`  Exists:   ${exists ? 'yes' : 'no'}`);

      if (!exists) {
        console.log('\n  Run "continuum db sync" to create and populate the database.\n');
        return;
      }

      try {
        const stat = statSync(path);
        console.log(`  Size:     ${formatBytes(stat.size)}`);
      } catch {
        // Non-fatal
      }

      const mdb = openDB(opts.root);

      // Count tables
      const tables = mdb.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>;
      console.log(`  Tables:   ${tables.length}`);

      // Count rows per table
      console.log('\n  Row counts:');
      for (const table of tables) {
        try {
          const row = mdb.db.prepare(`SELECT COUNT(*) as count FROM "${table.name}"`).get() as {
            count: number;
          };
          console.log(`    ${table.name.padEnd(20)} ${row.count}`);
        } catch {
          console.log(`    ${table.name.padEnd(20)} (error)`);
        }
      }

      // Active project events
      const state = getState(opts.root);
      if (state.activeProjectId) {
        const total = countAllEvents(mdb, state.activeProjectId);
        console.log(`\n  Active project events: ${total}`);
      }

      closeDB(opts.root);
      console.log('');
    });

  // ── db reset ────────────────────────────────────────────

  db.command('reset')
    .description('Delete and rebuild the database from filesystem data')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const path = dbPath(opts.root);

      if (existsSync(path)) {
        unlinkSync(path);
        console.log('\n  Deleted existing database.');
      }

      console.log('  Rebuilding from filesystem...\n');

      const mdb = openDB(opts.root);
      const result = recoverWorkspace(mdb, opts.root);
      closeDB(opts.root);

      console.log(`  ✓ Database rebuilt (${result.durationMs}ms)\n`);
      console.log(`    Projects:   ${result.projectsSynced}`);
      console.log(`    Sessions:   ${result.sessionsSynced}`);
      console.log(`    Events:     ${result.eventsRecovered}`);
      console.log(`    Artifacts:  ${result.artifactsSynced}`);

      if (result.errors.length > 0) {
        console.log(`\n    Errors: ${result.errors.length}`);
      }

      console.log('');
    });
}
