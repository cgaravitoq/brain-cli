import { parseArgs } from "node:util";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Config } from "../types";
import { die } from "../errors";
import { parseFrontmatter } from "../frontmatter";

const COMPILER_SYSTEM_PROMPT = `You are a Second Brain compiler. Your job is to transform raw notes and articles into polished wiki articles.

## Instructions

For each unprocessed file listed in the prompt:

1. Read the full raw file
2. Identify core concept(s) — create one wiki article per distinct concept
3. Create/update articles in \`wiki/concepts/\`

## What to keep
- Definitions, architecture, patterns, practical examples, tradeoffs, limitations
- Specific numbers, quotes with insight, illustrative code examples

## What to drop
- Marketing language, repetition, filler, trivial setup steps

## Structure
- Concise opening (2-3 sentences)
- Substance-driven sections
- Tables for comparisons
- Code blocks only when they illustrate

## Formatting
- Use \`[[wikilinks]]\` for all internal references
- Images use \`![[filename]]\` syntax
- Every article must link to ≥2 related concepts

## Index
- Add unreferenced concepts to \`wiki/indexes/INDEX.md\` as pending
- Create the index file if it doesn't exist

## After processing
- Mark each raw file as \`status: processed\` in its frontmatter

## Frontmatter for wiki articles
\`\`\`yaml
---
title: "Concept Name"
aliases: []
tags: [lowercase-hyphenated]
created: YYYY-MM-DD
sources: []
related: []
---
\`\`\`

## Density target
Compress to ~30-50% of original length while preserving all substance.
`;

export interface CompileOptions {
  dryRun: boolean;
  model: string;
  noPush: boolean;
  verbose: boolean;
}

type SubprocessStream = ReturnType<typeof Bun.spawn>["stdout"];

function readStream(stream: SubprocessStream | undefined): Promise<string> {
  if (!stream || typeof stream === "number") {
    return Promise.resolve("");
  }

  return new Response(stream).text();
}

export function parseCompileArgs(args: string[]): CompileOptions {
  const { values } = parseArgs({
    args,
    options: {
      "dry-run": { type: "boolean", default: false },
      model: { type: "string", default: "sonnet" },
      "no-push": { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  return {
    dryRun: (values["dry-run"] as boolean) ?? false,
    model: (values.model as string) ?? "sonnet",
    noPush: (values["no-push"] as boolean) ?? false,
    verbose: (values.verbose as boolean) ?? false,
  };
}

export interface UnprocessedFile {
  path: string;
  title: string;
}

export async function scanUnprocessed(vault: string): Promise<UnprocessedFile[]> {
  const rawDirs = ["raw/notes", "raw/articles"];
  const files: UnprocessedFile[] = [];

  for (const rawDir of rawDirs) {
    const dir = join(vault, rawDir);
    const glob = new Bun.Glob("*.md");

    try {
      for await (const path of glob.scan({ cwd: dir, absolute: false })) {
        const content = await Bun.file(join(dir, path)).text();
        const parsed = parseFrontmatter(content);
        if (parsed?.frontmatter.status === "processed") continue;
        const title = parsed?.frontmatter.title || path.replace(/\.md$/, "");
        files.push({ path: join(rawDir, path), title });
      }
    } catch {
      continue;
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

export async function ensureCompilerAgent(vault: string, model: string): Promise<string> {
  const agentDir = join(vault, ".claude", "agents");
  const agentPath = join(agentDir, "compiler.md");

  const content = `---
model: ${model}
tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

${COMPILER_SYSTEM_PROMPT}`;

  await mkdir(agentDir, { recursive: true });
  await Bun.write(agentPath, content);

  return agentPath;
}

function buildPrompt(files: UnprocessedFile[]): string {
  const lines = [
    `Compile the following ${files.length} unprocessed file(s) into wiki articles:`,
    "",
  ];
  for (const f of files) {
    lines.push(`- \`${f.path}\` — ${f.title}`);
  }
  lines.push("");
  lines.push("Follow the compilation rules in your system prompt.");
  return lines.join("\n");
}

function parseGitStatusPaths(output: string): Set<string> {
  const paths = new Set<string>();

  for (const line of output.split("\n")) {
    if (!line) continue;

    let path = line.slice(3);
    if (!path) continue;

    if (path.includes(" -> ")) {
      path = path.split(" -> ").pop() ?? path;
    }

    // git wraps paths with spaces/special chars in quotes
    if (path.startsWith('"') && path.endsWith('"')) {
      path = path.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }

    paths.add(path);
  }

  return paths;
}

function difference(after: Set<string>, before: Set<string>): string[] {
  return [...after].filter((path) => !before.has(path)).sort();
}

async function runPipedCommand(
  args: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let proc: ReturnType<typeof Bun.spawn>;

  try {
    proc = Bun.spawn(args, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err) {
    die(
      err instanceof Error && err.message.includes('Executable not found')
        ? `${args[0]} not found in PATH`
        : `failed to start ${args[0]}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

async function getGitStatusPaths(vault: string): Promise<Set<string> | null> {
  const repoCheck = await runPipedCommand(
    ["git", "rev-parse", "--is-inside-work-tree"],
    vault,
  );

  if (repoCheck.exitCode !== 0) {
    return null;
  }

  const status = await runPipedCommand(
    ["git", "status", "--porcelain", "--untracked-files=all", "--", "raw", "wiki"],
    vault,
  );

  if (status.exitCode !== 0) {
    die(status.stderr.trim() || "git status failed");
  }

  return parseGitStatusPaths(status.stdout);
}

export async function run(args: string[], config: Config): Promise<void> {
  const options = parseCompileArgs(args);
  const { vault } = config;

  const files = await scanUnprocessed(vault);

  if (files.length === 0) {
    console.log("Nothing to compile.");
    return;
  }

  if (options.dryRun) {
    console.log(`Would compile ${files.length} file(s):\n`);
    for (const f of files) {
      console.log(`  • ${f.path} — ${f.title}`);
    }
    return;
  }

  const gitBefore = await getGitStatusPaths(vault);

  await ensureCompilerAgent(vault, options.model);

  const prompt = buildPrompt(files);

  console.log(`Compiling ${files.length} file(s)...`);

  const claudeBin = process.env.BRAIN_CLAUDE_BIN || "claude";
  const claudeArgs = [
    claudeBin,
    "-p", prompt,
    "--agent", "compiler",
    "--permission-mode", "bypassPermissions",
  ];

  if (options.verbose) {
    console.error(`> ${claudeArgs.join(" ")}`);
  }

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(claudeArgs, {
      stdout: options.verbose ? "inherit" : "pipe",
      stderr: options.verbose ? "inherit" : "pipe",
      cwd: vault,
    });
  } catch (err) {
    die(
      err instanceof Error && err.message.includes('Executable not found')
        ? "Claude CLI not found. Install `claude` and ensure it is in PATH."
        : `failed to start compiler agent: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    if (!options.verbose) {
      const stderr = await readStream(proc.stderr);
      if (stderr) console.error(stderr);
    }
    die(`compilation failed (exit code ${exitCode})`);
  }

  console.log("Compilation complete.");

  if (gitBefore === null) {
    console.log("Skipping git commit: vault is not a git repository.");
    return;
  }

  const gitAfter = await getGitStatusPaths(vault);
  if (gitAfter === null) {
    console.log("Skipping git commit: vault is not a git repository.");
    return;
  }

  const changedPaths = difference(gitAfter, gitBefore);
  if (changedPaths.length === 0) {
    console.log("No new compile changes to commit.");
    return;
  }

  const gitAdd = await runPipedCommand(
    ["git", "add", "--", ...changedPaths],
    vault,
  );
  if (gitAdd.exitCode !== 0) {
    die(gitAdd.stderr.trim() || "git add failed");
  }

  const stagedDiff = await runPipedCommand(
    ["git", "diff", "--cached", "--quiet", "--", ...changedPaths],
    vault,
  );

  if (stagedDiff.exitCode === 0) {
    console.log("No new compile changes to commit.");
    return;
  }
  if (stagedDiff.exitCode !== 1) {
    die(stagedDiff.stderr.trim() || "git diff failed");
  }

  const commitMsg = `wiki: compile ${files.length} source(s)`;
  const gitCommit = await runPipedCommand(
    ["git", "commit", "-m", commitMsg],
    vault,
  );

  if (gitCommit.exitCode !== 0) {
    die(gitCommit.stderr.trim() || "git commit failed");
  }

  console.log(`Committed: ${commitMsg}`);

  if (!options.noPush) {
    const gitPush = await runPipedCommand(["git", "push"], vault);
    if (gitPush.exitCode !== 0) {
      die(gitPush.stderr.trim() || "git push failed");
    }
    console.log("Pushed to remote.");
  }
}
