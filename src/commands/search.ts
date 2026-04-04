import { join } from "node:path";
import type { Config } from "../types";
import { die } from "../errors";

export async function run(args: string[], config: Config): Promise<void> {
  const query = args.join(" ").trim();
  if (!query) {
    die("Usage: brain search <query>", 2);
  }

  const terms = query
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => t.toLowerCase());

  const glob = new Bun.Glob("**/*.md");
  let matchCount = 0;

  for await (const path of glob.scan({ cwd: config.vault })) {
    const fullPath = join(config.vault, path);
    const content = await Bun.file(fullPath).text();
    const contentLower = content.toLowerCase();

    // AND semantics: every term must appear somewhere in the content
    if (!terms.every((term) => contentLower.includes(term))) continue;

    matchCount++;
    console.log(path);

    // Find the best context line — prefer lines containing the most terms
    const lines = content.split("\n");
    const bestLine = pickBestLine(lines, terms);
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
function pickBestLine(lines: string[], terms: string[]): string | null {
  let best: string | null = null;
  let bestScore = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") continue;

    const lower = line.toLowerCase();
    const score = terms.filter((t) => lower.includes(t)).length;
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
