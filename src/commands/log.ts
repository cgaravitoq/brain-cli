import { parseArgs } from "node:util";
import type { Config } from "../types";
import { GitError, ValidationError } from "../errors";
import { isGitRepo, runGit } from "../git";

interface LogEntry {
  date: string;
  time: string;
  message: string;
}

async function getLogEntries(
  vault: string,
  opts: { all: boolean; limit: number },
): Promise<LogEntry[]> {
  const gitArgs = ["log", `--format=%ai %s`, `-${opts.limit}`];

  if (!opts.all) {
    gitArgs.push("--", "wiki/", "raw/");
  }

  const result = await runGit(vault, gitArgs);

  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    if (
      stderr.includes("does not have any commits") ||
      stderr.includes("unknown revision")
    ) {
      return [];
    }
    throw new GitError(stderr || "git log failed");
  }

  const stdout = result.stdout.trim();
  if (!stdout) return [];

  const entries: LogEntry[] = [];
  const lines = stdout.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(
      /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):\d{2} [+-]\d{4} (.*)$/,
    );
    if (match) {
      entries.push({ date: match[1]!, time: match[2]!, message: match[3]! });
    } else {
      entries.push({ date: "", time: "", message: line });
    }
  }

  return entries;
}

export async function run(args: string[], config: Config): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      n: { type: "string" },
      all: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  const vault = config.vault;

  if (!(await isGitRepo(vault))) {
    throw new GitError("vault is not a git repository", "Initialize with: git init");
  }

  const count = values.n ? parseInt(values.n as string, 10) : 10;
  if (isNaN(count) || count < 1) {
    throw new ValidationError("invalid count for -n flag", "Use a positive integer, e.g. -n 20", 2);
  }

  const allFlag = (values.all as boolean) ?? false;

  if (values.json) {
    const entries = await getLogEntries(vault, { all: allFlag, limit: count });
    console.log(JSON.stringify({ commits: entries }));
    return;
  }

  const entries = await getLogEntries(vault, { all: allFlag, limit: count });

  if (entries.length === 0) {
    console.log("No log entries.");
    return;
  }

  for (const entry of entries) {
    if (entry.date && entry.time) {
      console.log(`${entry.date} ${entry.time}  ${entry.message}`);
    } else {
      console.log(entry.message);
    }
  }
}
