import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  claudeAdapter,
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

// ─── Claude adapter detection ─────────────────────────────

describe('claudeAdapter.canParse()', () => {
  it('should detect Claude API conversation with content blocks', () => {
    const raw = loadFixture('claude-conversation.json');
    expect(claudeAdapter.canParse(raw)).toBe(true);
  });

  it('should detect Claude error tool fixture', () => {
    const raw = loadFixture('claude-error-tool.json');
    expect(claudeAdapter.canParse(raw)).toBe(true);
  });

  it('should NOT detect a plain generic JSON conversation', () => {
    const raw = JSON.stringify([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]);
    expect(claudeAdapter.canParse(raw)).toBe(false);
  });

  it('should NOT detect markdown', () => {
    expect(claudeAdapter.canParse('## User\nHello')).toBe(false);
  });

  it('should detect a single Claude API response', () => {
    const raw = JSON.stringify({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }],
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
    });
    expect(claudeAdapter.canParse(raw)).toBe(true);
  });

  it('should detect wrapped format', () => {
    const raw = JSON.stringify({
      messages: [
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: [{ type: 'text', text: 'Hello' }], model: 'claude-sonnet-4-6' },
      ],
    });
    expect(claudeAdapter.canParse(raw)).toBe(true);
  });
});

// ─── Claude adapter parsing ───────────────────────────────

describe('claudeAdapter.parse()', () => {
  it('should parse a full conversation with text and tool blocks', () => {
    const raw = loadFixture('claude-conversation.json');
    const result = claudeAdapter.parse(raw);

    expect(result.format).toBe('json');
    expect(result.detectedProvider).toBe('anthropic');
    expect(result.messages.length).toBeGreaterThanOrEqual(8);

    // Check message types
    const textMessages = result.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    const toolCalls = result.messages.filter((m) => m.role === '__tool_call__');
    const toolResults = result.messages.filter((m) => m.role === '__tool_result__');

    expect(textMessages.length).toBeGreaterThanOrEqual(5);
    expect(toolCalls.length).toBe(2); // web_search + weather_fetch
    expect(toolResults.length).toBe(2);
  });

  it('should preserve tool_use callId', () => {
    const raw = loadFixture('claude-conversation.json');
    const result = claudeAdapter.parse(raw);

    const toolCall = result.messages.find((m) => m.role === '__tool_call__');
    expect(toolCall).toBeDefined();

    const payload = JSON.parse(toolCall!.content);
    expect(payload.callId).toBe('toolu_01ABC123');
    expect(payload.toolName).toBe('web_search');
    expect(payload.input).toHaveProperty('query');
  });

  it('should preserve tool_result callId for correlation', () => {
    const raw = loadFixture('claude-conversation.json');
    const result = claudeAdapter.parse(raw);

    const toolResult = result.messages.find((m) => m.role === '__tool_result__');
    expect(toolResult).toBeDefined();

    const payload = JSON.parse(toolResult!.content);
    expect(payload.callId).toBe('toolu_01ABC123');
    expect(payload.output).toContain('2.1 million');
  });

  it('should handle tool results with content array', () => {
    const raw = loadFixture('claude-conversation.json');
    const result = claudeAdapter.parse(raw);

    // The weather tool result uses content array format
    const toolResults = result.messages.filter((m) => m.role === '__tool_result__');
    const weatherResult = toolResults.find((m) => {
      const payload = JSON.parse(m.content);
      return payload.callId === 'toolu_02DEF456';
    });

    expect(weatherResult).toBeDefined();
    const payload = JSON.parse(weatherResult!.content);
    expect(payload.output).toContain('22°C');
  });

  it('should handle error tool results', () => {
    const raw = loadFixture('claude-error-tool.json');
    const result = claudeAdapter.parse(raw);

    const toolResult = result.messages.find((m) => m.role === '__tool_result__');
    expect(toolResult).toBeDefined();

    const payload = JSON.parse(toolResult!.content);
    expect(payload.isError).toBe(true);
    expect(payload.output).toContain('Connection refused');
  });

  it('should preserve model info in unmapped fields', () => {
    const raw = loadFixture('claude-conversation.json');
    const result = claudeAdapter.parse(raw);

    const assistantMsg = result.messages.find(
      (m) => m.role === 'assistant' && m.unmappedFields.model,
    );
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg!.unmappedFields.model).toContain('claude');
  });

  it('should report warnings for unmapped fields', () => {
    const raw = loadFixture('claude-conversation.json');
    const result = claudeAdapter.parse(raw);

    const modelWarnings = result.warnings.filter(
      (w) => w.type === 'unsupported_field' && w.field.includes('model'),
    );
    expect(modelWarnings.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle simple string content', () => {
    const raw = loadFixture('claude-conversation.json');
    const result = claudeAdapter.parse(raw);

    const userMsg = result.messages.find(
      (m) => m.role === 'user' && m.content === 'What is the capital of France?',
    );
    expect(userMsg).toBeDefined();
  });

  it('should handle invalid JSON', () => {
    const result = claudeAdapter.parse('{ broken!!!');
    expect(result.messages).toHaveLength(0);
    expect(result.warnings.some((w) => w.type === 'inaccessible')).toBe(true);
  });

  it('should handle empty array', () => {
    const result = claudeAdapter.parse('[]');
    expect(result.messages).toHaveLength(0);
  });
});

// ─── Adapter registry ─────────────────────────────────────

describe('adapterRegistry', () => {
  it('should include the Claude adapter', () => {
    expect(adapterRegistry.list()).toContain('claude');
    expect(adapterRegistry.get('claude')).toBe(claudeAdapter);
  });

  it('should include generic adapters', () => {
    expect(adapterRegistry.list()).toContain('generic-json');
    expect(adapterRegistry.list()).toContain('generic-markdown');
  });

  it('should auto-detect Claude format', () => {
    const raw = loadFixture('claude-conversation.json');
    const adapter = adapterRegistry.detect(raw, 'conversation.json');

    expect(adapter).not.toBeNull();
    expect(adapter!.id).toBe('claude');
  });

  it('should fall back to generic JSON for plain conversations', () => {
    const raw = JSON.stringify([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]);
    const adapter = adapterRegistry.detect(raw, 'chat.json');

    expect(adapter).not.toBeNull();
    expect(adapter!.id).toBe('generic-json');
  });

  it('should detect markdown format', () => {
    const raw = '## User\nHello\n## Assistant\nHi';
    const adapter = adapterRegistry.detect(raw, 'chat.md');

    expect(adapter).not.toBeNull();
    expect(adapter!.id).toBe('generic-markdown');
  });

  it('should return null for completely unknown format', () => {
    const adapter = adapterRegistry.get('nonexistent');
    expect(adapter).toBeNull();
  });
});

// ─── Adapter normalizer (ST2 integration) ─────────────────

describe('adapterNormalize()', () => {
  it('should convert Claude conversation to canonical events with tool events', () => {
    const raw = loadFixture('claude-conversation.json');
    const parseResult = claudeAdapter.parse(raw);

    const output = adapterNormalize({
      parseResult,
      projectId: 'proj_test',
      sessionId: 'sess_test',
      source: 'claude-adapter',
    });

    // Should have messages + tool calls + tool results
    expect(output.stats.messagesCreated).toBeGreaterThanOrEqual(5);
    expect(output.stats.toolCallsCreated).toBe(2);
    expect(output.stats.toolResultsCreated).toBe(2);
    expect(output.stats.skipped).toBe(0);

    // Check event types
    const messages = output.events.filter((e) => e.type === EventTypes.MESSAGE);
    const toolCalls = output.events.filter((e) => e.type === EventTypes.TOOL_CALL);
    const toolResults = output.events.filter((e) => e.type === EventTypes.TOOL_RESULT);

    expect(messages.length).toBeGreaterThanOrEqual(5);
    expect(toolCalls).toHaveLength(2);
    expect(toolResults).toHaveLength(2);

    // Tool call has correct payload
    const searchCall = toolCalls.find(
      (e) => (e as ToolCallEvent).payload.toolName === 'web_search',
    ) as ToolCallEvent;

    expect(searchCall).toBeDefined();
    expect(searchCall.payload.callId).toBe('toolu_01ABC123');
    expect(searchCall.payload.input).toHaveProperty('query');

    // Tool result correlates to tool call
    const searchResult = toolResults.find(
      (e) => (e as ToolResultEvent).payload.callId === 'toolu_01ABC123',
    ) as ToolResultEvent;

    expect(searchResult).toBeDefined();
    expect(searchResult.payload.output).toContain('2.1 million');
  });

  it('should map error tool results correctly', () => {
    const raw = loadFixture('claude-error-tool.json');
    const parseResult = claudeAdapter.parse(raw);

    const output = adapterNormalize({
      parseResult,
      projectId: 'p', sessionId: 's', source: 'test',
    });

    const errorResult = output.events.find(
      (e) => e.type === EventTypes.TOOL_RESULT && (e as ToolResultEvent).payload.isError,
    ) as ToolResultEvent;

    expect(errorResult).toBeDefined();
    expect(errorResult.payload.isError).toBe(true);
    expect(errorResult.payload.output).toContain('Connection refused');
  });

  it('should produce events with valid hashes', () => {
    const raw = loadFixture('claude-conversation.json');
    const parseResult = claudeAdapter.parse(raw);

    const output = adapterNormalize({
      parseResult,
      projectId: 'p', sessionId: 's', source: 'test',
    });

    for (const event of output.events) {
      expect(verifyEventHash(event)).toBe(true);
    }
  });

  it('should assign sequential sequence numbers', () => {
    const raw = loadFixture('claude-conversation.json');
    const parseResult = claudeAdapter.parse(raw);

    const output = adapterNormalize({
      parseResult,
      projectId: 'p', sessionId: 's', source: 'test',
    });

    for (let i = 0; i < output.events.length; i++) {
      expect(output.events[i].sequence).toBe(i);
    }
  });

  it('should preserve provider metadata in message events', () => {
    const raw = loadFixture('claude-conversation.json');
    const parseResult = claudeAdapter.parse(raw);

    const output = adapterNormalize({
      parseResult,
      projectId: 'p', sessionId: 's', source: 'test',
    });

    const msgWithMeta = output.events.find((e) => {
      if (e.type !== EventTypes.MESSAGE) return false;
      const payload = (e as MessageEvent).payload;
      return payload.metadata?.detectedProvider === 'anthropic';
    });

    expect(msgWithMeta).toBeDefined();
  });
});
