import type { Frontmatter } from "./types";

function escapeYamlString(str: string): string {
  if (/[":{}[\],&*?|>!%#@`]/.test(str) || str.startsWith("'")) {
    return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return `"${str}"`;
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
