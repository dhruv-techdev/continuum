import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import {
  DEFAULT_ROOT,
  getState,
  getProject,
  setActiveProject,
  buildManifest,
  validateManifest,
  exportCapsule,
  verifyCapsuleIntegrity,
  importCapsule,
  ImportPhases,
} from '@continuum/core';
import type { CapsuleManifest, ImportIssue } from '@continuum/core';

function requireProject(root: string): string {
  const s = getState(root);
  if (!s.activeProjectId) {
    console.error('\n✗ No active project.\n');
    process.exit(1);
  }
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

function formatIssues(issues: ImportIssue[], verbose: boolean): string {
  if (issues.length === 0) return '';

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  const lines: string[] = [''];

  if (errors.length > 0) {
    lines.push(`  Errors (${errors.length}):`);
    const limit = verbose ? errors.length : Math.min(errors.length, 10);
    for (let i = 0; i < limit; i++) {
      lines.push(`    ✗ [${errors[i].phase}] ${errors[i].message}`);
    }
    if (!verbose && errors.length > limit) {
      lines.push(`    ... and ${errors.length - limit} more. Use --verbose.`);
    }
  }

  if (warnings.length > 0) {
    lines.push(`  Warnings (${warnings.length}):`);
    const limit = verbose ? warnings.length : Math.min(warnings.length, 5);
    for (let i = 0; i < limit; i++) {
      lines.push(`    ⚠ [${warnings[i].phase}] ${warnings[i].message}`);
    }
    if (!verbose && warnings.length > limit) {
      lines.push(`    ... and ${warnings.length - limit} more.`);
    }
  }

  return lines.join('\n');
}

export function registerCapsuleCommand(program: Command): void {
  const capsule = program.command('capsule').description('Manage context capsules');

  // ── import (ST3) ────────────────────────────────────────

  capsule
    .command('import <capsulePath>')
    .description('Import a context capsule into the workspace')
    .option('-t, --title <name>', 'Override the project title')
    .option('--skip-integrity', 'Skip file hash verification (not recommended)', false)
    .option('--skip-event-hashes', 'Skip individual event hash checks', false)
    .option('--allow-warnings', 'Import despite warnings (errors still block)', false)
    .option('--verbose', 'Show all validation details', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((capsulePath: string, opts) => {
      const resolved = resolve(capsulePath);

      console.log(`\n  Importing capsule: ${resolved}\n`);

      const result = importCapsule({
        workspaceRoot: opts.root,
        capsulePath: resolved,
        title: opts.title,
        skipIntegrity: opts.skipIntegrity,
        skipEventHashes: opts.skipEventHashes,
        allowWarnings: opts.allowWarnings,
      });

      // Show phases completed
      const phaseLabels: Record<string, string> = {
        structure: 'Structure',
        schema: 'Schema',
        integrity: 'Integrity',
        events: 'Events',
        import: 'Import',
      };

      console.log('  Validation phases:');
      const allPhases = Object.values(ImportPhases);
      for (const phase of allPhases) {
        const passed = result.phasesCompleted.includes(phase);
        const phaseErrors = result.issues.filter(
          (i) => i.phase === phase && i.severity === 'error',
        );
        const icon = passed ? '✓' : phaseErrors.length > 0 ? '✗' : '—';
        console.log(`    ${icon} ${phaseLabels[phase] ?? phase}`);
      }

      // Show issues
      if (result.issues.length > 0) {
        console.log(formatIssues(result.issues, opts.verbose));
      }

      if (!result.success) {
        const errors = result.issues.filter((i) => i.severity === 'error');
        console.log(`\n  ✗ Import failed with ${errors.length} error(s).\n`);
        process.exit(1);
      }

      // Auto-select the imported project
      setActiveProject(opts.root, result.projectId!);

      console.log(`\n  ✓ Capsule imported successfully\n`);
      console.log(`  Project ID:  ${result.projectId}`);
      console.log(`  Title:       ${result.projectTitle}`);
      console.log(`  Capsule:     ${result.capsuleId}`);
      console.log(`  Events:      ${result.eventsImported}`);
      console.log(`  Sessions:    ${result.sessionsImported}`);
      console.log(`  Status:      active (auto-selected)`);
      console.log(`\n  Next steps:`);
      console.log(`    continuum state show     View the imported working state`);
      console.log(`    continuum timeline       Browse the imported history`);
      console.log(`    continuum search <query>  Search the imported events\n`);
    });

  // ── export ──────────────────────────────────────────────

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
      if (!project) {
        console.error('\n✗ Project not found.\n');
        process.exit(1);
      }

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
      console.log(`  Files:      ${result.filesCopied}`);
      console.log(`  Size:       ${formatBytes(result.totalSize)}`);
      if (opts.notes) console.log(`  Notes:      ${opts.notes}`);
      console.log(`\n  Contents:`);
      console.log(formatSection('Ledger', true, `${m.ledger.eventCount} events`));
      console.log(
        formatSection(
          'State',
          !!m.state,
          m.state ? `${m.state.activeStatements} statements` : undefined,
        ),
      );
      console.log(formatSection('Tracking', !!m.tracking));
      console.log(
        formatSection(
          'Artifacts',
          !!m.artifacts,
          m.artifacts ? `${m.artifacts.totalArtifacts} registered` : undefined,
        ),
      );
      console.log(`\n  To verify: continuum capsule verify ${result.capsulePath}\n`);
    });

  // ── verify ──────────────────────────────────────────────

  capsule
    .command('verify <capsulePath>')
    .description('Verify capsule integrity')
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((capsulePath: string) => {
      const resolved = resolve(capsulePath);
      if (!existsSync(resolved)) {
        console.error(`\n✗ Not found: ${resolved}\n`);
        process.exit(1);
      }

      const result = verifyCapsuleIntegrity(resolved);
      if (result.error) {
        console.error(`\n✗ ${result.error}\n`);
        process.exit(1);
      }

      console.log(`\n  Files checked: ${result.filesChecked}`);
      if (result.missing.length > 0) {
        console.log(`\n  Missing (${result.missing.length}):`);
        for (const f of result.missing) console.log(`    ✗ ${f}`);
      }
      if (result.mismatches.length > 0) {
        console.log(`\n  Mismatches (${result.mismatches.length}):`);
        for (const m of result.mismatches)
          console.log(
            `    ✗ ${m.path}: expected ${m.expected.slice(0, 16)}…, got ${m.actual.slice(0, 16)}…`,
          );
      }
      if (result.valid)
        console.log(
          `\n  ✓ All ${result.filesChecked} file(s) verified. Capsule integrity verified.\n`,
        );
      else {
        console.log(`\n  ✗ Integrity check FAILED.\n`);
        process.exit(1);
      }
    });

  // ── manifest ────────────────────────────────────────────

  capsule
    .command('manifest')
    .description('Generate a capsule manifest preview')
    .option('--json', 'Output raw JSON', false)
    .option('--save', 'Save to project directory', false)
    .option('--notes <text>', 'Notes')
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);
      const project = getProject(opts.root, projectId);
      if (!project) {
        console.error('\n✗ Project not found.\n');
        process.exit(1);
      }

      const manifest = buildManifest({ workspaceRoot: opts.root, projectId, notes: opts.notes });
      if (opts.json) {
        console.log(JSON.stringify(manifest, null, 2));
        return;
      }
      if (opts.save) {
        const p = join(opts.root, 'projects', projectId, 'manifest.json');
        writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
        console.log(`\n✓ Saved to ${p}`);
      }
      console.log(
        `\n─── Manifest: ${project.title}\n  Capsule: ${manifest.capsuleId}\n  Events: ${manifest.ledger.eventCount}\n  Integrity: ${manifest.integrity.files.length} files\n`,
      );
    });

  // ── validate ────────────────────────────────────────────

  capsule
    .command('validate <manifestPath>')
    .description('Validate a manifest file')
    .action((manifestPath: string) => {
      if (!existsSync(manifestPath)) {
        console.error(`\n✗ Not found: ${manifestPath}\n`);
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
        console.log(
          `\n✓ Valid: ${m.capsuleId} — ${m.project?.title ?? '—'} (${m.ledger?.eventCount ?? 0} events)\n`,
        );
      } else {
        console.error(`\n✗ ${errors.length} error(s):\n`);
        for (const e of errors) console.error(`  ✗ ${e.field}: ${e.message}`);
        console.error('');
        process.exit(1);
      }
    });
}
