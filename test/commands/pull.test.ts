import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createTestVault, type TestVault } from "../helpers";
import { run } from "../../src/commands/pull";
import { CLIError } from "../../src/errors";

async function gitRun(cwd: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout.trim();
}

async function gitInit(cwd: string): Promise<void> {
  await gitRun(cwd, ["init"]);
  await gitRun(cwd, ["config", "user.email", "test@test.com"]);
  await gitRun(cwd, ["config", "user.name", "Test"]);
}

describe("pull command", () => {
  let vault: TestVault;
  let logs: string[];
  const originalLog = console.log;

  beforeEach(async () => {
    vault = await createTestVault();
    logs = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
  });

  afterEach(async () => {
    console.log = originalLog;
    await vault.cleanup();
  });

  test("errors when vault is not a git repo", async () => {
    try {
      await run([], vault.config);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).message).toBe("vault is not a git repository");
    }
  });

  test("fails gracefully without remote", async () => {
    const dir = vault.config.vault;
    await gitInit(dir);
    // Need at least one commit
    await Bun.write(join(dir, "raw", "notes", "seed.md"), "# Seed\n");
    await gitRun(dir, ["add", "-A"]);
    await gitRun(dir, ["commit", "-m", "initial"]);

    try {
      await run([], vault.config);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      // git pull without a remote should produce an error
      expect((err as CLIError).message).toBeTruthy();
    }
  });

  test("pulls from local remote successfully — already up to date", async () => {
    // Create a bare remote
    const bareDir = await mkdtemp(join(tmpdir(), "brain-bare-"));

    try {
      await gitRun(bareDir, ["init", "--bare"]);

      // Set up the vault as a clone of the bare remote
      const dir = vault.config.vault;
      await gitInit(dir);
      await Bun.write(join(dir, "raw", "notes", "seed.md"), "# Seed\n");
      await gitRun(dir, ["add", "-A"]);
      await gitRun(dir, ["commit", "-m", "initial"]);
      await gitRun(dir, ["remote", "add", "origin", bareDir]);
      await gitRun(dir, ["push", "-u", "origin", "HEAD"]);

      // Pull when already up to date
      await run([], vault.config);
      expect(logs.join("\n")).toContain("Already up to date.");
    } finally {
      await rm(bareDir, { recursive: true, force: true });
    }
  });

  test("pulls new changes from remote", async () => {
    const bareDir = await mkdtemp(join(tmpdir(), "brain-bare-"));
    const clone2Dir = await mkdtemp(join(tmpdir(), "brain-clone2-"));

    try {
      // Create bare remote
      await gitRun(bareDir, ["init", "--bare"]);

      // Set up vault as clone of bare
      const dir = vault.config.vault;
      await gitInit(dir);
      await Bun.write(join(dir, "raw", "notes", "seed.md"), "# Seed\n");
      await gitRun(dir, ["add", "-A"]);
      await gitRun(dir, ["commit", "-m", "initial"]);
      await gitRun(dir, ["remote", "add", "origin", bareDir]);
      await gitRun(dir, ["push", "-u", "origin", "HEAD"]);

      // Create a second clone and push a change
      await gitRun(clone2Dir, ["clone", bareDir, "."]);
      await gitRun(clone2Dir, ["config", "user.email", "test@test.com"]);
      await gitRun(clone2Dir, ["config", "user.name", "Test"]);
      await Bun.write(join(clone2Dir, "wiki", "new-article.md"), "# New\n");
      await gitRun(clone2Dir, ["add", "-A"]);
      await gitRun(clone2Dir, ["commit", "-m", "add new article"]);
      await gitRun(clone2Dir, ["push"]);

      // Now pull from the first clone (our vault)
      await run([], vault.config);
      const output = logs.join("\n");
      // Should indicate changes were pulled (either file count or generic message)
      expect(
        output.includes("Pulled") || output.includes("updated"),
      ).toBe(true);
    } finally {
      await rm(bareDir, { recursive: true, force: true });
      await rm(clone2Dir, { recursive: true, force: true });
    }
  });
});
