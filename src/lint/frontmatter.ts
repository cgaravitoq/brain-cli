import { join } from "node:path";
import { parseFrontmatter } from "../frontmatter";

export interface FrontmatterIssue {
  file: string; // relative path
  missing: string[]; // list of missing required field names
}

const REQUIRED_FIELDS = ["title", "created", "tags"];

export async function checkFrontmatter(
  vault: string,
): Promise<FrontmatterIssue[]> {
  const issues: FrontmatterIssue[] = [];
  const glob = new Bun.Glob("**/*.md");

  for await (const path of glob.scan({ cwd: vault })) {
    const content = await Bun.file(join(vault, path)).text();
    const parsed = parseFrontmatter(content);

    if (!parsed) {
      // No frontmatter at all — all fields missing
      issues.push({ file: path, missing: [...REQUIRED_FIELDS] });
      continue;
    }

    const missing: string[] = [];
    for (const field of REQUIRED_FIELDS) {
      if (!parsed.frontmatter[field]) {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      issues.push({ file: path, missing });
    }
  }

  return issues;
}
