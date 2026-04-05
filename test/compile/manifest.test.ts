import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createTestVault, createFakeExecutable, type TestVault } from "../helpers";
import { generateFrontmatter } from "../../src/frontmatter";
import {
  loadManifest,
  saveManifest,
  computeFileHash,
  type CompileManifest,
} from "../../src/compile/manifest";
import {
  filterByManifest,
  scanUnprocessed,
  run,
} from "../../src/commands/compile";

describe("compile manifest", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
  });

  afterEach(async () => {
    await vault.cleanup();
  });

  describe("computeFileHash", () => {
    test("returns hex string", () => {
      const hash = computeFileHash("hello world");
      expect(typeof hash).toBe("string");
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    test("same content produces same hash", () => {
      const a = computeFileHash("test content");
      const b = computeFileHash("test content");
      expect(a).toBe(b);
    });

    test("different content produces different hash", () => {
      const a = computeFileHash("content A");
      const b = computeFileHash("content B");
      expect(a).not.toBe(b);
    });
  });

  describe("loadManifest", () => {
    test("returns empty manifest when file does not exist", async () => {
      const manifest = await loadManifest(vault.config.vault);
      expect(manifest).toEqual({ version: 1, lastCompileAt: "", compiled: {} });
    });

    test("loads valid manifest", async () => {
      const expected: CompileManifest = {
        version: 1,
        lastCompileAt: "2026-04-03T00:00:00.000Z",
        compiled: {
          "raw/notes/test.md": {
            hash: "abc123",
            compiledAt: "2026-04-03T00:00:00.000Z",
          },
        },
      };

      await mkdir(join(vault.config.vault, ".brain"), { recursive: true });
      await Bun.write(
        join(vault.config.vault, ".brain", "compile-manifest.json"),
        JSON.stringify(expected),
      );

      const manifest = await loadManifest(vault.config.vault);
      expect(manifest).toEqual(expected);
    });

    test("returns empty manifest for corrupted JSON", async () => {
      await mkdir(join(vault.config.vault, ".brain"), { recursive: true });
      await Bun.write(
        join(vault.config.vault, ".brain", "compile-manifest.json"),
        "not valid json {{{",
      );

      const manifest = await loadManifest(vault.config.vault);
      expect(manifest).toEqual({ version: 1, lastCompileAt: "", compiled: {} });
    });

    test("returns empty manifest for invalid shape", async () => {
      await mkdir(join(vault.config.vault, ".brain"), { recursive: true });
      await Bun.write(
        join(vault.config.vault, ".brain", "compile-manifest.json"),
        JSON.stringify({ foo: "bar" }),
      );

      const manifest = await loadManifest(vault.config.vault);
      expect(manifest).toEqual({ version: 1, lastCompileAt: "", compiled: {} });
    });
  });

  describe("saveManifest", () => {
    test("writes manifest to .brain directory", async () => {
      const manifest: CompileManifest = {
        version: 1,
        lastCompileAt: "2026-04-03T00:00:00.000Z",
        compiled: {
          "raw/notes/test.md": {
            hash: "abc123",
            compiledAt: "2026-04-03T00:00:00.000Z",
          },
        },
      };

      await saveManifest(vault.config.vault, manifest);

      const file = Bun.file(
        join(vault.config.vault, ".brain", "compile-manifest.json"),
      );
      expect(await file.exists()).toBe(true);

      const loaded = await file.json();
      expect(loaded).toEqual(manifest);
    });

    test("creates .brain directory if missing", async () => {
      const manifest: CompileManifest = {
        version: 1,
        lastCompileAt: "2026-04-03T00:00:00.000Z",
        compiled: {},
      };

      await saveManifest(vault.config.vault, manifest);

      const file = Bun.file(
        join(vault.config.vault, ".brain", "compile-manifest.json"),
      );
      expect(await file.exists()).toBe(true);
    });
  });

  describe("filterByManifest", () => {
    test("returns all files when manifest is empty", async () => {
      const fm = generateFrontmatter({
        title: "Test",
        created: "2026-04-03",
        tags: ["raw"],
      });
      await Bun.write(
        join(vault.config.vault, "raw", "notes", "test.md"),
        `${fm}\n\nBody.\n`,
      );

      const files = await scanUnprocessed(vault.config.vault);
      const manifest: CompileManifest = { version: 1, lastCompileAt: "", compiled: {} };

      const filtered = await filterByManifest(
        vault.config.vault,
        files,
        manifest,
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.path).toBe("raw/notes/test.md");
    });

    test("skips unchanged files (same hash)", async () => {
      const content = `${generateFrontmatter({
        title: "Test",
        created: "2026-04-03",
        tags: ["raw"],
      })}\n\nBody.\n`;

      await Bun.write(
        join(vault.config.vault, "raw", "notes", "test.md"),
        content,
      );

      const hash = computeFileHash(content);
      const manifest: CompileManifest = {
        version: 1,
        lastCompileAt: "2026-04-03T00:00:00.000Z",
        compiled: {
          "raw/notes/test.md": {
            hash,
            compiledAt: "2026-04-03T00:00:00.000Z",
          },
        },
      };

      const files = await scanUnprocessed(vault.config.vault);
      const filtered = await filterByManifest(
        vault.config.vault,
        files,
        manifest,
      );
      expect(filtered).toHaveLength(0);
    });

    test("includes modified files (different hash)", async () => {
      const fm = generateFrontmatter({
        title: "Test",
        created: "2026-04-03",
        tags: ["raw"],
      });
      await Bun.write(
        join(vault.config.vault, "raw", "notes", "test.md"),
        `${fm}\n\nUpdated body.\n`,
      );

      const manifest: CompileManifest = {
        version: 1,
        lastCompileAt: "2026-04-03T00:00:00.000Z",
        compiled: {
          "raw/notes/test.md": {
            hash: "old-hash-that-wont-match",
            compiledAt: "2026-04-03T00:00:00.000Z",
          },
        },
      };

      const files = await scanUnprocessed(vault.config.vault);
      const filtered = await filterByManifest(
        vault.config.vault,
        files,
        manifest,
      );
      expect(filtered).toHaveLength(1);
    });

    test("filters mixed changed and unchanged files", async () => {
      const unchangedContent = `${generateFrontmatter({
        title: "Unchanged",
        created: "2026-04-03",
        tags: ["raw"],
      })}\n\nSame body.\n`;

      const changedContent = `${generateFrontmatter({
        title: "Changed",
        created: "2026-04-03",
        tags: ["raw"],
      })}\n\nNew body.\n`;

      await Bun.write(
        join(vault.config.vault, "raw", "notes", "unchanged.md"),
        unchangedContent,
      );
      await Bun.write(
        join(vault.config.vault, "raw", "notes", "changed.md"),
        changedContent,
      );

      const manifest: CompileManifest = {
        version: 1,
        lastCompileAt: "2026-04-03T00:00:00.000Z",
        compiled: {
          "raw/notes/unchanged.md": {
            hash: computeFileHash(unchangedContent),
            compiledAt: "2026-04-03T00:00:00.000Z",
          },
          "raw/notes/changed.md": {
            hash: "stale-hash",
            compiledAt: "2026-04-03T00:00:00.000Z",
          },
        },
      };

      const files = await scanUnprocessed(vault.config.vault);
      const filtered = await filterByManifest(
        vault.config.vault,
        files,
        manifest,
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.title).toBe("Changed");
    });
  });
});

describe("compile incremental integration", () => {
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

  async function writeNote(name: string, title: string, body: string): Promise<void> {
    const fm = generateFrontmatter({
      title,
      created: "2026-04-03",
      tags: ["raw"],
    });
    await Bun.write(
      join(vault.config.vault, "raw", "notes", name),
      `${fm}\n\n${body}\n`,
    );
  }

  test("first compile (no manifest) processes all files", async () => {
    await writeNote("a.md", "Note A", "Body A");
    await writeNote("b.md", "Note B", "Body B");

    await run(["--dry-run"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("Would compile 2 file(s):");
    expect(output).toContain("Note A");
    expect(output).toContain("Note B");
  });

  test("second compile skips unchanged files", async () => {
    await writeNote("a.md", "Note A", "Body A");
    await writeNote("b.md", "Note B", "Body B");

    // Simulate a first compile by saving a manifest with current hashes
    const contentA = await Bun.file(
      join(vault.config.vault, "raw", "notes", "a.md"),
    ).text();
    const contentB = await Bun.file(
      join(vault.config.vault, "raw", "notes", "b.md"),
    ).text();

    const manifest: CompileManifest = {
      version: 1,
      lastCompileAt: "2026-04-03T00:00:00.000Z",
      compiled: {
        "raw/notes/a.md": {
          hash: computeFileHash(contentA),
          compiledAt: "2026-04-03T00:00:00.000Z",
        },
        "raw/notes/b.md": {
          hash: computeFileHash(contentB),
          compiledAt: "2026-04-03T00:00:00.000Z",
        },
      },
    };
    await saveManifest(vault.config.vault, manifest);

    await run(["--dry-run"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("Nothing to compile.");
  });

  test("modified file is recompiled", async () => {
    await writeNote("a.md", "Note A", "Body A");
    await writeNote("b.md", "Note B", "Body B");

    // Save manifest with hash for a.md only
    const contentA = await Bun.file(
      join(vault.config.vault, "raw", "notes", "a.md"),
    ).text();

    const manifest: CompileManifest = {
      version: 1,
      lastCompileAt: "2026-04-03T00:00:00.000Z",
      compiled: {
        "raw/notes/a.md": {
          hash: computeFileHash(contentA),
          compiledAt: "2026-04-03T00:00:00.000Z",
        },
        "raw/notes/b.md": {
          hash: "stale-hash-for-b",
          compiledAt: "2026-04-03T00:00:00.000Z",
        },
      },
    };
    await saveManifest(vault.config.vault, manifest);

    await run(["--dry-run"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("Would compile 1 file(s):");
    expect(output).toContain("Note B");
    expect(output).not.toContain("Note A");
  });

  test("--all forces full recompile", async () => {
    await writeNote("a.md", "Note A", "Body A");
    await writeNote("b.md", "Note B", "Body B");

    // Save manifest with current hashes for both files
    const contentA = await Bun.file(
      join(vault.config.vault, "raw", "notes", "a.md"),
    ).text();
    const contentB = await Bun.file(
      join(vault.config.vault, "raw", "notes", "b.md"),
    ).text();

    const manifest: CompileManifest = {
      version: 1,
      lastCompileAt: "2026-04-03T00:00:00.000Z",
      compiled: {
        "raw/notes/a.md": {
          hash: computeFileHash(contentA),
          compiledAt: "2026-04-03T00:00:00.000Z",
        },
        "raw/notes/b.md": {
          hash: computeFileHash(contentB),
          compiledAt: "2026-04-03T00:00:00.000Z",
        },
      },
    };
    await saveManifest(vault.config.vault, manifest);

    await run(["--dry-run", "--all"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("Would compile 2 file(s):");
    expect(output).toContain("Note A");
    expect(output).toContain("Note B");
  });

  test("--dry-run does not update manifest", async () => {
    await writeNote("a.md", "Note A", "Body A");

    await run(["--dry-run"], vault.config);

    const manifestFile = Bun.file(
      join(vault.config.vault, ".brain", "compile-manifest.json"),
    );
    expect(await manifestFile.exists()).toBe(false);
  });

  test("non-dry-run updates manifest after compile", async () => {
    const fakeClaude = await createFakeExecutable(
      "claude",
      "#!/bin/sh\nexit 0\n",
    );
    process.env.BRAIN_CLAUDE_BIN = join(fakeClaude.dir, "claude");

    await writeNote("a.md", "Note A", "Body A");

    try {
      await run(["--no-push"], vault.config);
    } finally {
      await fakeClaude.cleanup();
    }

    const manifestFile = Bun.file(
      join(vault.config.vault, ".brain", "compile-manifest.json"),
    );
    expect(await manifestFile.exists()).toBe(true);

    const manifest: CompileManifest = await manifestFile.json();
    expect(manifest.lastCompileAt).toBeTruthy();
    expect(manifest.compiled["raw/notes/a.md"]).toBeDefined();
    expect(manifest.compiled["raw/notes/a.md"]!.hash).toBeTruthy();
    expect(manifest.compiled["raw/notes/a.md"]!.compiledAt).toBeTruthy();
  });

  test("corrupted manifest treated as first run", async () => {
    await writeNote("a.md", "Note A", "Body A");

    await mkdir(join(vault.config.vault, ".brain"), { recursive: true });
    await Bun.write(
      join(vault.config.vault, ".brain", "compile-manifest.json"),
      "corrupted data!!!",
    );

    await run(["--dry-run"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("Would compile 1 file(s):");
    expect(output).toContain("Note A");
  });
});
