import { join } from "node:path";
import { die } from "../errors";
import { slugify, formatDate } from "../utils";
import { fileExists } from "../fs";
import { spawnCapture } from "../spawn";

/**
 * Extract [[wikilinks]] from a "## Sources consulted" section.
 */
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

/**
 * Title-case the input and strip trailing question marks.
 */
export function extractTitle(input: string): string {
  return input
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\?$/, "");
}

/**
 * Extract the first paragraph after the first `# ` heading as a summary.
 */
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
export function log(silent: boolean, ...args: unknown[]): void {
  if (!silent) console.error(...args);
}

/**
 * Generate a dated filename: YYYY-MM-DD-slug.md
 */
export function generateAgentFilename(input: string, date = new Date()): string {
  const slug = slugify(input, 60);
  return `${formatDate(date)}-${slug}.md`;
}

/**
 * Resolve a unique output path, appending -2, -3, etc. if the file already exists.
 */
export async function resolveAgentOutputPath(
  outputDir: string,
  input: string,
  date = new Date(),
): Promise<{ filename: string; filePath: string }> {
  const baseFilename = generateAgentFilename(input, date);
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

export interface SpawnClaudeOptions {
  vault: string;
  prompt: string;
  agentName: string;
  verbose: boolean;
  silent: boolean;
  commandLabel: string;
}

/**
 * Spawn the Claude CLI with the given agent and prompt, returning the trimmed stdout.
 * Handles ENOENT detection, non-zero exit codes, and empty responses.
 */
export async function spawnClaude(opts: SpawnClaudeOptions): Promise<string> {
  const { vault, prompt, agentName, verbose, silent, commandLabel } = opts;

  const claudeBin = process.env.BRAIN_CLAUDE_BIN || "claude";
  const claudeArgs = [
    claudeBin,
    "-p", prompt,
    "--agent", agentName,
    "--permission-mode", "bypassPermissions",
  ];

  if (verbose) {
    console.error(`> ${claudeArgs.join(" ")}`);
  }

  let result: Awaited<ReturnType<typeof spawnCapture>>;
  try {
    result = await spawnCapture(claudeArgs, {
      cwd: vault,
      stdoutMode: "pipe",
      stderrMode: verbose ? "inherit" : "pipe",
    });
  } catch (err) {
    die(
      err instanceof Error && (err.message.includes("ENOENT") || err.message.includes("Executable not found"))
        ? "Claude CLI not found. Install `claude` and ensure it is in PATH."
        : `failed to start ${commandLabel} agent: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const { stdout: output, stderr: stderrOutput, exitCode } = result;

  if (exitCode !== 0) {
    if (stderrOutput && !silent) console.error(stderrOutput);
    die(`${commandLabel} failed (exit code ${exitCode})`);
  }

  const body = output.trim();

  if (!body) {
    die("agent returned empty response");
  }

  return body;
}
