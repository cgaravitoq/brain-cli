import { join } from "node:path";
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

export async function run(args: string[], config: Config): Promise<void> {
  const wikiCount = await countFiles(join(config.vault, "wiki"));
  const rawCount = await countFiles(join(config.vault, "raw"));
  const unprocessed = await countUnprocessed(join(config.vault, "raw"));

  const vaultDisplay = config.vault.replace(
    process.env.HOME || "",
    "~",
  );

  console.log(`\n\u{1F9E0} Second Brain`);
  console.log(`   Wiki articles:  ${wikiCount}`);
  console.log(`   Raw sources:    ${rawCount}`);
  console.log(`   Unprocessed:    ${unprocessed}`);
  console.log(`   Vault:          ${vaultDisplay}`);
}
