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

  // --- Fuzzy search (stemming) tests ---

  test("stemmed search: 'orchestrate' finds file with 'orchestration'", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "stem1.md"),
      "---\ntitle: \"Stem\"\ncreated: 2026-04-03\ntags: [raw]\n---\n\nAgent Orchestration Pattern\n",
    );

    await run(["orchestrate"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("stem1.md");
    expect(output).toContain("Orchestration");
  });

  test("stemmed search: 'orchestration' still works (exact match)", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "stem2.md"),
      "---\ntitle: \"Stem\"\ncreated: 2026-04-03\ntags: [raw]\n---\n\nAgent Orchestration Pattern\n",
    );

    await run(["orchestration"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("stem2.md");
    expect(output).toContain("Orchestration");
  });

  test("stemmed search: 'running' finds file with 'run'", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "stem3.md"),
      "---\ntitle: \"Stem\"\ncreated: 2026-04-03\ntags: [raw]\n---\n\nHow to run a process\n",
    );

    await run(["running"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("stem3.md");
  });

  test("stemmed search: multi-term AND still works with stemming", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "stem4.md"),
      "---\ntitle: \"Stem\"\ncreated: 2026-04-03\ntags: [raw]\n---\n\nThe orchestration of agents is complex.\n",
    );

    // "orchestrate" stems to "orchestr", matching "orchestration"
    // "agents" stems to "agent", matching "agents"
    await run(["orchestrate", "agent"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("stem4.md");
  });

  test("stemmed search: multi-term AND rejects when one term has no stem match", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "stem5.md"),
      "---\ntitle: \"Stem\"\ncreated: 2026-04-03\ntags: [raw]\n---\n\nThe orchestration layer\n",
    );

    await run(["orchestrate", "database"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("No results found.");
  });

  test("stemmed search: 'orchestrated' finds file with 'orchestrator'", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "stem6.md"),
      "---\ntitle: \"Stem\"\ncreated: 2026-04-03\ntags: [raw]\n---\n\nThe orchestrator manages tasks\n",
    );

    await run(["orchestrated"], vault.config);
    const output = logs.join("\n");
    // Both "orchestrated" and "orchestrator" stem to "orchestr"
    expect(output).toContain("stem6.md");
  });

  // --- Relevance ranking tests ---

  test("title match ranks above body-only match", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "body-only.md"),
      "---\ntitle: \"Unrelated\"\ncreated: 2026-04-03\ntags: [raw]\n---\n\npattern matching is useful\n",
    );
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "title-match.md"),
      "---\ntitle: \"Pattern\"\ncreated: 2026-04-03\ntags: [raw]\n---\n\npattern matching is useful\n",
    );

    await run(["pattern"], vault.config);
    const output = logs.join("\n");
    const titleIdx = output.indexOf("title-match.md");
    const bodyIdx = output.indexOf("body-only.md");
    expect(titleIdx).not.toBe(-1);
    expect(bodyIdx).not.toBe(-1);
    expect(titleIdx).toBeLessThan(bodyIdx);
  });

  test("wiki location ranks above raw location", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "raw-file.md"),
      "---\ntitle: \"Concept\"\ncreated: 2026-04-03\ntags: [raw]\n---\n\nshared keyword\n",
    );
    await Bun.write(
      join(vault.config.vault, "wiki", "wiki-file.md"),
      "---\ntitle: \"Concept\"\ncreated: 2026-04-03\ntags: [raw]\n---\n\nshared keyword\n",
    );

    await run(["shared"], vault.config);
    const output = logs.join("\n");
    const wikiIdx = output.indexOf("wiki-file.md");
    const rawIdx = output.indexOf("raw-file.md");
    expect(wikiIdx).not.toBe(-1);
    expect(rawIdx).not.toBe(-1);
    expect(wikiIdx).toBeLessThan(rawIdx);
  });

  // --- Tag filtering tests ---

  test("--tag filters by single tag", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "agents.md"),
      "---\ntitle: \"Agents\"\ncreated: 2026-04-03\ntags: [agents, devops]\n---\n\nAgent orchestration\n",
    );
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "cooking.md"),
      "---\ntitle: \"Cooking\"\ncreated: 2026-04-03\ntags: [recipes]\n---\n\nAgent orchestration in the kitchen\n",
    );

    await run(["--tag", "agents", "orchestration"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("agents.md");
    expect(output).not.toContain("cooking.md");
  });

  test("--tag comma-separated uses OR logic", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "devops.md"),
      "---\ntitle: \"DevOps\"\ncreated: 2026-04-03\ntags: [devops]\n---\n\nshared keyword\n",
    );
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "agents.md"),
      "---\ntitle: \"Agents\"\ncreated: 2026-04-03\ntags: [agents]\n---\n\nshared keyword\n",
    );
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "cooking.md"),
      "---\ntitle: \"Cooking\"\ncreated: 2026-04-03\ntags: [recipes]\n---\n\nshared keyword\n",
    );

    await run(["--tag", "agents,devops", "shared"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("devops.md");
    expect(output).toContain("agents.md");
    expect(output).not.toContain("cooking.md");
  });

  test("no --tag returns all matches", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "a.md"),
      "---\ntitle: \"A\"\ncreated: 2026-04-03\ntags: [agents]\n---\n\nshared keyword\n",
    );
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "b.md"),
      "---\ntitle: \"B\"\ncreated: 2026-04-03\ntags: [recipes]\n---\n\nshared keyword\n",
    );

    await run(["shared"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("a.md");
    expect(output).toContain("b.md");
  });

  test("--tag skips file without frontmatter", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "with-fm.md"),
      "---\ntitle: \"Tagged\"\ncreated: 2026-04-03\ntags: [agents]\n---\n\nshared keyword\n",
    );
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "no-fm.md"),
      "shared keyword without any frontmatter\n",
    );

    await run(["--tag", "agents", "shared"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("with-fm.md");
    expect(output).not.toContain("no-fm.md");
  });
});
