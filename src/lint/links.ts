import { join } from "node:path";
import { parseFrontmatter } from "../frontmatter";

export interface LinkIssue {
  file: string; // relative path
  link: string; // the wikilink target text
  line: number; // 1-based line number
}

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

/**
 * Build a set of known link targets from all .md files in the vault.
 * Includes: filename without extension (lowercased), frontmatter title (lowercased),
 * and any aliases (lowercased).
 */
async function buildTargetSet(vault: string): Promise<Set<string>> {
  const targets = new Set<string>();
  const glob = new Bun.Glob("**/*.md");

  for await (const path of glob.scan({ cwd: vault })) {
    // Add filename without extension
    const basename = path.split("/").pop()!;
    const stem = basename.replace(/\.md$/, "").toLowerCase();
    targets.add(stem);

    // Parse frontmatter for title and aliases
    const content = await Bun.file(join(vault, path)).text();
    const parsed = parseFrontmatter(content);
    if (parsed) {
      if (parsed.frontmatter.title) {
        targets.add(parsed.frontmatter.title.toLowerCase());
      }
      if (parsed.frontmatter.aliases) {
        const raw = parsed.frontmatter.aliases;
        // Handle [a, b] format
        const stripped = raw.replace(/^\[/, "").replace(/\]$/, "");
        for (const alias of stripped.split(",")) {
          const trimmed = alias.trim();
          if (trimmed.length > 0) {
            targets.add(trimmed.toLowerCase());
          }
        }
      }
    }
  }

  return targets;
}

export async function checkLinks(vault: string): Promise<LinkIssue[]> {
  const targets = await buildTargetSet(vault);
  const issues: LinkIssue[] = [];
  const glob = new Bun.Glob("**/*.md");

  for await (const path of glob.scan({ cwd: vault })) {
    const content = await Bun.file(join(vault, path)).text();
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      let match: RegExpExecArray | null;
      WIKILINK_RE.lastIndex = 0;

      while ((match = WIKILINK_RE.exec(line)) !== null) {
        const target = match[1]!.toLowerCase();
        if (!targets.has(target)) {
          issues.push({
            file: path,
            link: match[1]!,
            line: i + 1,
          });
        }
      }
    }
  }

  return issues;
}

/**
 * Fix broken wikilinks by removing the link syntax but keeping the display text.
 * [[broken link]] -> broken link
 * [[broken|display]] -> display
 */
export async function fixBrokenLinks(
  vault: string,
  issues: LinkIssue[],
): Promise<number> {
  // Group issues by file
  const byFile = new Map<string, LinkIssue[]>();
  for (const issue of issues) {
    const existing = byFile.get(issue.file) ?? [];
    existing.push(issue);
    byFile.set(issue.file, existing);
  }

  let fixCount = 0;

  for (const [file, fileIssues] of byFile) {
    const fullPath = join(vault, file);
    let content = await Bun.file(fullPath).text();

    // Build a set of broken targets for this file
    const brokenTargets = new Set(
      fileIssues.map((i) => i.link.toLowerCase()),
    );

    // Replace broken wikilinks
    content = content.replace(
      /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,
      (match, target: string, display: string | undefined) => {
        if (brokenTargets.has(target.toLowerCase())) {
          fixCount++;
          return display ?? target;
        }
        return match;
      },
    );

    await Bun.write(fullPath, content);
  }

  return fixCount;
}
