# brain-cli 🧠

CLI for your [Second Brain](https://github.com/cgaravitoq/second-brain) vault. Capture notes, clip articles, query your wiki, file outputs back into the raw pipeline, and compile raw material into a structured wiki via Claude.

## Install

```bash
git clone https://github.com/cgaravitoq/brain-cli.git
cd brain-cli
bun install
bun link
```

Requires [Bun](https://bun.sh) ≥ 1.0.

## Usage

```bash
# Quick note
brain "Braintrust allows full LLM observability including traces and evals"

# Note with title
brain -t "Retry Pattern" "Per-section retry beats per-job in parallel pipelines"

# Open editor for longer notes
brain -e

# Clip a web page
brain clip https://blog.example.com/interesting-post

# List unprocessed items
brain list

# Search the vault
brain search "orchestration"

# Vault stats
brain stats

# Ask the wiki a question and save the result to output/asks/
brain ask "how does context routing affect multi-agent orchestration?"

# Print-only mode for ask
brain ask -p "what changed in my retry strategy?"

# File the most recent ask result back into raw/notes/
brain file --last

# Compile raw → wiki
brain compile
```

## Config

On first run, `brain` prompts for your vault path. You can also set it directly without an interactive prompt. Config is stored at `~/.config/brain/config.json`.

```bash
brain config                              # show current
brain config ~/Developer/personal/brain   # set path
```

## Commands

`brain <text>` creates a note in `raw/notes/`.

`brain clip <url>` fetches a page, converts it to markdown, and stores it in `raw/articles/`.

`brain list` shows unprocessed raw notes and articles.

`brain search <query>` searches markdown files across the vault.

`brain stats` prints wiki/raw counts and the configured vault path.

`brain ask <question>` runs a read-only Claude researcher against the vault and writes the answer to `output/asks/`. Use `-p` to print the markdown answer to stdout without saving a file.

`brain file` scans `output/` for unfiled markdown outputs and copies one back into `raw/notes/` or `raw/articles/`.

`brain compile` shells out to Claude to turn unprocessed raw material into wiki content. If the vault is a git repo, compile will auto-commit the new compile changes. If it is not a git repo, compile still runs and skips the git step.

## Environment

`BRAIN_CONFIG_DIR` overrides the config directory. This is mainly useful for tests.

`BRAIN_CLAUDE_BIN` overrides the Claude executable used by `brain ask` and `brain compile`.

## How it works

```
You → brain "thought" → raw/notes/
You → brain clip <url> → raw/articles/
You → brain ask "question" → output/asks/
You → brain file → raw/notes/ or raw/articles/
        ↓
brain compile → Claude subagent → wiki/concepts/ + indexes
        ↓
Optional git commit/push when the vault is already a repo
```

## Development

```bash
bun test          # Run tests
bun x tsc --noEmit # Type check
bun run bin/brain.ts <args>  # Run locally
```

`brain ask` and `brain compile` require a working Claude CLI installation unless `BRAIN_CLAUDE_BIN` points to an alternative executable.

## License

MIT
