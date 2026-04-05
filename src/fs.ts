import { access } from "node:fs/promises";

export async function readTextFile(path: string): Promise<string> {
  return Bun.file(path).text();
}

export async function writeTextFile(
  path: string,
  content: string,
): Promise<void> {
  await Bun.write(path, content);
}

/**
 * Check if a path exists (file or directory).
 * Uses access() since Bun.file().exists() only works for regular files.
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Async generator that yields file paths matching a glob pattern.
 * Uses Bun.Glob for native performance.
 * Yields paths relative to cwd, using forward slashes.
 */
export async function* globFiles(
  pattern: string,
  cwd: string,
): AsyncGenerator<string> {
  const glob = new Bun.Glob(pattern);
  for await (const path of glob.scan({ cwd, onlyFiles: true })) {
    yield path;
  }
}
