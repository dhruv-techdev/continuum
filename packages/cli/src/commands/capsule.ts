import { Command } from 'commander';
import { writeFileSync } from 'fs';
import { join } from 'path';
import {
  DEFAULT_ROOT,
  getState,
  getProject,
  buildManifest,
  validateManifest,
} from '@continuum/core';
import type { CapsuleManifest } from '@continuum/core';

function requireProject(root: string): string {
  const s = getState(root);
  if (!s.activeProjectId) { console.error('\n✗ No active project.\n'); process.exit(1); }
  return s.activeProjectId;
}

function formatSection(label: string, present: boolean, detail?: string): string {
  const icon = present ? '✓' : '—';
  const extra = detail ? `  ${detail}` : '';
  return `  ${icon} ${label.padEnd(16)}${extra}`;
}

export function registerCapsuleCommand(program: Command): void {
  const capsule = program.command('capsule').description('Manage context capsules');

  // ── manifest ────────────────────────────────────────────

  capsule
    .command('manifest')
    .description('Generate a capsule manifest for the active project')
    .option('--notes <text>', 'Human-readable notes')
    .option('--expires <timestamp>', 'Expiry ISO timestamp')
    .option('--sessions <ids>', 'Comma-separated session IDs to include')
    .option('--json', 'Output raw JSON', false)
    .option('--save', 'Save manifest.json to the project directory', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);
      const project = getProject(opts.root, projectId);
      if (!project) { console.error(`\n✗ Project not found.\n`); process.exit(1); }

      const sessionFilter = opts.sessions
        ? opts.sessions.split(',').map((s: string) => s.trim())
        : undefined;

      const manifest = buildManifest({
        workspaceRoot: opts.root,
        projectId,
        notes: opts.notes,
        expiresAt: opts.expires,
        sessionFilter,
      });

      // Validate
      const errors = validateManifest(manifest);
      if (errors.length > 0) {
        console.error('\n⚠ Manifest has validation issues:\n');
        for (const e of errors) {
          console.error(`  ✗ ${e.field}: ${e.message}`);
        }
        console.error('');
      }

      if (opts.json) {
        console.log(JSON.stringify(manifest, null, 2));
        return;
      }

      if (opts.save) {
        const outPath = join(opts.root, 'projects', projectId, 'manifest.json');
        writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
        console.log(`\n✓ Manifest saved to ${outPath}`);
      }

      console.log(`\n─── Capsule Manifest: ${project.title}\n`);
      console.log(`  Capsule ID:  ${manifest.capsuleId}`);
      console.log(`  Schema:      ${manifest.schemaVersion}`);
      console.log(`  Created:     ${manifest.createdAt}`);
      console.log(`  Created by:  ${manifest.createdBy}`);
      if (manifest.notes) console.log(`  Notes:       ${manifest.notes}`);
      if (manifest.expiresAt) console.log(`  Expires:     ${manifest.expiresAt}`);

      console.log(`\n  Project:`);
      console.log(`    ID:        ${manifest.project.id}`);
      console.log(`    Title:     ${manifest.project.title}`);
      console.log(`    Sessions:  ${manifest.project.sessionCount}`);

      console.log(`\n  Sections:`);
      console.log(formatSection('Ledger', true, `${manifest.ledger.eventCount} events, ${manifest.ledger.eventTypes.join(', ')}`));
      console.log(formatSection('State', !!manifest.state, manifest.state ? `${manifest.state.activeStatements} active statements` : undefined));
      console.log(formatSection('Tracking', !!manifest.tracking, manifest.tracking ? [
        manifest.tracking.decisions ? `${manifest.tracking.decisions.count} decisions` : null,
        manifest.tracking.tasks ? `${manifest.tracking.tasks.count} tasks` : null,
        manifest.tracking.attempts ? `${manifest.tracking.attempts.count} attempts` : null,
      ].filter(Boolean).join(', ') : undefined));
      console.log(formatSection('Artifacts', !!manifest.artifacts, manifest.artifacts ? `${manifest.artifacts.totalArtifacts} (${manifest.artifacts.storedCount} stored, ${manifest.artifacts.referenceCount} refs)` : undefined));
      console.log(formatSection('Evaluations', !!manifest.evaluations));

      console.log(`\n  Integrity:`);
      console.log(`    Algorithm: ${manifest.integrity.algorithm}`);
      console.log(`    Files:     ${manifest.integrity.files.length}`);
      for (const f of manifest.integrity.files) {
        console.log(`      ${f.path.padEnd(20)} ${f.hash.slice(0, 16)}… (${f.size} B)`);
      }

      if (errors.length === 0) {
        console.log('\n  ✓ Manifest is valid.\n');
      }
    });

  // ── validate ────────────────────────────────────────────

  capsule
    .command('validate <manifestPath>')
    .description('Validate a capsule manifest file')
    .action((manifestPath: string) => {
      const { existsSync, readFileSync } = require('fs');

      if (!existsSync(manifestPath)) {
        console.error(`\n✗ File not found: ${manifestPath}\n`);
        process.exit(1);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      } catch {
        console.error('\n✗ Invalid JSON.\n');
        process.exit(1);
      }

      const errors = validateManifest(parsed);

      if (errors.length === 0) {
        const m = parsed as CapsuleManifest;
        console.log(`\n✓ Manifest is valid.\n`);
        console.log(`  Capsule:  ${m.capsuleId}`);
        console.log(`  Schema:   ${m.schemaVersion}`);
        console.log(`  Project:  ${m.project?.title ?? '—'}`);
        console.log(`  Events:   ${m.ledger?.eventCount ?? 0}`);
        console.log(`  Files:    ${m.integrity?.files?.length ?? 0}\n`);
      } else {
        console.error(`\n✗ Manifest has ${errors.length} error(s):\n`);
        for (const e of errors) {
          console.error(`  ✗ ${e.field}: ${e.message}`);
        }
        console.error('');
        process.exit(1);
      }
    });
}
