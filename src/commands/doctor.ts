import { existsSync, accessSync, constants } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadStoredConfig } from "../config";
import { isGitRepo, runGit } from "../git";

interface Check {
  name: string;
  status: "pass" | "fail" | "warn";
  message: string;
  suggestion?: string;
}

export async function run(): Promise<void> {
  const checks: Check[] = [];

  // 1. Config check
  const config = await loadStoredConfig();
  if (!config) {
    checks.push({
      name: "Config",
      status: "fail",
      message: "No vault configured",
      suggestion: "Run: brain config <path-to-vault>",
    });
  } else {
    checks.push({
      name: "Config",
      status: "pass",
      message: `${config.vault} configured`,
    });

    // 2. Vault exists
    if (!existsSync(config.vault)) {
      checks.push({
        name: "Vault exists",
        status: "fail",
        message: `Vault not found: ${config.vault}`,
        suggestion: "Check the path or reconfigure: brain config <path>",
      });
    } else {
      checks.push({
        name: "Vault exists",
        status: "pass",
        message: config.vault,
      });

      // 3. Vault structure
      const requiredDirs = ["raw/notes", "raw/articles", "wiki/indexes"];
      const missing = requiredDirs.filter(
        (d) => !existsSync(join(config.vault, d)),
      );
      if (missing.length > 0) {
        checks.push({
          name: "Structure",
          status: "warn",
          message: `Missing directories: ${missing.join(", ")}`,
          suggestion: "Run: brain init (or create directories manually)",
        });
      } else {
        checks.push({
          name: "Structure",
          status: "pass",
          message: "All required directories present",
        });
      }

      // 4. Git check
      if (await isGitRepo(config.vault)) {
        checks.push({
          name: "Git",
          status: "pass",
          message: "Repository initialized",
        });

        // 5. Remote check
        const remoteResult = await runGit(config.vault, ["remote", "-v"]);
        if (remoteResult.stdout.trim() === "") {
          checks.push({
            name: "Remote",
            status: "warn",
            message: "No remote configured",
            suggestion: "Run: brain push --set-upstream origin main",
          });
        } else {
          checks.push({
            name: "Remote",
            status: "pass",
            message: "Remote configured",
          });
        }
      } else {
        checks.push({
          name: "Git",
          status: "warn",
          message: "Not a git repository",
          suggestion: "Run: git init (or brain init)",
        });
      }

      // 6. Permissions
      try {
        accessSync(config.vault, constants.W_OK);
        checks.push({
          name: "Permissions",
          status: "pass",
          message: "Vault is writable",
        });
      } catch {
        checks.push({
          name: "Permissions",
          status: "fail",
          message: "Vault is not writable",
          suggestion: "Check directory permissions",
        });
      }
    }
  }

  // 7. Claude CLI check
  const claudeBin = process.env.BRAIN_CLAUDE_BIN || "claude";
  const claudeResult = spawnSync("which", [claudeBin], { encoding: "utf8" });
  if (claudeResult.status === 0 && claudeResult.stdout.trim()) {
    checks.push({
      name: "Claude CLI",
      status: "pass",
      message: `Available at ${claudeResult.stdout.trim()}`,
    });
  } else {
    checks.push({
      name: "Claude CLI",
      status: "fail",
      message: "claude CLI not found",
      suggestion: "Install from https://claude.ai/claude-code",
    });
  }

  // Output
  console.log("\nChecking vault setup...\n");

  const passCount = checks.filter((c) => c.status === "pass").length;
  const failCount = checks.filter((c) => c.status === "fail").length;

  for (const check of checks) {
    const icon =
      check.status === "pass"
        ? "\u2705"
        : check.status === "warn"
          ? "\u26A0\uFE0F"
          : "\u274C";
    console.log(`${icon} ${check.name}: ${check.message}`);
    if (check.suggestion) {
      console.log(`   \uD83D\uDCA1 ${check.suggestion}`);
    }
  }

  console.log(`\n${passCount}/${checks.length} checks passed`);

  if (failCount > 0) {
    process.exit(1);
  }
}
