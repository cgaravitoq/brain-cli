import { parseArgs } from "node:util";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Config } from "../types";
import { generateFilename, formatDate } from "../utils";
import { generateFrontmatter } from "../frontmatter";
import { htmlToMarkdown, extractTitle } from "../html";
import { ValidationError, FileSystemError } from "../errors";
import { writeTextFile } from "../fs";

export async function run(args: string[], config: Config): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const dryRun = (values["dry-run"] as boolean) ?? false;
  const url = positionals[0];
  if (!url) {
    throw new ValidationError("Usage: brain clip <url>", "brain clip https://example.com/article", 2);
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new ValidationError(
      "URL must start with http:// or https://",
      "brain clip https://example.com/article",
    );
  }

  if (dryRun) {
    const title = titleFromUrl(url);
    const filename = generateFilename(title, new Date());
    console.log(`\n📎 Would save: ${url}`);
    console.log(`   As: raw/clips/${filename}`);
    return;
  }

  let html: string;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new FileSystemError(
        `Failed to fetch URL: ${response.status} ${response.statusText}`,
        "Check the URL and try again",
      );
    }
    html = await response.text();
  } catch (err) {
    if (err instanceof Error && (err.name === "CLIError" || err.name === "ValidationError" || err.name === "FileSystemError")) throw err;
    throw new FileSystemError(
      `Failed to fetch URL: ${err instanceof Error ? err.message : String(err)}`,
      "Check your network connection and try again",
    );
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
