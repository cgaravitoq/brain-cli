import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { createTestVault, type TestVault } from "../helpers";
import { run } from "../../src/commands/note";

describe("note command", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
  });

  afterEach(async () => {
    await vault.cleanup();
  });

  test("creates a note file from text", async () => {
    await run(["Hello", "world"], vault.config);

    const files = await readdir(join(vault.config.vault, "raw", "notes"));
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    expect(mdFiles).toHaveLength(1);
    expect(mdFiles[0]).toContain("hello-world");
  });

  test("note content includes frontmatter and body", async () => {
    await run(["Test note content"], vault.config);

    const files = await readdir(join(vault.config.vault, "raw", "notes"));
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    const content = await Bun.file(
      join(vault.config.vault, "raw", "notes", mdFiles[0]!),
    ).text();

    expect(content).toContain("---");
    expect(content).toContain('title: "Test note content"');
    expect(content).toContain("tags: [raw, unprocessed]");
    expect(content).toContain("Test note content");
  });

  test("creates a titled note", async () => {
    await run(["Body text here"], vault.config, { title: "My Title" });

    const files = await readdir(join(vault.config.vault, "raw", "notes"));
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    expect(mdFiles[0]).toContain("my-title");

    const content = await Bun.file(
      join(vault.config.vault, "raw", "notes", mdFiles[0]!),
    ).text();
    expect(content).toContain('title: "My Title"');
    expect(content).toContain("Body text here");
  });

  test("fails with no text and no title", async () => {
    expect(run([], vault.config)).rejects.toThrow();
  });

  test("filename matches date pattern", async () => {
    await run(["Pattern test"], vault.config);

    const files = await readdir(join(vault.config.vault, "raw", "notes"));
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    expect(mdFiles[0]).toMatch(/^\d{4}-\d{2}-\d{2}-\d{4}-.+\.md$/);
  });
});
