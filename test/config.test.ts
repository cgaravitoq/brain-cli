import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { createTestConfigDir } from "./helpers";
import { getConfigDir, getConfigPath, saveConfig, loadConfig } from "../src/config";

describe("config", () => {
  let configDir: string;
  let cleanup: () => Promise<void>;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    originalEnv = process.env.BRAIN_CONFIG_DIR;
    const result = await createTestConfigDir();
    configDir = result.dir;
    cleanup = result.cleanup;
    process.env.BRAIN_CONFIG_DIR = configDir;
  });

  afterEach(async () => {
    if (originalEnv === undefined) {
      delete process.env.BRAIN_CONFIG_DIR;
    } else {
      process.env.BRAIN_CONFIG_DIR = originalEnv;
    }
    await cleanup();
  });

  test("getConfigDir respects BRAIN_CONFIG_DIR", () => {
    expect(getConfigDir()).toBe(configDir);
  });

  test("getConfigPath returns path within config dir", () => {
    expect(getConfigPath()).toBe(join(configDir, "config.json"));
  });

  test("saveConfig writes config file", async () => {
    await saveConfig("~/my-vault");
    const file = Bun.file(join(configDir, "config.json"));
    expect(await file.exists()).toBe(true);
    const data = await file.json();
    expect(data.vault).toBe("~/my-vault");
  });

  test("loadConfig reads saved config", async () => {
    await saveConfig("~/my-vault");
    const config = await loadConfig();
    expect(config.vault).toEndWith("/my-vault");
    expect(config.vault).not.toStartWith("~");
  });
});
