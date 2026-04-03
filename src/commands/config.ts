import type { Config } from "../types";
import { saveConfig, getConfigPath } from "../config";
import { expandHome } from "../utils";
import { die } from "../errors";

export async function run(args: string[], config: Config): Promise<void> {
  if (args.length === 0) {
    // Show current config
    const vaultDisplay = config.vault.replace(
      process.env.HOME || "",
      "~",
    );
    console.log(`Vault: ${vaultDisplay}`);
    console.log(`Config: ${getConfigPath()}`);
    return;
  }

  if (args.length === 1) {
    const newVault = args[0]!;
    await saveConfig(newVault);
    console.log(`Vault set to: ${newVault}`);
    return;
  }

  die("Usage: brain config [path]", 2);
}
