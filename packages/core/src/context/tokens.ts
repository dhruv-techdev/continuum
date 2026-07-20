/**
 * Simple token estimation.
 *
 * Uses the ~4 chars per token heuristic which is reasonable
 * for English text with typical code snippets. Good enough
 * for budget planning; exact counts require a tokenizer.
 */

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function trimToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  if (text.length <= maxChars) return text;

  // Try to cut at a paragraph boundary
  const trimmed = text.slice(0, maxChars);
  const lastParagraph = trimmed.lastIndexOf('\n\n');

  if (lastParagraph > maxChars * 0.7) {
    return trimmed.slice(0, lastParagraph) + '\n\n[… trimmed to fit token budget]';
  }

  // Fall back to sentence boundary
  const lastSentence = trimmed.lastIndexOf('. ');
  if (lastSentence > maxChars * 0.7) {
    return trimmed.slice(0, lastSentence + 1) + '\n\n[… trimmed to fit token budget]';
  }

  return trimmed + '\n\n[… trimmed to fit token budget]';
}
