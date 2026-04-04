import { parseArgs } from "node:util";
import type { Config } from "../types";
import { die } from "../errors";
import { isGitRepo, getChangedFiles, runGit } from "../git";

export function generateCommitMessage(files: string[]): string {
  let wikiCount = 0;
  let rawCount = 0;

  for (const f of files) {
    if (f.startsWith("wiki/")) {
      wikiCount++;
    } else if (f.startsWith("raw/")) {
      rawCount++;
    }
  }

  const total = files.length;

  if (wikiCount === total) {
    return `wiki: update ${wikiCount} ${wikiCount === 1 ? "article" : "articles"}`;
  }

  if (rawCount === total) {
    return `raw: add ${rawCount} ${rawCount === 1 ? "source" : "sources"}`;
  }

  return `vault: sync ${total} ${total === 1 ? "file" : "files"}`;
}

export async function run(args: string[], config: Config): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      message: { type: "string", short: "m" },
      "dry-run": { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const vault = config.vault;

  if (!(await isGitRepo(vault))) {
    die("vault is not a git repository");
  }

  const changed = await getChangedFiles(vault);
  if (changed.length === 0) {
    console.log("Nothing to push — vault is clean.");
    return;
  }

  const message =
    (values.message as string | undefined) || generateCommitMessage(changed);

  if (values["dry-run"]) {
    console.log(`Would commit and push ${changed.length} file(s):\n`);
    for (const f of changed) {
      console.log(`  \u2022 ${f}`);
    }
    console.log(`\nCommit message: ${message}`);
    return;
  }

  // git add all changed files
  const add = await runGit(vault, ["add", "--", ...changed]);
  if (add.exitCode !== 0) {
    die(add.stderr.trim() || "git add failed");
  }

  // git commit
  const commit = await runGit(vault, ["commit", "-m", message]);
  if (commit.exitCode !== 0) {
    die(commit.stderr.trim() || "git commit failed");
  }
  console.log(`Committed: ${message}`);

  // git push
  const push = await runGit(vault, ["push"]);
  if (push.exitCode !== 0) {
    die(push.stderr.trim() || "git push failed");
  }
  console.log("Pushed to remote.");
}
