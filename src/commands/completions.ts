import { die } from "../errors";

export const COMMANDS = [
  { name: "ask",     desc: "Query the wiki with a question",   usage: "brain ask <question>",  flags: ["-p, --print    Print to stdout", "--stdout       Raw stdout only (no stderr)", "--model <m>    Model to use (default: sonnet)", "--verbose      Show agent stderr", "--dry-run      Show what would be created"] },
  { name: "canvas",  desc: "Generate Obsidian canvas",         usage: "brain canvas <topic>",   flags: ["--depth <n>    Link traversal depth (default: 1)"] },
  { name: "chart",   desc: "Generate chart with matplotlib",   usage: "brain chart <topic>",    flags: ["-p, --print    Print to stdout", "--stdout       Raw stdout only (no stderr)", "--model <m>    Model to use (default: sonnet)", "--verbose      Show agent stderr", "--dry-run      Show what would be created"] },
  { name: "clip",    desc: "Save article from URL",            usage: "brain clip <url>",       flags: ["--raw          Skip Readability, convert full HTML", "--dry-run      Show what would be saved"] },
  { name: "compile", desc: "Compile raw material into wiki",   usage: "brain compile",          flags: ["--dry-run      Preview files to compile", "--model <m>    Model for both phases (default: sonnet)", "--extract-model <m>  Model for extraction phase", "--write-model <m>    Model for writing phase", "--no-push      Skip git push after compile", "--verbose      Show agent stderr", "--all          Recompile all (ignore manifest)", "--watch        Watch for changes and recompile", "--concurrency <n>    Parallel jobs (default: 4)"] },
  { name: "config",  desc: "View or set vault path",           usage: "brain config [path]",    flags: [] },
  { name: "doctor",  desc: "Diagnose vault setup",             usage: "brain doctor",           flags: [] },
  { name: "export",  desc: "Export vault content",             usage: "brain export",           flags: ["--format <f>   json or markdown (default: json)", "--output <dir> Output directory (required for markdown)", "--verbose      Show progress"] },
  { name: "file",    desc: "File output back into raw/",       usage: "brain file",             flags: ["--last         File the most recent output", "--as <type>    note or article (default: note)"] },
  { name: "init",    desc: "Create vault directory structure",  usage: "brain init [path]",      flags: [] },
  { name: "lint",    desc: "Check vault health",               usage: "brain lint",             flags: ["--check <name> Run single check (links|frontmatter|orphans|stale)", "--fix          Auto-fix issues (links only)"] },
  { name: "list",    desc: "List unprocessed items",           usage: "brain list",             flags: ["--json         Output as JSON"] },
  { name: "log",     desc: "Show vault git history",           usage: "brain log",              flags: ["-n <count>     Number of entries (default: 10)", "--all          Include all files, not just wiki/raw", "--json         Output as JSON"] },
  { name: "mcp",     desc: "Start MCP server over stdio",      usage: "brain mcp",              flags: [] },
  { name: "note",    desc: "Capture a quick note",             usage: "brain <text>",           flags: ["-t, --title <t>  Set note title", "-e, --editor     Open $EDITOR", "--dry-run        Show what would be created"] },
  { name: "pull",    desc: "Git pull with rebase",             usage: "brain pull",             flags: [] },
  { name: "push",    desc: "Git add, commit, and push",        usage: "brain push",             flags: ["-m, --message <msg>  Commit message", "--dry-run              Show what would be pushed"] },
  { name: "report",  desc: "Generate long-form report",        usage: "brain report <topic>",   flags: ["-p, --print    Print to stdout", "--stdout       Raw stdout only (no stderr)", "--model <m>    Model to use (default: sonnet)", "--verbose      Show agent stderr", "--dry-run      Show what would be created"] },
  { name: "search",  desc: "Search the vault",                 usage: "brain search <query>",   flags: ["--tag <tags>   Filter by comma-separated tags", "--json         Output as JSON"] },
  { name: "slides",  desc: "Generate Marp slide deck",         usage: "brain slides <topic>",   flags: ["-p, --print    Print to stdout", "--stdout       Raw stdout only (no stderr)", "--model <m>    Model to use (default: sonnet)", "--verbose      Show agent stderr", "--count <n>    Target slide count (default: 10)", "--dry-run      Show what would be created"] },
  { name: "stats",   desc: "Show vault statistics",            usage: "brain stats",            flags: ["--json         Output as JSON"] },
] as const;

export function getCommandHelp(name: string): string | null {
  const cmd = COMMANDS.find((c) => c.name === name);
  if (!cmd) return null;

  const lines = [`Usage: ${cmd.usage}`, "", cmd.desc];
  if (cmd.flags.length > 0) {
    lines.push("", "Options:");
    for (const flag of cmd.flags) {
      lines.push(`  ${flag}`);
    }
  }
  return lines.join("\n");
}

const BASH_COMPLETION = `_brain_completions() {
  local cur prev opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  
  commands="ask canvas chart clip compile config doctor export file init lint list log mcp note pull push report search slides stats"
  flags="--help --version"
  
  case "\${prev}" in
    brain)
      COMPREPLY=($(compgen -W "\${commands}" -- "\${cur}"))
      return 0
      ;;
    ask|chart|report|slides)
      COMPREPLY=($(compgen -W "\${flags} --model --print --stdout --verbose --dry-run" -- "\${cur}"))
      return 0
      ;;
    compile)
      COMPREPLY=($(compgen -W "\${flags} --dry-run --model --extract-model --write-model --no-push --verbose --all --watch --concurrency" -- "\${cur}"))
      return 0
      ;;
    canvas)
      COMPREPLY=($(compgen -W "\${flags} --depth" -- "\${cur}"))
      return 0
      ;;
    export)
      COMPREPLY=($(compgen -W "\${flags} --format --output --verbose" -- "\${cur}"))
      return 0
      ;;
    search)
      COMPREPLY=($(compgen -W "\${flags} --tag --json" -- "\${cur}"))
      return 0
      ;;
    list|stats)
      COMPREPLY=($(compgen -W "\${flags} --json" -- "\${cur}"))
      return 0
      ;;
    push)
      COMPREPLY=($(compgen -W "\${flags} --message --dry-run" -- "\${cur}"))
      return 0
      ;;
    file)
      COMPREPLY=($(compgen -W "\${flags} --last --as" -- "\${cur}"))
      return 0
      ;;
    note)
      COMPREPLY=($(compgen -W "\${flags} --title --dry-run" -- "\${cur}"))
      return 0
      ;;
    lint)
      COMPREPLY=($(compgen -W "\${flags} --check --fix" -- "\${cur}"))
      return 0
      ;;
    clip)
      COMPREPLY=($(compgen -W "\${flags} --raw --dry-run" -- "\${cur}"))
      return 0
      ;;
    log)
      COMPREPLY=($(compgen -W "\${flags} -n --all --json" -- "\${cur}"))
      return 0
      ;;
    *)
      COMPREPLY=($(compgen -W "\${commands} \${flags}" -- "\${cur}"))
      return 0
      ;;
  esac
}
complete -F _brain_completions brain`;

const ZSH_COMPLETION = `#compdef brain

_brain_commands() {
  local -a commands
  commands=(
    'ask:Query the wiki with a question'
    'canvas:Generate Obsidian canvas'
    'chart:Generate charts from data'
    'clip:Clip content from URL'
    'compile:Compile raw notes to wiki'
    'config:Configure vault path'
    'doctor:Diagnose vault setup'
    'export:Export vault content'
    'file:File output back to raw'
    'init:Create vault structure'
    'lint:Lint the vault'
    'list:List raw notes'
    'log:Show git log'
    'mcp:Run MCP server'
    'note:Create a note'
    'pull:Pull from remote'
    'push:Push to remote'
    'report:Generate a report'
    'search:Search the vault'
    'slides:Generate slides'
    'stats:Show vault statistics'
  )
  _describe 'command' commands
}

_brain() {
  local -a opts
  opts=(
    '(-h --help)'{-h,--help}'[show help]'
    '(-v --version)'{-v,--version}'[show version]'
  )
  
  _arguments -s "\${opts[@]}" && return 0
  
  case "$words[1]" in
    ask|chart|report|slides)
      _arguments -s "\${opts[@]}" \\
        '(-p --print)'{-p,--print}'[print to stdout]' \\
        '(--stdout)--stdout[stdout only]' \\
        '(-m --model)'{-m,--model}'[model]:model:(sonnet opus haiku)' \\
        '(-v --verbose)'{-v,--verbose}'[verbose]' \\
        '(--dry-run)--dry-run[dry run]'
      ;;
    compile)
      _arguments -s "\${opts[@]}" \\
        '(--dry-run)--dry-run[dry run]' \\
        '(-m --model)'{-m,--model}'[model]:model:(sonnet opus)' \\
        '(--extract-model)--extract-model[extraction model]:model:(sonnet opus)' \\
        '(--write-model)--write-model[write model]:model:(sonnet opus)' \\
        '(--no-push)--no-push[skip push]' \\
        '(-v --verbose)'{-v,--verbose}'[verbose]' \\
        '(-a --all)'{-a,--all}'[force all]' \\
        '(--watch)--watch[watch for changes]' \\
        '(--concurrency)--concurrency[parallel jobs]:number:'
      ;;
    canvas)
      _arguments -s "\${opts[@]}" \\
        '(--depth)--depth[link depth]:number:'
      ;;
    export)
      _arguments -s "\${opts[@]}" \\
        '(-f --format)'{-f,--format}'[export format]:format:(json markdown)' \\
        '(-o --output)'{-o,--output}'[output directory]:dir:_directories' \\
        '(-v --verbose)'{-v,--verbose}'[verbose]'
      ;;
    search)
      _arguments -s "\${opts[@]}" \\
        '(-t --tag)'{-t,--tag}'[filter by tag]:tag:' \\
        '(--json)--json[JSON output]'
      ;;
    list|stats)
      _arguments -s "\${opts[@]}" \\
        '(--json)--json[JSON output]'
      ;;
    push)
      _arguments -s "\${opts[@]}" \\
        '(-m --message)'{-m,--message}'[commit message]:message:' \\
        '(--dry-run)--dry-run[dry run]'
      ;;
    file)
      _arguments -s "\${opts[@]}" \\
        '(-l --last)'{-l,--last}'[file most recent]' \\
        '(-a --as)'{-a,--as}'[file as]:type:(note article)'
      ;;
    note)
      _arguments -s "\${opts[@]}" \\
        '(-t --title)'{-t,--title}'[title]:title:' \\
        '(--dry-run)--dry-run[dry run]'
      ;;
    lint)
      _arguments -s "\${opts[@]}" \\
        '(-c --check)'{-c,--check}'[check only]' \\
        '(-f --fix)'{-f,--fix}'[fix issues]'
      ;;
    clip)
      _arguments -s "\${opts[@]}" \\
        '(--raw)--raw[skip Readability]' \\
        '(--dry-run)--dry-run[dry run]'
      ;;
    log)
      _arguments -s "\${opts[@]}" \\
        '(-n)-n[number of entries]:number:' \\
        '(-a --all)'{-a,--all}'[all branches]' \\
        '(--json)--json[JSON output]'
      ;;
    *)
      _describe 'command' _brain_commands
      ;;
  esac
}

_brain "$@"`;

const FISH_COMPLETION = `# brain fish completion
complete -c brain -f

# Commands
complete -c brain -n '__fish_use_subcommand' -a 'ask' -d 'Query the wiki'
complete -c brain -n '__fish_use_subcommand' -a 'chart' -d 'Generate charts'
complete -c brain -n '__fish_use_subcommand' -a 'clip' -d 'Clip from URL'
complete -c brain -n '__fish_use_subcommand' -a 'compile' -d 'Compile raw to wiki'
complete -c brain -n '__fish_use_subcommand' -a 'config' -d 'Configure vault'
complete -c brain -n '__fish_use_subcommand' -a 'doctor' -d 'Diagnose vault setup'
complete -c brain -n '__fish_use_subcommand' -a 'export' -d 'Export vault content'
complete -c brain -n '__fish_use_subcommand' -a 'file' -d 'File output to raw'
complete -c brain -n '__fish_use_subcommand' -a 'init' -d 'Create vault structure'
complete -c brain -n '__fish_use_subcommand' -a 'lint' -d 'Lint vault'
complete -c brain -n '__fish_use_subcommand' -a 'list' -d 'List notes'
complete -c brain -n '__fish_use_subcommand' -a 'log' -d 'Git log'
complete -c brain -n '__fish_use_subcommand' -a 'mcp' -d 'MCP server'
complete -c brain -n '__fish_use_subcommand' -a 'note' -d 'Create note'
complete -c brain -n '__fish_use_subcommand' -a 'pull' -d 'Pull from remote'
complete -c brain -n '__fish_use_subcommand' -a 'push' -d 'Push to remote'
complete -c brain -n '__fish_use_subcommand' -a 'report' -d 'Generate report'
complete -c brain -n '__fish_use_subcommand' -a 'search' -d 'Search vault'
complete -c brain -n '__fish_use_subcommand' -a 'slides' -d 'Generate slides'
complete -c brain -n '__fish_use_subcommand' -a 'stats' -d 'Show stats'
complete -c brain -n '__fish_use_subcommand' -a 'canvas' -d 'Generate Obsidian canvas'

# Global flags
complete -c brain -l help -s h -d 'Show help'
complete -c brain -l version -s v -d 'Show version'

# ask/chart/report/slides flags
complete -c brain -n '__fish_seen_subcommand_from ask chart report slides' -l print -s p -d 'Print to stdout'
complete -c brain -n '__fish_seen_subcommand_from ask chart report slides' -l stdout -d 'Stdout only'
complete -c brain -n '__fish_seen_subcommand_from ask chart report slides' -l model -s m -d 'Model name' -r
complete -c brain -n '__fish_seen_subcommand_from ask chart report slides' -l verbose -s v -d 'Verbose'
complete -c brain -n '__fish_seen_subcommand_from ask chart report slides' -l dry-run -d 'Dry run'

# compile flags
complete -c brain -n '__fish_seen_subcommand_from compile' -l dry-run -d 'Dry run'
complete -c brain -n '__fish_seen_subcommand_from compile' -l model -s m -d 'Model name' -r
complete -c brain -n '__fish_seen_subcommand_from compile' -l extract-model -d 'Extraction model' -r
complete -c brain -n '__fish_seen_subcommand_from compile' -l write-model -d 'Write model' -r
complete -c brain -n '__fish_seen_subcommand_from compile' -l no-push -d 'Skip push'
complete -c brain -n '__fish_seen_subcommand_from compile' -l verbose -s v -d 'Verbose'
complete -c brain -n '__fish_seen_subcommand_from compile' -l all -s a -d 'Force all'
complete -c brain -n '__fish_seen_subcommand_from compile' -l watch -d 'Watch for changes'
complete -c brain -n '__fish_seen_subcommand_from compile' -l concurrency -d 'Parallel jobs' -r

# canvas flags
complete -c brain -n '__fish_seen_subcommand_from canvas' -l depth -d 'Link depth' -r

# export flags
complete -c brain -n '__fish_seen_subcommand_from export' -l format -s f -d 'Export format' -r -a 'json markdown'
complete -c brain -n '__fish_seen_subcommand_from export' -l output -s o -d 'Output directory' -r
complete -c brain -n '__fish_seen_subcommand_from export' -l verbose -s v -d 'Verbose'

# search flags
complete -c brain -n '__fish_seen_subcommand_from search' -l tag -s t -d 'Filter by tag' -r
complete -c brain -n '__fish_seen_subcommand_from search' -l json -d 'JSON output'

# list/stats flags
complete -c brain -n '__fish_seen_subcommand_from list stats' -l json -d 'JSON output'

# push flags
complete -c brain -n '__fish_seen_subcommand_from push' -l message -s m -d 'Commit message' -r
complete -c brain -n '__fish_seen_subcommand_from push' -l dry-run -d 'Dry run'

# file flags
complete -c brain -n '__fish_seen_subcommand_from file' -l last -s l -d 'File most recent'
complete -c brain -n '__fish_seen_subcommand_from file' -l as -d 'File as' -r

# note flags
complete -c brain -n '__fish_seen_subcommand_from note' -l title -s t -d 'Title' -r
complete -c brain -n '__fish_seen_subcommand_from note' -l dry-run -d 'Dry run'

# lint flags
complete -c brain -n '__fish_seen_subcommand_from lint' -l check -s c -d 'Check only'
complete -c brain -n '__fish_seen_subcommand_from lint' -l fix -s f -d 'Fix issues'

# clip flags
complete -c brain -n '__fish_seen_subcommand_from clip' -l raw -d 'Skip Readability'
complete -c brain -n '__fish_seen_subcommand_from clip' -l dry-run -d 'Dry run'

# log flags
complete -c brain -n '__fish_seen_subcommand_from log' -s n -d 'Number of entries' -r
complete -c brain -n '__fish_seen_subcommand_from log' -l all -s a -d 'All branches'
complete -c brain -n '__fish_seen_subcommand_from log' -l json -d 'JSON output'`;

export function parseCompletionsArgs(args: string[]): string {
  const shell = args[0];
  if (!shell) {
    die("Usage: brain completions <bash|zsh|fish>");
  }
  return shell;
}

export function run(shell: string): void {
  switch (shell) {
    case "bash":
      console.log(BASH_COMPLETION);
      break;
    case "zsh":
      console.log(ZSH_COMPLETION);
      break;
    case "fish":
      console.log(FISH_COMPLETION);
      break;
    default:
      die(`Unknown shell: ${shell}. Use: bash, zsh, or fish`);
  }
}
