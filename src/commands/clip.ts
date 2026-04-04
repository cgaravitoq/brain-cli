import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Config } from "../types";
import { generateFilename, formatDate } from "../utils";
import { generateFrontmatter } from "../frontmatter";
import { htmlToMarkdown, extractTitle } from "../html";
import { die } from "../errors";
import { writeTextFile } from "../fs";

export async function run(args: string[], config: Config): Promise<void> {
  const url = args[0];
  if (!url) {
    die("Usage: brain clip <url>", 2);
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    die("URL must start with http:// or https://");
  }

  let html: string;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      die(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }
    html = await response.text();
  } catch (err) {
    if (err instanceof Error && err.name === "CLIError") throw err;
    die(`Failed to fetch URL: ${err instanceof Error ? err.message : String(err)}`);
  }

  const pageTitle = extractTitle(html) || titleFromUrl(url);
  const markdown = htmlToMarkdown(html);

  const now = new Date();
  const filename = generateFilename(pageTitle, now);
  const dir = join(config.vault, "raw", "articles");
  const filepath = join(dir, filename);

  await mkdir(dir, { recursive: true });

  const frontmatter = generateFrontmatter({
    title: pageTitle,
    created: formatDate(now),
    tags: ["raw", "unprocessed"],
    source: url,
  });

  await writeTextFile(filepath, `${frontmatter}\n\n${markdown}\n`);
  console.log(`raw/articles/${filename}`);
}

function titleFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const last = pathname.split("/").filter(Boolean).pop() || "article";
    return last.replace(/[-_]/g, " ").replace(/\.\w+$/, "");
  } catch {
    return "article";
  }
}
