# Continuum — Hackathon Demo Script

**Total runtime target: ~4–5 min**
Everything below uses the real, published CLI (`npm install -g @dhruv-techdev/continuum-cli`) — no local repo needed.

---

## 0. Hook (10 sec) — say this first, before touching the terminal

> "Every time you close a chat with Claude or ChatGPT, everything it learned about your project dies with that tab. New session, zero memory — you re-explain the whole thing from scratch. I built Continuum to fix that."

---

## 1. The 5 Ws (30 sec, slide or voiceover, no terminal yet)

**What** — Continuum is a CLI + MCP server that captures an AI coding session's history, extracts what actually matters (objectives, decisions, failed attempts, progress), and transfers that state into a brand-new AI session — automatically, no copy-pasting.

**Who** — Any developer using Claude Code, ChatGPT, or any AI coding tool across multiple sessions, machines, or teammates.

**When** — Any time context gets wiped: closing a tab, hitting a context limit, switching machines, or handing work to someone else.

**Where** — Runs entirely locally. `~/.continuum` is a local, per-machine store — nothing leaves your laptop unless you explicitly export a capsule.

**Why** — "A change of session should never force valuable work to begin again." Re-explaining context is wasted time and lost decisions — like the reason we picked X over Y, or the approach that already failed.

---

## 2. Live demo — CRUD walkthrough (3 min)

Say out loud: *"Let me show you the full lifecycle — create, read, update, delete — live."*

### CREATE — capture something into Continuum

```bash
# one-time setup (skip narrating if already installed)
continuum init

# create a project
continuum project create -t "Todo API" -d "REST API demo for hackathon"

# CREATE: bring a real AI session in — zero copy-paste
LATEST=$(ls -t ~/.claude/projects/*/*.jsonl | head -1)
continuum import "$LATEST" --verbose
```
> *"That just pulled my actual Claude Code session — messages, tool calls, file edits — straight off disk. No copy-paste."*

Also show manual capture (good for a quick visual):
```bash
continuum track decision add -c "Use pgx over an ORM" -r "Raw SQL control, avoids GORM overhead" -a "GORM,sqlx"
continuum track task add -d "Implement JWT auth with RS256"
```

### READ — pull it back out

```bash
# structured state
continuum state show --refresh

# the actual transferable context package
continuum context resume --raw
```
> *"This is the payload a new AI session gets — objectives, decisions, what's still open — all auto-extracted from that one import."*

```bash
# search across everything ever captured
continuum search "JWT"

# full timeline
continuum timeline
```

### UPDATE — change state, show it stick

```bash
# mark a task done
continuum track task list          # grab an id
continuum track task update <taskId> -s completed -n "Auth working end to end"

# reject a decision and show the record survives
continuum track decision reject <decisionId> -r "Switched to sqlx instead"
```
> *"Nothing gets silently overwritten — rejected decisions stay in the record, so a future session knows what NOT to repeat."*

### DELETE — remove something

```bash
# soft-delete an artifact
continuum artifact list
continuum artifact delete <artifactId>

# close out a session
continuum session close
```

---

## 3. The actual "wow" moment (60 sec) — do this live, don't just describe it

```bash
claude mcp add continuum -s user -- continuum-mcp --root ~/.continuum
```

> *"Now watch this — I'm opening a completely new Claude Code session. It has never seen any of this conversation."*

**[cut to new terminal / new session]**

Type in the new session:
> "Use continuum to resume context for my active project."

> *"It just called a tool, pulled my prior decisions, tasks, and objectives, and picked up exactly where the last session left off — automatically."*

---

## 4. Close (15 sec)

> "That's Continuum — capture once, resume anywhere. Published on npm right now as `@dhruv-techdev/continuum-cli`, works with Claude, ChatGPT, or any tool that speaks MCP. Thanks."

---

## Cheat sheet — every command used, copy-paste ready

```bash
npm install -g @dhruv-techdev/continuum-cli @dhruv-techdev/continuum-mcp
continuum init
continuum project create -t "Todo API" -d "REST API demo for hackathon"

LATEST=$(ls -t ~/.claude/projects/*/*.jsonl | head -1)
continuum import "$LATEST" --verbose

continuum track decision add -c "Use pgx over an ORM" -r "Raw SQL control" -a "GORM,sqlx"
continuum track task add -d "Implement JWT auth with RS256"

continuum state show --refresh
continuum context resume --raw
continuum search "JWT"
continuum timeline

continuum track task list
continuum track task update <taskId> -s completed -n "Auth working end to end"
continuum track decision list
continuum track decision reject <decisionId> -r "Switched to sqlx instead"

continuum artifact list
continuum artifact delete <artifactId>
continuum session close

claude mcp add continuum -s user -- continuum-mcp --root ~/.continuum
claude mcp list
```
