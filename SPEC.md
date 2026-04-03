# notes-cli — Spec

Quick capture CLI for a Second Brain vault (Obsidian + LLM-maintained wiki).

## What it does

Capture notes, links, and thoughts from any terminal. Notes land in the vault's `raw/` directory as markdown files, ready for LLM compilation into a structured wiki.

## Install

```bash
bun install -g notes-cli
```

## Config

Stored at `~/.config/brain/config.json`:

```json
{
  "vault": "~/Developer/personal/brain"
}
```

On first run, if no config exists, prompt the user for the vault path and save it.

## Commands

### `brain <text>`

Quick capture. Saves a note to `raw/notes/`.

```bash
brain "Braintrust allows full LLM observability including traces and evals"
```

Creates:

```
raw/notes/2026-04-03-2120-braintrust-allows-full-llm-observabilit.md
```

With content:

```markdown
---
title: "Braintrust allows full LLM observability including traces and evals"
created: 2026-04-03
tags: [raw, unprocessed]
---

Braintrust allows full LLM observability including traces and evals
```

### `brain -t "Title" <text>`

Note with explicit title. The title goes in frontmatter, the text is the body.

```bash
brain -t "Retry Pattern" "Per-section retry is better than per-job in parallel pipelines"
```

### `brain -e`

Opens `$EDITOR` (or `vim`) for longer notes. Saves on close if content is non-empty.

### `brain clip <url>`

Fetch a URL, convert to markdown, save to `raw/articles/`. Uses readable extraction (not raw HTML).

```bash
brain clip https://blog.example.com/interesting-post
```

Creates `raw/articles/2026-04-03-2120-interesting-post.md` with the page content as markdown and source URL in frontmatter.

### `brain list`

List unprocessed items across all `raw/` subdirectories.

```bash
brain list

📂 Notes (2)
  • Braintrust allows full LLM observability...
  • Retry Pattern

📂 Articles (3)
  • Thread by @himanshustwts
  • Connect Claude Code to tools via MCP
  • Create custom subagents

5 unprocessed item(s)
```

### `brain stats`

Vault stats overview.

```bash
brain stats

🧠 Second Brain
   Wiki articles:  1
   Raw sources:    5
   Unprocessed:    4
   Vault:          ~/Developer/personal/brain
```

### `brain config [path]`

View or set the vault path.

```bash
brain config                              # show current
brain config ~/Developer/personal/brain   # set new path
```

### `brain search <query>`

Full-text search across the entire vault (raw + wiki + output). Shows matching filenames and a preview of the matching line.

```bash
brain search "orchestration"

📄 wiki/concepts/llm-knowledge-bases.md
   ...Agent Orchestration Pattern...

📄 raw/notes/2026-04-03-agent-orchestration.md
   ...planner generates outline, workers in parallel...
```

## Technical

- **Runtime:** Bun
- **Language:** TypeScript
- **Zero dependencies** — use Bun built-ins only (file I/O, glob, fetch for clip)
- **Binary name:** `brain`
- **Executable:** `bin/brain.ts` with `#!/usr/bin/env bun` shebang
- **Package name:** `brain-cli` (or `@cgaravitoq/brain-cli`)

## File naming

Pattern: `{YYYY-MM-DD}-{HHmm}-{slug}.md`

- Date and time from local timezone
- Slug: first ~50 chars of title/content, lowercased, spaces to hyphens, non-alphanumeric stripped

## Frontmatter

Every generated file has:

```yaml
---
title: "..."
created: YYYY-MM-DD
tags: [raw, unprocessed]
source: "https://..."     # only for clip command
---
```

## Structure

```
notes-cli/
├── bin/
│   └── brain.ts          # Entry point with shebang
├── src/
│   ├── commands/
│   │   ├── note.ts       # brain <text> and brain -t
│   │   ├── clip.ts       # brain clip <url>
│   │   ├── list.ts       # brain list
│   │   ├── stats.ts      # brain stats
│   │   ├── search.ts     # brain search <query>
│   │   └── config.ts     # brain config [path]
│   ├── config.ts         # Load/save ~/.config/brain/config.json
│   ├── frontmatter.ts    # Generate YAML frontmatter
│   └── utils.ts          # slugify, file naming, path helpers
├── package.json
├── tsconfig.json
├── CLAUDE.md             # → symlink to AGENTS.md
├── AGENTS.md
├── SPEC.md               # This file
└── README.md
```
