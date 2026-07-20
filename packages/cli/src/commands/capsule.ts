import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import {
  DEFAULT_ROOT,
  getState,
  getProject,
  buildManifest,
  validateManifest,
  exportCapsule,
  verifyCapsuleIntegrity,
} from '@continuum/core';
import type { CapsuleManifest } from '@continuum/core';

function requireProject(root: string): string {
  const s = getState(root);
  if (!s.activeProjectId) { console.error('\n✗ No active project.\n'); process.exit(1); }
  return s.activeProjectId;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatSection(label: string, present: boolean, detail?: string): string {
  const icon = present ? '✓' : '—';
  const extra = detail ? `  ${detail}` : '';
  return `  ${icon} ${label.padEnd(16)}${extra}`;
}

export function registerCapsuleCommand(program: Command): void {
  const capsule = program.command('capsule').description('Manage context capsules');

  // ── export (ST3) ────────────────────────────────────────

  capsule
    .command('export')
    .description('Export a portable context capsule')
    .option('-o, --output <dir>', 'Output directory', join(homedir(), '.continuum', 'capsules'))
    .option('--include-artifacts', 'Include stored artifact content', false)
    .option('--sessions <ids>', 'Comma-separated session IDs to include')
    .option('--notes <text>', 'Human-readable notes')
    .option('--expires <timestamp>', 'Expiry ISO timestamp')
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);
      const project = getProject(opts.root, projectId);
      if (!project) { console.error('\n✗ Project not found.\n'); process.exit(1); }

      const sessionFilter = opts.sessions
        ? opts.sessions.split(',').map((s: string) => s.trim())
        : undefined;

      console.log(`\n  Exporting capsule for "${project.title}"...\n`);

      const result = exportCapsule({
        workspaceRoot: opts.root,
        projectId,
        outputDir: opts.output,
        includeArtifactContent: opts.includeArtifacts,
        sessionFilter,
        notes: opts.notes,
        expiresAt: opts.expires,
      });

      if (result.error) {
        console.error(`\n✗ ${result.error}\n`);
        process.exit(1);
      }

      const m = result.manifest;

      console.log(`✓ Capsule exported\n`);
      console.log(`  Path:       ${result.capsulePath}`);
      console.log(`  Capsule ID: ${result.capsuleId}`);
      console.log(`  Schema:     ${m.schemaVersion}`);
      console.log(`  Files:      ${result.filesCopied}`);
      console.log(`  Size:       ${formatBytes(result.totalSize)}`);

      console.log(`\n  Contents:`);
      console.log(formatSection('Ledger', true, `${m.ledger.eventCount} events`));
      console.log(formatSection('State', !!m.state, m.state ? `${m.state.activeStatements} statements` : undefined));
      console.log(formatSection('Tracking', !!m.tracking));
      console.log(formatSection('Artifacts', !!m.artifacts, m.artifacts ? `${m.artifacts.totalArtifacts} registered` : undefined));

      console.log(`\n  Integrity:`);
      console.log(`    ${m.integrity.files.length} file(s) hashed with ${m.integrity.algorithm}`);

      if (m.notes) console.log(`\n  Notes: ${m.notes}`);
      if (m.expiresAt) console.log(`  Expires: ${m.expiresAt}`);

      console.log(`\n  To verify: continuum capsule verify ${result.capsulePath}\n`);
    });

  // ── verify ──────────────────────────────────────────────

  capsule
    .command('verify <capsulePath>')
    .description('Verify capsule integrity against its hashes')
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((capsulePath: string) => {
      const resolved = resolve(capsulePath);

      if (!existsSync(resolved)) {
        console.error(`\n✗ Capsule not found: ${resolved}\n`);
        process.exit(1);
      }

      console.log(`\n  Verifying capsule: ${resolved}\n`);

      const result = verifyCapsuleIntegrity(resolved);

      if (result.error) {
        console.error(`\n✗ ${result.error}\n`);
        process.exit(1);
      }

      console.log(`  Files checked: ${result.filesChecked}`);

      if (result.missing.length > 0) {
        console.log(`\n  Missing files (${result.missing.length}):`);
        for (const f of result.missing) {
          console.log(`    ✗ ${f}`);
        }
      }

      if (result.mismatches.length > 0) {
        console.log(`\n  Hash mismatches (${result.mismatches.length}):`);
        for (const m of result.mismatches) {
          console.log(`    ✗ ${m.path}`);
          console.log(`      Expected: ${m.expected.slice(0, 16)}…`);
          console.log(`      Actual:   ${m.actual.slice(0, 16)}…`);
        }
      }

      if (result.valid) {
        console.log(`\n  ✓ Capsule integrity verified. All ${result.filesChecked} files match.\n`);
      } else {
        console.log(`\n  ✗ Capsule integrity check FAILED.\n`);
        process.exit(1);
      }
    });

  // ── manifest ────────────────────────────────────────────

  capsule
    .command('manifest')
    .description('Generate a capsule manifest (preview without exporting)')
    .option('--sessions <ids>', 'Comma-separated session IDs')
    .option('--notes <text>', 'Notes')
    .option('--json', 'Output raw JSON', false)
    .option('--save', 'Save manifest.json to project directory', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);
      const project = getProject(opts.root, projectId);
      if (!project) { console.error('\n✗ Project not found.\n'); process.exit(1); }

      const sessionFilter = opts.sessions
        ? opts.sessions.split(',').map((s: string) => s.trim())
        : undefined;

      const manifest = buildManifest({ workspaceRoot: opts.root, projectId, notes: opts.notes, sessionFilter });

      const errors = validateManifest(manifest);
      if (errors.length > 0) {
        console.error('\n⚠ Manifest has validation issues:\n');
        for (const e of errors) console.error(`  ✗ ${e.field}: ${e.message}`);
        console.error('');
      }

      if (opts.json) { console.log(JSON.stringify(manifest, null, 2)); return; }

      if (opts.save) {
        const outPath = join(opts.root, 'projects', projectId, 'manifest.json');
        writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
        console.log(`\n✓ Manifest saved to ${outPath}`);
      }

      console.log(`\n─── Capsule Manifest: ${project.title}\n`);
      console.log(`  Capsule ID: ${manifest.capsuleId}`);
      console.log(`  Schema:     ${manifest.schemaVersion}`);
      console.log(`  Events:     ${manifest.ledger.eventCount}`);
      console.log(`  Types:      ${manifest.ledger.eventTypes.join(', ')}`);
      console.log(`  Integrity:  ${manifest.integrity.files.length} file(s)`);
      if (errors.length === 0) console.log('\n  ✓ Valid.\n');
    });

  // ── validate ────────────────────────────────────────────

  capsule
    .command('validate <manifestPath>')
    .description('Validate a capsule manifest file')
    .action((manifestPath: string) => {
      if (!existsSync(manifestPath)) { console.error(`\n✗ File not found: ${manifestPath}\n`); process.exit(1); }

      let parsed: unknown;
      try { parsed = JSON.parse(readFileSync(manifestPath, 'utf-8')); } catch { console.error('\n✗ Invalid JSON.\n'); process.exit(1); }

      const errors = validateManifest(parsed);

      if (errors.length === 0) {
        const m = parsed as CapsuleManifest;
        console.log(`\n✓ Valid manifest: ${m.capsuleId} — ${m.project?.title ?? '—'} (${m.ledger?.eventCount ?? 0} events)\n`);
      } else {
        console.error(`\n✗ ${errors.length} error(s):\n`);
        for (const e of errors) console.error(`  ✗ ${e.field}: ${e.message}`);
        console.error('');
        process.exit(1);
      }
    });
}
