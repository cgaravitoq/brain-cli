import { mkdtemp, rm, mkdir, chmod } from "node:fs/promises";
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

export async function createFakeExecutable(
  name: string,
  script: string,
): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "brain-bin-test-"));
  const filepath = join(dir, name);
  await Bun.write(filepath, script);
  await chmod(filepath, 0o755);

  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
