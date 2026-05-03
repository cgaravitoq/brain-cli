import { parseArgs } from "node:util";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Config } from "../types";
import { generateFilename, formatDate } from "../utils";
import { generateFrontmatter } from "../frontmatter";
import { ValidationError, FileSystemError } from "../errors";
import { writeTextFile } from "../fs";
import { ExtractorRegistry } from "../extractors/registry";
import { ExtractorError } from "../extractors/types";

export async function run(args: string[], config: Config): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      "dry-run": { type: "boolean", default: false },
      raw: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const dryRun = (values["dry-run"] as boolean) ?? false;
  const useRaw = (values["raw"] as boolean) ?? false;
  const rawUrl = positionals[0];
  if (!rawUrl) {
    throw new ValidationError("Usage: brain clip <url> [--raw]", "brain clip https://example.com/article", 2);
  }

  if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
    throw new ValidationError(
      "URL must start with http:// or https://",
      "brain clip https://example.com/article",
    );
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ValidationError("Invalid URL", "brain clip https://example.com/article");
  }

  const registry = new ExtractorRegistry({
    external: config.extractors,
    raw: useRaw,
  });

  if (dryRun) {
    const extractor = registry.pick(url);
    console.log(`\n📎 Would clip: ${url.toString()}`);
    console.log(`   Extractor: ${extractor.name}`);
    console.log(`   Target dir: raw/articles/`);
    return;
  }

  let page;
  let usedExtractor: string;
  try {
    const result = await registry.extract(url);
    page = result.page;
    usedExtractor = result.usedExtractor;
  } catch (err) {
    if (err instanceof ExtractorError) {
      throw new FileSystemError(
        `Extractor failed (${err.extractor}): ${err.message}`,
        config.extractors
          ? "Check the URL or your extractor command"
          : "For sites that block plain HTTP (X.com, LinkedIn), register an extractor:\n" +
            '  Edit ~/.config/brain/config.json and add:\n' +
            '    "extractors": { "x.com": "your-extractor-cmd" }',
      );
    }
    throw err;
  }

  const now = new Date();
  const filename = generateFilename(page.title, now);
  const dir = join(config.vault, "raw", "articles");
  const filepath = join(dir, filename);

  await mkdir(dir, { recursive: true });

  const frontmatter = generateFrontmatter({
    title: page.title,
    created: formatDate(now),
    tags: ["raw", "unprocessed"],
    source: url.toString(),
    author: page.author,
    site: page.site,
    excerpt: page.excerpt,
  });

  await writeTextFile(filepath, `${frontmatter}\n\n${page.content}\n`);
  console.error(`✓ Extracted via ${usedExtractor}`);
  console.log(`raw/articles/${filename}`);
}
