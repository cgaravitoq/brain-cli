import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createTestVault, type TestVault } from "../helpers";
import { generateFrontmatter } from "../../src/frontmatter";
import { checkLinks, fixBrokenLinks } from "../../src/lint/links";
import { checkFrontmatter } from "../../src/lint/frontmatter";
import { checkOrphans } from "../../src/lint/orphans";
import { checkStale } from "../../src/lint/stale";
import { run } from "../../src/commands/lint";

describe("lint: checkLinks", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
  });

  afterEach(async () => {
    await vault.cleanup();
  });

  test("detects broken wikilinks", async () => {
    const fm = generateFrontmatter({
      title: "Test Note",
      created: "2026-04-04",
      tags: ["test"],
    });
    await Bun.write(
      join(vault.config.vault, "wiki", "test-note.md"),
      `${fm}\n\nSee [[nonexistent]] and [[also missing]].\n`,
    );

    const issues = await checkLinks(vault.config.vault);
    expect(issues.length).toBe(2);
    expect(issues.map((i) => i.link)).toContain("nonexistent");
    expect(issues.map((i) => i.link)).toContain("also missing");
  });

  test("valid links pass (by filename)", async () => {
    const fm1 = generateFrontmatter({
      title: "Concept A",
      created: "2026-04-04",
      tags: ["wiki"],
    });
    const fm2 = generateFrontmatter({
      title: "Concept B",
      created: "2026-04-04",
      tags: ["wiki"],
    });
    await Bun.write(
      join(vault.config.vault, "wiki", "concept-a.md"),
      `${fm1}\n\nLinks to [[concept-b]].\n`,
    );
    await Bun.write(
      join(vault.config.vault, "wiki", "concept-b.md"),
      `${fm2}\n\nLinks to [[concept-a]].\n`,
    );

    const issues = await checkLinks(vault.config.vault);
    expect(issues.length).toBe(0);
  });

  test("valid links pass (by title)", async () => {
    const fm1 = generateFrontmatter({
      title: "Concept A",
      created: "2026-04-04",
      tags: ["wiki"],
    });
    const fm2 = generateFrontmatter({
      title: "Concept B",
      created: "2026-04-04",
      tags: ["wiki"],
    });
    await Bun.write(
      join(vault.config.vault, "wiki", "concept-a.md"),
      `${fm1}\n\nLinks to [[Concept B]].\n`,
    );
    await Bun.write(
      join(vault.config.vault, "wiki", "concept-b.md"),
      `${fm2}\n\nLinks to [[Concept A]].\n`,
    );

    const issues = await checkLinks(vault.config.vault);
    expect(issues.length).toBe(0);
  });

  test("handles display text syntax [[target|display]]", async () => {
    const fm = generateFrontmatter({
      title: "Test",
      created: "2026-04-04",
      tags: ["test"],
    });
    await Bun.write(
      join(vault.config.vault, "wiki", "test.md"),
      `${fm}\n\nSee [[nonexistent|shown text]].\n`,
    );

    const issues = await checkLinks(vault.config.vault);
    expect(issues.length).toBe(1);
    expect(issues[0]!.link).toBe("nonexistent");
  });
});

describe("lint: fixBrokenLinks", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
  });

  afterEach(async () => {
    await vault.cleanup();
  });

  test("removes broken wikilink syntax, keeps text", async () => {
    const fm = generateFrontmatter({
      title: "Test",
      created: "2026-04-04",
      tags: ["test"],
    });
    await Bun.write(
      join(vault.config.vault, "wiki", "test.md"),
      `${fm}\n\nSee [[broken link]] and [[broken|display text]].\n`,
    );

    const issues = await checkLinks(vault.config.vault);
    expect(issues.length).toBe(2);

    const fixed = await fixBrokenLinks(vault.config.vault, issues);
    expect(fixed).toBe(2);

    const content = await Bun.file(
      join(vault.config.vault, "wiki", "test.md"),
    ).text();
    expect(content).toContain("See broken link and display text.");
    expect(content).not.toContain("[[");
  });
});

describe("lint: checkFrontmatter", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
  });

  afterEach(async () => {
    await vault.cleanup();
  });

  test("detects missing required fields", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "bad.md"),
      "---\ntitle: Only Title\n---\n\nBody.\n",
    );

    const issues = await checkFrontmatter(vault.config.vault);
    expect(issues.length).toBe(1);
    expect(issues[0]!.missing).toContain("created");
    expect(issues[0]!.missing).toContain("tags");
    expect(issues[0]!.missing).not.toContain("title");
  });

  test("reports all 3 fields missing when no frontmatter", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "bare.md"),
      "Just a plain markdown file.\n",
    );

    const issues = await checkFrontmatter(vault.config.vault);
    expect(issues.length).toBe(1);
    expect(issues[0]!.missing).toEqual(["title", "created", "tags"]);
  });

  test("passes when all required fields present", async () => {
    const fm = generateFrontmatter({
      title: "Good Note",
      created: "2026-04-04",
      tags: ["test"],
    });
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "good.md"),
      `${fm}\n\nBody.\n`,
    );

    const issues = await checkFrontmatter(vault.config.vault);
    expect(issues.length).toBe(0);
  });
});

describe("lint: checkOrphans", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
  });

  afterEach(async () => {
    await vault.cleanup();
  });

  test("detects orphaned wiki files", async () => {
    const fm = generateFrontmatter({
      title: "Lonely",
      created: "2026-04-04",
      tags: ["wiki"],
    });
    await Bun.write(
      join(vault.config.vault, "wiki", "lonely.md"),
      `${fm}\n\nNo one links here.\n`,
    );

    const issues = await checkOrphans(vault.config.vault);
    expect(issues.length).toBe(1);
    expect(issues[0]!.file).toBe("wiki/lonely.md");
  });

  test("does not flag wiki files with inbound links", async () => {
    const fm1 = generateFrontmatter({
      title: "Linked",
      created: "2026-04-04",
      tags: ["wiki"],
    });
    const fm2 = generateFrontmatter({
      title: "Linker",
      created: "2026-04-04",
      tags: ["raw"],
    });
    await Bun.write(
      join(vault.config.vault, "wiki", "linked.md"),
      `${fm1}\n\nContent.\n`,
    );
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "linker.md"),
      `${fm2}\n\nSee [[linked]].\n`,
    );

    const issues = await checkOrphans(vault.config.vault);
    expect(issues.length).toBe(0);
  });

  test("excludes wiki/indexes from orphan detection", async () => {
    await mkdir(join(vault.config.vault, "wiki", "indexes"), {
      recursive: true,
    });
    const fm = generateFrontmatter({
      title: "Index Page",
      created: "2026-04-04",
      tags: ["wiki"],
    });
    await Bun.write(
      join(vault.config.vault, "wiki", "indexes", "index.md"),
      `${fm}\n\nIndex.\n`,
    );

    const issues = await checkOrphans(vault.config.vault);
    expect(issues.length).toBe(0);
  });
});

describe("lint: checkStale", () => {
  let vault: TestVault;

  beforeEach(async () => {
    vault = await createTestVault();
  });

  afterEach(async () => {
    await vault.cleanup();
  });

  test("detects stale raw files", async () => {
    const oldDate = "2025-01-01";
    const fm = generateFrontmatter({
      title: "Old Note",
      created: oldDate,
      tags: ["raw"],
    });
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "old-note.md"),
      `${fm}\n\nOld content.\n`,
    );

    const issues = await checkStale(vault.config.vault);
    expect(issues.length).toBe(1);
    expect(issues[0]!.file).toBe("raw/notes/old-note.md");
    expect(issues[0]!.age).toBeGreaterThan(30);
  });

  test("does not flag processed files", async () => {
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "processed.md"),
      "---\ntitle: Processed\ncreated: 2025-01-01\ntags: [raw]\nstatus: processed\n---\n\nDone.\n",
    );

    const issues = await checkStale(vault.config.vault);
    expect(issues.length).toBe(0);
  });

  test("does not flag recent files", async () => {
    const today = new Date().toISOString().split("T")[0]!;
    const fm = generateFrontmatter({
      title: "Fresh Note",
      created: today,
      tags: ["raw"],
    });
    await Bun.write(
      join(vault.config.vault, "raw", "notes", "fresh.md"),
      `${fm}\n\nNew content.\n`,
    );

    const issues = await checkStale(vault.config.vault);
    expect(issues.length).toBe(0);
  });
});

describe("lint: run (integration)", () => {
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

  test("empty vault is clean", async () => {
    await run([], vault.config);
    // No sections printed means clean
    expect(logs.length).toBe(0);
  });

  test("reports errors and warnings together", async () => {
    // Create a file with broken link (error)
    const fm = generateFrontmatter({
      title: "Test",
      created: "2026-04-04",
      tags: ["test"],
    });
    await Bun.write(
      join(vault.config.vault, "wiki", "test.md"),
      `${fm}\n\nSee [[nonexistent]].\n`,
    );

    await expect(run([], vault.config)).rejects.toThrow("lint found");
    const output = logs.join("\n");
    expect(output).toContain("Links");
    expect(output).toContain("broken link [[nonexistent]]");
    expect(output).toContain("Orphans");
    expect(output).toContain("error(s)");
    expect(output).toContain("warning(s)");
  });

  test("--check runs only specified check", async () => {
    // Create a file with broken link AND missing frontmatter
    await Bun.write(
      join(vault.config.vault, "wiki", "test.md"),
      "No frontmatter here. See [[broken]].\n",
    );

    await expect(run(["--check", "links"], vault.config)).rejects.toThrow("lint found");
    const output = logs.join("\n");
    expect(output).toContain("Links");
    expect(output).not.toContain("Frontmatter");
  });

  test("--fix repairs broken links", async () => {
    const fm = generateFrontmatter({
      title: "Test",
      created: "2026-04-04",
      tags: ["test"],
    });
    await Bun.write(
      join(vault.config.vault, "wiki", "test.md"),
      `${fm}\n\nSee [[broken link]].\n`,
    );

    await run(["--fix"], vault.config);
    const output = logs.join("\n");
    expect(output).toContain("Fixed");

    // Verify the file was actually fixed
    const content = await Bun.file(
      join(vault.config.vault, "wiki", "test.md"),
    ).text();
    expect(content).not.toContain("[[broken link]]");
    expect(content).toContain("broken link");
  });
});
