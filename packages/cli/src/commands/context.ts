import { Command } from 'commander';
import {
  DEFAULT_ROOT,
  getState,
  buildContextPackage,
  buildSingleLayer,
  ContextLayers,
  ALL_LAYERS,
  MODEL_PRESETS,
  getModelPreset,
  listPresetIds,
} from '@dhruv-techdev/continuum-core';
import type { ContextLayer } from '@dhruv-techdev/continuum-core';

function requireProject(root: string): string {
  const s = getState(root);
  if (!s.activeProjectId) {
    console.error('\n✗ No active project.\n');
    process.exit(1);
  }
  return s.activeProjectId;
}

function parseLayers(input: string): ContextLayer[] {
  return input
    .split(',')
    .map((s) => s.trim().toUpperCase() as ContextLayer)
    .filter((l) => ALL_LAYERS.includes(l));
}

function resolveBudget(opts: { budget?: number; model?: string }): number {
  if (opts.budget && opts.budget > 0) return opts.budget;

  if (opts.model) {
    const preset = getModelPreset(opts.model);
    if (!preset) {
      console.error(
        `\n✗ Unknown model "${opts.model}". Available: ${listPresetIds().join(', ')}\n`,
      );
      process.exit(1);
    }
    return preset.usableBudget;
  }

  return 0;
}

export function registerContextCommand(program: Command): void {
  const ctx = program
    .command('context')
    .description('Build layered context packages for session transfer');

  // ── package ─────────────────────────────────────────────

  ctx
    .command('package')
    .description('Generate a full layered context package')
    .option('-l, --layers <layers>', 'Layers to include (L0,L1,L2,L3,L4)', 'L0,L1,L2')
    .option('-s, --session <id>', 'Scope to a single session instead of the whole project')
    .option('-b, --budget <tokens>', 'Token budget (0 = unlimited)', parseInt)
    .option(
      '-m, --model <preset>',
      'Model preset for auto budget (e.g. claude-sonnet, gpt-4o, small)',
    )
    .option('--focus <topic>', 'Focus topic for L3 evidence')
    .option('--max-evidence <n>', 'Max events in L3', parseInt, 30)
    .option('--max-archive <n>', 'Max events in L4', parseInt, 100)
    .option('--raw', 'Output only the combined text', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);
      const layers = parseLayers(opts.layers);

      if (layers.length === 0) {
        console.error('\n✗ No valid layers. Valid: L0, L1, L2, L3, L4\n');
        process.exit(1);
      }

      const budget = resolveBudget(opts);

      let pkg;
      try {
        pkg = buildContextPackage({
          workspaceRoot: opts.root,
          projectId,
          sessionId: opts.session,
          tokenBudget: budget,
          layers,
          focusTopic: opts.focus,
          maxEvidenceEvents: opts.maxEvidence,
          maxArchiveEvents: opts.maxArchive,
        });
      } catch (err) {
        console.error(`\n✗ ${(err as Error).message}\n`);
        process.exit(1);
      }

      if (opts.raw) {
        console.log(pkg.combined);
        return;
      }

      console.log(`\n─── Context Package: ${pkg.projectTitle}\n`);
      console.log(`  Tokens:    ~${pkg.totalTokens}`);
      if (budget > 0) {
        console.log(`  Budget:    ${budget} tokens${opts.model ? ` (${opts.model})` : ''}`);
        console.log(`  Usage:     ${Math.round((pkg.totalTokens / budget) * 100)}%`);
      }
      console.log(`  Included:  ${pkg.includedLayers.join(', ')}`);
      if (pkg.excludedLayers.length > 0)
        console.log(`  Excluded:  ${pkg.excludedLayers.join(', ')} (over budget)`);

      console.log('\n  Layers:\n');
      for (const layer of pkg.layers) {
        console.log(`    ${layer.layer}  ${layer.label.padEnd(22)} ~${layer.tokenEstimate} tokens`);
      }

      console.log('\n' + '═'.repeat(60) + '\n');
      console.log(pkg.combined);
    });

  // ── layer ───────────────────────────────────────────────

  ctx
    .command('layer <layerId>')
    .description('Generate a single context layer')
    .option('--focus <topic>', 'Focus topic for L3')
    .option('--max-events <n>', 'Max events for L3/L4', parseInt, 30)
    .option('--raw', 'Output only the content', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((layerId: string, opts) => {
      const projectId = requireProject(opts.root);
      const layer = layerId.toUpperCase() as ContextLayer;

      if (!ALL_LAYERS.includes(layer)) {
        console.error(`\n✗ Invalid layer. Valid: ${ALL_LAYERS.join(', ')}\n`);
        process.exit(1);
      }

      const content = buildSingleLayer(opts.root, projectId, layer, opts.focus, opts.maxEvents);

      if (opts.raw) {
        console.log(content.content);
        return;
      }

      console.log(
        `\n  ${content.layer}  ${content.label}  ~${content.tokenEstimate} tokens  (${content.loadBehavior})\n`,
      );
      console.log(content.content);
      console.log('');
    });

  // ── resume ──────────────────────────────────────────────

  ctx
    .command('resume')
    .description('Generate the standard L0+L1+L2 continuation package')
    .option('-s, --session <id>', 'Scope to a single session instead of the whole project')
    .option('-b, --budget <tokens>', 'Token budget', parseInt)
    .option('-m, --model <preset>', 'Model preset for auto budget')
    .option('--raw', 'Output only the combined text', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);
      const budget = resolveBudget(opts);

      let pkg;
      try {
        pkg = buildContextPackage({
          workspaceRoot: opts.root,
          projectId,
          sessionId: opts.session,
          tokenBudget: budget,
          layers: [
            ContextLayers.L0_ORIENTATION,
            ContextLayers.L1_ACTIVE_STATE,
            ContextLayers.L2_GOVERNING,
          ],
        });
      } catch (err) {
        console.error(`\n✗ ${(err as Error).message}\n`);
        process.exit(1);
      }

      if (opts.raw) {
        console.log(pkg.combined);
        return;
      }

      console.log(`\n─── Resume Package: ${pkg.projectTitle}\n`);
      console.log(`  Tokens: ~${pkg.totalTokens}`);
      if (budget > 0) console.log(`  Budget: ${budget}${opts.model ? ` (${opts.model})` : ''}`);
      console.log(`  Layers: ${pkg.includedLayers.join(', ')}\n`);
      console.log(pkg.combined);
    });

  // ── models ──────────────────────────────────────────────

  ctx
    .command('models')
    .description('List available model presets and their token budgets')
    .action(() => {
      console.log('\n  Model Presets:\n');
      console.log(
        `  ${'ID'.padEnd(18)} ${'Name'.padEnd(22)} ${'Window'.padEnd(10)} ${'Usable'.padEnd(10)}`,
      );
      console.log(`  ${'─'.repeat(18)} ${'─'.repeat(22)} ${'─'.repeat(10)} ${'─'.repeat(10)}`);

      for (const p of MODEL_PRESETS) {
        console.log(
          `  ${p.id.padEnd(18)} ${p.name.padEnd(22)} ${String(p.contextWindow).padEnd(10)} ${String(p.usableBudget).padEnd(10)}`,
        );
      }

      console.log(`\n  Usage: continuum context package --model claude-sonnet\n`);
    });
}
