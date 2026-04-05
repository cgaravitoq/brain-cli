import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { isGitRepo, runGit } from "../git";
import { fileExists, writeTextFile } from "../fs";

const VAULT_STRUCTURE = [
  "raw/notes",
  "raw/articles",
  "wiki/indexes",
];

export function parseInitArgs(args: string[]): { path: string | null } {
  return { path: args[0] || null };
}

export async function run(options: { path: string | null }): Promise<void> {
  const vaultPath = options.path || process.cwd();

  // Check if directory exists and is not empty
  if (await fileExists(vaultPath)) {
    const entries = await readdir(vaultPath);
    if (entries.length > 0) {
      console.log(`Directory ${vaultPath} is not empty. Aborting.`);
      console.log("Use a different path or clear the directory first.");
      return;
    }
  }

  // Create directory structure
  console.log(`Creating vault structure at ${vaultPath}/`);

  for (const dir of VAULT_STRUCTURE) {
    const fullPath = join(vaultPath, dir);
    await mkdir(fullPath, { recursive: true });
    console.log(`  Created: ${dir}/`);
  }

  // Create initial INDEX.md
  const indexPath = join(vaultPath, "wiki/indexes/INDEX.md");
  await writeTextFile(indexPath, `# Index

This is your Second Brain wiki index.

## Structure

- \`raw/notes/\` — quick notes and fleeting thoughts
- \`raw/articles/\` — clipped articles and reference material
- \`wiki/\` — compiled, processed knowledge

## Getting Started

1. Add notes: \`brain note "My thought"\`
2. Clip content: \`brain clip <url>\`
3. Compile: \`brain compile\`
4. Search: \`brain search <query>\`
`);
  console.log(`  Created: wiki/indexes/INDEX.md`);

  // Initialize git if not a repo
  if (!await isGitRepo(vaultPath)) {
    console.log("\nInitializing git repository...");
    await runGit(vaultPath, ["init"]);
    console.log("Git repository initialized");
  } else {
    console.log("\nGit repository already exists");
  }

  console.log(`\nVault created at ${vaultPath}/`);
  console.log("\nTo set as default vault, run:");
  console.log(`   brain config ${vaultPath}`);
}
