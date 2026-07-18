import { describe, it, expect } from 'vitest';
import { parseJSON } from '../src/import/json-parser';

describe('parseJSON()', () => {
  // ── Direct array format ─────────────────────────────────────

  describe('direct array format', () => {
    it('should parse a simple message array', () => {
      const input = JSON.stringify([
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ]);
      const result = parseJSON(input);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[0].content).toBe('Hello');
      expect(result.messages[1].role).toBe('assistant');
      expect(result.messages[1].content).toBe('Hi there');
      expect(result.format).toBe('json');
    });

    it('should lowercase roles', () => {
      const input = JSON.stringify([
        { role: 'USER', content: 'hi' },
        { role: 'Assistant', content: 'hello' },
      ]);
      const result = parseJSON(input);

      expect(result.messages[0].role).toBe('user');
      expect(result.messages[1].role).toBe('assistant');
    });

    it('should preserve unmapped fields and warn', () => {
      const input = JSON.stringify([
        { role: 'user', content: 'hi', name: 'Bob', function_call: { name: 'test' } },
      ]);
      const result = parseJSON(input);

      expect(result.messages[0].unmappedFields).toHaveProperty('name', 'Bob');
      expect(result.messages[0].unmappedFields).toHaveProperty('function_call');
      expect(result.warnings.some((w) => w.field.includes('name'))).toBe(true);
      expect(result.warnings.some((w) => w.field.includes('function_call'))).toBe(true);
    });

    it('should skip non-message items and warn', () => {
      const input = JSON.stringify([
        'not a message',
        { role: 'user', content: 'real message' },
        42,
      ]);
      const result = parseJSON(input);

      expect(result.messages).toHaveLength(1);
      expect(result.warnings.filter((w) => w.type === 'skipped_message')).toHaveLength(2);
    });

    it('should skip messages without a role and warn', () => {
      const input = JSON.stringify([
        { content: 'no role' },
        { role: 'user', content: 'has role' },
      ]);
      const result = parseJSON(input);

      expect(result.messages).toHaveLength(1);
      expect(result.warnings.some((w) => w.type === 'skipped_message')).toBe(true);
    });

    it('should warn on empty content but still import', () => {
      const input = JSON.stringify([
        { role: 'user', content: '' },
      ]);
      const result = parseJSON(input);

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].content).toBe('');
      expect(result.warnings.some((w) => w.type === 'empty_content')).toBe(true);
    });
  });

  // ── Wrapped object formats ──────────────────────────────────

  describe('wrapped object format', () => {
    for (const key of ['messages', 'conversation', 'chat', 'data', 'turns']) {
      it(`should find messages under "${key}" key`, () => {
        const input = JSON.stringify({
          [key]: [
            { role: 'user', content: 'hello' },
          ],
          title: 'My Chat',
        });
        const result = parseJSON(input);

        expect(result.messages).toHaveLength(1);
        expect(result.warnings.some((w) => w.field === 'title')).toBe(true);
      });
    }
  });

  // ── ChatGPT export format ───────────────────────────────────

  describe('ChatGPT export format', () => {
    it('should extract messages from mapping nodes', () => {
      const input = JSON.stringify({
        mapping: {
          'node-1': {
            message: {
              author: { role: 'user' },
              content: { parts: ['Hello ChatGPT'] },
              create_time: 1000,
            },
          },
          'node-2': {
            message: {
              author: { role: 'assistant' },
              content: { parts: ['Hello! How can I help?'] },
              create_time: 2000,
            },
          },
        },
      });
      const result = parseJSON(input);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toBe('Hello ChatGPT');
      expect(result.messages[1].content).toBe('Hello! How can I help?');
      expect(result.detectedProvider).toBe('openai');
    });

    it('should sort messages by create_time', () => {
      const input = JSON.stringify({
        mapping: {
          'late': {
            message: { author: { role: 'assistant' }, content: { parts: ['Second'] }, create_time: 200 },
          },
          'early': {
            message: { author: { role: 'user' }, content: { parts: ['First'] }, create_time: 100 },
          },
        },
      });
      const result = parseJSON(input);

      expect(result.messages[0].content).toBe('First');
      expect(result.messages[1].content).toBe('Second');
    });
  });

  // ── Error cases ─────────────────────────────────────────────

  describe('error handling', () => {
    it('should handle invalid JSON', () => {
      const result = parseJSON('{ broken json!!!');
      expect(result.messages).toHaveLength(0);
      expect(result.warnings.some((w) => w.type === 'inaccessible')).toBe(true);
    });

    it('should warn for unrecognized JSON object structure', () => {
      const result = parseJSON(JSON.stringify({ unknown: 'structure' }));
      expect(result.messages).toHaveLength(0);
      expect(result.warnings.some((w) => w.type === 'inaccessible')).toBe(true);
    });

    it('should handle empty array', () => {
      const result = parseJSON('[]');
      expect(result.messages).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });
  });
});
