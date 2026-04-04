import { parseArgs } from "node:util";
import type { Config } from "../types";
import { die } from "../errors";
import { isGitRepo, runGit } from "../git";

export async function run(args: string[], config: Config): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      n: { type: "string" },
      all: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const vault = config.vault;

  if (!(await isGitRepo(vault))) {
    die("vault is not a git repository");
  }

  const count = values.n ? parseInt(values.n as string, 10) : 10;
  if (isNaN(count) || count < 1) {
    die("invalid count for -n flag", 2);
  }

  const allFlag = (values.all as boolean) ?? false;

  const gitArgs = ["log", `--format=%ai %s`, `-${count}`];

  if (!allFlag) {
    gitArgs.push("--", "wiki/", "raw/");
  }

  const result = await runGit(vault, gitArgs);

  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    if (
      stderr.includes("does not have any commits") ||
      stderr.includes("unknown revision")
    ) {
      console.log("No log entries.");
      return;
    }
    die(stderr || "git log failed");
  }

  const stdout = result.stdout.trim();
  if (!stdout) {
    console.log("No log entries.");
    return;
  }

  const lines = stdout.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(
      /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):\d{2} [+-]\d{4} (.*)$/,
    );
    if (match) {
      console.log(`${match[1]} ${match[2]}  ${match[3]}`);
    } else {
      console.log(line);
    }
  }
}
