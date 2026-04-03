# brain-cli — Spec

CLI for capturing, compiling, and querying a Second Brain vault (Obsidian + LLM-maintained wiki).

## Install

```bash
git clone https://github.com/cgaravitoq/brain-cli.git
cd brain-cli
bun link
```

## Config

Stored at `~/.config/brain/config.json` (XDG-compliant, overridable with `BRAIN_CONFIG_DIR`):

```json
{
  "vault": "~/Developer/personal/brain"
}
```

On first run, prompts for the vault path.

## Commands

### Implemented

#### `brain <text>`
Quick note capture → `raw/notes/`. Generates timestamped filename with slug.

#### `brain -t "Title" <text>`
Note with explicit title in frontmatter, text as body.

#### `brain -e`
Opens `$EDITOR` for longer notes. Saves on close if non-empty.

#### `brain clip <url>`
Fetches URL, converts HTML to markdown, saves to `raw/articles/` with source URL in frontmatter.

#### `brain list`
Lists unprocessed items across `raw/` subdirectories. Filters by `status: processed` in frontmatter.

#### `brain stats`
Vault stats: wiki articles, raw sources, unprocessed count, vault path.

#### `brain search <query>`
Full-text search across entire vault. Shows matching filenames and context preview.

#### `brain config [path]`
View or set vault path.

### To implement

#### `brain compile`
Compiles unprocessed raw files into wiki articles by invoking a Claude Code subagent.

```bash
brain compile              # Compile all unprocessed
brain compile --dry-run    # Show what would be compiled
brain compile --model opus # Override model (default: sonnet)
brain compile --no-push    # Compile but don't git push
brain compile --verbose    # Show agent output
```

**Flow:**
1. Scan `raw/` for files without `status: processed`
2. If none found, exit with "Nothing to compile"
3. Build compilation prompt with file paths and compilation rules
4. Invoke `claude -p --agent compiler --permission-mode bypassPermissions --cwd <vault>`
5. The compiler subagent:
   - Reads each unprocessed file
   - Creates/updates wiki articles in `wiki/concepts/`
   - Updates `wiki/indexes/INDEX.md`
   - Marks raw files as `status: processed`
6. After agent completes: `git add -A && git commit -m "wiki: compile <N> articles" && git push`

**Compiler subagent** lives at `<vault>/.claude/agents/compiler.md` and is auto-created by `brain compile` if missing. Contains:
- model: sonnet (overridable via `--model`)
- tools: Read, Write, Edit, Glob, Grep
- System prompt: compilation rules (see below)

**Compilation rules** (embedded in subagent system prompt):
- Read the full raw article
- Identify core concept(s) — one article per distinct concept
- Keep: definitions, architecture, patterns, practical examples, tradeoffs, limitations
- Drop: marketing language, repetition, filler, trivial setup steps
- Preserve: specific numbers, quotes with insight, illustrative code examples
- Structure: concise opening (2-3 sentences), substance-driven sections, tables for comparisons, code blocks only when they illustrate
- Use `[[wikilinks]]` for all internal references
- Images use `![[filename]]` syntax
- Every article must link to ≥2 related concepts
- Add unreferenced concepts to INDEX.md as pending
- Density target: compress to ~30-50% of original length
- Frontmatter: title, aliases, tags (lowercase-hyphenated), created, sources, related

#### `brain lint`
Future: health checks over the wiki (broken links, missing frontmatter, orphan concepts, stale articles).

#### `brain open`
Future: open vault in Obsidian (`open obsidian://vault/<name>`).

## Backlog

### Search improvements
Current `brain search` is basic substring match. Future iterations:
- **Fuzzy matching** — "orchestrate" should find "orchestration"
- **Multi-term** — `brain search "agent pattern"` should match files containing both words, not just the exact phrase
- **Ranking** — order results by relevance (match frequency, title match > body match, wiki > raw)
- **Tag filtering** — `brain search --tag agents "pattern"` to scope search
- **Frontmatter-aware** — understand title/tags/aliases as higher-weight fields

### Compile improvements
- **Context injection** — pass list of existing wiki concepts to the compiler so it avoids duplicates and links better
- **Incremental compile** — only re-compile articles whose sources changed
- **Multi-model pipeline** — cheaper model for extraction, better model for synthesis

### General
- **`brain push`** — manual git add + commit + push without compiling
- **`brain pull`** — git pull for multi-device sync
- **`brain log`** — show recent compile history (git log filtered by wiki commits)

## Technical

- **Runtime:** Bun
- **Language:** TypeScript, strict mode
- **Zero dependencies** — Bun built-ins only
- **Binary name:** `brain`
- **Package name:** `brain-cli`
- **Config:** XDG-compliant, `BRAIN_CONFIG_DIR` env for test isolation
- **Tests:** `bun test`, real temp dirs, no mocks

## File naming

Pattern: `{YYYY-MM-DD}-{HHmm}-{slug}.md`

## Architecture

```
bin/brain.ts              # Entry: parseArgs + routing + error boundary
src/
  types.ts                # Config, Frontmatter, CommandHandler interfaces
  errors.ts               # CLIError, die()
  config.ts               # XDG config load/save
  frontmatter.ts          # YAML frontmatter generate/parse
  utils.ts                # slugify, filenames, expandHome, dates
  html.ts                 # HTML-to-markdown (zero deps)
  commands/
    note.ts               # brain <text>, -t, -e
    clip.ts               # brain clip <url>
    list.ts               # brain list (filtered by unprocessed)
    stats.ts              # brain stats
    search.ts             # brain search <query>
    config.ts             # brain config [path]
    compile.ts            # brain compile (TODO)
test/                     # Mirrors src/, real temp dirs
  helpers.ts              # createTestVault(), createTestConfigDir()
```
