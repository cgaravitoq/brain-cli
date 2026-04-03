# brain-cli 🧠

CLI for your [Second Brain](https://github.com/cgaravitoq/second-brain) vault. Capture notes, clip articles, search knowledge, and compile raw material into a structured wiki via LLM.

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

# Compile raw → wiki (coming soon)
brain compile
```

## Config

On first run, `brain` prompts for your vault path. Stored at `~/.config/brain/config.json`.

```bash
brain config                              # show current
brain config ~/Developer/personal/brain   # set path
```

## How it works

```
You → brain "thought" → raw/notes/
You → brain clip <url> → raw/articles/
        ↓
brain compile → Claude subagent → wiki/concepts/ + indexes
        ↓
Obsidian Git → auto-push → GitHub
```

## Development

```bash
bun test          # Run tests
bun x tsc --noEmit # Type check
bun run bin/brain.ts <args>  # Run locally
```

## License

MIT
