import { join } from "node:path";
import { parseFrontmatter } from "../frontmatter";

export interface OrphanIssue {
  file: string; // relative path of orphaned file
}

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

export async function checkOrphans(vault: string): Promise<OrphanIssue[]> {
  const glob = new Bun.Glob("**/*.md");

  // Build structures: wiki files with their identifiers, and per-file outbound links
  const wikiFiles: Array<{ path: string; identifiers: Set<string> }> = [];
  // Map from source file -> set of lowercased link targets
  const outboundLinks = new Map<string, Set<string>>();

  for await (const path of glob.scan({ cwd: vault })) {
    const content = await Bun.file(join(vault, path)).text();

    // Collect outbound wikilink targets
    const targets = new Set<string>();
    let match: RegExpExecArray | null;
    WIKILINK_RE.lastIndex = 0;
    while ((match = WIKILINK_RE.exec(content)) !== null) {
      targets.add(match[1]!.toLowerCase());
    }
    outboundLinks.set(path, targets);

    // If this is a wiki file (but not an index), register its identifiers
    if (path.startsWith("wiki/") && !path.startsWith("wiki/indexes/")) {
      const identifiers = new Set<string>();

      // Filename without extension
      const basename = path.split("/").pop()!;
      identifiers.add(basename.replace(/\.md$/, "").toLowerCase());

      // Frontmatter title and aliases
      const parsed = parseFrontmatter(content);
      if (parsed) {
        if (parsed.frontmatter.title) {
          identifiers.add(parsed.frontmatter.title.toLowerCase());
        }
        if (parsed.frontmatter.aliases) {
          const stripped = parsed.frontmatter.aliases
            .replace(/^\[/, "")
            .replace(/\]$/, "");
          for (const alias of stripped.split(",")) {
            const trimmed = alias.trim();
            if (trimmed.length > 0) {
              identifiers.add(trimmed.toLowerCase());
            }
          }
        }
      }

      wikiFiles.push({ path, identifiers });
    }
  }

  // Check each wiki file for inbound links from any other file
  const issues: OrphanIssue[] = [];

  for (const wikiFile of wikiFiles) {
    let hasInbound = false;

    for (const [sourcePath, targets] of outboundLinks) {
      if (sourcePath === wikiFile.path) continue; // skip self-links

      for (const id of wikiFile.identifiers) {
        if (targets.has(id)) {
          hasInbound = true;
          break;
        }
      }
      if (hasInbound) break;
    }

    if (!hasInbound) {
      issues.push({ file: wikiFile.path });
    }
  }

  return issues;
}
