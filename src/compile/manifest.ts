import { join } from "node:path";
import { mkdir } from "node:fs/promises";

const MANIFEST_DIR = ".brain";
const MANIFEST_FILE = "compile-manifest.json";

export interface CompiledEntry {
  hash: string;
  compiledAt: string;
}

export interface CompileManifest {
  lastCompileAt: string;
  compiled: Record<string, CompiledEntry>;
}

function emptyManifest(): CompileManifest {
  return { lastCompileAt: "", compiled: {} };
}

function manifestPath(vault: string): string {
  return join(vault, MANIFEST_DIR, MANIFEST_FILE);
}

export async function loadManifest(vault: string): Promise<CompileManifest> {
  const path = manifestPath(vault);
  const file = Bun.file(path);

  if (!(await file.exists())) {
    return emptyManifest();
  }

  try {
    const data = await file.json();

    // Validate shape
    if (
      typeof data !== "object" ||
      data === null ||
      typeof data.lastCompileAt !== "string" ||
      typeof data.compiled !== "object" ||
      data.compiled === null
    ) {
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
  await Bun.write(manifestPath(vault), JSON.stringify(manifest, null, 2) + "\n");
}

export function computeFileHash(content: string): string {
  const hash = Bun.hash(content);
  // Bun.hash returns a number; convert to hex string
  // Use BigInt for unsigned representation to avoid negative hex values
  return BigInt.asUintN(64, BigInt(hash)).toString(16);
}
