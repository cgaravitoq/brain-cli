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
  return generateAgentFilename(question, date);
}

export async function resolveAskOutputPath(
  outputDir: string,
  question: string,
  date = new Date(),
): Promise<{ filename: string; filePath: string }> {
  return resolveAgentOutputPath(outputDir, question, date);
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

  const body = await spawnClaude({
    vault,
    prompt: question,
    agentName: "researcher",
    verbose: options.verbose,
    silent,
    commandLabel: "research",
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
