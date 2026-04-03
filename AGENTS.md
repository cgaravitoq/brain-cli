# AGENTS.md

## Project

This is `notes-cli` — a CLI tool for quick note capture into a Second Brain Obsidian vault.

Read SPEC.md for the full spec before doing anything.

## Rules

- **Runtime:** Bun (not Node, not npm)
- **Language:** TypeScript, strict mode
- **Zero dependencies** — Bun built-ins only. No commander, no yargs, no chalk.
- **Binary name:** `brain`
- **Package name:** `brain-cli`
- **Test with:** `bun test`
- **Typecheck with:** `bun x tsc --noEmit`
- **Format with:** `bun fmt` (if configured) or keep consistent style

## Conventions

- Filenames: lowercase, hyphenated
- Error handling: `CLIError` + `die()` from `src/errors.ts`, caught in `bin/brain.ts`
- stderr for errors (`console.error`), stdout for data output (`console.log`)
- No global state: config loaded once, passed down as `Config` parameter
- Functions over classes where possible
- All file writes must `mkdir({ recursive: true })` before `Bun.write()`

## Architecture

```
bin/brain.ts              # Entry point: parseArgs routing + error boundary
src/
  types.ts                # Config, Frontmatter, CommandHandler interfaces
  errors.ts               # CLIError class, die() helper
  config.ts               # XDG-compliant config load/save (BRAIN_CONFIG_DIR for tests)
  frontmatter.ts          # Generate/parse YAML frontmatter
  utils.ts                # slugify, generateFilename, expandHome, formatDate/Time
  html.ts                 # Regex HTML-to-markdown converter (for clip)
  commands/
    note.ts               # brain <text>, brain -t, brain -e
    clip.ts               # brain clip <url>
    list.ts               # brain list
    stats.ts              # brain stats
    search.ts             # brain search <query>
    config.ts             # brain config [path]
test/                     # Mirrors src/ — real temp dirs, no mocks
  helpers.ts              # createTestVault(), createTestConfigDir()
```

## Key patterns

- **Arg parsing:** `parseArgs` from `node:util` with `strict: false`, `allowPositionals: true`
- **Command routing:** `Record<string, CommandHandler>` in `bin/brain.ts` with lazy imports; `note` is the implicit default (not in registry)
- **Config testability:** `BRAIN_CONFIG_DIR` env var overrides config path in tests
- **File I/O testing:** real temp directories via `mkdtemp`, cleanup in `afterEach`
- **File discovery:** `Bun.Glob("**/*.md").scan()` for listing and searching
