import { readFile, writeFile, access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { lstat } from "node:fs/promises";

export async function readTextFile(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export async function writeTextFile(
  path: string,
  content: string,
): Promise<void> {
  await writeFile(path, content, "utf8");
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Async generator that yields file paths matching a glob-like pattern.
 * Supports: "*.md", "**\/*.md", "prefix/**\/*.md".
 * Yields paths relative to cwd, using forward slashes.
 */
export async function* globFiles(
  pattern: string,
  cwd: string,
): AsyncGenerator<string> {
  if (!pattern.includes("**")) {
    // Non-recursive: "*.md" — scan root of cwd only
    const dotIdx = pattern.lastIndexOf(".");
    const suffix = dotIdx >= 0 ? pattern.slice(dotIdx) : null;
    if (!suffix) return;

    let entries: string[];
    try {
      entries = await readdir(cwd);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.endsWith(suffix)) {
        // Check if it's actually a file (not a directory ending in .md)
        const fullPath = join(cwd, entry);
        try {
          const stat = await lstat(fullPath);
          if (stat.isFile()) yield entry;
        } catch {
          // Skip entries we can't stat
        }
      }
    }
    return;
  }

  // Recursive: extract the static prefix before "**"
  // "wiki/**/*.md" → prefix="wiki", suffix=".md"
  // "**/*.md"      → prefix="",     suffix=".md"
  const starStarIdx = pattern.indexOf("**");
  const prefixPart = pattern.slice(0, starStarIdx).replace(/\/$/, "");
  const afterLastStar = pattern.slice(pattern.lastIndexOf("*") + 1);
  const suffix = afterLastStar.startsWith(".") ? afterLastStar : null;

  const scanDir = prefixPart ? join(cwd, prefixPart) : cwd;

  // Note: readdir with recursive: true returns strings (not Dirents)
  // regardless of withFileTypes setting in some Node versions
  let allEntries: string[];
  try {
    allEntries = (await readdir(scanDir, { recursive: true })) as string[];
  } catch {
    return;
  }

  for (const entry of allEntries) {
    const normalized = entry.replace(/\\/g, "/");
    if (!suffix || normalized.endsWith(suffix)) {
      // Filter out directories (entries ending in / on some systems)
      if (normalized.includes("/") || !suffix || normalized.endsWith(suffix)) {
        const relPath = prefixPart ? `${prefixPart}/${normalized}` : normalized;
        yield relPath;
      }
    }
  }
}
