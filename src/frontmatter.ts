import type { Frontmatter } from "./types";
import { formatDate } from "./utils";

function escapeYamlString(str: string): string {
  if (/[":{}[\],&*?|>!%#@`]/.test(str) || str.startsWith("'")) {
    return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return `"${str}"`;
}

/** Always-quoting escape for build*Frontmatter output */
function escapeQuotes(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Ordered key-value pair for frontmatter fields that must appear
 * before the standard title/type/created block (e.g. marp settings).
 */
export interface FrontmatterField {
  key: string;
  value: string | boolean | number;
}

export interface FrontmatterData {
  /** Fields emitted before title (e.g. marp: true, theme: default) */
  prefix?: FrontmatterField[];
  title: string;
  type: string;
  /** Optional field emitted right after type (e.g. question, topic) */
  subject?: { key: string; value: string };
  created: Date;
  sources?: string[];
  related?: string[];
}

/**
 * Build YAML frontmatter for output commands (ask, chart, report, slides).
 * Produces output identical to the per-command build*Frontmatter functions.
 */
export function buildFrontmatter(data: FrontmatterData): string {
  const lines: string[] = ["---"];

  if (data.prefix) {
    for (const { key, value } of data.prefix) {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push(`title: ${escapeQuotes(data.title)}`);
  lines.push(`type: ${data.type}`);

  if (data.subject) {
    lines.push(`${data.subject.key}: ${escapeQuotes(data.subject.value)}`);
  }

  lines.push(`created: ${formatDate(data.created)}`);

  if (data.sources && data.sources.length > 0) {
    lines.push("sources:");
    for (const s of data.sources) lines.push(`  - ${escapeQuotes(s)}`);
  }

  if (data.related && data.related.length > 0) {
    lines.push("related:");
    for (const r of data.related) lines.push(`  - ${escapeQuotes(r)}`);
  }

  lines.push("---");
  return lines.join("\n");
}

export function generateFrontmatter(fm: Frontmatter): string {
  const lines: string[] = ["---"];
  lines.push(`title: ${escapeYamlString(fm.title)}`);
  lines.push(`created: ${fm.created}`);
  lines.push(`tags: [${fm.tags.join(", ")}]`);
  if (fm.source) {
    lines.push(`source: ${escapeYamlString(fm.source)}`);
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * Update or add key-value pairs in raw frontmatter without destroying
 * multi-line YAML structures (arrays, etc). Works on the raw string.
 */
export function updateRawFrontmatter(
  content: string,
  updates: Record<string, string>,
): string {
  const match = content.match(/^---\n([\s\S]*?)\n---(\n[\s\S]*)?$/);
  if (!match) {
    const lines = ["---"];
    for (const [key, value] of Object.entries(updates)) {
      lines.push(`${key}: ${value}`);
    }
    lines.push("---");
    return lines.join("\n") + "\n" + content;
  }

  let yaml = match[1]!;
  const rest = match[2] ?? "";

  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}:.*$`, "m");
    if (regex.test(yaml)) {
      yaml = yaml.replace(regex, `${key}: ${value}`);
    } else {
      yaml += `\n${key}: ${value}`;
    }
  }

  return `---\n${yaml}\n---${rest}`;
}

export function parseFrontmatter(
  content: string,
): { frontmatter: Record<string, string>; body: string } | null {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;

  const raw = match[1]!;
  const body = match[2] ?? "";
  const frontmatter: Record<string, string> = {};

  for (const line of raw.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }

  return { frontmatter, body: body.trimStart() ?? "" };
}
