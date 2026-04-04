import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { createTestVault, type TestVault } from "../helpers";
import { run } from "../../src/commands/search";

describe("search command", () => {
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

  test("finds matching notes", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "note.md"),
      "---\ntitle: \"Orchestration\"\ncreated: 2026-04-03\ntags: [raw, unprocessed]\n---\n\nAgent Orchestration Pattern\n",
    );

    await run(["orchestration"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("note.md");
    expect(output).toContain("Orchestration");
  });

  test("case-insensitive search", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "note.md"),
      "---\ntitle: \"Test\"\ncreated: 2026-04-03\ntags: [raw, unprocessed]\n---\n\nHello World\n",
    );

    await run(["hello"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("note.md");
  });

  test("shows no results message", async () => {
    await run(["nonexistent"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("No results found.");
  });

  test("fails with no query", async () => {
    expect(run([], vault.config)).rejects.toThrow();
  });

  test("searches across wiki and raw", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "note.md"),
      "---\ntitle: \"Note\"\ncreated: 2026-04-03\ntags: [raw]\n---\n\nshared keyword\n",
    );
    await Bun.write(
      join(vault.config.vault, "wiki", "concept.md"),
      "---\ntitle: \"Concept\"\ncreated: 2026-04-03\ntags: [wiki]\n---\n\nshared keyword\n",
    );

    await run(["shared keyword"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("note.md");
    expect(output).toContain("concept.md");
  });

  test("multi-term AND matching — both words in different lines", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "multi.md"),
      "---\ntitle: \"Multi\"\ncreated: 2026-04-03\ntags: [raw]\n---\n\nThe agent is autonomous.\nIt uses a pattern for routing.\n",
    );

    await run(["agent", "pattern"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("multi.md");
  });

  test("multi-term rejects partial match — only one term present", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "partial.md"),
      "---\ntitle: \"Partial\"\ncreated: 2026-04-03\ntags: [raw]\n---\n\nThe agent is autonomous.\n",
    );

    await run(["agent", "pattern"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("No results found.");
  });

  test("single-term still works exactly as before", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "single.md"),
      "---\ntitle: \"Single\"\ncreated: 2026-04-03\ntags: [raw]\n---\n\nOrchestration layer\n",
    );

    await run(["orchestration"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("single.md");
    expect(output).toContain("Orchestration");
  });

  test("empty terms after split (multiple spaces) are filtered out", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "spaces.md"),
      "---\ntitle: \"Spaces\"\ncreated: 2026-04-03\ntags: [raw]\n---\n\nagent pattern\n",
    );

    // Extra spaces between terms should still work
    await run(["agent   pattern"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("spaces.md");
  });

  test("multi-term prefers context line with most terms", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "context.md"),
      "---\ntitle: \"Context\"\ncreated: 2026-04-03\ntags: [raw]\n---\n\nThe agent is here.\nThe agent uses a pattern for routing.\nSome other line.\n",
    );

    await run(["agent", "pattern"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("context.md");
    // The line with both "agent" and "pattern" should be shown
    expect(output).toContain("agent uses a pattern");
  });
});
