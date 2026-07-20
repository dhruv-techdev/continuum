import { Command } from 'commander';
import { resolve } from 'path';
import { DEFAULT_ROOT } from '@continuum/core';
import { ALL_TOOLS, startServer } from '@continuum/mcp';
import type { ToolDef } from '@continuum/mcp';

export function registerMcpCommand(program: Command): void {
  const mcp = program.command('mcp').description('Manage the Continuum MCP server');

  // ── start ───────────────────────────────────────────────

  mcp
    .command('start')
    .description('Start the Continuum MCP server (stdio transport)')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action(async (opts) => {
      console.error(`Continuum MCP server starting (root: ${opts.root})`);
      console.error(`Tools: ${ALL_TOOLS.map((t: ToolDef) => t.name).join(', ')}`);
      console.error('Listening on stdio...');
      await startServer({ root: opts.root });
    });

  // ── tools ───────────────────────────────────────────────

  mcp
    .command('tools')
    .description('List available MCP tools')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action(() => {
      console.log(`\n  Continuum MCP Tools (${ALL_TOOLS.length}):\n`);

      for (const tool of ALL_TOOLS) {
        console.log(`  ${tool.name}`);
        console.log(`    ${tool.description}`);

        const schema = tool.inputSchema as {
          properties?: Record<string, { type: string; description?: string }>;
        };
        if (schema.properties) {
          const params = Object.entries(schema.properties);
          if (params.length > 0) {
            console.log('    Parameters:');
            for (const [name, def] of params) {
              console.log(
                `      ${name} (${def.type})${def.description ? ': ' + def.description : ''}`,
              );
            }
          }
        }
        console.log('');
      }
    });

  // ── config ──────────────────────────────────────────────

  mcp
    .command('config')
    .description('Print MCP server configuration for use in client settings')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const serverPath = resolve(__dirname, '../../node_modules/@continuum/mcp/src/index.ts');

      const config = {
        continuum: {
          command: 'npx',
          args: ['tsx', serverPath, '--root', opts.root],
          env: {},
        },
      };

      console.log('\n  Add this to your MCP client configuration:\n');
      console.log(JSON.stringify(config, null, 2));
      console.log(
        '\n  For Claude Desktop, add to ~/Library/Application Support/Claude/claude_desktop_config.json',
      );
      console.log('  under the "mcpServers" key.\n');
    });

  // ── test ────────────────────────────────────────────────

  mcp
    .command('test')
    .description('Test MCP tools directly without starting the server')
    .requiredOption('-t, --tool <name>', 'Tool name to test')
    .option('-a, --args <json>', 'Tool arguments as JSON', '{}')
    .option('--root <path>', 'Workspace root', DEFAULT_ROOT)
    .action((opts) => {
      const tool = ALL_TOOLS.find((t: ToolDef) => t.name === opts.tool);

      if (!tool) {
        console.error(`\n✗ Unknown tool "${opts.tool}".`);
        console.error(`  Available: ${ALL_TOOLS.map((t: ToolDef) => t.name).join(', ')}\n`);
        process.exit(1);
      }

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(opts.args);
      } catch {
        console.error('\n✗ --args must be valid JSON.\n');
        process.exit(1);
      }

      try {
        const result = tool.handler(args, opts.root);
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error(`\n✗ Tool error: ${(err as Error).message}\n`);
        process.exit(1);
      }
    });
}
