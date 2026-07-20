#!/usr/bin/env node

export { VERSION, PRODUCT_NAME } from '@continuum/core';
export { createServer, startServer } from './server';
export type { ServerOptions } from './server';
export { ALL_TOOLS } from './tools';
export type { ToolDef } from './tools';

// Run as standalone server when executed directly
if (require.main === module) {
  const root = process.argv.includes('--root')
    ? process.argv[process.argv.indexOf('--root') + 1]
    : undefined;

  const { startServer } = require('./server');
  startServer({ root }).catch((err: Error) => {
    console.error('MCP server error:', err.message);
    process.exit(1);
  });
}
