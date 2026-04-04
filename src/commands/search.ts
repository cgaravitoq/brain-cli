import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Config } from "../types";
import { die } from "../errors";
import { stem } from "../search/stemmer";
import { parseFrontmatter } from "../frontmatter";

export async function run(args: string[], config: Config): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      tag: { type: "string" },
    },
    allowPositionals: true,
    strict: false,
  });

  const query = positionals.join(" ").trim();
  if (!query) {
    die("Usage: brain search <query>", 2);
  }

  const tagFilter: string[] | null =
    typeof values.tag === "string"
      ? values.tag
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 0)
      : null;

  const terms = query
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => t.toLowerCase());

  const glob = new Bun.Glob("**/*.md");
  let matchCount = 0;

  for await (const path of glob.scan({ cwd: config.vault })) {
    const fullPath = join(config.vault, path);
    const content = await Bun.file(fullPath).text();

    // Tag filtering: skip files that don't match any of the requested tags
    if (tagFilter) {
      const parsed = parseFrontmatter(content);
      if (!parsed) continue;
      const tagsRaw = parsed.frontmatter["tags"];
      if (!tagsRaw) continue;
      // Tags are stored as "[tag1, tag2]" — strip brackets, split on comma
      const fileTags = tagsRaw
        .replace(/^\[/, "")
        .replace(/\]$/, "")
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0);
      // OR semantics: file matches if it has ANY of the filter tags
      const hasMatch = tagFilter.some((ft) => fileTags.includes(ft));
      if (!hasMatch) continue;
    }

    const contentLower = content.toLowerCase();

    // AND semantics: every term must appear somewhere in the content
    const exactMatch = terms.every((term) => contentLower.includes(term));

    if (!exactMatch) {
      // Fallback: try stemmed matching — stem(query term) vs stem(content words)
      const contentWords = contentLower.split(/[^a-z]+/).filter((w) => w.length > 0);
      const stemmedContent = new Set(contentWords.map((w) => stem(w)));
      const stemmedMatch = terms.every((t) => stemmedContent.has(stem(t)));
      if (!stemmedMatch) continue;
    }

    matchCount++;
    console.log(path);

    // Find the best context line — prefer lines containing the most terms
    const lines = content.split("\n");
    const bestLine = pickBestLine(lines, terms, !exactMatch);
    if (bestLine) {
      const trimmed = bestLine.trim();
      const firstTerm = terms[0]!;
      if (terms.length === 1) {
        const display =
          trimmed.length > 80
            ? "   ..." + extractContext(trimmed, firstTerm, 70) + "..."
            : "   ..." + trimmed + "...";
        console.log(display);
      } else {
        const display =
          trimmed.length > 80
            ? "   ..." + extractContextMulti(trimmed, terms, 70) + "..."
            : "   ..." + trimmed + "...";
        console.log(display);
      }
    }
  }

  if (matchCount === 0) {
    console.log("No results found.");
  }
}

/** Pick the line containing the most search terms, skipping empty/frontmatter lines. */
function pickBestLine(
  lines: string[],
  terms: string[],
  useStemming = false,
): string | null {
  let best: string | null = null;
  let bestScore = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") continue;

    const lower = line.toLowerCase();
    let score: number;

    if (useStemming) {
      const lineWords = lower.split(/[^a-z]+/).filter((w) => w.length > 0);
      const stemmedLine = new Set(lineWords.map((w) => stem(w)));
      score = terms.filter(
        (t) => lower.includes(t) || stemmedLine.has(stem(t)),
      ).length;
    } else {
      score = terms.filter((t) => lower.includes(t)).length;
    }

    if (score > bestScore) {
      bestScore = score;
      best = line;
    }
  }

  return best;
}

function extractContext(line: string, query: string, maxLen: number): string {
  const idx = line.toLowerCase().indexOf(query);
  if (idx === -1) return line.slice(0, maxLen);

  const start = Math.max(0, idx - Math.floor((maxLen - query.length) / 2));
  const end = Math.min(line.length, start + maxLen);
  return line.slice(start, end);
}

/** Center the context window around the first matching term found. */
function extractContextMulti(
  line: string,
  terms: string[],
  maxLen: number,
): string {
  const lower = line.toLowerCase();
  // Find the first term that appears in this line
  for (const term of terms) {
    const idx = lower.indexOf(term);
    if (idx !== -1) {
      const start = Math.max(
        0,
        idx - Math.floor((maxLen - term.length) / 2),
      );
      const end = Math.min(line.length, start + maxLen);
      return line.slice(start, end);
    }
  }
  return line.slice(0, maxLen);
}
