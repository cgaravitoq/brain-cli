import { parseArgs } from "node:util";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Config } from "../types";
import { die } from "../errors";
import { slugify, formatDate } from "../utils";

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
  model: string;
  verbose: boolean;
}

export function parseAskArgs(args: string[]): { options: AskOptions; question: string } {
  const { values, positionals } = parseArgs({
    args,
    options: {
      print: { type: "boolean", short: "p", default: false },
      model: { type: "string", default: "sonnet" },
      verbose: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const question = positionals.join(" ").trim();
  if (!question) {
    die("usage: brain ask <question>");
  }

  return {
    options: {
      printOnly: (values.print as boolean) ?? false,
      model: (values.model as string) ?? "sonnet",
      verbose: (values.verbose as boolean) ?? false,
    },
    question,
  };
}

export async function ensureResearcherAgent(vault: string, model: string): Promise<string> {
  const agentDir = join(vault, ".claude", "agents");
  const agentPath = join(agentDir, "researcher.md");

  const content = `---
model: ${model}
tools:
  - Read
  - Glob
  - Grep
---

${RESEARCHER_SYSTEM_PROMPT}`;

  await mkdir(agentDir, { recursive: true });
  await Bun.write(agentPath, content);

  return agentPath;
}

export function generateAskFilename(question: string, date = new Date()): string {
  const slug = slugify(question, 60);
  return `${formatDate(date)}-${slug}.md`;
}

export function buildAskFrontmatter(
  question: string,
  title: string,
  sources: string[],
  date: Date,
): string {
  const esc = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const lines = ["---"];
  lines.push(`title: ${esc(title)}`);
  lines.push("type: ask");
  lines.push(`question: ${esc(question)}`);
  lines.push(`created: ${formatDate(date)}`);
  if (sources.length > 0) {
    lines.push("sources:");
    for (const s of sources) lines.push(`  - ${esc(s)}`);
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
  let match;
  while ((match = linkPattern.exec(section)) !== null) {
    links.push(`[[${match[1]}]]`);
  }
  return links;
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

export async function run(args: string[], config: Config): Promise<void> {
  const { options, question } = parseAskArgs(args);
  const { vault } = config;

  await ensureResearcherAgent(vault, options.model);

  console.log("Researching...\n");

  const claudeArgs = [
    "claude",
    "-p", question,
    "--agent", "researcher",
    "--permission-mode", "bypassPermissions",
  ];

  if (options.verbose) {
    console.error(`> ${claudeArgs.join(" ")}`);
  }

  const proc = Bun.spawn(claudeArgs, {
    stdout: "pipe",
    stderr: options.verbose ? "inherit" : "pipe",
    cwd: vault,
  });

  const [output, stderrOutput, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    if (stderrOutput) console.error(stderrOutput);
    die(`research failed (exit code ${exitCode})`);
  }

  const body = output.trim();

  if (!body) {
    die("agent returned empty response");
  }

  if (options.printOnly) {
    console.log(body);
    return;
  }

  const now = new Date();
  const title = extractTitle(question);
  const sources = extractSources(body);
  const frontmatter = buildAskFrontmatter(question, title, sources, now);
  const fileContent = `${frontmatter}\n\n${body}\n`;

  const outputDir = join(vault, "output", "asks");
  await mkdir(outputDir, { recursive: true });

  const filename = generateAskFilename(question, now);
  const filePath = join(outputDir, filename);
  await Bun.write(filePath, fileContent);

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
