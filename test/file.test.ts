import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createTestVault, type TestVault } from "./helpers";
import {
  parseFileArgs,
  scanUnfiled,
  fileOutput,
  type UnfiledOutput,
} from "../src/commands/file";
import { parseFrontmatter, updateRawFrontmatter } from "../src/frontmatter";

let vault: TestVault;

beforeEach(async () => {
  vault = await createTestVault();
});

afterEach(async () => {
  await vault.cleanup();
});

async function writeOutput(vaultDir: string, subdir: string, filename: string, content: string) {
  const dir = join(vaultDir, "output", subdir);
  await mkdir(dir, { recursive: true });
  await Bun.write(join(dir, filename), content);
}

describe("parseFileArgs", () => {
  test("defaults: no --last, as note", () => {
    const opts = parseFileArgs([]);
    expect(opts.last).toBe(false);
    expect(opts.as).toBe("note");
  });

  test("parses --last", () => {
    const opts = parseFileArgs(["--last"]);
    expect(opts.last).toBe(true);
  });

  test("parses --as article", () => {
    const opts = parseFileArgs(["--as", "article"]);
    expect(opts.as).toBe("article");
  });

  test("parses --last --as article together", () => {
    const opts = parseFileArgs(["--last", "--as", "article"]);
    expect(opts.last).toBe(true);
    expect(opts.as).toBe("article");
  });

  test("throws on invalid --as value", () => {
    expect(() => parseFileArgs(["--as", "invalid"])).toThrow();
  });
});

describe("scanUnfiled", () => {
  test("returns empty when no output directory exists", async () => {
    const files = await scanUnfiled(vault.config.vault);
    expect(files).toEqual([]);
  });

  test("finds unfiled output files", async () => {
    await writeOutput(
      vault.config.vault,
      "asks",
      "2026-04-04-test-question.md",
      `---\ntitle: "Test Question"\ntype: ask\ncreated: 2026-04-04\n---\n\n# Test\n\nAnswer.\n`,
    );

    const files = await scanUnfiled(vault.config.vault);
    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe("test-question");
    expect(files[0]!.date).toBe("2026-04-04");
    expect(files[0]!.type).toBe("asks");
    expect(files[0]!.path).toBe(join("output", "asks", "2026-04-04-test-question.md"));
  });

  test("excludes filed outputs", async () => {
    await writeOutput(
      vault.config.vault,
      "asks",
      "2026-04-04-filed.md",
      `---\ntitle: "Filed"\nfiled: true\n---\n\nContent.\n`,
    );
    await writeOutput(
      vault.config.vault,
      "asks",
      "2026-04-04-unfiled.md",
      `---\ntitle: "Unfiled"\n---\n\nContent.\n`,
    );

    const files = await scanUnfiled(vault.config.vault);
    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe("unfiled");
  });

  test("sorts most recent first", async () => {
    await writeOutput(
      vault.config.vault,
      "asks",
      "2026-04-01-older.md",
      `---\ntitle: "Older"\ncreated: 2026-04-01\n---\n\nContent.\n`,
    );
    await writeOutput(
      vault.config.vault,
      "asks",
      "2026-04-04-newer.md",
      `---\ntitle: "Newer"\ncreated: 2026-04-04\n---\n\nContent.\n`,
    );

    const files = await scanUnfiled(vault.config.vault);
    expect(files).toHaveLength(2);
    expect(files[0]!.name).toBe("newer");
    expect(files[1]!.name).toBe("older");
  });
});

describe("fileOutput", () => {
  test("copies to raw/notes/ and marks original as filed", async () => {
    const content = `---\ntitle: "Test Answer"\ntype: ask\nquestion: "what is X"\ncreated: 2026-04-04\nsources:\n  - "[[concept-a]]"\n---\n\n# What Is X\n\nExplanation here.\n`;
    await writeOutput(vault.config.vault, "asks", "2026-04-04-what-is-x.md", content);

    const output: UnfiledOutput = {
      path: "output/asks/2026-04-04-what-is-x.md",
      name: "what-is-x",
      date: "2026-04-04",
      type: "asks",
    };

    const targetPath = await fileOutput(vault.config.vault, output, "note");

    expect(targetPath).toBe(join("raw", "notes", "2026-04-04-what-is-x.md"));

    // Verify target was created with status: unprocessed
    const targetContent = await Bun.file(join(vault.config.vault, targetPath)).text();
    expect(targetContent).toContain("status: unprocessed");
    expect(targetContent).toContain("filed_from:");
    expect(targetContent).toContain("# What Is X");

    // Verify original was marked as filed
    const sourceContent = await Bun.file(
      join(vault.config.vault, "output", "asks", "2026-04-04-what-is-x.md"),
    ).text();
    expect(sourceContent).toContain("filed: true");
    expect(sourceContent).toContain("filed_to:");
  });

  test("files to raw/articles/ with --as article", async () => {
    const content = `---\ntitle: "Article"\ntype: ask\ncreated: 2026-04-04\n---\n\n# Article\n\nContent.\n`;
    await writeOutput(vault.config.vault, "asks", "2026-04-04-article.md", content);

    const output: UnfiledOutput = {
      path: "output/asks/2026-04-04-article.md",
      name: "article",
      date: "2026-04-04",
      type: "asks",
    };

    const targetPath = await fileOutput(vault.config.vault, output, "article");
    expect(targetPath).toBe(join("raw", "articles", "2026-04-04-article.md"));

    const targetContent = await Bun.file(join(vault.config.vault, targetPath)).text();
    expect(targetContent).toContain("status: unprocessed");
  });

  test("preserves multi-line frontmatter arrays", async () => {
    const content = `---\ntitle: "Test"\nsources:\n  - "[[a]]"\n  - "[[b]]"\n---\n\nBody.\n`;
    await writeOutput(vault.config.vault, "asks", "2026-04-04-test.md", content);

    const output: UnfiledOutput = {
      path: "output/asks/2026-04-04-test.md",
      name: "test",
      date: "2026-04-04",
      type: "asks",
    };

    const targetPath = await fileOutput(vault.config.vault, output, "note");
    const targetContent = await Bun.file(join(vault.config.vault, targetPath)).text();

    // Multi-line arrays should be preserved
    expect(targetContent).toContain('  - "[[a]]"');
    expect(targetContent).toContain('  - "[[b]]"');
  });
});

describe("updateRawFrontmatter", () => {
  test("adds fields to existing frontmatter", () => {
    const content = `---\ntitle: "Test"\ncreated: 2026-04-04\n---\n\nBody.`;
    const updated = updateRawFrontmatter(content, { status: "unprocessed" });
    expect(updated).toContain("status: unprocessed");
    expect(updated).toContain('title: "Test"');
    expect(updated).toContain("Body.");
  });

  test("updates existing field", () => {
    const content = `---\ntitle: "Test"\nstatus: draft\n---\n\nBody.`;
    const updated = updateRawFrontmatter(content, { status: "processed" });
    expect(updated).toContain("status: processed");
    expect(updated).not.toContain("status: draft");
  });

  test("creates frontmatter when none exists", () => {
    const content = "Just body text.";
    const updated = updateRawFrontmatter(content, { status: "unprocessed" });
    expect(updated).toMatch(/^---\n/);
    expect(updated).toContain("status: unprocessed");
    expect(updated).toContain("Just body text.");
  });

  test("preserves multi-line arrays", () => {
    const content = `---\ntitle: "Test"\nsources:\n  - "[[a]]"\n  - "[[b]]"\n---\n\nBody.`;
    const updated = updateRawFrontmatter(content, { filed: "true" });
    expect(updated).toContain('  - "[[a]]"');
    expect(updated).toContain('  - "[[b]]"');
    expect(updated).toContain("filed: true");
  });
});
