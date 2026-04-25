# AGENTS.md

## Project

This is `brain-cli` — a CLI tool for capturing, querying, and compiling knowledge inside a Second Brain Obsidian vault.

There is no persistent `SPEC.md` in this repo. Use `README.md` for the current CLI surface.

## Rules

- **Runtime:** Bun (not Node, not npm)
- **Language:** TypeScript, strict mode
- **Minimal dependencies** — prefer Bun built-ins. Third-party deps are allowed only when pure-JS, lightweight, no native binaries, no postinstall scripts, and they provide capability that would be infeasible to reimplement (e.g. Readability for main-content extraction, Turndown — with `turndown-plugin-gfm` for GFM tables/strikethrough — for HTML→markdown, linkedom for a lightweight DOM). No commander, no yargs, no chalk.
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
  errors.ts               # CLIError class, die() helper, GitError, ValidationError
  config.ts               # XDG-compliant config load/save (BRAIN_CONFIG_DIR for tests)
  frontmatter.ts          # Generate/parse YAML frontmatter
  utils.ts                # slugify, generateFilename, expandHome, formatDate/Time
  html.ts                 # HTML→markdown via Turndown + linkedom (for clip)
  readability.ts          # Mozilla Readability main-content extraction (for clip)
  fs.ts                   # Bun-native file I/O: readTextFile, writeTextFile, fileExists, globFiles
  spawn.ts                # Bun.spawn/spawnSync wrappers: spawnCapture, spawnSyncInherited, spawnSyncCapture
  git.ts                  # Git helpers: runGit, isGitRepo, getChangedFiles, parseGitStatusPaths
  agents.ts               # Claude agent file generation (ensureAgent)
  commands/
    shared.ts             # Shared helpers for agent commands (extractSources, spawnClaude, etc.)
    note.ts               # brain <text>, brain -t, brain -e
    clip.ts               # brain clip <url>
    list.ts               # brain list
    stats.ts              # brain stats
    search.ts             # brain search <query>
    compile.ts            # brain compile [--dry-run] [--model] [--no-push] [--watch]
    ask.ts                # brain ask <question> [-p|--print] [--model] [--verbose]
    file.ts               # brain file [--last] [--as note|article]
    config.ts             # brain config [path]
    push.ts               # brain push — git add, commit, push
    pull.ts               # brain pull — git pull --rebase
    log.ts                # brain log — vault git history
    init.ts               # brain init [path] — scaffold vault structure
    doctor.ts             # brain doctor — diagnose vault setup
    lint.ts               # brain lint — vault health checks (links, frontmatter, orphans, stale)
    mcp.ts                # brain mcp — MCP server over stdio
    report.ts             # brain report <topic> — long-form report generation
    slides.ts             # brain slides <topic> — Marp slide deck generation
    chart.ts              # brain chart <topic> — matplotlib chart generation
    canvas.ts             # brain canvas <topic> — Obsidian canvas generation
    export.ts             # brain export — export vault content
    completions.ts        # brain completions <sh> — shell completions (bash/zsh/fish)
  lint/
    links.ts              # Broken wikilink detection and auto-fix
    frontmatter.ts        # Frontmatter validation (missing/malformed)
    orphans.ts            # Orphan note detection (no inbound links)
    stale.ts              # Stale note detection (old, untouched notes)
  compile/
    manifest.ts           # Compile manifest tracking (.brain/ directory)
  search/
    stemmer.ts            # Minimal suffix-stripping stemmer for fuzzy search
  mcp/
    protocol.ts           # JSON-RPC types for MCP protocol
    tools.ts              # MCP tool definitions and input schemas
test/                     # Mirrors src/ — real temp dirs, no mocks
  helpers.ts              # temp vault/config/bin helpers
```

## Key patterns

- **Arg parsing:** `parseArgs` from `node:util` with `strict: false`, `allowPositionals: true`
- **Command routing:** `Set<string>` of known commands in `bin/brain.ts` with lazy `await import()`; `note` is the implicit default (not in the set); `completions`, `init`, and `doctor` are handled early (before config load)
- **Config behavior:** `brain config <path>` must work even when no config exists yet; `BRAIN_CONFIG_DIR` overrides the config path in tests
- **File I/O:** all file reads/writes go through `src/fs.ts` which uses `Bun.file().text()` and `Bun.write()` — not `node:fs` read/write functions
- **File discovery:** `Bun.Glob().scan()` via the `globFiles()` async generator in `src/fs.ts`
- **Process spawning:** all subprocess calls go through `src/spawn.ts` which uses `Bun.spawn()` and `Bun.spawnSync()` — not `node:child_process`
- **Git operations:** centralized in `src/git.ts` (uses `spawnCapture` internally); commands like `push`, `pull`, `log`, `compile` call `runGit()` rather than spawning git directly
- **File I/O testing:** real temp directories via `mkdtemp`, cleanup in `afterEach`
- **Claude integration:** `ask`, `compile`, `report`, `slides`, `chart`, and `canvas` shell out to Claude CLI via `src/spawn.ts`; `BRAIN_CLAUDE_BIN` can override the executable path for tests or custom installs
- **Compile safety:** `compile` may auto-commit only when the vault is already a git repository; it must not stage unrelated changes outside the compile result set
- **Lint subsystem:** `src/lint/` modules each export a check function returning typed issue arrays; `commands/lint.ts` orchestrates them and optionally auto-fixes
