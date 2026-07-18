/**
 * Heuristic state extractor.
 *
 * Scans message events for signal phrases and extracts
 * categorized statements with provenance links (ST2).
 *
 * This is the Phase 1 deterministic extractor. It will be
 * augmented with model-based extraction in later phases.
 */

import { randomUUID } from 'crypto';
import type { ContinuumEvent, MessageEvent } from '../events/types';
import { EventTypes, MessageRoles } from '../events/types';
import {
  StatementCategories,
  ConfidenceLevels,
} from './types';
import type {
  Statement,
  StatementCategory,
  ConfidenceLevel,
  WorkingState,
} from './types';

// ─── Pattern definitions ────────────────────────────────────

interface ExtractionPattern {
  category: StatementCategory;
  /** Regex to test against a sentence */
  pattern: RegExp;
  /** Confidence if matched */
  confidence: ConfidenceLevel;
  /** Only match assistant messages (decisions/completions are usually from the AI) */
  roleFilter?: 'user' | 'assistant' | 'any';
}

const PATTERNS: ExtractionPattern[] = [
  // ── Objectives ──────────────────────────────────────────
  { category: StatementCategories.OBJECTIVE, pattern: /\b(?:goal|objective|aim|purpose)\s+(?:is|:)\s*/i, confidence: ConfidenceLevels.HIGH, roleFilter: 'any' },
  { category: StatementCategories.OBJECTIVE, pattern: /\b(?:i want|we want|i need|we need)\s+(?:to|a|an|the)\b/i, confidence: ConfidenceLevels.MEDIUM, roleFilter: 'user' },
  { category: StatementCategories.OBJECTIVE, pattern: /\b(?:trying to|planning to|working on)\b/i, confidence: ConfidenceLevels.MEDIUM, roleFilter: 'user' },
  { category: StatementCategories.OBJECTIVE, pattern: /\b(?:build|create|implement|design|develop)\s+(?:a|an|the)\b/i, confidence: ConfidenceLevels.LOW, roleFilter: 'user' },

  // ── Constraints ─────────────────────────────────────────
  { category: StatementCategories.CONSTRAINT, pattern: /\b(?:must|shall|required to|has to|have to)\b/i, confidence: ConfidenceLevels.HIGH, roleFilter: 'any' },
  { category: StatementCategories.CONSTRAINT, pattern: /\b(?:cannot|can't|must not|should not|shouldn't|do not|don't)\b/i, confidence: ConfidenceLevels.HIGH, roleFilter: 'any' },
  { category: StatementCategories.CONSTRAINT, pattern: /\b(?:constraint|requirement|limitation|restriction|prohibition)\s*:/i, confidence: ConfidenceLevels.HIGH, roleFilter: 'any' },
  { category: StatementCategories.CONSTRAINT, pattern: /\b(?:avoid|never|always)\b/i, confidence: ConfidenceLevels.MEDIUM, roleFilter: 'any' },

  // ── Decisions ───────────────────────────────────────────
  { category: StatementCategories.DECISION, pattern: /\b(?:decided|decision)\s*(?:to|:)/i, confidence: ConfidenceLevels.HIGH, roleFilter: 'any' },
  { category: StatementCategories.DECISION, pattern: /\b(?:going with|chose|chosen|picking|selected)\b/i, confidence: ConfidenceLevels.HIGH, roleFilter: 'any' },
  { category: StatementCategories.DECISION, pattern: /\b(?:let's use|we'll use|i'll use|let's go with)\b/i, confidence: ConfidenceLevels.MEDIUM, roleFilter: 'any' },
  { category: StatementCategories.DECISION, pattern: /\b(?:instead of|rather than|over|preferred)\b/i, confidence: ConfidenceLevels.LOW, roleFilter: 'any' },

  // ── Next actions ────────────────────────────────────────
  { category: StatementCategories.NEXT_ACTION, pattern: /\b(?:next step|next action|next,?|todo|to-do)\s*(?:is|:|—)/i, confidence: ConfidenceLevels.HIGH, roleFilter: 'any' },
  { category: StatementCategories.NEXT_ACTION, pattern: /\b(?:then we|after that|following that|subsequently)\b/i, confidence: ConfidenceLevels.MEDIUM, roleFilter: 'any' },
  { category: StatementCategories.NEXT_ACTION, pattern: /\b(?:action item|task)\s*:/i, confidence: ConfidenceLevels.HIGH, roleFilter: 'any' },

  // ── Completed ───────────────────────────────────────────
  { category: StatementCategories.COMPLETED, pattern: /\b(?:done|completed|finished|implemented|added|created|built|set up|configured)\b/i, confidence: ConfidenceLevels.MEDIUM, roleFilter: 'assistant' },

  // ── Failures ────────────────────────────────────────────
  { category: StatementCategories.FAILURE, pattern: /\b(?:failed|didn't work|doesn't work|broken|error|bug|issue|problem)\b/i, confidence: ConfidenceLevels.MEDIUM, roleFilter: 'any' },
  { category: StatementCategories.FAILURE, pattern: /\b(?:tried|attempted)\b.*\b(?:but|however|unfortunately)\b/i, confidence: ConfidenceLevels.HIGH, roleFilter: 'any' },

  // ── Assumptions ─────────────────────────────────────────
  { category: StatementCategories.ASSUMPTION, pattern: /\b(?:assuming|assumption|i assume|we assume|presumably)\b/i, confidence: ConfidenceLevels.HIGH, roleFilter: 'any' },

  // ── Open questions ──────────────────────────────────────
  { category: StatementCategories.OPEN_QUESTION, pattern: /\b(?:unclear|unsure|not sure|need to figure out|open question|tbd|to be determined)\b/i, confidence: ConfidenceLevels.HIGH, roleFilter: 'any' },
  { category: StatementCategories.OPEN_QUESTION, pattern: /\b(?:should we|do we need|what about|how should)\b.*\?/i, confidence: ConfidenceLevels.MEDIUM, roleFilter: 'any' },
];

// ─── Sentence splitting ─────────────────────────────────────

function splitSentences(text: string): string[] {
  // Split on sentence boundaries but keep the delimiter
  const raw = text.split(/(?<=[.!?])\s+/);

  const sentences: string[] = [];
  for (const s of raw) {
    const trimmed = s.trim();
    // Skip very short fragments and code blocks
    if (trimmed.length < 10) continue;
    if (trimmed.startsWith('```')) continue;
    if (trimmed.startsWith('import ') || trimmed.startsWith('export ')) continue;
    if (trimmed.startsWith('const ') || trimmed.startsWith('let ') || trimmed.startsWith('var ')) continue;
    sentences.push(trimmed);
  }

  return sentences;
}

// ─── Extract from a single message ──────────────────────────

function generateStatementId(): string {
  return `stmt_${randomUUID().slice(0, 12)}`;
}

function extractFromMessage(
  event: MessageEvent,
): Statement[] {
  const statements: Statement[] = [];
  const role = event.payload.role;
  const sentences = splitSentences(event.payload.content);

  for (const sentence of sentences) {
    for (const pattern of PATTERNS) {
      // Role filter
      if (pattern.roleFilter && pattern.roleFilter !== 'any' && pattern.roleFilter !== role) {
        continue;
      }

      if (pattern.pattern.test(sentence)) {
        // Avoid duplicates: don't add the same sentence twice for the same category
        const alreadyHas = statements.some(
          (s) => s.category === pattern.category && s.text === sentence,
        );
        if (alreadyHas) continue;

        statements.push({
          id: generateStatementId(),
          category: pattern.category,
          text: sentence,
          confidence: pattern.confidence,
          sourceEventIds: [event.id],
          sourceSequence: event.sequence,
          extractedAt: new Date().toISOString(),
        });

        // One category per sentence — take the first (highest priority) match
        break;
      }
    }
  }

  return statements;
}

// ─── Extract from all events ────────────────────────────────

export function extractWorkingState(
  projectId: string,
  events: ContinuumEvent[],
): WorkingState {
  const sessionIds = [...new Set(events.map((e) => e.sessionId))];

  const allStatements: Statement[] = [];

  for (const event of events) {
    if (event.type !== EventTypes.MESSAGE) continue;
    const messageEvent = event as MessageEvent;
    const extracted = extractFromMessage(messageEvent);
    allStatements.push(...extracted);
  }

  // Sort statements by source sequence so earlier events come first
  allStatements.sort((a, b) => a.sourceSequence - b.sourceSequence);

  // Categorize
  const byCategory = (cat: StatementCategory) =>
    allStatements.filter((s) => s.category === cat);

  return {
    projectId,
    sessionIds,
    extractedAt: new Date().toISOString(),
    totalEventsProcessed: events.length,
    objectives: byCategory(StatementCategories.OBJECTIVE),
    constraints: byCategory(StatementCategories.CONSTRAINT),
    decisions: byCategory(StatementCategories.DECISION),
    nextActions: byCategory(StatementCategories.NEXT_ACTION),
    completed: byCategory(StatementCategories.COMPLETED),
    failures: byCategory(StatementCategories.FAILURE),
    assumptions: byCategory(StatementCategories.ASSUMPTION),
    openQuestions: byCategory(StatementCategories.OPEN_QUESTION),
  };
}
