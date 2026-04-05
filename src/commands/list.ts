import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Config } from "../types";
import { parseFrontmatter } from "../frontmatter";
import { readTextFile, globFiles } from "../fs";

interface Category {
  label: string;
  emoji: string;
  dir: string;
}

const CATEGORIES: Category[] = [
  { label: "Notes", emoji: "\u{1F4C2}", dir: "notes" },
  { label: "Articles", emoji: "\u{1F4C2}", dir: "articles" },
];

interface ListItem {
  category: string;
  file: string;
  title: string;
}

async function gatherItems(vault: string): Promise<ListItem[]> {
  const items: ListItem[] = [];

  for (const cat of CATEGORIES) {
    const dir = join(vault, "raw", cat.dir);
    const files: string[] = [];

    try {
      for await (const path of globFiles("*.md", dir)) {
        files.push(path);
      }
    } catch {
      continue;
    }

    if (files.length === 0) continue;

    files.sort();

    for (const file of files) {
      const content = await readTextFile(join(dir, file));
      const parsed = parseFrontmatter(content);
      const status = parsed?.frontmatter.status;
      if (status === "processed") continue;
      const title = parsed?.frontmatter.title || file.replace(/\.md$/, "");
      items.push({ category: cat.label.toLowerCase(), file, title });
    }
  }

  return items;
}

export async function run(args: string[], config: Config): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.json) {
    const items = await gatherItems(config.vault);
    console.log(JSON.stringify(items));
    return;
  }

  let total = 0;

  for (const cat of CATEGORIES) {
    const dir = join(config.vault, "raw", cat.dir);
    const files: string[] = [];

    try {
      for await (const path of globFiles("*.md", dir)) {
        files.push(path);
      }
    } catch {
      continue;
    }

    if (files.length === 0) continue;

    files.sort();
    const unprocessed: { file: string; title: string }[] = [];

    for (const file of files) {
      const content = await readTextFile(join(dir, file));
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
