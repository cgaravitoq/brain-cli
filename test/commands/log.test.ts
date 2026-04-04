import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { createTestVault, type TestVault } from "../helpers";
import { run } from "../../src/commands/log";
import { CLIError } from "../../src/errors";

async function gitInit(cwd: string): Promise<void> {
  const init = Bun.spawn(["git", "init"], { cwd, stdout: "pipe", stderr: "pipe" });
  await init.exited;
  const name = Bun.spawn(["git", "config", "user.email", "test@test.com"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  await name.exited;
  const user = Bun.spawn(["git", "config", "user.name", "Test"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  await user.exited;
}

async function gitAddAll(cwd: string): Promise<void> {
  const proc = Bun.spawn(["git", "add", "-A"], { cwd, stdout: "pipe", stderr: "pipe" });
  await proc.exited;
}

async function gitCommit(cwd: string, message: string): Promise<void> {
  const proc = Bun.spawn(["git", "commit", "-m", message, "--allow-empty"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  await proc.exited;
}

describe("log command", () => {
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

  test("shows no log entries for empty repo", async () => {
    await gitInit(vault.config.vault);
    await run([], vault.config);
    expect(logs.join("\n")).toContain("No log entries.");
  });

  test("shows vault commits", async () => {
    const dir = vault.config.vault;
    await gitInit(dir);

    // Create a file in wiki/ and commit it
    await Bun.write(join(dir, "wiki", "test.md"), "# Test\n");
    await gitAddAll(dir);
    await gitCommit(dir, "wiki: add test article");

    // Create a file in raw/ and commit it
    await Bun.write(join(dir, "raw", "notes", "note.md"), "# Note\n");
    await gitAddAll(dir);
    await gitCommit(dir, "raw: add test note");

    await run([], vault.config);

    const output = logs.join("\n");
    expect(output).toContain("wiki: add test article");
    expect(output).toContain("raw: add test note");
  });

  test("-n flag limits output", async () => {
    const dir = vault.config.vault;
    await gitInit(dir);

    // Create 5 commits touching wiki/
    for (let i = 1; i <= 5; i++) {
      await Bun.write(join(dir, "wiki", `file${i}.md`), `# File ${i}\n`);
      await gitAddAll(dir);
      await gitCommit(dir, `wiki: add file ${i}`);
    }

    await run(["-n", "2"], vault.config);

    const output = logs.join("\n");
    const lines = output.split("\n").filter((l) => l.trim());
    expect(lines.length).toBe(2);
  });

  test("--all shows all commits", async () => {
    const dir = vault.config.vault;
    await gitInit(dir);

    // Vault commit
    await Bun.write(join(dir, "wiki", "test.md"), "# Test\n");
    await gitAddAll(dir);
    await gitCommit(dir, "wiki: add test article");

    // Non-vault commit (not touching wiki/ or raw/)
    await Bun.write(join(dir, "README.md"), "# Readme\n");
    await gitAddAll(dir);
    await gitCommit(dir, "docs: add readme");

    // Default mode: only vault commits
    await run([], vault.config);
    const defaultOutput = logs.join("\n");
    expect(defaultOutput).toContain("wiki: add test article");
    expect(defaultOutput).not.toContain("docs: add readme");

    // Reset logs
    logs = [];

    // --all mode: all commits
    await run(["--all"], vault.config);
    const allOutput = logs.join("\n");
    expect(allOutput).toContain("wiki: add test article");
    expect(allOutput).toContain("docs: add readme");
  });

  test("formats dates correctly", async () => {
    const dir = vault.config.vault;
    await gitInit(dir);

    await Bun.write(join(dir, "wiki", "test.md"), "# Test\n");
    await gitAddAll(dir);
    await gitCommit(dir, "wiki: format test");

    await run([], vault.config);

    const output = logs.join("\n");
    // Should match "YYYY-MM-DD HH:MM  message" format
    expect(output).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}  wiki: format test$/m);
  });

  test("invalid -n flag errors", async () => {
    const dir = vault.config.vault;
    await gitInit(dir);

    try {
      await run(["-n", "abc"], vault.config);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(CLIError);
      expect((err as CLIError).message).toBe("invalid count for -n flag");
      expect((err as CLIError).exitCode).toBe(2);
    }
  });
});
