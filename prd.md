# PRD: brain ask + brain file

## Context

brain-cli has ingest (`brain note`, `brain clip`) and compilation (`brain compile`), but no way to **query** the wiki and get structured output back. This is the missing output stage from the Karpathy LLM Knowledge Base workflow.

The key insight: outputs are files in the vault, not terminal text. Good outputs get filed back into the wiki, so explorations compound into knowledge.

## Commands

### `brain ask <question>`

Query the wiki. A read-only agent researches the question across the vault and produces a markdown file as output.

#### Flow

```
brain ask "how does context routing affect multi-agent orchestration?"
    │
    ├─ 1. Spawn Claude agent (read-only: Read, Glob, Grep)
    │     Working directory: vault root
    │     System prompt: researcher role (see below)
    │
    ├─ 2. Agent reads wiki/indexes/INDEX.md as entry point
    │     Navigates to relevant wiki articles via wikilinks
    │     If needed, scans raw/ for fresh unprocessed material
    │     Reads 2-5 specific files depending on question scope
    │     Cross-references concepts, finds connections
    │
    ├─ 3. CLI captures agent output and writes to:
    │     output/asks/YYYY-MM-DD-<slug>.md
    │
    └─ 4. CLI prints summary to terminal + path to the full output file
```

#### Output file format

```markdown
---
title: "How Context Routing Affects Multi-Agent Orchestration"
type: ask
question: "how does context routing affect multi-agent orchestration?"
created: 2026-04-04
sources:
  - "[[multi-agent-orchestration-patterns]]"
  - "[[claude-code-subagents]]"
related:
  - "[[claude-code-agent-teams]]"
---

# How Context Routing Affects Multi-Agent Orchestration

[Agent's researched answer here — full prose, not bullet lists.
Uses [[wikilinks]] to reference source articles.
Includes tables, comparisons, code blocks where relevant.]

## Sources consulted
- [[multi-agent-orchestration-patterns]] — core context routing concepts
- [[claude-code-subagents]] — delegation patterns, context isolation
```

#### Agent system prompt

The agent is a researcher with read access to the **entire vault**. It navigates:

1. **Primary: wiki/** — compiled, cross-referenced knowledge. Start at `wiki/indexes/INDEX.md` to understand what exists, then read specific articles.
2. **Secondary: raw/** — unprocessed but potentially valuable. Fresh articles and notes that haven't been compiled yet. Check here if wiki doesn't fully cover the question.

The agent:
- Starts by reading `wiki/indexes/INDEX.md` to understand what exists
- Reads specific articles relevant to the question (not all of them)
- Checks `raw/` if the question touches topics not yet in the wiki
- Cross-references concepts across articles to find connections
- Writes the answer as a standalone markdown document to stdout (CLI handles file creation)
- Includes a `sources` section listing every article it consulted
- Writes prose, not bullet lists — this is a document, not a chat reply
- Uses `[[wikilinks]]` to link back to source articles

#### CLI flags

```bash
brain ask "question"                    # Default: writes file + prints summary
brain ask -p "question"                 # Print-only mode: answer to stdout, no file saved
brain ask --model opus "question"       # Override model (default: sonnet)
brain ask --verbose "question"          # Show agent's research process
```

#### Technical details

- Agent spawned via `claude -p` (print mode), read-only — agent writes answer to stdout, CLI handles file creation
- `BRAIN_CLAUDE_BIN` may override the Claude executable path for tests or custom installs
- Model default: `sonnet` (fast, cheap for research). Flag to override.
- Output directory: `output/asks/` — created automatically if missing
- Filename: `YYYY-MM-DD-<slugified-question>.md`
- If a filename already exists for the same date/question, suffix with `-2`, `-3`, etc. instead of overwriting
- If slug is too long (>60 chars), truncate to first meaningful words

#### What the terminal shows

```
Researching...

Consulted 3 articles:
  • multi-agent-orchestration-patterns
  • claude-code-subagents  
  • claude-code-agent-teams

Answer saved: output/asks/2026-04-04-context-routing-multi-agent.md

Summary: Context routing is the primary bottleneck in multi-agent systems —
deciding what each agent sees matters more than the orchestration pattern itself.
Your TFM orchestrator faces this directly when delegating to RAG and Code agents.
```

---

### `brain file`

Promote an output back into the wiki's raw pipeline. This is the feedback loop — good outputs become knowledge.

**No path arguments.** The CLI knows where outputs live. You pick from a list.

#### Flow

```
brain file
    │
    ├─ 1. Scan output/ for all unfiled markdown files
    │     (unfiled = no `filed: true` in frontmatter)
    │
    ├─ 2. Display numbered list, most recent first:
    │
    │     Unfiled outputs:
    │       1. context-routing-multi-agent (Apr 4, asks)
    │       2. langfuse-vs-arize (Apr 3, asks)
    │       3. terraform-module-patterns (Apr 2, asks)
    │
    │     File which? [1-3, or q to quit]:
    │
    ├─ 3. User picks a number
    │
    ├─ 4. Copy to raw/notes/YYYY-MM-DD-<original-name>.md
    │     Preserve original frontmatter
    │     Add/update: status: unprocessed
    │     Add: filed_from: "output/asks/..."
    │
    ├─ 5. Mark original with: filed: true, filed_to: "raw/notes/..." in frontmatter
    │
    └─ 6. Print confirmation: "Filed → raw/notes/2026-04-04-context-routing-multi-agent.md"
```

#### CLI usage

```bash
brain file              # Interactive: list unfiled outputs, pick by number
brain file --last       # File the most recent output, no questions asked
brain file --as article # File into raw/articles/ instead of raw/notes/
```

#### Edge cases

- No unfiled outputs → "Nothing to file."
- Only one unfiled output → skip the list, file it directly (with confirmation)
- `--last` + `--as article` can combine
- If the destination raw filename already exists, fail instead of overwriting it

#### What happens next

The filed output sits in `raw/notes/` as unprocessed. Next `brain compile` picks it up, integrates the insights into existing wiki articles or creates new ones, and marks it as processed. The exploration is now part of the wiki. Future `brain ask` queries can find it.

---

## Architecture decisions

### Agent writes to stdout, CLI writes the file

Don't give the agent Write permissions to the vault. Instead:
1. Agent runs with `claude -p` (print mode), read-only tools
2. Agent outputs the full markdown document to stdout
3. CLI captures stdout, adds frontmatter, writes to `output/asks/`

This is simpler, safer, and consistent with how `brain compile` works (Claude writes, but through controlled output). The agent focuses on research; the CLI handles file I/O.

Progress text for `brain ask -p` should go to stderr so stdout remains clean markdown.

### Vault access scope

The agent reads the **entire vault**, not just `wiki/`. Reason: you clip an article at 10am, don't compile, and ask a question at 10:15. If the agent only sees `wiki/`, it misses fresh raw material. Wiki is the primary, curated source. Raw is supplementary — unprocessed but potentially the most up-to-date.

### Why not RAG/embeddings?

Karpathy's insight: at ~100 articles / ~400K words, index files + summaries are enough. The agent reads `INDEX.md`, follows links, reads relevant articles. No vector DB, no embedding pipeline, no retrieval infrastructure. This scales to hundreds of articles before you need anything fancier.

If the wiki grows past ~500 articles, revisit with a search tool (issue #6/#7 in the backlog).

### Output directory structure

```
output/
├── asks/          # brain ask outputs
├── reports/       # brain report outputs (future)
├── slides/        # brain slides outputs (future)
└── charts/        # brain chart outputs (future)
```

Only `asks/` is in scope for this PRD. The structure prepares for future output types without overbuilding.

---

## Implementation order

1. **`brain ask`** — core command, agent prompt, file output, terminal summary
2. **`brain file`** — feedback loop, interactive picker, copy to raw/, frontmatter management
3. **Tests** — real temp vaults with test wiki articles, verify agent prompt construction, verify file output format and frontmatter

## Existing patterns to follow

- Command structure: mirrors `src/commands/compile.ts` — parseArgs, spawn Claude, handle output
- Frontmatter: use existing `src/frontmatter.ts` for parsing/generating
- File naming: use existing `src/utils.ts` for slugify, generateFilename
- Config: reads vault path from existing config system
- Error handling: `CLIError` + `die()` from `src/errors.ts`
- Testing: real temp dirs, no mocks, mirrors `test/` conventions

---

## TODO: `--stdout` flag for agent-consumable output

**Priority:** High — unlocks agent-to-knowledge-base queries across all projects.

### Problem

The `-p` / `--print` flag outputs the answer to stdout but the CLI still prints metadata to stderr (`Researching...`, `Consulted N articles`, `Summary: ...`). This is fine for humans but noisy for LLM agents that want to capture clean markdown via `$(brain ask ...)`.

### Proposed solution

Add a `--stdout` flag that outputs ONLY the raw markdown body to stdout. No frontmatter, no stderr logging, nothing except the answer.

```bash
# Human use (current, unchanged)
brain ask "question"                    # Writes file + prints summary
brain ask -p "question"                 # Prints to stdout + metadata to stderr

# Agent use (new)
brain ask --stdout "question"           # ONLY markdown body to stdout. Zero stderr.
```

### Implementation

In `src/commands/ask.ts`:
1. Add `--stdout` flag to `parseArgs` (`{ type: "boolean", default: false }`)
2. When `--stdout` is true:
   - Suppress all `console.error()` calls (no "Researching...", no "Consulted N articles", no "Summary:")
   - Do not write the output file
   - Print only the raw `body` (Claude's response) to `console.log(body)` — no frontmatter wrapping
3. `--stdout` implies `--print` behavior (no file saved) but goes further (no stderr)

### Use case: AI agents querying the knowledge base

```bash
# In a coding agent's workflow (Claude Code, OpenCode, Codex):
CONTEXT=$(brain ask --stdout "what are the Terraform module conventions")
# $CONTEXT is clean markdown the agent can use as context for its next action
```

This is useful for any project where agents work on a codebase and need to query team knowledge. The TFM project (4-person team) is the first target — agents working on Terraform/Python can query architecture decisions, conventions, and past discussions stored in Obsidian.

### Acceptance criteria

- [ ] `brain ask --stdout "question"` outputs only markdown to stdout
- [ ] Zero output to stderr when `--stdout` is used
- [ ] No file is written to `output/asks/` when `--stdout` is used
- [ ] Exit code 0 on success, non-zero on failure (agent can check `$?`)
- [ ] Works with `--model` flag (`brain ask --stdout --model opus "question"`)

---

## Out of scope

- `brain report` (longer, structured multi-section documents)
- `brain slides` (Marp-format presentations)
- `brain chart` (matplotlib/image generation)
- RAG / vector search
- Interactive follow-up questions (ask is single-shot)

These are natural next steps after ask + file are solid.
