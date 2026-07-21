#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════
# Continuum Cross-Tool Demonstration (US-031)
#
# Proves end-to-end context continuity:
#   1. Import a realistic Claude dev session
#   2. Extract state, track decisions/tasks/failures
#   3. Export a portable capsule
#   4. Import into a fresh workspace
#   5. Generate transfer context for a receiving agent
#   6. Verify the transfer
#   7. Deliberately remove a critical fact
#   8. Demonstrate automatic repair
# ═══════════════════════════════════════════════════════════

CLI="npx tsx packages/cli/src/index.ts"
FIXTURE="packages/core/tests/fixtures/demo-dev-session.json"
CAPSULE_DIR=$(mktemp -d)
DEST_ROOT=$(mktemp -d)

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

step() { echo -e "\n${CYAN}━━━ $1 ━━━${NC}\n"; }
ok()   { echo -e "${GREEN}✓ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; }

echo -e "\n${BOLD}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   Continuum — Cross-Tool Transfer Demonstration      ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════╝${NC}"

# ── PHASE 1: Source workspace ─────────────────────────────

step "Phase 1: Initialize source workspace"
$CLI init --force
ok "Workspace initialized"

$CLI project create -t "Taskflow API" -d "REST API for a task-management app — Go, Gin, PostgreSQL"
ok "Project created"

step "Phase 2: Import Claude dev session (ST1)"
$CLI import "$FIXTURE" --verbose
ok "Session imported with tool calls"

step "Phase 3: Extract structured state"
$CLI state show --refresh
ok "Working state extracted"

step "Phase 4: Track decisions, tasks, and attempts"
$CLI track decision add -c "Use pgx for database access" -r "Full control over SQL, avoids ORM overhead" -a "GORM,sqlx,ent"
$CLI track decision add -c "Use Redis sliding window for rate limiting" -r "Distributed rate limiting across K8s replicas" -a "In-memory token bucket"
$CLI track decision add -c "Use RS256 with JWKS for JWT auth" -r "Key rotation support, no hardcoded secrets" -a "HS256 with static secret"
$CLI track decision add -c "Use compound cursor pagination (timestamp+id)" -r "Deterministic ordering even with timestamp collisions" -a "Offset pagination,Timestamp-only cursor"

$CLI track task add -d "Implement JSON:API response envelope"
$CLI track task add -d "Build CRUD handlers for projects and tasks"
$CLI track task add -d "Implement Redis rate limiting middleware"
$CLI track task add -d "Write integration tests"

$CLI track attempt add -a "Used GORM for database layer" -o failure -f "Query logging too noisy, generated inefficient JOINs" --observations "Stick with raw pgx for full SQL control"
$CLI track attempt add -a "Cursor pagination with timestamp only" -o failure -f "Tasks created in the same millisecond got skipped" --observations "Need compound cursor with timestamp+id for determinism"

ok "Tracking data recorded"

step "Phase 5: View dashboard"
$CLI dashboard

step "Phase 6: Security scan"
$CLI scan

step "Phase 7: Export portable capsule (ST2)"
$CLI capsule export -o "$CAPSULE_DIR" --notes "Taskflow API handoff — ready for continuation"
ok "Capsule exported to $CAPSULE_DIR"

$CLI capsule verify "$CAPSULE_DIR"/*.ctx
ok "Capsule integrity verified"

# ── PHASE 2: Destination workspace ────────────────────────

step "Phase 8: Import capsule into fresh workspace (ST2)"
$CLI init --root "$DEST_ROOT" --force
$CLI capsule import "$CAPSULE_DIR"/*.ctx --root "$DEST_ROOT"
ok "Capsule imported into $DEST_ROOT"

step "Phase 9: Generate transfer context for receiving agent"
$CLI context resume --root "$DEST_ROOT"
ok "L0+L1+L2 context package generated"

step "Phase 10: Verify the transfer"
$CLI verify generate --root "$DEST_ROOT"
$CLI verify score --auto --root "$DEST_ROOT"
ok "Verification passed with expected answers"

$CLI verify report --root "$DEST_ROOT"

# ── PHASE 3: Deliberate failure and repair (ST3) ─────────

step "Phase 11: Deliberately break the transfer (ST3)"
echo -e "${YELLOW}Simulating a transfer where the receiving agent missed a critical fact..."
echo -e "The agent doesn't know that GORM was tried and rejected.${NC}"

# Generate checks and score with one critical fact deliberately wrong
$CLI verify generate --root "$DEST_ROOT"

# Save the pending checks, then create wrong answers for failure-awareness checks
CHECKS_FILE="$DEST_ROOT/projects/$(ls "$DEST_ROOT/projects/" | head -1)/evaluations/pending-checks.json"

# Create answers file with one deliberate failure
node -e "
const checks = JSON.parse(require('fs').readFileSync('$CHECKS_FILE', 'utf-8'));
const answers = {};
for (const c of checks) {
  if (c.dimension === 'failure_awareness' && c.expectedAnswer.includes('GORM')) {
    // Deliberately wrong — the agent doesn't know about the GORM failure
    answers[c.id] = 'I am not aware of any failed approaches for the database layer.';
  } else {
    answers[c.id] = c.expectedAnswer;
  }
}
require('fs').writeFileSync('/tmp/continuum-demo-answers.json', JSON.stringify(answers, null, 2));
console.log('Created answer file with 1 deliberate failure (GORM awareness)');
"

$CLI verify score --answers /tmp/continuum-demo-answers.json --root "$DEST_ROOT"
warn "Verification shows a failure — the agent missed the GORM attempt"

$CLI verify report --root "$DEST_ROOT"

step "Phase 12: Automatic repair with evidence retrieval (ST3)"
echo -e "${CYAN}Showing repair evidence for the failed check...${NC}"
$CLI verify repair --show-evidence --root "$DEST_ROOT"

echo -e "\n${CYAN}Running repair with correct answers after seeing evidence...${NC}"
$CLI verify repair --auto --root "$DEST_ROOT"
ok "Transfer repaired — failed check now passes"

$CLI verify report --root "$DEST_ROOT"

# ── Summary ───────────────────────────────────────────────

step "Phase 13: Final audit trail"
$CLI audit stats --root "$DEST_ROOT"

echo -e "\n${BOLD}╔═══════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   Demonstration Complete                              ║${NC}"
echo -e "${BOLD}╠═══════════════════════════════════════════════════════╣${NC}"
echo -e "${BOLD}║                                                       ║${NC}"
echo -e "${BOLD}║   ✓ Imported a realistic Claude dev session           ║${NC}"
echo -e "${BOLD}║   ✓ Extracted objectives, constraints, decisions      ║${NC}"
echo -e "${BOLD}║   ✓ Tracked failed attempts (GORM, timestamp cursor)  ║${NC}"
echo -e "${BOLD}║   ✓ Exported a portable, integrity-verified capsule   ║${NC}"
echo -e "${BOLD}║   ✓ Imported into a fresh workspace                   ║${NC}"
echo -e "${BOLD}║   ✓ Generated layered context for a receiving agent   ║${NC}"
echo -e "${BOLD}║   ✓ Verified the transfer passed all critical checks  ║${NC}"
echo -e "${BOLD}║   ✓ Deliberately broke one check (GORM awareness)     ║${NC}"
echo -e "${BOLD}║   ✓ Retrieved targeted evidence and repaired it       ║${NC}"
echo -e "${BOLD}║   ✓ Full audit trail of all operations                ║${NC}"
echo -e "${BOLD}║                                                       ║${NC}"
echo -e "${BOLD}║   A change of session should never force valuable     ║${NC}"
echo -e "${BOLD}║   work to begin again.                                ║${NC}"
echo -e "${BOLD}║                                                       ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════╝${NC}"

# Cleanup
rm -rf "$CAPSULE_DIR" "$DEST_ROOT" /tmp/continuum-demo-answers.json 2>/dev/null || true
