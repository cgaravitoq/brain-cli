import { parseArgs } from "node:util";
import { join, basename } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Config } from "../types";
import { die } from "../errors";
import { slugify, formatDate } from "../utils";
import { extractSources, extractRelated, extractTitle } from "./ask";

const CHARTIST_SYSTEM_PROMPT = `You are a data visualization specialist with read access to a Second Brain vault. Your job is to research the vault and produce a chart specification as structured JSON.

## How to research

1. **Start at** \`wiki/indexes/INDEX.md\` to understand what exists
2. **Navigate** to relevant wiki articles via wikilinks
3. **Check** \`raw/\` if the question touches topics not yet in the wiki
4. **Read** 2-5 specific files depending on question scope
5. **Extract** quantitative data, comparisons, or categorical information suitable for charting

## Vault structure

- \`wiki/\` — compiled, cross-referenced knowledge (primary source)
- \`raw/\` — unprocessed notes and articles (supplementary, may be more recent)

## Output format

Output ONLY valid JSON (no markdown fences, no extra text) with this exact schema:

{
  "title": "Chart Title",
  "chart_type": "bar|line|pie|scatter",
  "python_code": "...matplotlib code that saves to sys.argv[1]...",
  "data_table": "| Col1 | Col2 |\\n|---|---|\\n| ... | ... |",
  "sources": "## Sources consulted\\n- [[article]] — note"
}

The python_code MUST:
- Import matplotlib.pyplot as plt and sys
- Save the figure to sys.argv[1] (the output PNG path)
- Call plt.tight_layout() before saving
- NOT call plt.show()

## Rules

- Output ONLY the JSON object — no markdown fences, no explanatory text
- Choose the chart type that best represents the data
- Include a descriptive title
- The data_table should be a markdown table summarizing the data
- The sources field should list every article you consulted using [[wikilinks]]
- If the vault doesn't contain enough data, say so in the title and provide what's available
`;

export interface ChartOptions {
  printOnly: boolean;
  stdout: boolean;
  model: string;
  verbose: boolean;
}

type SubprocessStream = ReturnType<typeof Bun.spawn>["stdout"];

function readStream(stream: SubprocessStream | undefined): Promise<string> {
  if (!stream || typeof stream === "number") {
    return Promise.resolve("");
  }

  return new Response(stream).text();
}

export interface ChartJson {
  title: string;
  chart_type: string;
  python_code: string;
  data_table: string;
  sources: string;
}

export function parseChartArgs(args: string[]): { options: ChartOptions; question: string } {
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

  const question = positionals.join(" ").trim();
  if (!question) {
    die("usage: brain chart <query>");
  }

  const stdoutMode = (values.stdout as boolean) ?? false;

  return {
    options: {
      printOnly: stdoutMode || ((values.print as boolean) ?? false),
      stdout: stdoutMode,
      model: (values.model as string) ?? "sonnet",
      verbose: stdoutMode ? false : ((values.verbose as boolean) ?? false),
    },
    question,
  };
}

export async function ensureChartistAgent(vault: string, model: string): Promise<string> {
  const agentDir = join(vault, ".claude", "agents");
  const agentPath = join(agentDir, "chartist.md");

  const content = `---
model: ${model}
tools:
  - Read
  - Glob
  - Grep
---

${CHARTIST_SYSTEM_PROMPT}`;

  await mkdir(agentDir, { recursive: true });
  await Bun.write(agentPath, content);

  return agentPath;
}

export function generateChartFilename(question: string, date = new Date()): string {
  const slug = slugify(question, 60);
  return `${formatDate(date)}-${slug}`;
}

export async function resolveChartOutputPath(
  outputDir: string,
  question: string,
  date = new Date(),
): Promise<{ stem: string; mdPath: string; pngPath: string }> {
  const baseStem = generateChartFilename(question, date);

  let stem = baseStem;
  let mdPath = join(outputDir, `${stem}.md`);
  let pngPath = join(outputDir, `${stem}.png`);
  let suffix = 2;

  while ((await Bun.file(mdPath).exists()) || (await Bun.file(pngPath).exists())) {
    stem = `${baseStem}-${suffix}`;
    mdPath = join(outputDir, `${stem}.md`);
    pngPath = join(outputDir, `${stem}.png`);
    suffix++;
  }

  return { stem, mdPath, pngPath };
}

export function buildChartFrontmatter(
  question: string,
  title: string,
  sources: string[],
  related: string[],
  date: Date,
): string {
  const esc = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  const lines = ["---"];
  lines.push(`title: ${esc(title)}`);
  lines.push("type: chart");
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

export function buildMarkdownWrapper(
  pngFilename: string,
  title: string,
  dataTable: string,
  sourcesText: string,
): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`![[${pngFilename}]]`);
  lines.push("");
  if (dataTable) {
    lines.push("## Data");
    lines.push("");
    lines.push(dataTable);
    lines.push("");
  }
  if (sourcesText) {
    lines.push(sourcesText);
    lines.push("");
  }
  return lines.join("\n");
}

export function parseChartJson(raw: string): ChartJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    die("chart agent returned invalid JSON");
  }

  const obj = parsed as Record<string, unknown>;

  const requiredFields = ["title", "chart_type", "python_code", "data_table", "sources"];
  for (const field of requiredFields) {
    if (typeof obj[field] !== "string") {
      die("chart agent response missing required fields");
    }
  }

  return obj as unknown as ChartJson;
}

/** Log to stderr, unless suppressed (--stdout mode) */
function log(silent: boolean, ...args: unknown[]): void {
  if (!silent) console.error(...args);
}

export async function run(args: string[], config: Config): Promise<void> {
  const { options, question } = parseChartArgs(args);
  const { vault } = config;
  const silent = options.stdout;

  // Check matplotlib availability
  const check = Bun.spawnSync(["python3", "-c", "import matplotlib"]);
  if (check.exitCode !== 0) {
    die("matplotlib is required for chart generation. Install with: pip3 install matplotlib");
  }

  await ensureChartistAgent(vault, options.model);

  log(silent, "Generating chart...\n");

  const claudeBin = process.env.BRAIN_CLAUDE_BIN || "claude";
  const claudeArgs = [
    claudeBin,
    "-p", question,
    "--agent", "chartist",
    "--permission-mode", "bypassPermissions",
  ];

  if (options.verbose) {
    console.error(`> ${claudeArgs.join(" ")}`);
  }

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(claudeArgs, {
      stdout: "pipe",
      stderr: options.verbose ? "inherit" : "pipe",
      cwd: vault,
    });
  } catch (err) {
    die(
      err instanceof Error && err.message.includes("Executable not found")
        ? "Claude CLI not found. Install `claude` and ensure it is in PATH."
        : `failed to start chart agent: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const [output, stderrOutput, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    if (stderrOutput && !silent) console.error(stderrOutput);
    die(`chart generation failed (exit code ${exitCode})`);
  }

  const rawJson = output.trim();

  if (!rawJson) {
    die("agent returned empty response");
  }

  // Parse the JSON specification
  const chartSpec = parseChartJson(rawJson);

  // Extract sources and related from the sources text
  const sources = extractSources(chartSpec.sources);
  const related = extractRelated(chartSpec.sources, sources);
  const title = chartSpec.title || extractTitle(question);

  // --stdout: raw markdown only, zero stderr, no file written
  if (options.stdout) {
    const wrapper = buildMarkdownWrapper(
      "chart.png",
      title,
      chartSpec.data_table,
      chartSpec.sources,
    );
    console.log(wrapper);
    return;
  }

  // -p / --print: markdown to stdout, progress to stderr, no file written
  if (options.printOnly) {
    const wrapper = buildMarkdownWrapper(
      "chart.png",
      title,
      chartSpec.data_table,
      chartSpec.sources,
    );
    console.log(wrapper);
    return;
  }

  // Default: generate PNG and write files
  const now = new Date();
  const outputDir = join(vault, "output", "charts");
  await mkdir(outputDir, { recursive: true });

  const { stem, mdPath, pngPath } = await resolveChartOutputPath(outputDir, question, now);

  // Write python code to temp file and execute
  const tmpPy = join(outputDir, `${stem}-tmp.py`);
  await Bun.write(tmpPy, chartSpec.python_code);

  const pyProc = Bun.spawnSync(["python3", tmpPy, pngPath]);

  // Clean up temp python file
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(tmpPy);
  } catch {
    // ignore cleanup errors
  }

  if (pyProc.exitCode !== 0) {
    const pyStderr = pyProc.stderr ? new TextDecoder().decode(pyProc.stderr) : "";
    die(`chart generation failed: ${pyStderr}`);
  }

  // Verify PNG was created
  if (!(await Bun.file(pngPath).exists())) {
    die("chart generation did not produce an image");
  }

  // Build and write markdown wrapper
  const pngFilename = basename(pngPath);
  const frontmatter = buildChartFrontmatter(question, title, sources, related, now);
  const body = buildMarkdownWrapper(pngFilename, title, chartSpec.data_table, chartSpec.sources);
  const fileContent = `${frontmatter}\n\n${body}`;
  await Bun.write(mdPath, fileContent);

  const sourceNames = sources.map((s) => s.replace(/^\[\[/, "").replace(/\]\]$/, ""));
  if (sourceNames.length > 0) {
    console.log(`Consulted ${sourceNames.length} article(s):`);
    for (const s of sourceNames) {
      console.log(`  • ${s}`);
    }
    console.log();
  }

  console.log(`Chart saved: output/charts/${basename(mdPath)}`);
  console.log(`Image saved: output/charts/${pngFilename}`);
}
