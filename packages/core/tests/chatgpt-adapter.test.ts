import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  chatgptAdapter,
  adapterRegistry,
  adapterNormalize,
  EventTypes,
  verifyEventHash,
} from '../src/index';
import type { ContinuumEvent, ToolCallEvent, ToolResultEvent, MessageEvent } from '../src/index';

const FIXTURES = join(__dirname, 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf-8');
}

// ─── ChatGPT adapter detection ─────────────────────────────

describe('chatgptAdapter.canParse()', () => {
  it('should detect a Chat Completions-style conversation with tool_calls', () => {
    const raw = loadFixture('chatgpt-conversation.json');
    expect(chatgptAdapter.canParse(raw)).toBe(true);
  });

  it('should detect a ChatGPT web export (mapping tree)', () => {
    const raw = loadFixture('chatgpt-export.json');
    expect(chatgptAdapter.canParse(raw)).toBe(true);
  });

  it('should NOT detect a plain generic JSON conversation', () => {
    const raw = JSON.stringify([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]);
    expect(chatgptAdapter.canParse(raw)).toBe(false);
  });

  it('should NOT detect a Claude conversation', () => {
    const raw = JSON.stringify([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi' }],
        model: 'claude-sonnet-4-6',
      },
    ]);
    expect(chatgptAdapter.canParse(raw)).toBe(false);
  });

  it('should NOT detect markdown', () => {
    expect(chatgptAdapter.canParse('# User\nHello')).toBe(false);
  });

  it('should be selected by the adapter registry', () => {
    const raw = loadFixture('chatgpt-conversation.json');
    const adapter = adapterRegistry.detect(raw);
    expect(adapter?.id).toBe('chatgpt');
  });
});

// ─── Chat Completions-style parsing ────────────────────────

describe('chatgptAdapter.parse() — Chat Completions shape', () => {
  it('should parse plain text messages', () => {
    const raw = loadFixture('chatgpt-conversation.json');
    const result = chatgptAdapter.parse(raw);

    expect(result.detectedProvider).toBe('openai');
    const userMsg = result.messages.find((m) => m.role === 'user');
    expect(userMsg?.content).toContain('capital of France');
  });

  it('should preserve tool_calls callId', () => {
    const raw = loadFixture('chatgpt-conversation.json');
    const result = chatgptAdapter.parse(raw);

    const toolCall = result.messages.find((m) => m.role === '__tool_call__');
    expect(toolCall).toBeDefined();

    const payload = JSON.parse(toolCall!.content);
    expect(payload.callId).toBe('call_01ABC123');
    expect(payload.toolName).toBe('web_search');
    expect(payload.input).toHaveProperty('query', 'Paris population 2025');
  });

  it('should preserve tool_call_id for correlation on tool results', () => {
    const raw = loadFixture('chatgpt-conversation.json');
    const result = chatgptAdapter.parse(raw);

    const toolResult = result.messages.find((m) => m.role === '__tool_result__');
    expect(toolResult).toBeDefined();

    const payload = JSON.parse(toolResult!.content);
    expect(payload.callId).toBe('call_01ABC123');
    expect(payload.output).toContain('2.1 million');
  });

  it('should preserve model info in unmapped fields', () => {
    const raw = loadFixture('chatgpt-conversation.json');
    const result = chatgptAdapter.parse(raw);

    const assistantMsg = result.messages.find(
      (m) => m.role === 'assistant' && m.unmappedFields.model,
    );
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.unmappedFields.model).toContain('gpt');
  });

  it('should handle legacy function_call format', () => {
    const raw = JSON.stringify([
      { role: 'user', content: 'What is 2+2?' },
      {
        role: 'assistant',
        content: null,
        function_call: { name: 'calculator', arguments: '{"expression":"2+2"}' },
      },
    ]);
    const result = chatgptAdapter.parse(raw);

    const toolCall = result.messages.find((m) => m.role === '__tool_call__');
    expect(toolCall).toBeDefined();
    const payload = JSON.parse(toolCall!.content);
    expect(payload.toolName).toBe('calculator');
    expect(payload.input).toEqual({ expression: '2+2' });
  });

  it('should handle unparsable tool_call arguments gracefully', () => {
    const raw = JSON.stringify([
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_bad', type: 'function', function: { name: 'foo', arguments: 'not json' } },
        ],
      },
    ]);
    const result = chatgptAdapter.parse(raw);

    const toolCall = result.messages.find((m) => m.role === '__tool_call__');
    const payload = JSON.parse(toolCall!.content);
    expect(payload.input).toEqual({ raw: 'not json' });
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── ChatGPT web export (tree) parsing ─────────────────────

describe('chatgptAdapter.parse() — web export shape', () => {
  it('should linearize the mapping tree in chronological order', () => {
    const raw = loadFixture('chatgpt-export.json');
    const result = chatgptAdapter.parse(raw);

    expect(result.messages.map((m) => m.content)).toEqual([
      'What is the capital of France?',
      'The capital of France is Paris.',
      'Thanks!',
    ]);
  });

  it('should preserve the model slug from node metadata', () => {
    const raw = loadFixture('chatgpt-export.json');
    const result = chatgptAdapter.parse(raw);

    const assistantMsg = result.messages.find((m) => m.role === 'assistant');
    expect(assistantMsg?.unmappedFields.model).toBe('gpt-4o');
  });

  it('should handle an array of exported conversations', () => {
    const conv = JSON.parse(loadFixture('chatgpt-export.json'));
    const raw = JSON.stringify([conv, conv]);
    const result = chatgptAdapter.parse(raw);

    expect(result.messages).toHaveLength(6);
  });
});

// ─── Integration with normalizer + event pipeline ──────────

describe('chatgptAdapter + adapterNormalize integration', () => {
  it('should produce valid, hash-verified events from a Chat Completions transcript', () => {
    const raw = loadFixture('chatgpt-conversation.json');
    const parseResult = chatgptAdapter.parse(raw);

    const { events } = adapterNormalize({
      parseResult,
      projectId: 'proj_test',
      sessionId: 'sess_test',
      source: 'import:chatgpt:test.json',
    });

    expect(events.length).toBeGreaterThan(0);
    for (const event of events as ContinuumEvent[]) {
      expect(verifyEventHash(event)).toBe(true);
    }

    const toolCall = events.find((e) => e.type === EventTypes.TOOL_CALL) as ToolCallEvent | undefined;
    const toolResult = events.find((e) => e.type === EventTypes.TOOL_RESULT) as ToolResultEvent | undefined;
    expect(toolCall?.payload.callId).toBe('call_01ABC123');
    expect(toolResult?.payload.callId).toBe('call_01ABC123');

    const message = events.find((e) => e.type === EventTypes.MESSAGE) as MessageEvent | undefined;
    expect(message?.payload.content).toContain('capital of France');
  });

  it('should produce valid events from a web export transcript', () => {
    const raw = loadFixture('chatgpt-export.json');
    const parseResult = chatgptAdapter.parse(raw);

    const { events } = adapterNormalize({
      parseResult,
      projectId: 'proj_test',
      sessionId: 'sess_test',
      source: 'import:chatgpt:export.json',
    });

    expect(events).toHaveLength(3);
    for (const event of events as ContinuumEvent[]) {
      expect(verifyEventHash(event)).toBe(true);
    }
  });
});
