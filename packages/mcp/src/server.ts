/**
 * Continuum MCP server.
 *
 * Exposes project context tools over the Model Context Protocol
 * so that AI agents can query project history, state, decisions,
 * and evidence without loading the complete archive.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { VERSION, PRODUCT_NAME, DEFAULT_ROOT } from '@dhruv-techdev/continuum-core';
import { ALL_TOOLS } from './tools';

export interface ServerOptions {
  root?: string;
}

export function createServer(options: ServerOptions = {}): Server {
  const root = options.root ?? DEFAULT_ROOT;

  const server = new Server(
    {
      name: `${PRODUCT_NAME} Context Server`,
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // ── List tools ──────────────────────────────────────────

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: ALL_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  });

  // ── Call tool ───────────────────────────────────────────

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const tool = ALL_TOOLS.find((t) => t.name === name);

    if (!tool) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
        isError: true,
      };
    }

    try {
      const result = tool.handler((args ?? {}) as Record<string, unknown>, root);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: (err as Error).message }) }],
        isError: true,
      };
    }
  });

  return server;
}

export async function startServer(options: ServerOptions = {}): Promise<void> {
  const server = createServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
