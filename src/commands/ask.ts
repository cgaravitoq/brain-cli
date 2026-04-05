import { parseArgs } from "node:util";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Config } from "../types";
import { die } from "../errors";
import { slugify, formatDate } from "../utils";
import { buildFrontmatter } from "../frontmatter";
import { writeTextFile, fileExists } from "../fs";
import { spawnCapture } from "../spawn";
import { ensureAgent, type AgentDefinition } from "../agents";

const RESEARCHER_SYSTEM_PROMPT = `You are a researcher with read access to a Second Brain vault. Your job is to research questions by navigating the wiki and raw materials, then produce a comprehensive markdown answer.

## How to research

1. **Start at** \`wiki/indexes/INDEX.md\` to understand what exists
2. **Navigate** to relevant wiki articles via wikilinks
3. **Check** \`raw/\` if the question touches topics not yet in the wiki
4. **Read** 2-5 specific files depending on question scope
5. **Cross-reference** concepts across articles to find connections

## Vault structure

- \`wiki/\` — compiled, cross-referenced knowledge (primary source)
- \`raw/\` — unprocessed notes and articles (supplementary, may be more recent)

## Output format

Write your answer as a standalone markdown document. Output ONLY the markdown content (no frontmatter — the CLI adds that).

Your output must include:

1. A heading matching the question
2. Full prose answer (not bullet lists) using \`[[wikilinks]]\` to reference source articles
3. Tables, comparisons, code blocks where relevant
4. A "## Sources consulted" section listing every article you read, with a brief note on what you found there

## Rules

- Write prose, not bullet lists — this is a document, not a chat reply
- Use \`[[wikilinks]]\` to link back to source articles
- Be thorough but concise — substance over length
- If the vault doesn't contain enough information to fully answer the question, say so explicitly and answer with what's available
`;

export interface AskOptions {
  printOnly: boolean;
  stdout: boolean;
  model: string;
  verbose: boolean;
  dryRun: boolean;
}

export function parseAskArgs(args: string[]): { options: AskOptions; question: string } {
  const { values, positionals } = parseArgs({
    args,
    options: {
      print: { type: "boolean", short: "p", default: false },
      stdout: { type: "boolean", default: false },
      model: { type: "string", default: "sonnet" },
      verbose: { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const question = positionals.join(" ").trim();
  if (!question) {
    die("usage: brain ask <question>");
  }

  const stdoutMode = (values.stdout as boolean) ?? false;

  return {
    options: {
      printOnly: stdoutMode || ((values.print as boolean) ?? false),
      stdout: stdoutMode,
      model: (values.model as string) ?? "sonnet",
      verbose: stdoutMode ? false : ((values.verbose as boolean) ?? false),
      dryRun: (values["dry-run"] as boolean) ?? false,
    },
    question,
  };
}

const RESEARCHER_AGENT: AgentDefinition = {
  name: "researcher",
  systemPrompt: RESEARCHER_SYSTEM_PROMPT,
  tools: ["Read", "Glob", "Grep"],
};

export async function ensureResearcherAgent(vault: string, model: string): Promise<string> {
  return ensureAgent(vault, RESEARCHER_AGENT, model);
}

export function generateAskFilename(question: string, date = new Date()): string {
  const slug = slugify(question, 60);
  return `${formatDate(date)}-${slug}.md`;
}

export async function resolveAskOutputPath(
  outputDir: string,
  question: string,
  date = new Date(),
): Promise<{ filename: string; filePath: string }> {
  const baseFilename = generateAskFilename(question, date);
  const ext = ".md";
  const stem = baseFilename.slice(0, -ext.length);

  let filename = baseFilename;
  let filePath = join(outputDir, filename);
  let suffix = 2;

  while (await fileExists(filePath)) {
    filename = `${stem}-${suffix}${ext}`;
    filePath = join(outputDir, filename);
    suffix++;
  }

  return { filename, filePath };
}

export function buildAskFrontmatter(
  question: string,
  title: string,
  sources: string[],
  related: string[],
  date: Date,
): string {
  return buildFrontmatter({
    title,
    type: "ask",
    subject: { key: "question", value: question },
    created: date,
    sources: sources.length > 0 ? sources : undefined,
    related: related.length > 0 ? related : undefined,
  });
}

export function extractSources(body: string): string[] {
  const sourcesMatch = body.match(/## Sources consulted\n([\s\S]*?)(?:\n## |$)/i);
  if (!sourcesMatch) return [];
  const section = sourcesMatch[1]!;
  const links: string[] = [];
  const linkPattern = /\[\[([^\]]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = linkPattern.exec(section)) !== null) {
    links.push(`[[${m[1]}]]`);
  }
  return links;
}

/** Extract wikilinks from the body that aren't in the sources list (related articles) */
export function extractRelated(body: string, sources: string[]): string[] {
  const sourceSet = new Set(sources);
  const linkPattern = /\[\[([^\]]+)\]\]/g;

  // Strip the sources section to avoid double-counting
  const bodyWithoutSources = body.replace(/## Sources consulted\n[\s\S]*?(?:\n## |$)/i, "");

  const related: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = linkPattern.exec(bodyWithoutSources)) !== null) {
    const link = `[[${m[1]}]]`;
    if (!sourceSet.has(link) && !seen.has(link)) {
      related.push(link);
      seen.add(link);
    }
  }
  return related;
}

export function extractTitle(question: string): string {
  return question
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\?$/, "");
}

export function extractSummary(body: string, maxLength = 200): string {
  const lines = body.split("\n");
  let foundHeading = false;
  const paragraphLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("# ")) {
      foundHeading = true;
      continue;
    }
    if (foundHeading) {
      if (line.trim() === "" && paragraphLines.length > 0) break;
      if (line.trim() !== "") paragraphLines.push(line.trim());
    }
  }

  const paragraph = paragraphLines.join(" ");
  if (paragraph.length <= maxLength) return paragraph;
  return paragraph.slice(0, maxLength).replace(/\s+\S*$/, "") + "...";
}

/** Log to stderr, unless suppressed (--stdout mode) */
function log(silent: boolean, ...args: unknown[]): void {
  if (!silent) console.error(...args);
}

export async function run(args: string[], config: Config): Promise<void> {
  const { options, question } = parseAskArgs(args);
  const { vault } = config;
  const silent = options.stdout;

  if (options.dryRun) {
    const filename = generateAskFilename(question);
    console.log(`\n📝 Would create: output/asks/${filename}`);
    console.log(`   Question: ${question}`);
    return;
  }

  await ensureResearcherAgent(vault, options.model);

  log(silent, "Researching...\n");

  const claudeBin = process.env.BRAIN_CLAUDE_BIN || "claude";
  const claudeArgs = [
    claudeBin,
    "-p", question,
    "--agent", "researcher",
    "--permission-mode", "bypassPermissions",
  ];

  if (options.verbose) {
    console.error(`> ${claudeArgs.join(" ")}`);
  }

  let result: Awaited<ReturnType<typeof spawnCapture>>;
  try {
    result = await spawnCapture(claudeArgs, {
      cwd: vault,
      stdoutMode: "pipe",
      stderrMode: options.verbose ? "inherit" : "pipe",
    });
  } catch (err) {
    die(
      err instanceof Error && (err.message.includes("ENOENT") || err.message.includes("Executable not found"))
        ? "Claude CLI not found. Install `claude` and ensure it is in PATH."
        : `failed to start research agent: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const { stdout: output, stderr: stderrOutput, exitCode } = result;

  if (exitCode !== 0) {
    if (stderrOutput && !silent) console.error(stderrOutput);
    die(`research failed (exit code ${exitCode})`);
  }

  const body = output.trim();

  if (!body) {
    die("agent returned empty response");
  }

  // --stdout: raw markdown only, zero stderr, no file written
  if (options.stdout) {
    console.log(body);
    return;
  }

  // -p / --print: markdown to stdout, progress to stderr, no file written
  if (options.printOnly) {
    console.log(body);
    return;
  }

  // Default: write file + print summary
  const now = new Date();
  const title = extractTitle(question);
  const sources = extractSources(body);
  const related = extractRelated(body, sources);
  const frontmatter = buildAskFrontmatter(question, title, sources, related, now);
  const fileContent = `${frontmatter}\n\n${body}\n`;

  const outputDir = join(vault, "output", "asks");
  await mkdir(outputDir, { recursive: true });

  const { filename, filePath } = await resolveAskOutputPath(outputDir, question, now);
  await writeTextFile(filePath, fileContent);

  const sourceNames = sources.map((s) => s.replace(/^\[\[/, "").replace(/\]\]$/, ""));
  if (sourceNames.length > 0) {
    console.log(`Consulted ${sourceNames.length} article(s):`);
    for (const s of sourceNames) {
      console.log(`  • ${s}`);
    }
    console.log();
  }

  console.log(`Answer saved: output/asks/${filename}`);

  const summary = extractSummary(body);
  if (summary) {
    console.log(`\nSummary: ${summary}`);
  }
}
