import { Command } from 'commander';
import {
  DEFAULT_ROOT,
  createProject,
  listProjects,
  getProject,
  getState,
  setActiveProject,
} from '@dhruv-techdev/continuum-core';

export function registerProjectCommand(program: Command): void {
  const project = program.command('project').description('Manage projects');

  // ── create ──────────────────────────────────────────────────

  project
    .command('create')
    .description('Create a new project')
    .requiredOption('-t, --title <title>', 'Project title')
    .option('-d, --description <text>', 'Project description', '')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const result = createProject(opts.root, {
        title: opts.title,
        description: opts.description,
      });

      if (result.error) {
        console.error(`\n✗ ${result.error}\n`);
        process.exit(1);
      }

      const p = result.data!;

      // Auto-select the new project
      setActiveProject(opts.root, p.id);

      console.log(`\n✓ Project created\n`);
      console.log(`  ID:      ${p.id}`);
      console.log(`  Title:   ${p.title}`);
      if (p.description) {
        console.log(`  Desc:    ${p.description}`);
      }
      console.log(`  Status:  active (auto-selected)`);
      console.log(`\n  Next: continuum session start\n`);
    });

  // ── list ────────────────────────────────────────────────────

  project
    .command('list')
    .description('List all projects')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const projects = listProjects(opts.root);
      const state = getState(opts.root);

      if (projects.length === 0) {
        console.log('\n  No projects yet. Run "continuum project create -t <title>" to start.\n');
        return;
      }

      console.log(`\n  Projects (${projects.length}):\n`);

      for (const p of projects) {
        const active = p.id === state.activeProjectId ? ' ← active' : '';
        console.log(`  ${p.id}`);
        console.log(`    Title:   ${p.title}${active}`);
        if (p.description) {
          console.log(`    Desc:    ${p.description}`);
        }
        console.log(`    Created: ${p.createdAt}`);
        console.log('');
      }
    });

  // ── select ──────────────────────────────────────────────────

  project
    .command('select <projectId>')
    .description('Set the active project')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((projectId: string, opts) => {
      const p = getProject(opts.root, projectId);

      if (!p) {
        console.error(`\n✗ Project "${projectId}" not found.\n`);
        console.error('  Run "continuum project list" to see available projects.\n');
        process.exit(1);
      }

      setActiveProject(opts.root, p.id);

      console.log(`\n✓ Active project set to "${p.title}"`);
      console.log(`  ID: ${p.id}\n`);
    });
}
