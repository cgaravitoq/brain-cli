import type { Config } from "../types";
import { saveConfig, getConfigPath } from "../config";
import { ValidationError } from "../errors";

export async function run(args: string[], config: Config): Promise<void> {
  if (args.length === 0) {
    // Show current config
    if (!config.vault) {
      console.log("Vault: (not set)");
      console.log(`Config: ${getConfigPath()}`);
      return;
    }

    const vaultDisplay = config.vault.replace(process.env.HOME || "", "~");
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

  throw new ValidationError("Usage: brain config [path]", "brain config ~/my-vault", 2);
}
