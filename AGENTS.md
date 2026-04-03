# AGENTS.md

## Project

This is `notes-cli` — a CLI tool for quick note capture into a Second Brain Obsidian vault.

Read SPEC.md for the full spec before doing anything.

## Rules

- **Runtime:** Bun (not Node, not npm)
- **Language:** TypeScript, strict mode
- **Zero dependencies** — Bun built-ins only. No commander, no yargs, no chalk.
- **Binary name:** `brain`
- **Test with:** `bun test`
- **Format with:** `bun fmt` (if configured) or keep consistent style

## Conventions

- Filenames: lowercase, hyphenated
- Error handling: helpful messages to stderr, non-zero exit codes
- No global state: config loaded once, passed down
- Functions over classes where possible
