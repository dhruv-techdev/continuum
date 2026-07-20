import { Command } from 'commander';
import {
  DEFAULT_ROOT,
  getState,
  getProject,
  buildContextPackage,
  buildSingleLayer,
  ContextLayers,
  ALL_LAYERS,
} from '@continuum/core';
import type { ContextLayer, LayerContent } from '@continuum/core';

function requireProject(root: string): string {
  const s = getState(root);
  if (!s.activeProjectId) { console.error('\n✗ No active project.\n'); process.exit(1); }
  return s.activeProjectId;
}

function parseLayers(input: string): ContextLayer[] {
  return input.split(',').map((s) => s.trim().toUpperCase() as ContextLayer).filter((l) => ALL_LAYERS.includes(l));
}

function formatLayerSummary(layer: LayerContent): string {
  return `  ${layer.layer}  ${layer.label.padEnd(22)} ~${layer.tokenEstimate} tokens  (${layer.loadBehavior})`;
}

export function registerContextCommand(program: Command): void {
  const ctx = program.command('context').description('Build layered context packages for session transfer');

  // ── package ─────────────────────────────────────────────

  ctx
    .command('package')
    .description('Generate a full layered context package')
    .option('-l, --layers <layers>', 'Comma-separated layers to include (L0,L1,L2,L3,L4)', 'L0,L1,L2')
    .option('-b, --budget <tokens>', 'Token budget (0 = unlimited)', parseInt, 0)
    .option('--focus <topic>', 'Focus topic for L3 evidence')
    .option('--max-evidence <n>', 'Max events in L3', parseInt, 30)
    .option('--max-archive <n>', 'Max events in L4', parseInt, 100)
    .option('--raw', 'Output only the combined text (for piping)', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);

      const layers = parseLayers(opts.layers);

      if (layers.length === 0) {
        console.error('\n✗ No valid layers specified. Valid: L0, L1, L2, L3, L4\n');
        process.exit(1);
      }

      const pkg = buildContextPackage({
        workspaceRoot: opts.root,
        projectId,
        tokenBudget: opts.budget,
        layers,
        focusTopic: opts.focus,
        maxEvidenceEvents: opts.maxEvidence,
        maxArchiveEvents: opts.maxArchive,
      });

      if (opts.raw) {
        console.log(pkg.combined);
        return;
      }

      console.log(`\n─── Context Package: ${pkg.projectTitle}\n`);
      console.log(`  Generated:   ${pkg.generatedAt.slice(0, 19)}`);
      console.log(`  Total tokens: ~${pkg.totalTokens}`);
      if (pkg.tokenBudget > 0) console.log(`  Budget:      ${pkg.tokenBudget} tokens`);
      console.log(`  Included:    ${pkg.includedLayers.join(', ')}`);
      if (pkg.excludedLayers.length > 0) console.log(`  Excluded:    ${pkg.excludedLayers.join(', ')} (over budget)`);

      console.log('\n  Layers:\n');
      for (const layer of pkg.layers) {
        console.log(formatLayerSummary(layer));
      }

      console.log('\n' + '═'.repeat(60) + '\n');
      console.log(pkg.combined);
    });

  // ── layer <id> ──────────────────────────────────────────

  ctx
    .command('layer <layerId>')
    .description('Generate a single context layer (L0, L1, L2, L3, L4)')
    .option('--focus <topic>', 'Focus topic for L3')
    .option('--max-events <n>', 'Max events for L3/L4', parseInt, 30)
    .option('--raw', 'Output only the content text', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((layerId: string, opts) => {
      const projectId = requireProject(opts.root);
      const layer = layerId.toUpperCase() as ContextLayer;

      if (!ALL_LAYERS.includes(layer)) {
        console.error(`\n✗ Invalid layer "${layerId}". Valid: ${ALL_LAYERS.join(', ')}\n`);
        process.exit(1);
      }

      const content = buildSingleLayer(
        opts.root, projectId, layer,
        opts.focus, opts.maxEvents,
      );

      if (opts.raw) {
        console.log(content.content);
        return;
      }

      console.log(`\n${formatLayerSummary(content)}\n`);
      console.log(content.content);
      console.log('');
    });

  // ── resume ──────────────────────────────────────────────

  ctx
    .command('resume')
    .description('Generate the standard L0+L1+L2 continuation package')
    .option('-b, --budget <tokens>', 'Token budget', parseInt, 0)
    .option('--raw', 'Output only the combined text', false)
    .option('--root <path>', '', DEFAULT_ROOT)
    .action((opts) => {
      const projectId = requireProject(opts.root);

      const pkg = buildContextPackage({
        workspaceRoot: opts.root,
        projectId,
        tokenBudget: opts.budget,
        layers: [ContextLayers.L0_ORIENTATION, ContextLayers.L1_ACTIVE_STATE, ContextLayers.L2_GOVERNING],
      });

      if (opts.raw) {
        console.log(pkg.combined);
        return;
      }

      console.log(`\n─── Resume Package: ${pkg.projectTitle}\n`);
      console.log(`  Tokens: ~${pkg.totalTokens}`);
      console.log(`  Layers: ${pkg.includedLayers.join(', ')}\n`);
      console.log(pkg.combined);
    });
}
