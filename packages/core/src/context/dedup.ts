/**
 * Content deduplication with source reference preservation.
 *
 * When the same information appears in multiple places
 * (e.g., a decision extracted from the state engine AND
 * from the tracking store), keep only the highest-scored
 * version but merge all source event IDs.
 */

import type { ScoredItem } from './ranker';

/**
 * Normalize text for fuzzy comparison.
 * Strips punctuation, collapses whitespace, lowercases.
 */
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Simple similarity check: are two strings similar enough
 * to be considered duplicates?
 *
 * Uses a combination of:
 *   1. Exact normalized match
 *   2. One contains the other (substring match)
 *   3. Shared word overlap above threshold
 */
function areSimilar(a: string, b: string, threshold = 0.7): boolean {
  const normA = normalizeForComparison(a);
  const normB = normalizeForComparison(b);

  // Exact match after normalization
  if (normA === normB) return true;

  // Substring containment (shorter within longer)
  const shorter = normA.length < normB.length ? normA : normB;
  const longer = normA.length < normB.length ? normB : normA;
  if (longer.includes(shorter) && shorter.length > 20) return true;

  // Word overlap
  const wordsA = new Set(normA.split(' ').filter((w) => w.length > 2));
  const wordsB = new Set(normB.split(' ').filter((w) => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) return false;

  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }

  const overlapRatio = overlap / Math.min(wordsA.size, wordsB.size);
  return overlapRatio >= threshold;
}

/**
 * Deduplicate scored items. For each group of similar items:
 *   - Keep the one with the highest score
 *   - Merge source event IDs from all duplicates
 *   - Track how many duplicates were merged
 */
export interface DeduplicatedItem extends ScoredItem {
  /** Number of duplicates merged into this item */
  mergedCount: number;
  /** All unique source event IDs from this item and its duplicates */
  allSourceIds: string[];
}

export function deduplicateItems(items: ScoredItem[]): DeduplicatedItem[] {
  if (items.length === 0) return [];

  const result: DeduplicatedItem[] = [];
  const consumed = new Set<number>();

  // Sort by score descending so we always keep the highest-scored version
  const sorted = [...items].sort((a, b) => b.score - a.score);

  for (let i = 0; i < sorted.length; i++) {
    if (consumed.has(i)) continue;

    const primary = sorted[i];
    const allSourceIds = new Set(primary.sourceIds);
    let mergedCount = 0;

    // Find duplicates
    for (let j = i + 1; j < sorted.length; j++) {
      if (consumed.has(j)) continue;

      if (areSimilar(primary.text, sorted[j].text)) {
        consumed.add(j);
        mergedCount++;

        // Merge source IDs
        for (const sid of sorted[j].sourceIds) {
          allSourceIds.add(sid);
        }
      }
    }

    result.push({
      ...primary,
      mergedCount,
      allSourceIds: [...allSourceIds],
    });
  }

  return result;
}

/**
 * Format deduplicated items for context injection.
 * Shows the source count and merged indicator.
 */
export function formatDeduplicatedItem(item: DeduplicatedItem): string {
  const merged = item.mergedCount > 0 ? ` [${item.mergedCount + 1} sources]` : '';
  const refs =
    item.allSourceIds.length > 0
      ? ` (refs: ${item.allSourceIds
          .slice(0, 3)
          .map((id) => id.slice(0, 12))
          .join(', ')}${item.allSourceIds.length > 3 ? '…' : ''})`
      : '';
  return `- ${item.text}${merged}${refs}`;
}
