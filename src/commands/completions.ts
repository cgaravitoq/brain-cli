import { die } from "../errors";

export const COMMANDS = [
  { name: "ask", flags: ["--print", "--stdout", "--model", "--verbose"] },
  { name: "chart", flags: ["--print", "--stdout", "--model", "--verbose"] },
  { name: "clip", flags: ["--dry-run"] },
  { name: "compile", flags: ["--dry-run", "--model", "--no-push", "--verbose", "--all"] },
  { name: "config", flags: [] },
  { name: "doctor", flags: [] },
  { name: "export", flags: ["--format", "--output", "--verbose"] },
  { name: "file", flags: ["--last", "--as"] },
  { name: "init", flags: [] },
  { name: "lint", flags: ["--check", "--fix"] },
  { name: "list", flags: [] },
  { name: "log", flags: ["--all", "--verbose"] },
  { name: "mcp", flags: [] },
  { name: "note", flags: ["--title", "--dry-run"] },
  { name: "pull", flags: [] },
  { name: "push", flags: ["--dry-run", "--message"] },
  { name: "report", flags: ["--print", "--stdout", "--model", "--verbose", "--dry-run"] },
  { name: "search", flags: ["--tag"] },
  { name: "slides", flags: ["--print", "--stdout", "--model", "--verbose", "--count", "--dry-run"] },
  { name: "stats", flags: [] },
] as const;

const BASH_COMPLETION = `_brain_completions() {
  local cur prev opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  
  commands="ask chart clip compile config doctor export file init lint list log mcp note pull push report search slides stats"
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
      COMPREPLY=($(compgen -W "\${flags} --model --no-push --all" -- "\${cur}"))
      return 0
      ;;
    export)
      COMPREPLY=($(compgen -W "\${flags} --format --output --verbose" -- "\${cur}"))
      return 0
      ;;
    search)
      COMPREPLY=($(compgen -W "\${flags} --tag" -- "\${cur}"))
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
      COMPREPLY=($(compgen -W "\${flags} --dry-run" -- "\${cur}"))
      return 0
      ;;
    log)
      COMPREPLY=($(compgen -W "\${flags} --all --verbose" -- "\${cur}"))
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
        '(--no-push)--no-push[skip push]' \\
        '(-v --verbose)'{-v,--verbose}'[verbose]' \\
        '(-a --all)'{-a,--all}'[force all]'
      ;;
    export)
      _arguments -s "\${opts[@]}" \\
        '(-f --format)'{-f,--format}'[export format]:format:(json markdown)' \\
        '(-o --output)'{-o,--output}'[output directory]:dir:_directories' \\
        '(-v --verbose)'{-v,--verbose}'[verbose]'
      ;;
    search)
      _arguments -s "\${opts[@]}" \\
        '(-t --tag)'{-t,--tag}'[filter by tag]:tag:'
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
        '(--dry-run)--dry-run[dry run]'
      ;;
    log)
      _arguments -s "\${opts[@]}" \\
        '(-a --all)'{-a,--all}'[all branches]' \\
        '(-v --verbose)'{-v,--verbose}'[verbose]'
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
complete -c brain -n '__fish_seen_subcommand_from compile' -l no-push -d 'Skip push'
complete -c brain -n '__fish_seen_subcommand_from compile' -l verbose -s v -d 'Verbose'
complete -c brain -n '__fish_seen_subcommand_from compile' -l all -s a -d 'Force all'

# export flags
complete -c brain -n '__fish_seen_subcommand_from export' -l format -s f -d 'Export format' -r -a 'json markdown'
complete -c brain -n '__fish_seen_subcommand_from export' -l output -s o -d 'Output directory' -r
complete -c brain -n '__fish_seen_subcommand_from export' -l verbose -s v -d 'Verbose'

# search flags
complete -c brain -n '__fish_seen_subcommand_from search' -l tag -s t -d 'Filter by tag' -r

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
complete -c brain -n '__fish_seen_subcommand_from clip' -l dry-run -d 'Dry run'

# log flags
complete -c brain -n '__fish_seen_subcommand_from log' -l all -s a -d 'All branches'
complete -c brain -n '__fish_seen_subcommand_from log' -l verbose -s v -d 'Verbose'`;

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
