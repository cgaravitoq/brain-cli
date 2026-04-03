import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { join } from "node:path";
import { createTestVault, type TestVault } from "../helpers";
import { generateFrontmatter } from "../../src/frontmatter";
import { run } from "../../src/commands/list";

describe("list command", () => {
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

  test("shows message when no items exist", async () => {
    await run([], vault.config);
    expect(logs.join("\n")).toContain("No unprocessed items.");
  });

  test("lists notes with titles", async () => {
    const fm = generateFrontmatter({
      title: "Test Note",
      created: "2026-04-03",
      tags: ["raw", "unprocessed"],
    });
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "2026-04-03-2120-test-note.md"),
      `${fm}\n\nBody.\n`,
    );

    await run([], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("Notes (1)");
    expect(output).toContain("Test Note");
    expect(output).toContain("1 unprocessed item(s)");
  });

  test("lists both notes and articles", async () => {
    const fm1 = generateFrontmatter({
      title: "A Note",
      created: "2026-04-03",
      tags: ["raw", "unprocessed"],
    });
    const fm2 = generateFrontmatter({
      title: "An Article",
      created: "2026-04-03",
      tags: ["raw", "unprocessed"],
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

    await run([], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("Notes (1)");
    expect(output).toContain("Articles (1)");
    expect(output).toContain("2 unprocessed item(s)");
  });
});
