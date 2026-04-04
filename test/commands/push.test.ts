import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { createTestVault, type TestVault } from "../helpers";
import { run, generateCommitMessage } from "../../src/commands/push";
import { CLIError } from "../../src/errors";

async function gitInit(cwd: string): Promise<void> {
  const init = Bun.spawn(["git", "init"], { cwd, stdout: "pipe", stderr: "pipe" });
  await init.exited;
  // Configure git user for commits
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

async function gitLog(cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", "log", "--oneline", "-1"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout.trim();
}

async function gitStatus(cwd: string): Promise<string> {
  const proc = Bun.spawn(["git", "status", "--porcelain"], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;
  return stdout.trim();
}

describe("push command", () => {
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

  describe("generateCommitMessage", () => {
    test("wiki-only files", () => {
      expect(generateCommitMessage(["wiki/concepts/foo.md", "wiki/concepts/bar.md"])).toBe(
        "wiki: update 2 articles",
      );
    });

    test("wiki-only singular", () => {
      expect(generateCommitMessage(["wiki/concepts/foo.md"])).toBe(
        "wiki: update 1 article",
      );
    });

    test("raw-only files", () => {
      expect(
        generateCommitMessage(["raw/notes/a.md", "raw/articles/b.md"]),
      ).toBe("raw: add 2 sources");
    });

    test("raw-only singular", () => {
      expect(generateCommitMessage(["raw/notes/a.md"])).toBe(
        "raw: add 1 source",
      );
    });

    test("mixed files", () => {
      expect(
        generateCommitMessage(["wiki/concepts/foo.md", "raw/notes/a.md"]),
      ).toBe("vault: sync 2 files");
    });

    test("mixed singular", () => {
      expect(generateCommitMessage(["README.md"])).toBe("vault: sync 1 file");
    });

    test("other files count as mixed", () => {
      expect(
        generateCommitMessage(["wiki/concepts/foo.md", "README.md"]),
      ).toBe("vault: sync 2 files");
    });
  });

  describe("run", () => {
    test("not a git repo errors", async () => {
      try {
        await run([], vault.config);
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(CLIError);
        expect((err as CLIError).message).toBe("vault is not a git repository");
      }
    });

    test("clean repo says nothing to push", async () => {
      const dir = vault.config.vault;
      await gitInit(dir);
      // Need at least one commit for a clean status
      await gitAddAll(dir);
      await gitCommit(dir, "initial");

      await run([], vault.config);
      expect(logs.join("\n")).toContain("Nothing to push");
    });

    test("auto message for wiki-only changes", async () => {
      const dir = vault.config.vault;
      await gitInit(dir);
      await gitAddAll(dir);
      await gitCommit(dir, "initial");

      // Add a wiki file
      await Bun.write(join(dir, "wiki", "concepts", "test.md"), "# Test\n");

      // We can't actually push without a remote, so let's test the commit part
      // by checking what happens — push will fail, but commit message should be correct
      try {
        await run([], vault.config);
      } catch {
        // push will fail (no remote) — that's OK
      }

      const log = await gitLog(dir);
      expect(log).toContain("wiki: update 1 article");
    });

    test("auto message for raw-only changes", async () => {
      const dir = vault.config.vault;
      await gitInit(dir);
      await gitAddAll(dir);
      await gitCommit(dir, "initial");

      // Add a raw file
      await Bun.write(join(dir, "raw", "notes", "test.md"), "# Test\n");

      try {
        await run([], vault.config);
      } catch {
        // push will fail (no remote)
      }

      const log = await gitLog(dir);
      expect(log).toContain("raw: add 1 source");
    });

    test("custom message with -m", async () => {
      const dir = vault.config.vault;
      await gitInit(dir);
      await gitAddAll(dir);
      await gitCommit(dir, "initial");

      await Bun.write(join(dir, "wiki", "concepts", "test.md"), "# Test\n");

      try {
        await run(["-m", "my custom msg"], vault.config);
      } catch {
        // push will fail (no remote)
      }

      const log = await gitLog(dir);
      expect(log).toContain("my custom msg");
    });

    test("dry-run shows changes without committing", async () => {
      const dir = vault.config.vault;
      await gitInit(dir);
      await gitAddAll(dir);
      await gitCommit(dir, "initial");

      await Bun.write(join(dir, "wiki", "concepts", "test.md"), "# Test\n");
      await Bun.write(join(dir, "raw", "notes", "note.md"), "# Note\n");

      await run(["--dry-run"], vault.config);

      const output = logs.join("\n");
      expect(output).toContain("Would commit and push 2 file(s):");
      expect(output).toContain("Commit message:");

      // Verify nothing was actually committed
      const status = await gitStatus(dir);
      expect(status).not.toBe("");
    });

    test("dry-run with custom message", async () => {
      const dir = vault.config.vault;
      await gitInit(dir);
      await gitAddAll(dir);
      await gitCommit(dir, "initial");

      await Bun.write(join(dir, "wiki", "concepts", "test.md"), "# Test\n");

      await run(["--dry-run", "-m", "custom dry msg"], vault.config);

      const output = logs.join("\n");
      expect(output).toContain("Commit message: custom dry msg");
    });
  });
});
