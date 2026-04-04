import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { createTestVault, type TestVault } from "./helpers";
import {
  runGit,
  isGitRepo,
  parseGitStatusPaths,
  getChangedFiles,
} from "../src/git";

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

describe("git helpers", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
  });

  afterEach(async () => {
    await vault.cleanup();
  });

  describe("isGitRepo", () => {
    test("returns false for non-git directory", async () => {
      expect(await isGitRepo(vault.config.vault)).toBe(false);
    });

    test("returns true for git directory", async () => {
      await gitInit(vault.config.vault);
      expect(await isGitRepo(vault.config.vault)).toBe(true);
    });
  });

  describe("runGit", () => {
    test("returns exit code and output", async () => {
      await gitInit(vault.config.vault);
      const result = await runGit(vault.config.vault, ["status"]);
      expect(result.exitCode).toBe(0);
      expect(typeof result.stdout).toBe("string");
      expect(typeof result.stderr).toBe("string");
    });

    test("returns non-zero exit code on failure", async () => {
      await gitInit(vault.config.vault);
      const result = await runGit(vault.config.vault, ["log"]);
      // No commits yet, so git log will fail
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("parseGitStatusPaths", () => {
    test("parses simple porcelain output", () => {
      const output = "?? file1.md\n?? file2.md\n";
      const result = parseGitStatusPaths(output);
      expect(result).toEqual(["file1.md", "file2.md"]);
    });

    test("handles renames", () => {
      const output = "R  old.md -> new.md\n";
      const result = parseGitStatusPaths(output);
      expect(result).toEqual(["new.md"]);
    });

    test("handles quoted paths", () => {
      const output = '?? "path with spaces.md"\n';
      const result = parseGitStatusPaths(output);
      expect(result).toEqual(["path with spaces.md"]);
    });

    test("handles empty output", () => {
      const result = parseGitStatusPaths("");
      expect(result).toEqual([]);
    });

    test("returns sorted paths", () => {
      const output = "?? z.md\n?? a.md\n?? m.md\n";
      const result = parseGitStatusPaths(output);
      expect(result).toEqual(["a.md", "m.md", "z.md"]);
    });

    test("handles modified files", () => {
      const output = " M src/file.ts\nM  src/other.ts\n";
      const result = parseGitStatusPaths(output);
      expect(result).toEqual(["src/file.ts", "src/other.ts"]);
    });
  });

  describe("getChangedFiles", () => {
    test("returns empty array for clean repo", async () => {
      const dir = vault.config.vault;
      await gitInit(dir);
      // Add and commit everything
      const add = Bun.spawn(["git", "add", "-A"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
      await add.exited;
      const commit = Bun.spawn(["git", "commit", "-m", "init", "--allow-empty"], {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });
      await commit.exited;

      const files = await getChangedFiles(dir);
      expect(files).toEqual([]);
    });

    test("returns changed files", async () => {
      const dir = vault.config.vault;
      await gitInit(dir);
      const add = Bun.spawn(["git", "add", "-A"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
      await add.exited;
      const commit = Bun.spawn(["git", "commit", "-m", "init", "--allow-empty"], {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      });
      await commit.exited;

      await Bun.write(join(dir, "wiki", "test.md"), "# Test\n");
      const files = await getChangedFiles(dir);
      expect(files).toContain("wiki/test.md");
    });
  });
});
