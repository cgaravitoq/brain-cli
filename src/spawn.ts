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

  const proc = Bun.spawn([cmd, ...rest], {
    cwd: options.cwd,
    stdin: "ignore",
    stdout: stdoutMode,
    stderr: stderrMode,
  });

  const [stdoutText, stderrText] = await Promise.all([
    stdoutMode === "pipe" ? new Response(proc.stdout).text() : "",
    stderrMode === "pipe" ? new Response(proc.stderr).text() : "",
  ]);

  const exitCode = await proc.exited;

  return { exitCode, stdout: stdoutText, stderr: stderrText };
}

/**
 * Spawn a command synchronously with fully inherited stdio (for interactive use, e.g. editors).
 */
export function spawnSyncInherited(args: string[]): { exitCode: number } {
  const [cmd, ...rest] = args;
  if (!cmd) throw new Error("No command provided");

  const result = Bun.spawnSync([cmd, ...rest], { stdio: ["inherit", "inherit", "inherit"] });
  return { exitCode: result.exitCode };
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

  const result = Bun.spawnSync([cmd, ...rest]);
  return {
    exitCode: result.exitCode,
    stderr: result.stderr.length > 0 ? Buffer.from(result.stderr) : null,
  };
}
