import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { readTextFile, writeTextFile, fileExists } from "../fs";

const MANIFEST_DIR = ".brain";
const MANIFEST_FILE = "compile-manifest.json";
const MANIFEST_VERSION = 1;

export interface CompiledEntry {
  hash: string;
  compiledAt: string;
}

export interface CompileManifest {
  version: number;
  lastCompileAt: string;
  compiled: Record<string, CompiledEntry>;
}

function emptyManifest(): CompileManifest {
  return { version: MANIFEST_VERSION, lastCompileAt: "", compiled: {} };
}

function manifestPath(vault: string): string {
  return join(vault, MANIFEST_DIR, MANIFEST_FILE);
}

export async function loadManifest(vault: string): Promise<CompileManifest> {
  const path = manifestPath(vault);

  if (!(await fileExists(path))) {
    return emptyManifest();
  }

  try {
    const data = JSON.parse(await readTextFile(path));

    // Validate shape
    if (
      typeof data !== "object" ||
      data === null ||
      typeof data.lastCompileAt !== "string" ||
      typeof data.compiled !== "object" ||
      data.compiled === null
    ) {
      console.warn("brain: manifest corrupted, starting fresh");
      return emptyManifest();
    }

    // Check version — if missing or outdated, invalidate manifest
    if (!data.version || data.version < MANIFEST_VERSION) {
      console.warn("brain: manifest format upgraded, recompiling all files");
      return emptyManifest();
    }

    return data as CompileManifest;
  } catch {
    return emptyManifest();
  }
}

export async function saveManifest(
  vault: string,
  manifest: CompileManifest,
): Promise<void> {
  const dir = join(vault, MANIFEST_DIR);
  await mkdir(dir, { recursive: true });
  await writeTextFile(manifestPath(vault), JSON.stringify(manifest, null, 2) + "\n");
}

export function computeFileHash(content: string): string {
  // FNV-1a 64-bit hash
  const FNV_PRIME = 1099511628211n;
  const FNV_OFFSET = 14695981039346656037n;
  const MASK = (1n << 64n) - 1n;

  let hash = FNV_OFFSET;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(content);

  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME) & MASK;
  }

  return hash.toString(16);
}
