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

    for await (const path of glob.scan({ cwd: dir, absolute: false })) {
      const content = await Bun.file(join(dir, path)).text();
      const parsed = parseFrontmatter(content);
      if (parsed?.frontmatter.status === "processed") continue;
      const title = parsed?.frontmatter.title || path.replace(/\.md$/, "");
      files.push({ path: join(rawDir, path), title });
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

  await ensureCompilerAgent(vault, options.model);

  const prompt = buildPrompt(files);

  console.log(`Compiling ${files.length} file(s)...`);

  const claudeArgs = [
    "claude",
    "-p", prompt,
    "--agent", "compiler",
    "--permission-mode", "bypassPermissions",
  ];

  if (options.verbose) {
    console.error(`> ${claudeArgs.join(" ")}`);
  }

  const proc = Bun.spawn(claudeArgs, {
    stdout: options.verbose ? "inherit" : "pipe",
    stderr: options.verbose ? "inherit" : "pipe",
    cwd: vault,
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    if (!options.verbose) {
      const stderr = await new Response(proc.stderr).text();
      if (stderr) console.error(stderr);
    }
    die(`compilation failed (exit code ${exitCode})`);
  }

  console.log("Compilation complete.");

  const gitAdd = Bun.spawn(["git", "add", "-A"], { cwd: vault });
  if ((await gitAdd.exited) !== 0) {
    die("git add failed");
  }

  const commitMsg = `wiki: compile ${files.length} article(s)`;
  const gitCommit = Bun.spawn(["git", "commit", "-m", commitMsg], {
    cwd: vault,
    stdout: options.verbose ? "inherit" : "pipe",
    stderr: options.verbose ? "inherit" : "pipe",
  });

  if ((await gitCommit.exited) !== 0) {
    console.log("No changes to commit.");
    return;
  }

  console.log(`Committed: ${commitMsg}`);

  if (!options.noPush) {
    const gitPush = Bun.spawn(["git", "push"], {
      cwd: vault,
      stdout: options.verbose ? "inherit" : "pipe",
      stderr: options.verbose ? "inherit" : "pipe",
    });
    if ((await gitPush.exited) !== 0) {
      die("git push failed");
    }
    console.log("Pushed to remote.");
  }
}
