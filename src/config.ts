import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import type { Config, RawConfig } from "./types";
import { expandHome } from "./utils";
import { die } from "./errors";

export function getConfigDir(): string {
  if (process.env.BRAIN_CONFIG_DIR) return process.env.BRAIN_CONFIG_DIR;
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "brain");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export async function loadConfig(): Promise<Config> {
  const configPath = getConfigPath();
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return await initConfig();
  }

  const raw: RawConfig = await file.json();
  if (!raw.vault) {
    die("Config is missing 'vault' path. Run: brain config <path>");
  }

  return { vault: expandHome(raw.vault) };
}

export async function saveConfig(vault: string): Promise<void> {
  const configPath = getConfigPath();
  await mkdir(getConfigDir(), { recursive: true });
  const raw: RawConfig = { vault };
  await Bun.write(configPath, JSON.stringify(raw, null, 2) + "\n");
}

async function initConfig(): Promise<Config> {
  process.stdout.write("Enter your vault path: ");

  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();

  if (!value) {
    die("No vault path provided.");
  }

  const vault = new TextDecoder().decode(value).trim();
  if (!vault) {
    die("No vault path provided.");
  }

  await saveConfig(vault);
  console.error(`Config saved to ${getConfigPath()}`);
  return { vault: expandHome(vault) };
}
