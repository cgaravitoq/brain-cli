import type { Config } from "../types";
import { GitError } from "../errors";
import { isGitRepo, runGit } from "../git";

export async function run(args: string[], config: Config): Promise<void> {
  const vault = config.vault;

  if (!(await isGitRepo(vault))) {
    throw new GitError("vault is not a git repository", "Initialize with: git init");
  }

  const result = await runGit(vault, ["pull", "--rebase"]);

  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    // Handle rebase conflicts
    if (stderr.includes("conflict") || stderr.includes("CONFLICT")) {
      throw new GitError(
        "pull failed: merge conflicts detected. Resolve manually and run `git rebase --continue`",
        "git rebase --continue (after resolving conflicts)",
      );
    }
    throw new GitError(stderr || "git pull failed");
  }

  const stdout = result.stdout.trim();

  if (stdout === "Already up to date." || stdout.includes("Already up to date")) {
    console.log("Already up to date.");
    return;
  }

  // Parse output to show updated file summary
  const lines = stdout.split("\n");
  const fileLines = lines.filter(
    (l) =>
      l.includes("|") ||
      l.includes("create mode") ||
      l.includes("delete mode"),
  );

  if (fileLines.length > 0) {
    console.log(`Pulled ${fileLines.length} updated file(s).`);
  } else {
    console.log("Pulled latest changes.");
  }
}
