# Changelog

## v0.1.0 — Hackathon Release (2025-07-21)

Initial release implementing Phase 1 of the Continuum product scope.

### Core Platform
- Canonical event schema with 7 types (message, tool_call, tool_result, command, command_output, artifact, system)
- Immutable append-only JSONL event ledger with SHA-256 hash verification
- Workspace, project, and session management
- SQLite metadata database with WAL mode for search indexing

### Capture & Import
- Claude adapter with tool_use/tool_result content block mapping
- Generic JSON and Markdown transcript parsers
- Auto-detection adapter registry
- Adapter capture coverage reporting

### Structured State
- Heuristic state extraction (objectives, constraints, decisions, tasks, failures, assumptions, open questions)
- Evidence-linked statements with provenance
- User corrections with chain tracking
- Decision, task, and attempt lifecycle tracking

### Context Transfer
- 5-layer context packages (L0 orientation → L4 archive)
- Token budget management with model presets (Claude, GPT-4, Gemini, Llama, Mistral)
- Criticality-based content ranking
- Content deduplication with source reference preservation
- Portable .ctx capsule export/import with integrity verification

### Verification
- Automated check generation from structured state
- 8 verification dimensions (objective accuracy, constraint recall, decision continuity, progress accuracy, failure awareness, evidence grounding, contradiction rate, continuation readiness)
- Deterministic scoring with configurable thresholds
- Bounded repair loop with targeted evidence retrieval

### Security & Privacy
- Secret detection (30+ patterns: API keys, tokens, passwords, private keys, connection strings)
- Redact / exclude / reference-only actions
- Scoped shareable capsules with content filtering
- AES-256-GCM encryption for shared capsules

### MCP Server
- 6 tools: context.resume, context.get_state, context.search, context.get_source, context.get_decisions, context.get_attempts
- Stdio transport for Claude Desktop integration

### Observability
- Visual CLI dashboard with charts
- Append-only JSONL audit log with 20+ operation types
- Duration tracking, error recording, transfer outcome statistics
