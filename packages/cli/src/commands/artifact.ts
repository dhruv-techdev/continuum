import { Command } from 'commander';
import {
  DEFAULT_ROOT,
  getState,
  registerArtifact,
  listArtifacts,
  findArtifactById,
  deleteArtifact,
  StorageModes,
  ArtifactStatuses,
} from '@dhruv-techdev/continuum-core';
import type { StorageMode } from '@dhruv-techdev/continuum-core';

function requireActiveProject(root: string): string {
  const state = getState(root);
  if (!state.activeProjectId) {
    console.error('\n✗ No active project.');
    console.error('  Run "continuum project select <id>" first.\n');
    process.exit(1);
  }
  return state.activeProjectId;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function registerArtifactCommand(program: Command): void {
  const artifact = program.command('artifact').description('Manage project artifacts');

  // ── register ────────────────────────────────────────────

  artifact
    .command('register <path>')
    .description('Register a file as a project artifact')
    .option('-d, --description <text>', 'Artifact description')
    .option('-m, --mime <type>', 'Override MIME type')
    .option('--store', 'Copy file content into workspace (default: reference-only)', false)
    .option('--link-event <eventId>', 'Link to a session event')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((filePath: string, opts) => {
      const projectId = requireActiveProject(opts.root);

      const storageMode: StorageMode = opts.store ? StorageModes.CONTENT : StorageModes.REFERENCE;

      const result = registerArtifact(opts.root, {
        projectId,
        uri: filePath,
        mimeType: opts.mime,
        description: opts.description,
        storageMode,
        linkedEventId: opts.linkEvent,
      });

      if (result.error) {
        console.error(`\n✗ ${result.error}\n`);
        process.exit(1);
      }

      const a = result.artifact!;
      const verb = result.isUpdate ? 'Updated' : 'Registered';

      console.log(`\n✓ Artifact ${verb}\n`);
      console.log(`  ID:       ${a.id}`);
      console.log(`  File:     ${a.fileName}`);
      console.log(`  URI:      ${a.uri}`);
      console.log(`  MIME:     ${a.mimeType}`);
      console.log(`  Size:     ${formatSize(a.size)}`);
      if (a.hash) console.log(`  Hash:     ${a.hash.slice(0, 16)}…`);
      console.log(`  Version:  ${a.version}`);
      console.log(`  Storage:  ${a.storageMode}`);
      if (a.storedPath) console.log(`  Stored:   ${a.storedPath}`);
      if (a.description) console.log(`  Desc:     ${a.description}`);
      if (a.linkedEventIds.length > 0) {
        console.log(`  Linked:   ${a.linkedEventIds.length} event(s)`);
      }
      console.log('');
    });

  // ── list ────────────────────────────────────────────────

  artifact
    .command('list')
    .description('List registered artifacts')
    .option('--all', 'Include deleted and superseded artifacts', false)
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireActiveProject(opts.root);
      const artifacts = listArtifacts(opts.root, projectId, opts.all);

      if (artifacts.length === 0) {
        console.log(
          '\n  No artifacts registered. Run "continuum artifact register <path>" to add one.\n',
        );
        return;
      }

      console.log(`\n  Artifacts (${artifacts.length}):\n`);

      for (const a of artifacts) {
        const statusIcon =
          a.status === ArtifactStatuses.ACTIVE
            ? '●'
            : a.status === ArtifactStatuses.SUPERSEDED
              ? '○'
              : '✗';
        const stored = a.storageMode === StorageModes.CONTENT ? ' [stored]' : ' [ref]';

        console.log(`  ${statusIcon} ${a.id}  ${a.fileName}${stored}`);
        console.log(`    ${a.mimeType}  ${formatSize(a.size)}  v${a.version}`);
        if (a.description) console.log(`    ${a.description}`);
        if (a.linkedEventIds.length > 0) {
          console.log(`    Linked to ${a.linkedEventIds.length} event(s)`);
        }
        console.log('');
      }
    });

  // ── show ────────────────────────────────────────────────

  artifact
    .command('show <artifactId>')
    .description('Show details for a specific artifact')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((artifactId: string, opts) => {
      const projectId = requireActiveProject(opts.root);
      const a = findArtifactById(opts.root, projectId, artifactId);

      if (!a) {
        console.error(`\n✗ Artifact "${artifactId}" not found.\n`);
        process.exit(1);
      }

      console.log(`\n─── Artifact: ${a.fileName}\n`);
      console.log(`  ID:           ${a.id}`);
      console.log(`  URI:          ${a.uri}`);
      console.log(`  MIME:         ${a.mimeType}`);
      console.log(`  Size:         ${formatSize(a.size)}`);
      console.log(`  Hash:         ${a.hash || '—'}`);
      console.log(`  Version:      ${a.version}`);
      console.log(`  Status:       ${a.status}`);
      console.log(`  Storage:      ${a.storageMode}`);
      if (a.storedPath) console.log(`  Stored path:  ${a.storedPath}`);
      if (a.description) console.log(`  Description:  ${a.description}`);
      console.log(`  Registered:   ${a.registeredAt}`);
      console.log(`  Updated:      ${a.updatedAt}`);

      if (a.linkedEventIds.length > 0) {
        console.log(`\n  Linked events:`);
        for (const eid of a.linkedEventIds) {
          console.log(`    ${eid}`);
        }
      }

      console.log('');
    });

  // ── delete ──────────────────────────────────────────────

  artifact
    .command('delete <artifactId>')
    .description('Soft-delete an artifact (marks as deleted)')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((artifactId: string, opts) => {
      const projectId = requireActiveProject(opts.root);
      const success = deleteArtifact(opts.root, projectId, artifactId);

      if (!success) {
        console.error(`\n✗ Artifact "${artifactId}" not found.\n`);
        process.exit(1);
      }

      console.log(`\n✓ Artifact "${artifactId}" marked as deleted.\n`);
    });
}
