import { spawn, spawnSync as nodeSpawnSync } from "node:child_process";

export interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Spawn a command and capture stdout/stderr asynchronously.
 * @throws Error if the executable is not found or fails to start
 */
export async function spawnCapture(
  args: string[],
  options: {
    cwd?: string;
    stdoutMode?: "pipe" | "inherit";
    stderrMode?: "pipe" | "inherit";
  } = {},
): Promise<SpawnResult> {
  const [cmd, ...rest] = args;
  if (!cmd) throw new Error("No command provided");

  const stdoutMode = options.stdoutMode ?? "pipe";
  const stderrMode = options.stderrMode ?? "pipe";

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, rest, {
      cwd: options.cwd,
      stdio: ["ignore", stdoutMode, stderrMode],
    });

    let stdoutData = "";
    let stderrData = "";

    if (stdoutMode === "pipe") {
      proc.stdout?.on("data", (chunk: Buffer) => {
        stdoutData += chunk.toString();
      });
    }

    if (stderrMode === "pipe") {
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrData += chunk.toString();
      });
    }

    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout: stdoutData, stderr: stderrData });
    });
  });
}

/**
 * Spawn a command synchronously with fully inherited stdio (for interactive use, e.g. editors).
 */
export function spawnSyncInherited(args: string[]): { exitCode: number } {
  const [cmd, ...rest] = args;
  if (!cmd) throw new Error("No command provided");

  const result = nodeSpawnSync(cmd, rest, { stdio: "inherit" });
  return { exitCode: result.status ?? 1 };
}

/**
 * Spawn a command synchronously and capture stderr (stdout suppressed).
 */
export function spawnSyncCapture(args: string[]): {
  exitCode: number;
  stderr: Buffer | null;
} {
  const [cmd, ...rest] = args;
  if (!cmd) throw new Error("No command provided");

  const result = nodeSpawnSync(cmd, rest);
  return {
    exitCode: result.status ?? 1,
    stderr: result.stderr instanceof Buffer ? result.stderr : null,
  };
}
