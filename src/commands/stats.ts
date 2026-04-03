import { join } from "node:path";
import type { Config } from "../types";
import { parseFrontmatter } from "../frontmatter";

async function countFiles(dir: string, pattern = "**/*.md"): Promise<number> {
  const glob = new Bun.Glob(pattern);
  let count = 0;
  try {
    for await (const _ of glob.scan({ cwd: dir })) {
      count++;
    }
  } catch {
    // Directory doesn't exist
  }
  return count;
}

async function countUnprocessed(dir: string): Promise<number> {
  const glob = new Bun.Glob("**/*.md");
  let count = 0;
  try {
    for await (const path of glob.scan({ cwd: dir, absolute: false })) {
      const content = await Bun.file(join(dir, path)).text();
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
