import { parseArgs } from "node:util";
import { join } from "node:path";
import type { Config } from "../types";
import { die } from "../errors";
import { parseFrontmatter } from "../frontmatter";
import {
  runGit,
  isGitRepo,
  parseGitStatusPaths as parseGitStatusPathsArray,
} from "../git";
import {
  loadManifest,
  saveManifest,
  computeFileHash,
  type CompileManifest,
} from "../compile/manifest";
import { readTextFile, globFiles } from "../fs";
import { spawnCapture } from "../spawn";
import { ensureAgent, type AgentDefinition } from "../agents";

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

export interface WikiArticle {
  path: string;   // relative path like "wiki/concepts/foo.md"
  title: string;  // from frontmatter, or filename without .md
  tags: string;   // comma-separated tags from frontmatter, or empty string
}

export interface ExtractionConcept {
  title: string;
  wikiPath: string;
  keyPoints: string[];
  relatedConcepts: string[];
  suggestedTags: string[];
}

export interface ExtractionEntry {
  source: string;
  concepts: ExtractionConcept[];
}

export interface ExtractionPlan {
  extractions: ExtractionEntry[];
}

export interface CompileOptions {
  dryRun: boolean;
  model: string;
  extractModel: string | null;
  writeModel: string | null;
  noPush: boolean;
  verbose: boolean;
  all: boolean;
}

export function parseCompileArgs(args: string[]): CompileOptions {
  const { values } = parseArgs({
    args,
    options: {
      "dry-run": { type: "boolean", default: false },
      model: { type: "string", default: "sonnet" },
      "extract-model": { type: "string" },
      "write-model": { type: "string" },
      "no-push": { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      all: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  return {
    dryRun: (values["dry-run"] as boolean) ?? false,
    model: (values.model as string) ?? "sonnet",
    extractModel: (values["extract-model"] as string) ?? null,
    writeModel: (values["write-model"] as string) ?? null,
    noPush: (values["no-push"] as boolean) ?? false,
    verbose: (values.verbose as boolean) ?? false,
    all: (values.all as boolean) ?? false,
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

    try {
      for await (const path of globFiles("*.md", dir)) {
        const content = await readTextFile(join(dir, path));
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

export async function scanWikiInventory(vault: string): Promise<WikiArticle[]> {
  const wikiDir = join(vault, "wiki");
  const articles: WikiArticle[] = [];

  try {
    for await (const relPath of globFiles("**/*.md", wikiDir)) {
      const fullPath = join(wikiDir, relPath);
      const content = await readTextFile(fullPath);
      const parsed = parseFrontmatter(content);

      const filename = relPath.replace(/\.md$/, "").split("/").pop() ?? relPath;
      const title = parsed?.frontmatter.title || filename;

      let tags = "";
      if (parsed?.frontmatter.tags) {
        const raw = parsed.frontmatter.tags;
        // Tags are stored as "[tag1, tag2]" string from our frontmatter parser
        const stripped = raw.replace(/^\[/, "").replace(/\]$/, "").trim();
        tags = stripped;
      }

      articles.push({ path: join("wiki", relPath), title, tags });
    }
  } catch {
    // wiki directory may not exist
  }

  articles.sort((a, b) => a.path.localeCompare(b.path));
  return articles;
}

const COMPILER_AGENT: AgentDefinition = {
  name: "compiler",
  systemPrompt: COMPILER_SYSTEM_PROMPT,
  tools: ["Read", "Write", "Edit", "Glob", "Grep"],
};

export async function ensureCompilerAgent(vault: string, model: string): Promise<string> {
  return ensureAgent(vault, COMPILER_AGENT, model);
}

const EXTRACTOR_SYSTEM_PROMPT = `You are a Second Brain extraction agent. Your job is to analyze raw notes and articles and produce a structured extraction plan as JSON.

## Instructions

For each unprocessed file:
1. Read the full content
2. Identify core concept(s)
3. For each concept, extract: title, key points, related concepts, suggested wiki path

## Output format

Output ONLY valid JSON (no markdown fences, no commentary):

{
  "extractions": [
    {
      "source": "raw/notes/example.md",
      "concepts": [
        {
          "title": "Concept Name",
          "wikiPath": "wiki/concepts/concept-name.md",
          "keyPoints": ["point1", "point2"],
          "relatedConcepts": ["Other Concept"],
          "suggestedTags": ["tag1", "tag2"]
        }
      ]
    }
  ]
}`;

const EXTRACTOR_AGENT: AgentDefinition = {
  name: "extractor",
  systemPrompt: EXTRACTOR_SYSTEM_PROMPT,
  tools: ["Read", "Glob"],
};

export async function ensureExtractorAgent(vault: string, model: string): Promise<string> {
  return ensureAgent(vault, EXTRACTOR_AGENT, model);
}

export function buildExtractionPrompt(files: UnprocessedFile[], wikiArticles: WikiArticle[]): string {
  const lines = [
    `Analyze the following ${files.length} unprocessed file(s) and produce a JSON extraction plan:`,
    "",
  ];
  for (const f of files) {
    lines.push(`- \`${f.path}\` — ${f.title}`);
  }
  lines.push("");

  if (wikiArticles.length > 0) {
    lines.push("## Existing wiki articles (do NOT duplicate these)");
    lines.push("");
    lines.push("| Path | Title | Tags |");
    lines.push("|------|-------|------|");
    for (const a of wikiArticles) {
      lines.push(`| ${a.path} | ${a.title} | ${a.tags} |`);
    }
    lines.push("");
  }

  lines.push("Output ONLY valid JSON matching the extraction plan schema. No markdown fences, no commentary.");
  return lines.join("\n");
}

export function buildWritePrompt(
  files: UnprocessedFile[],
  wikiArticles: WikiArticle[],
  extractionPlan: ExtractionPlan,
): string {
  const lines = [
    `Compile the following ${files.length} unprocessed file(s) into wiki articles using the extraction plan below:`,
    "",
    "## Extraction Plan",
    "",
    JSON.stringify(extractionPlan, null, 2),
    "",
    "## Files to process",
    "",
  ];
  for (const f of files) {
    lines.push(`- \`${f.path}\` — ${f.title}`);
  }
  lines.push("");

  if (wikiArticles.length > 0) {
    lines.push("## Existing wiki articles");
    lines.push("");
    lines.push("| Path | Title | Tags |");
    lines.push("|------|-------|------|");
    for (const a of wikiArticles) {
      lines.push(`| ${a.path} | ${a.title} | ${a.tags} |`);
    }
    lines.push("");
    lines.push("Do NOT recreate or duplicate any of the articles listed above. Reference them with wikilinks where relevant.");
    lines.push("");
  }

  lines.push("Follow the extraction plan above and the compilation rules in your system prompt.");
  return lines.join("\n");
}

export function buildPrompt(files: UnprocessedFile[], wikiArticles: WikiArticle[]): string {
  const lines = [
    `Compile the following ${files.length} unprocessed file(s) into wiki articles:`,
    "",
  ];
  for (const f of files) {
    lines.push(`- \`${f.path}\` — ${f.title}`);
  }
  lines.push("");

  if (wikiArticles.length > 0) {
    lines.push("## Existing wiki articles");
    lines.push("");
    lines.push("| Path | Title | Tags |");
    lines.push("|------|-------|------|");
    for (const a of wikiArticles) {
      lines.push(`| ${a.path} | ${a.title} | ${a.tags} |`);
    }
    lines.push("");
    lines.push("Do NOT recreate or duplicate any of the articles listed above. Reference them with wikilinks where relevant.");
    lines.push("");
  }

  lines.push("Follow the compilation rules in your system prompt.");
  return lines.join("\n");
}

function parseGitStatusPaths(output: string): Set<string> {
  return new Set(parseGitStatusPathsArray(output));
}

function difference(after: Set<string>, before: Set<string>): string[] {
  return [...after].filter((path) => !before.has(path)).sort();
}

async function getGitStatusPaths(vault: string): Promise<Set<string> | null> {
  if (!(await isGitRepo(vault))) {
    return null;
  }

  const status = await runGit(vault, [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    "raw",
    "wiki",
  ]);

  if (status.exitCode !== 0) {
    die(status.stderr.trim() || "git status failed");
  }

  return parseGitStatusPaths(status.stdout);
}

export async function filterByManifest(
  vault: string,
  files: UnprocessedFile[],
  manifest: CompileManifest,
): Promise<UnprocessedFile[]> {
  const result: UnprocessedFile[] = [];

  for (const file of files) {
    const fullPath = join(vault, file.path);
    const content = await readTextFile(fullPath);
    const hash = computeFileHash(content);
    const entry = manifest.compiled[file.path];

    if (entry && entry.hash === hash) {
      continue; // unchanged, skip
    }

    result.push(file);
  }

  return result;
}

export async function updateManifest(
  vault: string,
  files: UnprocessedFile[],
  manifest: CompileManifest,
): Promise<CompileManifest> {
  const now = new Date().toISOString();
  const updated: CompileManifest = {
    lastCompileAt: now,
    compiled: { ...manifest.compiled },
  };

  for (const file of files) {
    const fullPath = join(vault, file.path);
    const content = await readTextFile(fullPath);
    const hash = computeFileHash(content);
    updated.compiled[file.path] = { hash, compiledAt: now };
  }

  return updated;
}

function isTwoPhase(options: CompileOptions): boolean {
  return options.extractModel !== null || options.writeModel !== null;
}

function resolveExtractModel(options: CompileOptions): string {
  return options.extractModel ?? options.model;
}

function resolveWriteModel(options: CompileOptions): string {
  return options.writeModel ?? options.model;
}

async function spawnClaude(
  vault: string,
  prompt: string,
  agent: string,
  verbose: boolean,
  captureStdout: boolean,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const claudeBin = process.env.BRAIN_CLAUDE_BIN || "claude";
  const claudeArgs = [
    claudeBin,
    "-p", prompt,
    "--agent", agent,
    "--permission-mode", "bypassPermissions",
  ];

  if (verbose) {
    console.error(`> ${claudeArgs.join(" ")}`);
  }

  try {
    return await spawnCapture(claudeArgs, {
      cwd: vault,
      stdoutMode: captureStdout ? "pipe" : (verbose ? "inherit" : "pipe"),
      stderrMode: verbose ? "inherit" : "pipe",
    });
  } catch (err) {
    die(
      err instanceof Error && (err.message.includes("ENOENT") || err.message.includes("Executable not found"))
        ? "Claude CLI not found. Install `claude` and ensure it is in PATH."
        : `failed to start ${agent} agent: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function parseExtractionPlan(output: string): ExtractionPlan | null {
  try {
    const parsed = JSON.parse(output.trim());
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray(parsed.extractions)
    ) {
      return parsed as ExtractionPlan;
    }
    return null;
  } catch {
    return null;
  }
}

export async function run(args: string[], config: Config): Promise<void> {
  const options = parseCompileArgs(args);
  const { vault } = config;

  const allFiles = await scanUnprocessed(vault);

  if (allFiles.length === 0) {
    console.log("Nothing to compile.");
    return;
  }

  const manifest = await loadManifest(vault);
  const files = options.all
    ? allFiles
    : await filterByManifest(vault, allFiles, manifest);

  if (files.length === 0) {
    console.log("Nothing to compile.");
    return;
  }

  const twoPhase = isTwoPhase(options);

  // Two-phase dry-run: run only extractor and print plan
  if (options.dryRun && twoPhase) {
    const extractModel = resolveExtractModel(options);
    await ensureExtractorAgent(vault, extractModel);

    const wikiArticles = await scanWikiInventory(vault);
    const extractionPrompt = buildExtractionPrompt(files, wikiArticles);

    console.log(`Extracting plan for ${files.length} file(s)...`);

    const result = await spawnClaude(vault, extractionPrompt, "extractor", options.verbose, true);

    if (result.exitCode !== 0) {
      if (result.stderr) console.error(result.stderr);
      die(`extraction failed (exit code ${result.exitCode})`);
    }

    const plan = parseExtractionPlan(result.stdout);
    if (plan) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      console.error("Warning: extractor returned invalid JSON");
      console.log(result.stdout);
    }
    return;
  }

  // Single-phase dry-run: just list files
  if (options.dryRun) {
    console.log(`Would compile ${files.length} file(s):\n`);
    for (const f of files) {
      console.log(`  • ${f.path} — ${f.title}`);
    }
    return;
  }

  const gitBefore = await getGitStatusPaths(vault);
  const wikiArticles = await scanWikiInventory(vault);

  if (twoPhase) {
    // Phase 1: Extraction
    const extractModel = resolveExtractModel(options);
    await ensureExtractorAgent(vault, extractModel);

    const extractionPrompt = buildExtractionPrompt(files, wikiArticles);

    console.log(`Extracting plan for ${files.length} file(s)...`);

    const extractResult = await spawnClaude(vault, extractionPrompt, "extractor", options.verbose, true);

    let plan: ExtractionPlan | null = null;
    if (extractResult.exitCode === 0) {
      plan = parseExtractionPlan(extractResult.stdout);
    }

    if (plan) {
      // Phase 2: Writing with extraction plan
      const writeModel = resolveWriteModel(options);
      await ensureCompilerAgent(vault, writeModel);

      const writePrompt = buildWritePrompt(files, wikiArticles, plan);

      console.log(`Compiling ${files.length} file(s)...`);

      const writeResult = await spawnClaude(vault, writePrompt, "compiler", options.verbose, false);

      if (writeResult.exitCode !== 0) {
        if (writeResult.stderr) console.error(writeResult.stderr);
        die(`compilation failed (exit code ${writeResult.exitCode})`);
      }
    } else {
      // Fallback to single-model compile with write model
      console.error("Warning: extraction failed, falling back to single-model compile");
      const writeModel = resolveWriteModel(options);
      await ensureCompilerAgent(vault, writeModel);

      const prompt = buildPrompt(files, wikiArticles);

      console.log(`Compiling ${files.length} file(s)...`);

      const result = await spawnClaude(vault, prompt, "compiler", options.verbose, false);

      if (result.exitCode !== 0) {
        if (result.stderr) console.error(result.stderr);
        die(`compilation failed (exit code ${result.exitCode})`);
      }
    }
  } else {
    // Single-phase compile (backward compatible)
    await ensureCompilerAgent(vault, options.model);

    const prompt = buildPrompt(files, wikiArticles);

    console.log(`Compiling ${files.length} file(s)...`);

    const result = await spawnClaude(vault, prompt, "compiler", options.verbose, false);

    if (result.exitCode !== 0) {
      if (result.stderr) console.error(result.stderr);
      die(`compilation failed (exit code ${result.exitCode})`);
    }
  }

  console.log("Compilation complete.");

  // Update manifest with hashes for compiled files
  const updatedManifest = await updateManifest(vault, files, manifest);
  await saveManifest(vault, updatedManifest);

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

  const gitAdd = await runGit(vault, ["add", "--", ...changedPaths]);
  if (gitAdd.exitCode !== 0) {
    die(gitAdd.stderr.trim() || "git add failed");
  }

  const stagedDiff = await runGit(vault, [
    "diff",
    "--cached",
    "--quiet",
    "--",
    ...changedPaths,
  ]);

  if (stagedDiff.exitCode === 0) {
    console.log("No new compile changes to commit.");
    return;
  }
  if (stagedDiff.exitCode !== 1) {
    die(stagedDiff.stderr.trim() || "git diff failed");
  }

  const commitMsg = `wiki: compile ${files.length} source(s)`;
  const gitCommit = await runGit(vault, ["commit", "-m", commitMsg]);

  if (gitCommit.exitCode !== 0) {
    die(gitCommit.stderr.trim() || "git commit failed");
  }

  console.log(`Committed: ${commitMsg}`);

  if (!options.noPush) {
    const gitPush = await runGit(vault, ["push"]);
    if (gitPush.exitCode !== 0) {
      die(gitPush.stderr.trim() || "git push failed");
    }
    console.log("Pushed to remote.");
  }
}
