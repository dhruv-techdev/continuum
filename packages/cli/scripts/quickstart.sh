#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════
# Continuum Quick Start
#
# Run this after `pnpm install && pnpm build` to see
# Continuum working in under 60 seconds.
# ═══════════════════════════════════════════════════════════

CLI="npx tsx packages/cli/src/index.ts"

echo ""
echo "  Continuum — Quick Start"
echo "  ───────────────────────"
echo ""

# 1. Init
echo "  [1/7] Initializing workspace..."
$CLI init --force > /dev/null 2>&1
echo "  ✓ Workspace ready"

# 2. Create project
echo "  [2/7] Creating project..."
$CLI project create -t "Quick Start Demo" -d "Your first Continuum project" > /dev/null 2>&1
echo "  ✓ Project created"

# 3. Import sample data
SAMPLE=$(mktemp)
cat > "$SAMPLE" << 'JSON'
[
  { "role": "user", "content": "I want to build a CLI tool for managing bookmarks. It should support tags, full-text search, and export to HTML." },
  { "role": "assistant", "content": "I'll set up a Node.js project with SQLite for storage, Commander for the CLI, and Lunr for search. Let me create the project structure." },
  { "role": "user", "content": "The tool must work offline — no cloud dependencies. All data stays local." },
  { "role": "user", "content": "I decided to use SQLite via better-sqlite3 for the database." },
  { "role": "assistant", "content": "Good choice. I've implemented the bookmark schema with title, URL, tags, notes, and timestamps. The search index is built with Lunr.js." },
  { "role": "user", "content": "I tried using Elasticsearch first but it was too heavy for a CLI tool." },
  { "role": "user", "content": "Next step: implement the tag filtering system." }
]
JSON

echo "  [3/7] Importing conversation..."
$CLI import "$SAMPLE" > /dev/null 2>&1
rm -f "$SAMPLE"
echo "  ✓ 7 events captured"

# 4. Extract state
echo "  [4/7] Extracting structured state..."
$CLI state show --refresh > /dev/null 2>&1
echo "  ✓ State extracted"

# 5. Track context
echo "  [5/7] Recording decisions and attempts..."
$CLI track decision add -c "Use SQLite via better-sqlite3" -r "Local-only, no cloud deps" -a "PostgreSQL,MongoDB" > /dev/null 2>&1
$CLI track task add -d "Implement tag filtering" > /dev/null 2>&1
$CLI track attempt add -a "Elasticsearch for search" -o failure -f "Too heavy for a CLI tool" > /dev/null 2>&1
echo "  ✓ Context tracked"

# 6. Verify
echo "  [6/7] Generating verification checks..."
$CLI verify generate > /dev/null 2>&1
$CLI verify score --auto > /dev/null 2>&1
echo "  ✓ Transfer verified"

# 7. Dashboard
echo "  [7/7] Ready!"
echo ""
$CLI dashboard

echo ""
echo "  Next steps:"
echo ""
echo "    pnpm dev:cli -- context resume       # Generate transfer context"
echo "    pnpm dev:cli -- capsule export       # Export a portable capsule"
echo "    pnpm dev:cli -- search \"SQLite\"      # Search the history"
echo "    pnpm dev:cli -- mcp tools            # See MCP tools"
echo "    pnpm demo                            # Full cross-tool demo"
echo ""
