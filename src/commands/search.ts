import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Config } from "../types";
import { die } from "../errors";
import { stem } from "../search/stemmer";
import { parseFrontmatter } from "../frontmatter";
import { readTextFile, globFiles } from "../fs";

export interface SearchResult {
  path: string;
  score: number;
  contextLine: string | null;
}

/** Parse frontmatter tags string like "[foo, bar]" into a lowercase array. */
function parseTags(raw: string): string[] {
  const stripped = raw.replace(/^\[/, "").replace(/\]$/, "");
  return stripped
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
}

/**
 * Search the vault for files matching a query string.
 * Returns results sorted by relevance score (descending).
 */
export async function searchVault(
  vault: string,
  query: string,
  tagFilter?: string[] | null,
): Promise<SearchResult[]> {
  const terms = query
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => t.toLowerCase());

  if (terms.length === 0) return [];

  const results: SearchResult[] = [];

  for await (const path of globFiles("**/*.md", vault)) {
    const fullPath = join(vault, path);
    const content = await readTextFile(fullPath);

    // Tag filtering: when --tag is active, skip files that don't match
    if (tagFilter) {
      const parsed = parseFrontmatter(content);
      if (!parsed?.frontmatter.tags) continue;
      const fileTags = parseTags(parsed.frontmatter.tags);
      const hasMatch = tagFilter.some((ft) => fileTags.includes(ft));
      if (!hasMatch) continue;
    }

    // Parse frontmatter once for AND-matching and scoring
    const parsed = parseFrontmatter(content);
    const body = parsed?.body ?? content;
    const title = parsed?.frontmatter.title ?? "";
    const tags = parsed?.frontmatter.tags ?? "";
    const aliases = parsed?.frontmatter.aliases ?? "";

    // Build searchable text from body + structured frontmatter fields only
    // This prevents false positives from YAML keys like "title:", "tags:", etc.
    const searchableText = [body, title, tags, aliases]
      .join("\n")
      .toLowerCase();

    // AND semantics: every term must appear somewhere in the searchable text
    const exactMatch = terms.every((term) => searchableText.includes(term));

    if (!exactMatch) {
      // Fallback: try stemmed matching — stem(query term) vs stem(searchable words)
      const searchableWords = searchableText.split(/[^a-z]+/).filter((w) => w.length > 0);
      const stemmedContent = new Set(searchableWords.map((w) => stem(w)));
      const stemmedMatch = terms.every((t) => stemmedContent.has(stem(t)));
      if (!stemmedMatch) continue;
    }

    // Compute relevance score
    let score = 0;

    // Title match: +10 if any term appears in frontmatter title
    if (title) {
      const titleLower = title.toLowerCase();
      if (terms.some((t) => titleLower.includes(t))) {
        score += 10;
      }
    }

    // Alias match: +8 per alias that contains any search term
    if (aliases) {
      const parsedAliases = parseTags(aliases);
      for (const alias of parsedAliases) {
        if (terms.some((t) => alias.includes(t))) {
          score += 8;
        }
      }
    }

    // Tag match: +5 if any term appears in frontmatter tags
    if (tags) {
      const tagsLower = tags.toLowerCase();
      if (terms.some((t) => tagsLower.includes(t))) {
        score += 5;
      }
    }

    // Wiki location: +3 if file is in wiki/ directory
    if (path.startsWith("wiki/")) {
      score += 3;
    }

    // Body occurrences: +1 each, capped at 5 (uses body only, not raw frontmatter)
    const bodyLower = body.toLowerCase();
    let bodyOccurrences = 0;
    for (const term of terms) {
      let idx = 0;
      while (idx < bodyLower.length) {
        const found = bodyLower.indexOf(term, idx);
        if (found === -1) break;
        bodyOccurrences++;
        idx = found + term.length;
      }
    }
    score += Math.min(bodyOccurrences, 5);

    // Find the best context line — prefer lines containing the most terms
    const lines = content.split("\n");
    const bestLine = pickBestLine(lines, terms, !exactMatch);

    results.push({ path, score, contextLine: bestLine });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results;
}

export async function run(args: string[], config: Config): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      tag: { type: "string" },
    },
    strict: false,
    allowPositionals: true,
  });

  const query = positionals.join(" ").trim();
  if (!query) {
    die("Usage: brain search <query>", 2);
  }

  const tagFilter =
    typeof values.tag === "string"
      ? values.tag
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 0)
      : null;

  const results = await searchVault(config.vault, query, tagFilter);

  if (results.length === 0) {
    console.log("No results found.");
    return;
  }

  const terms = query
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => t.toLowerCase());

  for (const result of results) {
    console.log(result.path);

    if (result.contextLine) {
      const trimmed = result.contextLine.trim();
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
