import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { readdir } from "node:fs/promises";
import { createTestVault, type TestVault } from "../helpers";
import { run } from "../../src/commands/clip";

describe("clip command", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
  });

  afterEach(async () => {
    await vault.cleanup();
  });

  test("fails with no URL", async () => {
    expect(run([], vault.config)).rejects.toThrow("Usage:");
  });

  test("fails with invalid URL", async () => {
    expect(run(["not-a-url"], vault.config)).rejects.toThrow("http");
  });

  test("fails with unreachable URL", async () => {
    expect(
      run(["https://this-domain-definitely-does-not-exist-12345.example"], vault.config),
    ).rejects.toThrow();
  });

  test("dry-run picks an extractor and does not write", async () => {
    // Capture stdout to verify the extractor name is reported.
    const origLog = console.log;
    const lines: string[] = [];
    console.log = (...a: unknown[]) => lines.push(a.join(" "));
    try {
      await run(["--dry-run", "https://www.reddit.com/r/programming/comments/abc/x/"], vault.config);
    } finally {
      console.log = origLog;
    }
    const articles = await readdir(join(vault.config.vault, "raw", "articles")).catch(() => []);
    expect(articles).toHaveLength(0);
    expect(lines.join("\n")).toContain("Extractor: reddit");
  });

  test("dry-run picks default extractor for generic URLs", async () => {
    const origLog = console.log;
    const lines: string[] = [];
    console.log = (...a: unknown[]) => lines.push(a.join(" "));
    try {
      await run(["--dry-run", "https://example.com/some/article"], vault.config);
    } finally {
      console.log = origLog;
    }
    expect(lines.join("\n")).toContain("Extractor: default");
  });

  test("dry-run uses raw extractor when --raw is passed", async () => {
    const origLog = console.log;
    const lines: string[] = [];
    console.log = (...a: unknown[]) => lines.push(a.join(" "));
    try {
      await run(
        ["--dry-run", "--raw", "https://www.reddit.com/r/programming/comments/abc/x/"],
        vault.config,
      );
    } finally {
      console.log = origLog;
    }
    expect(lines.join("\n")).toContain("Extractor: raw");
  });
});
