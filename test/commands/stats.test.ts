import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { createTestVault, type TestVault } from "../helpers";
import { run } from "../../src/commands/stats";

describe("stats command", () => {
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

  test("shows zero counts for empty vault", async () => {
    await run([], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("Wiki articles:  0");
    expect(output).toContain("Raw sources:    0");
    expect(output).toContain("Unprocessed:    0");
  });

  test("counts raw and wiki files", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "note.md"),
      "# Note",
    );
    await Bun.write(
      join(vault.config.vault, "raw", "articles", "article.md"),
      "# Article",
    );
    await Bun.write(
      join(vault.config.vault, "wiki", "concept.md"),
      "# Concept",
    );

    await run([], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("Wiki articles:  1");
    expect(output).toContain("Raw sources:    2");
    expect(output).toContain("Unprocessed:    2");
  });

  test("shows Second Brain header", async () => {
    await run([], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("Second Brain");
  });
});
