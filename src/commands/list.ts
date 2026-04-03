import { join } from "node:path";
import type { Config } from "../types";
import { parseFrontmatter } from "../frontmatter";

interface Category {
  label: string;
  emoji: string;
  dir: string;
}

const CATEGORIES: Category[] = [
  { label: "Notes", emoji: "\u{1F4C2}", dir: "notes" },
  { label: "Articles", emoji: "\u{1F4C2}", dir: "articles" },
];

export async function run(args: string[], config: Config): Promise<void> {
  let total = 0;

  for (const cat of CATEGORIES) {
    const dir = join(config.vault, "raw", cat.dir);
    const glob = new Bun.Glob("*.md");
    const files: string[] = [];

    for await (const path of glob.scan({ cwd: dir, absolute: false })) {
      files.push(path);
    }

    if (files.length === 0) continue;

    files.sort();
    const unprocessed: { file: string; title: string }[] = [];

    for (const file of files) {
      const content = await Bun.file(join(dir, file)).text();
      const parsed = parseFrontmatter(content);
      const status = parsed?.frontmatter.status;
      if (status === "processed") continue;
      const title = parsed?.frontmatter.title || file.replace(/\.md$/, "");
      unprocessed.push({ file, title });
    }

    if (unprocessed.length === 0) continue;

    total += unprocessed.length;
    console.log(`\n${cat.emoji} ${cat.label} (${unprocessed.length})`);

    for (const { title } of unprocessed) {
      const display =
        title.length > 60 ? title.slice(0, 57) + "..." : title;
      console.log(`  \u2022 ${display}`);
    }
  }

  if (total === 0) {
    console.log("No unprocessed items.");
  } else {
    console.log(`\n${total} unprocessed item(s)`);
  }
}
