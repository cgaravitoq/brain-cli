import { parseArgs } from "node:util";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Config } from "../types";
import { die } from "../errors";
import { slugify, formatDate } from "../utils";
import { extractSources, extractRelated, extractTitle, extractSummary } from "./ask";
import { writeTextFile, fileExists } from "../fs";
import { spawnCapture } from "../spawn";
import { ensureAgent, type AgentDefinition } from "../agents";

const PRESENTER_SYSTEM_PROMPT = `You are a presenter with read access to a Second Brain vault. Your job is to research a topic and produce a Marp-format markdown slide deck.

## How to research

1. **Start at** \`wiki/indexes/INDEX.md\` to understand what exists
2. **Navigate** to relevant wiki articles via wikilinks
3. **Check** \`raw/\` if the topic touches areas not yet in the wiki
4. **Read** 2-5 specific files depending on topic scope
5. **Cross-reference** concepts across articles to find connections

## Vault structure

- \`wiki/\` — compiled, cross-referenced knowledge (primary source)
- \`raw/\` — unprocessed notes and articles (supplementary, may be more recent)

## Output format

Create a Marp-format markdown slide deck. Output ONLY the slide content (no frontmatter — the CLI adds that).

Requirements:
- The first slide must be a title slide
- Use \`---\` as the separator between slides
- Each slide should have 3-5 bullet points
- The last slide must be "Sources consulted" with \`[[wikilinks]]\` to every article you read
- Use \`[[wikilinks]]\` throughout the slides to reference vault articles
- Target slide count: {SLIDE_COUNT} slides (including title and sources slides)

## Rules

- Keep slides concise — bullet points, not paragraphs
- Use \`[[wikilinks]]\` to link back to source articles
- Be thorough but concise — substance over length
- If the vault doesn't contain enough information, say so explicitly and present what's available
`;

export interface SlidesOptions {
  printOnly: boolean;
  stdout: boolean;
  model: string;
  verbose: boolean;
  count: number;
}

export function parseSlidesArgs(args: string[]): { options: SlidesOptions; question: string } {
  const { values, positionals } = parseArgs({
    args,
    options: {
      print: { type: "boolean", short: "p", default: false },
      stdout: { type: "boolean", default: false },
      model: { type: "string", default: "sonnet" },
      verbose: { type: "boolean", default: false },
      count: { type: "string", default: "10" },
    },
    allowPositionals: true,
    strict: false,
  });

  const question = positionals.join(" ").trim();
  if (!question) {
    die("usage: brain slides <topic>");
  }

  const stdoutMode = (values.stdout as boolean) ?? false;
  const countStr = (values.count as string) ?? "10";
  const count = parseInt(countStr, 10);
  if (isNaN(count) || count < 1) {
    die("--count must be a positive integer");
  }

  return {
    options: {
      printOnly: stdoutMode || ((values.print as boolean) ?? false),
      stdout: stdoutMode,
      model: (values.model as string) ?? "sonnet",
      verbose: stdoutMode ? false : ((values.verbose as boolean) ?? false),
      count,
    },
    question,
  };
}

const PRESENTER_AGENT: AgentDefinition = {
  name: "presenter",
  systemPrompt: PRESENTER_SYSTEM_PROMPT,
  tools: ["Read", "Glob", "Grep"],
};

export async function ensurePresenterAgent(vault: string, model: string): Promise<string> {
  return ensureAgent(vault, PRESENTER_AGENT, model);
}

export function generateSlidesFilename(question: string, date = new Date()): string {
  const slug = slugify(question, 60);
  return `${formatDate(date)}-${slug}.md`;
}

export async function resolveSlidesOutputPath(
  outputDir: string,
  question: string,
  date = new Date(),
): Promise<{ filename: string; filePath: string }> {
  const baseFilename = generateSlidesFilename(question, date);
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

export function buildSlidesFrontmatter(
  question: string,
  title: string,
  sources: string[],
  related: string[],
  date: Date,
): string {
  const esc = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const lines = ["---"];
  lines.push("marp: true");
  lines.push("theme: default");
  lines.push("paginate: true");
  lines.push(`title: ${esc(title)}`);
  lines.push("type: slides");
  lines.push(`question: ${esc(question)}`);
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

/** Log to stderr, unless suppressed (--stdout mode) */
function log(silent: boolean, ...args: unknown[]): void {
  if (!silent) console.error(...args);
}

export async function run(args: string[], config: Config): Promise<void> {
  const { options, question } = parseSlidesArgs(args);
  const { vault } = config;
  const silent = options.stdout;

  await ensurePresenterAgent(vault, options.model);

  log(silent, "Generating slides...\n");

  const systemPrompt = PRESENTER_SYSTEM_PROMPT.replace("{SLIDE_COUNT}", String(options.count));

  const claudeBin = process.env.BRAIN_CLAUDE_BIN || "claude";
  const prompt = `${question}\n\nTarget slide count: ${options.count}`;
  const claudeArgs = [
    claudeBin,
    "-p", prompt,
    "--agent", "presenter",
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
        : `failed to start presenter agent: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const { stdout: output, stderr: stderrOutput, exitCode } = result;

  if (exitCode !== 0) {
    if (stderrOutput && !silent) console.error(stderrOutput);
    die(`slide generation failed (exit code ${exitCode})`);
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
  const frontmatter = buildSlidesFrontmatter(question, title, sources, related, now);
  const fileContent = `${frontmatter}\n\n${body}\n`;

  const outputDir = join(vault, "output", "slides");
  await mkdir(outputDir, { recursive: true });

  const { filename, filePath } = await resolveSlidesOutputPath(outputDir, question, now);
  await writeTextFile(filePath, fileContent);

  const sourceNames = sources.map((s) => s.replace(/^\[\[/, "").replace(/\]\]$/, ""));
  if (sourceNames.length > 0) {
    console.log(`Consulted ${sourceNames.length} article(s):`);
    for (const s of sourceNames) {
      console.log(`  • ${s}`);
    }
    console.log();
  }

  console.log(`Slides saved: output/slides/${filename}`);

  const summary = extractSummary(body);
  if (summary) {
    console.log(`\nSummary: ${summary}`);
  }
}
