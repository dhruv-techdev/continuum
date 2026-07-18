import { describe, it, expect } from 'vitest';
import { parseMarkdown } from '../src/import/markdown-parser';

describe('parseMarkdown()', () => {
  // ── Heading style ───────────────────────────────────────────

  describe('heading style (## User / ## Assistant)', () => {
    it('should parse basic heading-style transcript', () => {
      const input = `## User
Hello world

## Assistant
Hi! How can I help you today?`;

      const result = parseMarkdown(input);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Hello world');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[1].content).toContain('How can I help');
    });

    it('should handle multiple exchanges', () => {
      const input = `## User
First question

## Assistant
First answer

## User
Second question

## Assistant
Second answer`;

      const result = parseMarkdown(input);
      expect(result.messages).toHaveLength(4);
      expect(result.messages[2].role).toBe('user');
      expect(result.messages[2].content).toBe('Second question');
    });
  });

  // ── Bold-prefix style ──────────────────────────────────────

  describe('bold-prefix style (**User:** ...)', () => {
    it('should parse bold-prefix transcript', () => {
      const input = `**User:** Hello
**Assistant:** Hi there! How are you?`;

      const result = parseMarkdown(input);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Hello');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[1].content).toContain('Hi there');
    });

    it('should handle multi-line content after bold prefix', () => {
      const input = `**User:** Tell me a story
**Assistant:** Once upon a time,
there was a brave knight
who fought dragons.`;

      const result = parseMarkdown(input);
      expect(result.messages[1].content).toContain('Once upon a time');
      expect(result.messages[1].content).toContain('who fought dragons');
    });
  });

  // ── Plain-prefix style ─────────────────────────────────────

  describe('plain-prefix style (User: / Human:)', () => {
    it('should parse plain-prefix transcript', () => {
      const input = `User: Hello
Assistant: Hi there`;

      const result = parseMarkdown(input);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
    });

    it('should handle Claude-style Human/Assistant', () => {
      const input = `Human: What is recursion?
Assistant: Recursion is when a function calls itself.`;

      const result = parseMarkdown(input);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[1].role).toBe('assistant');
    });
  });

  // ── Role aliases ────────────────────────────────────────────

  describe('role aliases', () => {
    it('should map "Me" to user', () => {
      const result = parseMarkdown('## Me\nHello\n## Assistant\nHi');
      expect(result.messages[0].role).toBe('user');
    });

    it('should map "AI" to assistant', () => {
      const result = parseMarkdown('## User\nHi\n## AI\nHello');
      expect(result.messages[1].role).toBe('assistant');
    });

    it('should map "ChatGPT" to assistant', () => {
      const result = parseMarkdown('## User\nHi\n## ChatGPT\nHello');
      expect(result.messages[1].role).toBe('assistant');
    });

    it('should map "Claude" to assistant', () => {
      const result = parseMarkdown('## User\nHi\n## Claude\nHello');
      expect(result.messages[1].role).toBe('assistant');
    });

    it('should map "System" to system', () => {
      const result = parseMarkdown('## System\nYou are helpful.\n## User\nHi');
      expect(result.messages[0].role).toBe('system');
    });
  });

  // ── Edge cases ──────────────────────────────────────────────

  describe('edge cases', () => {
    it('should skip preamble lines before first marker and warn', () => {
      const input = `This is a preamble
Some metadata here

## User
Hello`;

      const result = parseMarkdown(input);
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('Hello');
      expect(result.warnings.some((w) => w.type === 'skipped_message' && w.field === 'preamble')).toBe(true);
    });

    it('should warn on empty content', () => {
      const input = `## User

## Assistant
I have something to say`;

      const result = parseMarkdown(input);
      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toBe('');
      expect(result.warnings.some((w) => w.type === 'empty_content')).toBe(true);
    });

    it('should warn when no role markers are found', () => {
      const result = parseMarkdown('Just some random text with no markers.');
      expect(result.messages).toHaveLength(0);
      expect(result.warnings.some((w) => w.type === 'inaccessible')).toBe(true);
    });

    it('should handle empty input', () => {
      const result = parseMarkdown('');
      expect(result.messages).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should handle Windows-style line endings', () => {
      const input = '## User\r\nHello\r\n## Assistant\r\nHi';
      const result = parseMarkdown(input);
      expect(result.messages).toHaveLength(2);
    });

    it('should preserve code blocks in content', () => {
      const input = `## User
Here is some code:
\`\`\`python
def hello():
    print("Hello")
\`\`\`

## Assistant
That looks good!`;

      const result = parseMarkdown(input);
      expect(result.messages[0].content).toContain('```python');
      expect(result.messages[0].content).toContain('def hello()');
    });
  });
});
