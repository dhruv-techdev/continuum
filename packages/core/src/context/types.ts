/**
 * Layered context package types.
 *
 * Follows the product spec's transfer package model:
 *   L0 — Orientation:      Project identity and one-paragraph purpose
 *   L1 — Active state:     Objective, current task, progress, blockers, next actions
 *   L2 — Governing context: Constraints, decisions, rejected paths, terminology
 *   L3 — Supporting evidence: Relevant events, files, outputs, decision rationale
 *   L4 — Complete archive:  Untouched event ledger and artifacts (on demand)
 */

export const ContextLayers = {
  L0_ORIENTATION: 'L0',
  L1_ACTIVE_STATE: 'L1',
  L2_GOVERNING: 'L2',
  L3_EVIDENCE: 'L3',
  L4_ARCHIVE: 'L4',
} as const;

export type ContextLayer = (typeof ContextLayers)[keyof typeof ContextLayers];

export const ALL_LAYERS: readonly ContextLayer[] = ['L0', 'L1', 'L2', 'L3', 'L4'];

// ─── Layer content ──────────────────────────────────────────

export interface LayerContent {
  layer: ContextLayer;
  label: string;
  content: string;
  /** Approximate token count (chars / 4) */
  tokenEstimate: number;
  /** Whether this layer is always loaded or on-demand */
  loadBehavior: 'always' | 'continuation' | 'selected' | 'on_demand';
}

// ─── Context package ────────────────────────────────────────

export interface ContextPackage {
  projectId: string;
  projectTitle: string;
  generatedAt: string;

  layers: LayerContent[];

  /** Combined text of all included layers */
  combined: string;
  /** Total estimated tokens across all included layers */
  totalTokens: number;
  /** Token budget that was applied (0 = unlimited) */
  tokenBudget: number;
  /** Which layers were included */
  includedLayers: ContextLayer[];
  /** Which layers were trimmed or excluded due to budget */
  excludedLayers: ContextLayer[];
}

// ─── Build options ──────────────────────────────────────────

export interface ContextBuildOptions {
  workspaceRoot: string;
  projectId: string;
  /** Max tokens for the combined output (0 = unlimited) */
  tokenBudget?: number;
  /** Which layers to include (default: L0-L2 for continuation) */
  layers?: ContextLayer[];
  /** Topic or task to focus L3 evidence on */
  focusTopic?: string;
  /** Max events to include in L3 */
  maxEvidenceEvents?: number;
  /** Max events to include in L4 */
  maxArchiveEvents?: number;
}
