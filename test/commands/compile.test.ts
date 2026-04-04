import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { rm, mkdir } from "node:fs/promises";
import { createTestVault, createFakeExecutable, type TestVault } from "../helpers";
import { generateFrontmatter } from "../../src/frontmatter";
import {
  parseCompileArgs,
  scanUnprocessed,
  scanWikiInventory,
  buildPrompt,
  ensureCompilerAgent,
  run,
} from "../../src/commands/compile";
import type { WikiArticle, UnprocessedFile } from "../../src/commands/compile";
import { loadManifest } from "../../src/compile/manifest";

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
        all: false,
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

    test("parses --all", () => {
      const opts = parseCompileArgs(["--all"]);
      expect(opts.all).toBe(true);
    });

    test("parses all flags together", () => {
      const opts = parseCompileArgs([
        "--dry-run",
        "--model", "opus",
        "--no-push",
        "--verbose",
        "--all",
      ]);
      expect(opts).toEqual({
        dryRun: true,
        model: "opus",
        noPush: true,
        verbose: true,
        all: true,
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

  describe("scanWikiInventory", () => {
    test("returns correct articles from wiki directory", async () => {
      const wikiContent = `---\ntitle: "Test Concept"\ntags: [ai, ml]\ncreated: 2026-04-03\n---\n\nSome wiki content.\n`;
      await mkdir(join(vault.config.vault, "wiki", "concepts"), { recursive: true });
      await Bun.write(
        join(vault.config.vault, "wiki", "concepts", "test.md"),
        wikiContent,
      );

      const articles = await scanWikiInventory(vault.config.vault);
      expect(articles).toHaveLength(1);
      expect(articles[0]!.path).toBe(join("wiki", "concepts", "test.md"));
      expect(articles[0]!.title).toBe("Test Concept");
      expect(articles[0]!.tags).toBe("ai, ml");
    });

    test("articles without frontmatter use filename as title", async () => {
      await mkdir(join(vault.config.vault, "wiki", "concepts"), { recursive: true });
      await Bun.write(
        join(vault.config.vault, "wiki", "concepts", "my-concept.md"),
        "Just some plain text without any frontmatter.\n",
      );

      const articles = await scanWikiInventory(vault.config.vault);
      expect(articles).toHaveLength(1);
      expect(articles[0]!.title).toBe("my-concept");
      expect(articles[0]!.tags).toBe("");
    });

    test("returns empty array when no wiki files exist", async () => {
      const articles = await scanWikiInventory(vault.config.vault);
      expect(articles).toEqual([]);
    });

    test("returns articles sorted by path", async () => {
      await mkdir(join(vault.config.vault, "wiki", "concepts"), { recursive: true });
      await Bun.write(
        join(vault.config.vault, "wiki", "concepts", "zebra.md"),
        `---\ntitle: "Zebra"\ntags: [animals]\ncreated: 2026-04-03\n---\n\nContent.\n`,
      );
      await Bun.write(
        join(vault.config.vault, "wiki", "concepts", "alpha.md"),
        `---\ntitle: "Alpha"\ntags: [greek]\ncreated: 2026-04-03\n---\n\nContent.\n`,
      );

      const articles = await scanWikiInventory(vault.config.vault);
      expect(articles).toHaveLength(2);
      expect(articles[0]!.title).toBe("Alpha");
      expect(articles[1]!.title).toBe("Zebra");
    });
  });

  describe("buildPrompt", () => {
    const files: UnprocessedFile[] = [
      { path: "raw/notes/test.md", title: "Test Note" },
    ];

    test("includes inventory table when wiki has articles", () => {
      const wikiArticles: WikiArticle[] = [
        { path: "wiki/concepts/foo.md", title: "Foo Concept", tags: "tag1, tag2" },
      ];

      const prompt = buildPrompt(files, wikiArticles);
      expect(prompt).toContain("## Existing wiki articles");
      expect(prompt).toContain("| Path | Title | Tags |");
      expect(prompt).toContain("| wiki/concepts/foo.md | Foo Concept | tag1, tag2 |");
      expect(prompt).toContain("Do NOT recreate or duplicate any of the articles listed above.");
    });

    test("empty wiki skips inventory section", () => {
      const prompt = buildPrompt(files, []);
      expect(prompt).not.toContain("Existing wiki articles");
      expect(prompt).toContain("Follow the compilation rules in your system prompt.");
    });

    test("includes all files in prompt", () => {
      const multiFiles: UnprocessedFile[] = [
        { path: "raw/notes/a.md", title: "Note A" },
        { path: "raw/articles/b.md", title: "Article B" },
      ];

      const prompt = buildPrompt(multiFiles, []);
      expect(prompt).toContain("2 unprocessed file(s)");
      expect(prompt).toContain("`raw/notes/a.md`");
      expect(prompt).toContain("`raw/articles/b.md`");
    });
  });

  describe("incremental compilation", () => {
    test("first compile processes all files", async () => {
      const fakeClaude = await createFakeExecutable(
        "claude",
        "#!/bin/sh\nexit 0\n",
      );
      process.env.BRAIN_CLAUDE_BIN = join(fakeClaude.dir, "claude");

      const fm1 = generateFrontmatter({
        title: "Note A",
        created: "2026-04-03",
        tags: ["raw"],
      });
      const fm2 = generateFrontmatter({
        title: "Note B",
        created: "2026-04-03",
        tags: ["raw"],
      });
      await Bun.write(
        join(vault.config.vault, "raw", "notes", "a.md"),
        `${fm1}\n\nBody A.\n`,
      );
      await Bun.write(
        join(vault.config.vault, "raw", "notes", "b.md"),
        `${fm2}\n\nBody B.\n`,
      );

      try {
        await run([], vault.config);
      } finally {
        await fakeClaude.cleanup();
      }

      const output = logs.join("\n");
      expect(output).toContain("Compiling 2 file(s)...");
      expect(output).toContain("Compilation complete.");
    });

    test("second compile skips unchanged files", async () => {
      const fakeClaude = await createFakeExecutable(
        "claude",
        "#!/bin/sh\nexit 0\n",
      );
      process.env.BRAIN_CLAUDE_BIN = join(fakeClaude.dir, "claude");

      const fm = generateFrontmatter({
        title: "Note A",
        created: "2026-04-03",
        tags: ["raw"],
      });
      await Bun.write(
        join(vault.config.vault, "raw", "notes", "a.md"),
        `${fm}\n\nBody A.\n`,
      );

      try {
        // First compile
        await run([], vault.config);
        logs.length = 0;

        // Second compile — should skip
        await run([], vault.config);
      } finally {
        await fakeClaude.cleanup();
      }

      const output = logs.join("\n");
      expect(output).toContain("Nothing to compile.");
    });

    test("modified file is recompiled", async () => {
      const fakeClaude = await createFakeExecutable(
        "claude",
        "#!/bin/sh\nexit 0\n",
      );
      process.env.BRAIN_CLAUDE_BIN = join(fakeClaude.dir, "claude");

      const fm = generateFrontmatter({
        title: "Note A",
        created: "2026-04-03",
        tags: ["raw"],
      });
      const filePath = join(vault.config.vault, "raw", "notes", "a.md");
      await Bun.write(filePath, `${fm}\n\nBody A.\n`);

      try {
        // First compile
        await run([], vault.config);
        logs.length = 0;

        // Modify the file
        await Bun.write(filePath, `${fm}\n\nBody A updated.\n`);

        // Second compile — should recompile the modified file
        await run([], vault.config);
      } finally {
        await fakeClaude.cleanup();
      }

      const output = logs.join("\n");
      expect(output).toContain("Compiling 1 file(s)...");
      expect(output).toContain("Compilation complete.");
    });

    test("--all forces full recompile", async () => {
      const fakeClaude = await createFakeExecutable(
        "claude",
        "#!/bin/sh\nexit 0\n",
      );
      process.env.BRAIN_CLAUDE_BIN = join(fakeClaude.dir, "claude");

      const fm1 = generateFrontmatter({
        title: "Note A",
        created: "2026-04-03",
        tags: ["raw"],
      });
      const fm2 = generateFrontmatter({
        title: "Note B",
        created: "2026-04-03",
        tags: ["raw"],
      });
      await Bun.write(
        join(vault.config.vault, "raw", "notes", "a.md"),
        `${fm1}\n\nBody A.\n`,
      );
      await Bun.write(
        join(vault.config.vault, "raw", "notes", "b.md"),
        `${fm2}\n\nBody B.\n`,
      );

      try {
        // First compile
        await run([], vault.config);
        logs.length = 0;

        // Second compile with --all — should recompile all
        await run(["--all"], vault.config);
      } finally {
        await fakeClaude.cleanup();
      }

      const output = logs.join("\n");
      expect(output).toContain("Compiling 2 file(s)...");
      expect(output).toContain("Compilation complete.");
    });

    test("dry-run does not update manifest", async () => {
      const fm = generateFrontmatter({
        title: "Note A",
        created: "2026-04-03",
        tags: ["raw"],
      });
      await Bun.write(
        join(vault.config.vault, "raw", "notes", "a.md"),
        `${fm}\n\nBody A.\n`,
      );

      // Run dry-run — no claude needed
      await run(["--dry-run"], vault.config);
      const output1 = logs.join("\n");
      expect(output1).toContain("Would compile 1 file(s):");
      logs.length = 0;

      // Manifest should not have been saved, so another dry-run still shows the file
      await run(["--dry-run"], vault.config);
      const output2 = logs.join("\n");
      expect(output2).toContain("Would compile 1 file(s):");
    });
  });
});
