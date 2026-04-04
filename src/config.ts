import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Config, RawConfig } from "./types";
import { expandHome } from "./utils";
import { die } from "./errors";
import { readTextFile, writeTextFile, fileExists } from "./fs";

export function getConfigDir(): string {
  if (process.env.BRAIN_CONFIG_DIR) return process.env.BRAIN_CONFIG_DIR;
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "brain");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export async function loadStoredConfig(): Promise<Config | null> {
  const configPath = getConfigPath();

  if (!(await fileExists(configPath))) {
    return null;
  }

  const raw: RawConfig = JSON.parse(await readTextFile(configPath));
  if (!raw.vault) {
    die("Config is missing 'vault' path. Run: brain config <path>");
  }

  return { vault: expandHome(raw.vault) };
}

export async function loadConfig(): Promise<Config> {
  const config = await loadStoredConfig();
  if (config) {
    return config;
  }

  return await initConfig();
}

export async function saveConfig(vault: string): Promise<void> {
  const configPath = getConfigPath();
  await mkdir(getConfigDir(), { recursive: true });
  const raw: RawConfig = { vault };
  await writeTextFile(configPath, JSON.stringify(raw, null, 2) + "\n");
}

async function initConfig(): Promise<Config> {
  process.stdout.write("Enter your vault path: ");

  const vault = await new Promise<string>((resolve) => {
    const rl = createInterface({ input: process.stdin });
    let answered = false;
    rl.once("line", (line) => {
      answered = true;
      rl.close();
      resolve(line.trim());
    });
    rl.once("close", () => {
      if (!answered) resolve("");
    });
  });

  if (!vault) {
    die("No vault path provided.");
  }

  await saveConfig(vault);
  console.error(`Config saved to ${getConfigPath()}`);
  return { vault: expandHome(vault) };
}
