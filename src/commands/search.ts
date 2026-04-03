import { join } from "node:path";
import type { Config } from "../types";
import { die } from "../errors";

export async function run(args: string[], config: Config): Promise<void> {
  const query = args.join(" ").trim();
  if (!query) {
    die("Usage: brain search <query>", 2);
  }

  const glob = new Bun.Glob("**/*.md");
  const queryLower = query.toLowerCase();
  let matchCount = 0;

  for await (const path of glob.scan({ cwd: config.vault })) {
    const fullPath = join(config.vault, path);
    const content = await Bun.file(fullPath).text();

    if (!content.toLowerCase().includes(queryLower)) continue;

    matchCount++;
    console.log(path);

    // Find and display matching lines
    const lines = content.split("\n");
    for (const line of lines) {
      if (line.toLowerCase().includes(queryLower)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "---") continue;
        const display =
          trimmed.length > 80
            ? "   ..." + extractContext(trimmed, queryLower, 70) + "..."
            : "   ..." + trimmed + "...";
        console.log(display);
        break; // Show first match per file
      }
    }
  }

  if (matchCount === 0) {
    console.log("No results found.");
  }
}

function extractContext(line: string, query: string, maxLen: number): string {
  const idx = line.toLowerCase().indexOf(query);
  if (idx === -1) return line.slice(0, maxLen);

  const start = Math.max(0, idx - Math.floor((maxLen - query.length) / 2));
  const end = Math.min(line.length, start + maxLen);
  return line.slice(start, end);
}
