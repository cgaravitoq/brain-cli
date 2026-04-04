import { join } from "node:path";
import { parseFrontmatter } from "../frontmatter";

export interface StaleIssue {
  file: string; // relative path
  age: number; // days since creation
}

const STALE_THRESHOLD_DAYS = 30;

export async function checkStale(vault: string): Promise<StaleIssue[]> {
  const issues: StaleIssue[] = [];
  const now = new Date();

  for (const subdir of ["raw/notes", "raw/articles"]) {
    const glob = new Bun.Glob("*.md");
    const dir = join(vault, subdir);

    try {
      for await (const filename of glob.scan({ cwd: dir })) {
        const path = `${subdir}/${filename}`;
        const content = await Bun.file(join(vault, path)).text();
        const parsed = parseFrontmatter(content);

        if (!parsed) continue;

        // Skip if already processed
        if (parsed.frontmatter.status === "processed") continue;

        // Check created date
        const created = parsed.frontmatter.created;
        if (!created) continue;

        const createdDate = new Date(created + "T00:00:00");
        if (isNaN(createdDate.getTime())) continue;

        const diffMs = now.getTime() - createdDate.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays > STALE_THRESHOLD_DAYS) {
          issues.push({ file: path, age: diffDays });
        }
      }
    } catch {
      // Directory doesn't exist, skip
      continue;
    }
  }

  return issues;
}
