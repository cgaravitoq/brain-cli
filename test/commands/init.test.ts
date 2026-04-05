import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { parseInitArgs, run } from "../../src/commands/init";

describe("init command", () => {
  let tmpDir: string;
  let logs: string[];
  const originalLog = console.log;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "brain-init-test-"));
    logs = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
  });

  afterEach(async () => {
    console.log = originalLog;
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("parseInitArgs", () => {
    test("returns path when provided", () => {
      expect(parseInitArgs(["/some/path"])).toEqual({ path: "/some/path" });
    });

    test("returns null when no path provided", () => {
      expect(parseInitArgs([])).toEqual({ path: null });
    });
  });

  describe("run", () => {
    test("creates vault directory structure", async () => {
      const vaultPath = join(tmpDir, "my-vault");
      await run({ path: vaultPath });

      expect(existsSync(join(vaultPath, "raw", "notes"))).toBe(true);
      expect(existsSync(join(vaultPath, "raw", "articles"))).toBe(true);
      expect(existsSync(join(vaultPath, "wiki", "indexes"))).toBe(true);
    });

    test("creates INDEX.md", async () => {
      const vaultPath = join(tmpDir, "my-vault");
      await run({ path: vaultPath });

      const indexPath = join(vaultPath, "wiki", "indexes", "INDEX.md");
      expect(existsSync(indexPath)).toBe(true);

      const content = await Bun.file(indexPath).text();
      expect(content).toContain("# Index");
      expect(content).toContain("Second Brain");
      expect(content).toContain("raw/notes/");
      expect(content).toContain("raw/articles/");
    });

    test("initializes git repository", async () => {
      const vaultPath = join(tmpDir, "my-vault");
      await run({ path: vaultPath });

      expect(existsSync(join(vaultPath, ".git"))).toBe(true);
    });

    test("prints creation messages", async () => {
      const vaultPath = join(tmpDir, "my-vault");
      await run({ path: vaultPath });

      const output = logs.join("\n");
      expect(output).toContain("Creating vault structure");
      expect(output).toContain("raw/notes/");
      expect(output).toContain("raw/articles/");
      expect(output).toContain("wiki/indexes/INDEX.md");
      expect(output).toContain("Vault created");
    });

    test("aborts if directory is not empty", async () => {
      // Create a non-empty directory
      const vaultPath = join(tmpDir, "non-empty");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(vaultPath, { recursive: true });
      await writeFile(join(vaultPath, "existing.txt"), "hello");

      await run({ path: vaultPath });

      const output = logs.join("\n");
      expect(output).toContain("not empty");
      expect(output).toContain("Aborting");
    });

    test("uses cwd when no path provided", async () => {
      const originalCwd = process.cwd();
      const vaultPath = join(tmpDir, "cwd-vault");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(vaultPath, { recursive: true });

      process.chdir(vaultPath);
      try {
        await run({ path: null });
        expect(existsSync(join(vaultPath, "raw", "notes"))).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });

    test("prints config hint", async () => {
      const vaultPath = join(tmpDir, "my-vault");
      await run({ path: vaultPath });

      const output = logs.join("\n");
      expect(output).toContain("brain config");
      expect(output).toContain(vaultPath);
    });
  });
});
