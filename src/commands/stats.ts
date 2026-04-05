import { join } from "node:path";
import { parseArgs } from "node:util";
import type { Config } from "../types";
import { parseFrontmatter } from "../frontmatter";
import { readTextFile, globFiles } from "../fs";

async function countFiles(dir: string, pattern = "**/*.md"): Promise<number> {
  let count = 0;
  try {
    for await (const _ of globFiles(pattern, dir)) {
      count++;
    }
  } catch {
    // Directory doesn't exist
  }
  return count;
}

async function countUnprocessed(dir: string): Promise<number> {
  let count = 0;
  try {
    for await (const path of globFiles("**/*.md", dir)) {
      const content = await readTextFile(join(dir, path));
      const parsed = parseFrontmatter(content);
      if (parsed?.frontmatter.status !== "processed") count++;
    }
  } catch {
    // Directory doesn't exist
  }
  return count;
}

interface VaultStats {
  wikiCount: number;
  rawCount: number;
  processedCount: number;
  unprocessedCount: number;
}

async function gatherStats(vault: string): Promise<VaultStats> {
  const wikiCount = await countFiles(join(vault, "wiki"));
  const rawCount = await countFiles(join(vault, "raw"));
  const unprocessedCount = await countUnprocessed(join(vault, "raw"));
  const processedCount = rawCount - unprocessedCount;

  return { wikiCount, rawCount, processedCount, unprocessedCount };
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

  const options = { json: (values.json as boolean) ?? false };

  if (options.json) {
    const stats = await gatherStats(config.vault);
    console.log(JSON.stringify({
      wiki: stats.wikiCount,
      raw: stats.rawCount,
      processed: stats.processedCount,
      unprocessed: stats.unprocessedCount,
    }));
    return;
  }

  const stats = await gatherStats(config.vault);

  const vaultDisplay = config.vault.replace(
    process.env.HOME || "",
    "~",
  );

  console.log(`\n\u{1F9E0} Second Brain`);
  console.log(`   Wiki articles:  ${stats.wikiCount}`);
  console.log(`   Raw sources:    ${stats.rawCount}`);
  console.log(`   Unprocessed:    ${stats.unprocessedCount}`);
  console.log(`   Vault:          ${vaultDisplay}`);
}
