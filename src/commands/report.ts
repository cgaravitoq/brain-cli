import { parseArgs } from "node:util";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Config } from "../types";
import { die } from "../errors";
import { slugify, formatDate } from "../utils";
import { writeTextFile, fileExists } from "../fs";
import { spawnCapture } from "../spawn";

const REPORTER_SYSTEM_PROMPT = `You are a report writer with read access to a Second Brain vault. Your job is to research a topic thoroughly and produce a long-form structured document (2000-5000 words).

## How to research

1. **Start at** \`wiki/indexes/INDEX.md\` to understand what exists
2. **Navigate** to relevant wiki articles via wikilinks
3. **Check** \`raw/\` if the topic touches areas not yet in the wiki
4. **Read** 5-15 specific files depending on topic scope
5. **Cross-reference** concepts across articles to find connections and patterns

## Vault structure

- \`wiki/\` — compiled, cross-referenced knowledge (primary source)
- \`raw/\` — unprocessed notes and articles (supplementary, may be more recent)

## Output format

Write your report as a standalone markdown document. Output ONLY the markdown content (no frontmatter — the CLI adds that).

Your output must include:

1. A heading matching the topic
2. A table of contents listing all major sections
3. An executive summary (1-2 paragraphs) providing the key takeaways
4. Detailed sections with headers covering all aspects of the topic
5. Use \`[[wikilinks]]\` to reference vault articles throughout
6. Tables, comparisons, code blocks, and diagrams where relevant
7. A "## Sources consulted" section listing every article you read, with a brief note on what you found there

## Rules

- Write prose, not bullet lists — this is a long-form document, not a chat reply
- Use \`[[wikilinks]]\` to link back to source articles
- Aim for 2000-5000 words — be thorough and comprehensive
- Structure with clear headers and sub-headers for readability
- If the vault doesn't contain enough information to fully cover the topic, say so explicitly and cover what's available
`;

export interface ReportOptions {
  printOnly: boolean;
  stdout: boolean;
  model: string;
  verbose: boolean;
}

export function parseReportArgs(args: string[]): { options: ReportOptions; topic: string } {
  const { values, positionals } = parseArgs({
    args,
    options: {
      print: { type: "boolean", short: "p", default: false },
      stdout: { type: "boolean", default: false },
      model: { type: "string", default: "sonnet" },
      verbose: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const topic = positionals.join(" ").trim();
  if (!topic) {
    die("usage: brain report <topic>");
  }

  const stdoutMode = (values.stdout as boolean) ?? false;

  return {
    options: {
      printOnly: stdoutMode || ((values.print as boolean) ?? false),
      stdout: stdoutMode,
      model: (values.model as string) ?? "sonnet",
      verbose: stdoutMode ? false : ((values.verbose as boolean) ?? false),
    },
    topic,
  };
}

export async function ensureReporterAgent(vault: string, model: string): Promise<string> {
  const agentDir = join(vault, ".claude", "agents");
  const agentPath = join(agentDir, "reporter.md");

  const content = `---
model: ${model}
tools:
  - Read
  - Glob
  - Grep
---

${REPORTER_SYSTEM_PROMPT}`;

  await mkdir(agentDir, { recursive: true });
  await writeTextFile(agentPath, content);

  return agentPath;
}

export function generateReportFilename(topic: string, date = new Date()): string {
  const slug = slugify(topic, 60);
  return `${formatDate(date)}-${slug}.md`;
}

export async function resolveReportOutputPath(
  outputDir: string,
  topic: string,
  date = new Date(),
): Promise<{ filename: string; filePath: string }> {
  const baseFilename = generateReportFilename(topic, date);
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

export function buildReportFrontmatter(
  topic: string,
  title: string,
  sources: string[],
  related: string[],
  date: Date,
): string {
  const esc = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const lines = ["---"];
  lines.push(`title: ${esc(title)}`);
  lines.push("type: report");
  lines.push(`topic: ${esc(topic)}`);
  lines.push(`created: ${formatDate(date)}`);
  if (sources.length > 0) {
    lines.push("sources:");
    for (const s of sources) lines.push(`  - ${esc(s)}`);
  }
  if (related.length > 0) {
    lines.push("related:");
    for (const r of related) lines.push(`  - ${esc(r)}`);
  }
  lines.push("---");
  return lines.join("\n");
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

export function extractTitle(topic: string): string {
  return topic
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
  const { options, topic } = parseReportArgs(args);
  const { vault } = config;
  const silent = options.stdout;

  await ensureReporterAgent(vault, options.model);

  log(silent, "Generating report...\n");

  const claudeBin = process.env.BRAIN_CLAUDE_BIN || "claude";
  const claudeArgs = [
    claudeBin,
    "-p", topic,
    "--agent", "reporter",
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
        : `failed to start report agent: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const { stdout: output, stderr: stderrOutput, exitCode } = result;

  if (exitCode !== 0) {
    if (stderrOutput && !silent) console.error(stderrOutput);
    die(`report generation failed (exit code ${exitCode})`);
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
  const title = extractTitle(topic);
  const sources = extractSources(body);
  const related = extractRelated(body, sources);
  const frontmatter = buildReportFrontmatter(topic, title, sources, related, now);
  const fileContent = `${frontmatter}\n\n${body}\n`;

  const outputDir = join(vault, "output", "reports");
  await mkdir(outputDir, { recursive: true });

  const { filename, filePath } = await resolveReportOutputPath(outputDir, topic, now);
  await writeTextFile(filePath, fileContent);

  const sourceNames = sources.map((s) => s.replace(/^\[\[/, "").replace(/\]\]$/, ""));
  if (sourceNames.length > 0) {
    console.log(`Consulted ${sourceNames.length} article(s):`);
    for (const s of sourceNames) {
      console.log(`  • ${s}`);
    }
    console.log();
  }

  console.log(`Report saved: output/reports/${filename}`);

  const summary = extractSummary(body);
  if (summary) {
    console.log(`\nSummary: ${summary}`);
  }
}
