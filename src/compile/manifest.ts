import { join } from "node:path";
import { mkdir } from "node:fs/promises";

export interface CompileManifest {
  lastCompileAt: string;
  compiled: Record<string, { hash: string; compiledAt: string }>;
}

function emptyManifest(): CompileManifest {
  return { lastCompileAt: "", compiled: {} };
}

export async function loadManifest(vault: string): Promise<CompileManifest> {
  const manifestPath = join(vault, ".brain", "compile-manifest.json");
  const file = Bun.file(manifestPath);

  if (!(await file.exists())) {
    return emptyManifest();
  }

  try {
    const data = await file.json();
    return {
      lastCompileAt: data.lastCompileAt ?? "",
      compiled: data.compiled ?? {},
    };
  } catch {
    return emptyManifest();
  }
}

export async function saveManifest(
  vault: string,
  manifest: CompileManifest,
): Promise<void> {
  const brainDir = join(vault, ".brain");
  await mkdir(brainDir, { recursive: true });
  await Bun.write(
    join(brainDir, "compile-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}

export async function computeFileHash(filePath: string): Promise<string> {
  const content = await Bun.file(filePath).arrayBuffer();
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(content);
  return hasher.digest("hex") as string;
}
