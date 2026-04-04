import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { createTestVault, createFakeExecutable, type TestVault } from "../helpers";
import { generateFrontmatter } from "../../src/frontmatter";
import {
  parseCompileArgs,
  scanUnprocessed,
  ensureCompilerAgent,
  run,
} from "../../src/commands/compile";

describe("compile command", () => {
  let vault: TestVault;
  let logs: string[];
  const originalLog = console.log;
  const originalClaudeBin = process.env.BRAIN_CLAUDE_BIN;

  beforeEach(async () => {
    vault = await createTestVault();
    logs = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
  });

  afterEach(async () => {
    console.log = originalLog;
    if (originalClaudeBin === undefined) {
      delete process.env.BRAIN_CLAUDE_BIN;
    } else {
      process.env.BRAIN_CLAUDE_BIN = originalClaudeBin;
    }
    await vault.cleanup();
  });

  describe("parseCompileArgs", () => {
    test("returns defaults with no args", () => {
      const opts = parseCompileArgs([]);
      expect(opts).toEqual({
        dryRun: false,
        model: "sonnet",
        noPush: false,
        verbose: false,
      });
    });

    test("parses --dry-run", () => {
      const opts = parseCompileArgs(["--dry-run"]);
      expect(opts.dryRun).toBe(true);
    });

    test("parses --model", () => {
      const opts = parseCompileArgs(["--model", "opus"]);
      expect(opts.model).toBe("opus");
    });

    test("parses --no-push", () => {
      const opts = parseCompileArgs(["--no-push"]);
      expect(opts.noPush).toBe(true);
    });

    test("parses --verbose", () => {
      const opts = parseCompileArgs(["--verbose"]);
      expect(opts.verbose).toBe(true);
    });

    test("parses all flags together", () => {
      const opts = parseCompileArgs([
        "--dry-run",
        "--model", "opus",
        "--no-push",
        "--verbose",
      ]);
      expect(opts).toEqual({
        dryRun: true,
        model: "opus",
        noPush: true,
        verbose: true,
      });
    });
  });

  describe("scanUnprocessed", () => {
    test("returns empty array when no files exist", async () => {
      const files = await scanUnprocessed(vault.config.vault);
      expect(files).toEqual([]);
    });

    test("finds unprocessed notes", async () => {
      const fm = generateFrontmatter({
        title: "Test Note",
        created: "2026-04-03",
        tags: ["raw"],
      });
      await Bun.write(
        join(vault.config.vault, "raw", "notes", "test.md"),
        `${fm}\n\nBody.\n`,
      );

      const files = await scanUnprocessed(vault.config.vault);
      expect(files).toHaveLength(1);
      expect(files[0]!.title).toBe("Test Note");
      expect(files[0]!.path).toContain("raw/notes/test.md");
    });

    test("skips processed files", async () => {
      const content = `---\ntitle: "Done"\nstatus: processed\ncreated: 2026-04-03\ntags: [raw]\n---\n\nBody.\n`;
      await Bun.write(
        join(vault.config.vault, "raw", "notes", "done.md"),
        content,
      );

      const files = await scanUnprocessed(vault.config.vault);
      expect(files).toHaveLength(0);
    });

    test("finds files across notes and articles", async () => {
      const fm1 = generateFrontmatter({
        title: "A Note",
        created: "2026-04-03",
        tags: ["raw"],
      });
      const fm2 = generateFrontmatter({
        title: "An Article",
        created: "2026-04-03",
        tags: ["raw"],
        source: "https://example.com",
      });

      await Bun.write(
        join(vault.config.vault, "raw", "notes", "note.md"),
        `${fm1}\n\nBody.\n`,
      );
      await Bun.write(
        join(vault.config.vault, "raw", "articles", "article.md"),
        `${fm2}\n\nBody.\n`,
      );

      const files = await scanUnprocessed(vault.config.vault);
      expect(files).toHaveLength(2);
    });

    test("skips missing raw directories", async () => {
      await rm(join(vault.config.vault, "raw", "articles"), {
        recursive: true,
        force: true,
      });

      const fm = generateFrontmatter({
        title: "Only Note",
        created: "2026-04-03",
        tags: ["raw"],
      });
      await Bun.write(
        join(vault.config.vault, "raw", "notes", "only-note.md"),
        `${fm}\n\nBody.\n`,
      );

      const files = await scanUnprocessed(vault.config.vault);
      expect(files).toHaveLength(1);
      expect(files[0]!.title).toBe("Only Note");
    });
  });

  describe("ensureCompilerAgent", () => {
    test("creates agent file with correct model", async () => {
      const agentPath = await ensureCompilerAgent(vault.config.vault, "opus");
      const content = await Bun.file(agentPath).text();

      expect(agentPath).toBe(
        join(vault.config.vault, ".claude", "agents", "compiler.md"),
      );
      expect(content).toContain("model: opus");
      expect(content).toContain("- Read");
      expect(content).toContain("- Write");
      expect(content).toContain("- Edit");
      expect(content).toContain("- Glob");
      expect(content).toContain("- Grep");
      expect(content).toContain("Second Brain compiler");
    });

    test("overwrites existing agent with new model", async () => {
      await ensureCompilerAgent(vault.config.vault, "sonnet");
      await ensureCompilerAgent(vault.config.vault, "opus");
      const content = await Bun.file(
        join(vault.config.vault, ".claude", "agents", "compiler.md"),
      ).text();
      expect(content).toContain("model: opus");
      expect(content).not.toContain("model: sonnet");
    });
  });

  describe("run", () => {
    test("prints nothing to compile when vault is empty", async () => {
      await run([], vault.config);
      expect(logs.join("\n")).toContain("Nothing to compile.");
    });

    test("dry-run lists files without compiling", async () => {
      const fm = generateFrontmatter({
        title: "My Note",
        created: "2026-04-03",
        tags: ["raw"],
      });
      await Bun.write(
        join(vault.config.vault, "raw", "notes", "my-note.md"),
        `${fm}\n\nSome content.\n`,
      );

      await run(["--dry-run"], vault.config);
      const output = logs.join("\n");
      expect(output).toContain("Would compile 1 file(s):");
      expect(output).toContain("My Note");

      // Agent file should NOT be created in dry-run
      const agentFile = Bun.file(
        join(vault.config.vault, ".claude", "agents", "compiler.md"),
      );
      expect(await agentFile.exists()).toBe(false);
    });

    test("dry-run lists multiple files", async () => {
      const fm1 = generateFrontmatter({
        title: "Note One",
        created: "2026-04-03",
        tags: ["raw"],
      });
      const fm2 = generateFrontmatter({
        title: "Article Two",
        created: "2026-04-03",
        tags: ["raw"],
        source: "https://example.com",
      });
      await Bun.write(
        join(vault.config.vault, "raw", "notes", "one.md"),
        `${fm1}\n\nBody.\n`,
      );
      await Bun.write(
        join(vault.config.vault, "raw", "articles", "two.md"),
        `${fm2}\n\nBody.\n`,
      );

      await run(["--dry-run"], vault.config);
      const output = logs.join("\n");
      expect(output).toContain("Would compile 2 file(s):");
      expect(output).toContain("Note One");
      expect(output).toContain("Article Two");
    });

    test("dry-run skips processed files", async () => {
      const processed = `---\ntitle: "Done"\nstatus: processed\ncreated: 2026-04-03\ntags: [raw]\n---\n\nBody.\n`;
      const unprocessed = generateFrontmatter({
        title: "Pending",
        created: "2026-04-03",
        tags: ["raw"],
      });

      await Bun.write(
        join(vault.config.vault, "raw", "notes", "done.md"),
        processed,
      );
      await Bun.write(
        join(vault.config.vault, "raw", "notes", "pending.md"),
        `${unprocessed}\n\nBody.\n`,
      );

      await run(["--dry-run"], vault.config);
      const output = logs.join("\n");
      expect(output).toContain("Would compile 1 file(s):");
      expect(output).toContain("Pending");
      expect(output).not.toContain("Done");
    });

    test("non-dry-run succeeds outside git repositories", async () => {
      const fakeClaude = await createFakeExecutable(
        "claude",
        "#!/bin/sh\nexit 0\n",
      );

      process.env.BRAIN_CLAUDE_BIN = join(fakeClaude.dir, "claude");

      const fm = generateFrontmatter({
        title: "My Note",
        created: "2026-04-03",
        tags: ["raw"],
      });
      await Bun.write(
        join(vault.config.vault, "raw", "notes", "my-note.md"),
        `${fm}\n\nSome content.\n`,
      );

      try {
        await run([], vault.config);
      } finally {
        await fakeClaude.cleanup();
      }

      const output = logs.join("\n");
      expect(output).toContain("Compiling 1 file(s)...");
      expect(output).toContain("Compilation complete.");
      expect(output).toContain("Skipping git commit: vault is not a git repository.");
    });
  });
});
