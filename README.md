# brain-cli 🧠

CLI for an LLM-maintained Obsidian wiki vault. Capture notes, clip articles, query your wiki, and compile raw material into structured pages via Claude.

Designed to pair with the [obsidian-wiki-template](https://github.com/cgaravitoq/obsidian-wiki-template) — a public starter vault for LLM knowledge bases (following Karpathy's [LLM Knowledge Bases](https://x.com/karpathy/status/2039805659525644595) pattern).

Built on Bun-native APIs with a small set of pure-JS dependencies (`@mozilla/readability`, `turndown`, `linkedom`) used only by `brain clip` for HTML→markdown conversion.

## Requirements

- [Bun](https://bun.sh) >= 1.0
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) (for `ask`, `compile`, `report`, `slides`, and `chart` commands)

## Install

```bash
git clone https://github.com/cgaravitoq/brain-cli.git
cd brain-cli
bun install
bun link
```

## Usage

```
brain <text>           Quick capture
brain -t "Title" <text> Note with title
brain -e                 Open editor
brain clip <url>         Save article
brain list               List unprocessed
brain stats              Vault stats
brain search <query>     Search vault
brain compile            Compile raw → wiki
brain ask <question>     Query the wiki
brain file               File output → raw
brain push               Git add, commit & push
brain pull               Git pull with rebase
brain log                Show vault git log
brain init [path]        Create vault structure
brain doctor             Diagnose vault setup
brain config [path]      View/set vault path
brain mcp                MCP server (stdio)
brain lint               Lint vault health
brain report <topic>     Generate long-form report
brain slides <topic>     Generate Marp slide deck
brain chart <topic>      Generate chart with matplotlib
brain canvas <topic>     Generate Obsidian canvas
brain export             Export vault content
brain completions <sh>   Shell completions (bash/zsh/fish)
```

## Commands

**Capture**

- `brain <text>` -- create a note in `raw/notes/`
- `brain -t "Title" <text>` -- note with an explicit title
- `brain -e` -- open `$EDITOR` for longer notes
- `brain clip <url>` -- fetch a page, extract main content, convert to markdown, store in `raw/articles/` (`--raw` to skip Readability and convert the full HTML, `--dry-run`). Frontmatter includes `title`, `created`, `tags`, `source` URL, and — when extracted — `author`, `site`, `excerpt`.

  `clip` dispatches to one of several **extractors** based on the URL:

  | Extractor | Used for |
  |---|---|
  | `reddit` | `*.reddit.com/r/.../comments/...` — uses Reddit's `.json` endpoint to capture post + top-level comments |
  | `twitter-syndication` | `x.com` / `twitter.com` `/status/...` — uses the public `cdn.syndication.twimg.com` endpoint (works for tweets and threads' focal post; long-form X Articles need an external extractor) |
  | `default` | Everything else — HTTP fetch + Mozilla Readability + Turndown |
  | `raw` | Forced via `--raw` — skips Readability, converts full HTML |

  **External extractors** (for sites that block plain HTTP — X Articles, LinkedIn, Medium paywalls, anti-bot-protected Reddit). Add a per-domain command to `~/.config/brain/config.json`:

  ```json
  {
    "vault": "~/Developer/personal/brain",
    "extractors": {
      "x.com":         "my-x-extractor",
      "linkedin.com":  ["my-helper", "--mode=article"]
    }
  }
  ```

  The command is invoked with the URL as its final positional argument and is expected to print to stdout either:
  - JSON `{ "title": string, "content": string, "author"?, "site"?, "excerpt"? }`, or
  - Raw markdown (the first H1 / first non-empty line becomes the title).

  Non-zero exit → `brain clip` reports the error. External extractors **always win** over built-ins; built-ins fall back to `default` on transient failures, but extractors that emit a "do-not-fall-back" signal (e.g. X Article detected) surface the error directly so you know to register an external extractor.

**Query**

- `brain search <query>` -- search markdown files across the vault (`--tag`, `--json`)
- `brain ask <question>` -- run a Claude researcher against the vault (`-p`/`--print`, `--stdout`, `--model`, `--verbose`, `--dry-run`)
- `brain list` -- show unprocessed raw notes and articles (`--json`)
- `brain stats` -- vault file counts and configured path (`--json`)
- `brain log` -- show vault git log (`-n`, `--all`, `--json`)

**Compile & Generate**

- `brain compile` -- compile raw material into wiki content via Claude (`--dry-run`, `--model`, `--extract-model`, `--write-model`, `--no-push`, `--all`, `--watch`, `--concurrency`, `--verbose`)
- `brain report <topic>` -- generate a long-form report (`--print`, `--stdout`, `--model`, `--verbose`, `--dry-run`)
- `brain slides <topic>` -- generate a Marp slide deck (`--print`, `--stdout`, `--model`, `--verbose`, `--count`, `--dry-run`)
- `brain chart <topic>` -- generate a matplotlib chart (`--print`, `--stdout`, `--model`, `--verbose`, `--dry-run`)
- `brain canvas <topic>` -- generate an Obsidian canvas from wikilinks (`--depth`)

**File & Sync**

- `brain file` -- move an output back into `raw/` (`--last` for most recent, `--as note|article`)
- `brain push` -- git add, commit, and push vault changes (`-m "msg"`, `--dry-run`)
- `brain pull` -- git pull with rebase
- `brain export` -- export vault content (`--format json|markdown`, `--output`, `--verbose`)

**Setup**

- `brain config [path]` -- view or set vault path
- `brain init [path]` -- scaffold a new vault directory
- `brain doctor` -- diagnose vault configuration issues
- `brain lint` -- check vault health (`--check links|frontmatter|orphans|stale`, `--fix`)
- `brain mcp` -- start an MCP server over stdio. Exposes tools: `search_wiki`, `read_article`, `list_concepts`, `vault_stats`, `list_unprocessed`, `vault_lint`.
- `brain completions <bash|zsh|fish>` -- emit shell completions

## Config

On first run, `brain` prompts for your vault path. Config is stored at `~/.config/brain/config.json`.

```bash
brain config                              # show current
brain config ~/Developer/personal/brain   # set path
```

## Environment Variables

| Variable | Purpose |
|---|---|
| `BRAIN_CONFIG_DIR` | Override the config directory (mainly for tests) |
| `BRAIN_CLAUDE_BIN` | Override the Claude CLI executable path |
| `XDG_CONFIG_HOME` | XDG base directory for config (default: `~/.config`) |
| `EDITOR` | Editor opened by `brain -e` |

## How it works

```
You → brain "thought"       → raw/notes/
You → brain clip <url>      → raw/articles/
You → brain ask "question"  → output/asks/
You → brain report <topic>  → output/reports/
You → brain slides <topic>  → output/slides/
You → brain chart <topic>   → output/charts/
You → brain canvas <topic>  → output/canvas/
You → brain file            → raw/notes/ or raw/articles/
        ↓
brain compile → Claude subagent → wiki/concepts/ + indexes
        ↓
Optional git commit/push when the vault is already a repo
```

## Development

```bash
bun test              # Run tests
bun x tsc --noEmit    # Type check
bun run bin/brain.ts  # Run locally without linking
```

## License

MIT
