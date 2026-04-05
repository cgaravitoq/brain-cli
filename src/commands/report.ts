import { parseArgs } from "node:util";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Config } from "../types";
import { die } from "../errors";
import { buildFrontmatter } from "../frontmatter";
import { writeTextFile } from "../fs";
import { ensureAgent, type AgentDefinition } from "../agents";
import {
  extractSources,
  extractRelated,
  extractTitle,
  extractSummary,
  log,
  generateAgentFilename,
  resolveAgentOutputPath,
  spawnClaude,
} from "./shared";

export { extractSources, extractRelated, extractTitle, extractSummary } from "./shared";

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
  dryRun: boolean;
}

export function parseReportArgs(args: string[]): { options: ReportOptions; topic: string } {
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
      dryRun: (values["dry-run"] as boolean) ?? false,
    },
    topic,
  };
}

const REPORTER_AGENT: AgentDefinition = {
  name: "reporter",
  systemPrompt: REPORTER_SYSTEM_PROMPT,
  tools: ["Read", "Glob", "Grep"],
};

export async function ensureReporterAgent(vault: string, model: string): Promise<string> {
  return ensureAgent(vault, REPORTER_AGENT, model);
}

export function generateReportFilename(topic: string, date = new Date()): string {
  return generateAgentFilename(topic, date);
}

export async function resolveReportOutputPath(
  outputDir: string,
  topic: string,
  date = new Date(),
): Promise<{ filename: string; filePath: string }> {
  return resolveAgentOutputPath(outputDir, topic, date);
}

export function buildReportFrontmatter(
  topic: string,
  title: string,
  sources: string[],
  related: string[],
  date: Date,
): string {
  return buildFrontmatter({
    title,
    type: "report",
    subject: { key: "topic", value: topic },
    created: date,
    sources: sources.length > 0 ? sources : undefined,
    related: related.length > 0 ? related : undefined,
  });
}

export async function run(args: string[], config: Config): Promise<void> {
  const { options, topic } = parseReportArgs(args);
  const { vault } = config;
  const silent = options.stdout;

  if (options.dryRun) {
    const filename = generateReportFilename(topic);
    console.log(`\n📄 Would create: output/reports/${filename}`);
    console.log(`   Topic: ${topic}`);
    return;
  }

  await ensureReporterAgent(vault, options.model);

  log(silent, "Generating report...\n");

  const body = await spawnClaude({
    vault,
    prompt: topic,
    agentName: "reporter",
    verbose: options.verbose,
    silent,
    commandLabel: "report generation",
  });

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
