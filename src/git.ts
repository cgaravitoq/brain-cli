import { die } from "./errors";

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type SubprocessStream = ReturnType<typeof Bun.spawn>["stdout"];

export function readStream(stream: SubprocessStream | undefined): Promise<string> {
  if (!stream || typeof stream === "number") {
    return Promise.resolve("");
  }

  return new Response(stream).text();
}

export async function runGit(vault: string, args: string[]): Promise<GitResult> {
  let proc: ReturnType<typeof Bun.spawn>;

  try {
    proc = Bun.spawn(["git", ...args], {
      cwd: vault,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err) {
    die(
      err instanceof Error && err.message.includes("Executable not found")
        ? "git not found in PATH"
        : `failed to start git: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    readStream(proc.stdout),
    readStream(proc.stderr),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

export async function isGitRepo(vault: string): Promise<boolean> {
  const result = await runGit(vault, ["rev-parse", "--is-inside-work-tree"]);
  return result.exitCode === 0;
}

export function parseGitStatusPaths(output: string): string[] {
  const paths: string[] = [];

  for (const line of output.split("\n")) {
    if (!line) continue;

    let path = line.slice(3);
    if (!path) continue;

    if (path.includes(" -> ")) {
      path = path.split(" -> ").pop() ?? path;
    }

    // git wraps paths with spaces/special chars in quotes
    if (path.startsWith('"') && path.endsWith('"')) {
      path = path.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }

    paths.push(path);
  }

  return paths.sort();
}

export async function getChangedFiles(vault: string): Promise<string[]> {
  const status = await runGit(vault, [
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);

  if (status.exitCode !== 0) {
    die(status.stderr.trim() || "git status failed");
  }

  return parseGitStatusPaths(status.stdout);
}
