import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { createTestVault, type TestVault } from "../helpers";
import { run } from "../../src/commands/search";

describe("search weighting", () => {
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

  test("title outranks body-heavy match", async () => {
    // File with query term in title but only one body mention
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "title-hit.md"),
      "---\ntitle: \"Kubernetes\"\ncreated: 2026-04-03\ntags: [devops]\n---\n\nA brief note about container orchestration.\n",
    );
    // File with many body mentions but no title match
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "body-heavy.md"),
      "---\ntitle: \"Container Notes\"\ncreated: 2026-04-03\ntags: [devops]\n---\n\nKubernetes is great. Kubernetes scales well. Kubernetes handles pods. Kubernetes manages clusters. Kubernetes automates deployment.\n",
    );

    await run(["kubernetes"], vault.config);
    const output = logs.join("\n");
    const titleIdx = output.indexOf("title-hit.md");
    const bodyIdx = output.indexOf("body-heavy.md");
    expect(titleIdx).not.toBe(-1);
    expect(bodyIdx).not.toBe(-1);
    // Title match (+10 + 1 body) = 11 should beat body-only (5 body occurrences capped) = 5
    expect(titleIdx).toBeLessThan(bodyIdx);
  });

  test("alias contributes to score", async () => {
    // File with query term in aliases
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "alias-hit.md"),
      "---\ntitle: \"Container Orchestration\"\ncreated: 2026-04-03\ntags: [devops]\naliases: [k8s, kube]\n---\n\nManages containers at scale.\nkube is shorthand.\n",
    );
    // File with query term only in body
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "body-only.md"),
      "---\ntitle: \"Other Notes\"\ncreated: 2026-04-03\ntags: [devops]\n---\n\nkube is sometimes used as shorthand.\n",
    );

    await run(["kube"], vault.config);
    const output = logs.join("\n");
    const aliasIdx = output.indexOf("alias-hit.md");
    const bodyIdx = output.indexOf("body-only.md");
    expect(aliasIdx).not.toBe(-1);
    expect(bodyIdx).not.toBe(-1);
    // Alias match (+8) + body mention should outscore body-only mention
    expect(aliasIdx).toBeLessThan(bodyIdx);
  });

  test("frontmatter YAML keys don't cause false positives", async () => {
    // File where "title" only appears as a YAML key, not in body/title value/tags/aliases
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "yaml-key.md"),
      "---\ntitle: \"Something Else\"\ncreated: 2026-04-03\ntags: [raw]\n---\n\nThis document has no mention of the search term in its body.\n",
    );

    // Searching for "title" should not match because "title" only appears as a YAML key
    await run(["title"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("No results found.");
  });

  test("body-only scoring strips frontmatter", async () => {
    // File where "created" appears in raw YAML but not in body, title, tags, or aliases
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "fm-only.md"),
      "---\ntitle: \"My Note\"\ncreated: 2026-04-03\ntags: [raw]\n---\n\nThis body talks about something entirely different.\n",
    );

    // Searching for "created" should not match: it only appears as a YAML key
    await run(["created"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("No results found.");
  });
});
