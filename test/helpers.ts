import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/types";

export interface TestVault {
  config: Config;
  cleanup: () => Promise<void>;
}

export async function createTestVault(): Promise<TestVault> {
  const dir = await mkdtemp(join(tmpdir(), "brain-test-"));
  await mkdir(join(dir, "raw", "notes"), { recursive: true });
  await mkdir(join(dir, "raw", "articles"), { recursive: true });
  await mkdir(join(dir, "wiki"), { recursive: true });

  return {
    config: { vault: dir },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

export async function createTestConfigDir(): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "brain-config-test-"));
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
