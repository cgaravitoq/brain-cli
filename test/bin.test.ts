import { describe, test, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { createTestConfigDir } from "./helpers";

describe("brain CLI", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      const cleanup = cleanups.pop();
      if (cleanup) {
        await cleanup();
      }
    }
  });

  test("config path can be set on a fresh install without prompting", async () => {
    const configDir = await createTestConfigDir();
    cleanups.push(configDir.cleanup);

    const proc = Bun.spawn(
      ["bun", "run", "bin/brain.ts", "config", "/tmp/fresh-vault"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          BRAIN_CONFIG_DIR: configDir.dir,
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
      proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Vault set to: /tmp/fresh-vault");
    expect(stdout).not.toContain("Enter your vault path:");
    expect(stderr).not.toContain("Enter your vault path:");

    const saved = await Bun.file(join(configDir.dir, "config.json")).json();
    expect(saved).toEqual({ vault: "/tmp/fresh-vault" });
  });
});
