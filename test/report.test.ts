import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createTestVault, createFakeExecutable, type TestVault } from "./helpers";
import {
  parseReportArgs,
  generateReportFilename,
  resolveReportOutputPath,
  buildReportFrontmatter,
  extractSources,
  extractRelated,
  extractTitle,
  extractSummary,
  ensureReporterAgent,
  run,
} from "../src/commands/report";

let vault: TestVault;

beforeEach(async () => {
  vault = await createTestVault();
});

afterEach(async () => {
  await vault.cleanup();
});

describe("parseReportArgs", () => {
  test("parses a simple topic", () => {
    const { options, topic } = parseReportArgs(["multi", "agent", "patterns"]);
    expect(topic).toBe("multi agent patterns");
    expect(options.printOnly).toBe(false);
    expect(options.model).toBe("sonnet");
    expect(options.verbose).toBe(false);
  });

  test("parses quoted topic as single arg", () => {
    const { topic } = parseReportArgs(["multi agent patterns"]);
    expect(topic).toBe("multi agent patterns");
  });

  test("parses -p flag", () => {
    const { options, topic } = parseReportArgs(["-p", "knowledge graphs"]);
    expect(options.printOnly).toBe(true);
    expect(topic).toBe("knowledge graphs");
  });

  test("parses --model flag", () => {
    const { options } = parseReportArgs(["--model", "opus", "test topic"]);
    expect(options.model).toBe("opus");
  });

  test("parses --verbose flag", () => {
    const { options } = parseReportArgs(["--verbose", "test topic"]);
    expect(options.verbose).toBe(true);
  });

  test("parses --stdout flag", () => {
    const { options, topic } = parseReportArgs(["--stdout", "knowledge graphs"]);
    expect(options.stdout).toBe(true);
    expect(options.printOnly).toBe(true); // --stdout implies --print
    expect(options.verbose).toBe(false); // --stdout suppresses verbose
    expect(topic).toBe("knowledge graphs");
  });

  test("--stdout overrides --verbose", () => {
    const { options } = parseReportArgs(["--stdout", "--verbose", "test topic"]);
    expect(options.stdout).toBe(true);
    expect(options.verbose).toBe(false);
  });

  test("--stdout can combine with --model", () => {
    const { options } = parseReportArgs(["--stdout", "--model", "opus", "test topic"]);
    expect(options.stdout).toBe(true);
    expect(options.model).toBe("opus");
  });

  test("throws on empty topic", () => {
    expect(() => parseReportArgs([])).toThrow();
  });
});

describe("generateReportFilename", () => {
  test("generates YYYY-MM-DD-slug.md", () => {
    const date = new Date(2026, 3, 4); // April 4, 2026
    const filename = generateReportFilename("multi agent orchestration patterns", date);
    expect(filename).toBe("2026-04-04-multi-agent-orchestration-patterns.md");
  });

  test("truncates long slugs to 60 chars", () => {
    const date = new Date(2026, 3, 4);
    const longTopic = "comprehensive analysis of all the major orchestration frameworks for multi agent systems in production environments";
    const filename = generateReportFilename(longTopic, date);
    const slug = filename.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/\.md$/, "");
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  test("handles special characters", () => {
    const date = new Date(2026, 3, 4);
    const filename = generateReportFilename("C++ templates & metaprogramming", date);
    expect(filename).toMatch(/^2026-04-04-.+\.md$/);
    expect(filename).not.toMatch(/[&+]/);
  });
});

describe("resolveReportOutputPath", () => {
  test("keeps the base filename when unused", async () => {
    const outputDir = join(vault.config.vault, "output", "reports");
    await mkdir(outputDir, { recursive: true });

    const result = await resolveReportOutputPath(
      outputDir,
      "multi agent orchestration patterns",
      new Date(2026, 3, 4),
    );

    expect(result.filename).toBe("2026-04-04-multi-agent-orchestration-patterns.md");
  });

  test("adds a numeric suffix when the filename already exists", async () => {
    const outputDir = join(vault.config.vault, "output", "reports");
    await mkdir(outputDir, { recursive: true });
    await Bun.write(
      join(outputDir, "2026-04-04-multi-agent-orchestration-patterns.md"),
      "existing",
    );

    const result = await resolveReportOutputPath(
      outputDir,
      "multi agent orchestration patterns",
      new Date(2026, 3, 4),
    );

    expect(result.filename).toBe("2026-04-04-multi-agent-orchestration-patterns-2.md");
  });
});

describe("buildReportFrontmatter", () => {
  test("builds frontmatter with sources", () => {
    const fm = buildReportFrontmatter(
      "multi agent patterns",
      "Multi Agent Patterns",
      ["[[article-one]]", "[[article-two]]"],
      [],
      new Date(2026, 3, 4),
    );
    expect(fm).toContain("title:");
    expect(fm).toContain("type: report");
    expect(fm).toContain("topic:");
    expect(fm).toContain("created: 2026-04-04");
    expect(fm).toContain("sources:");
    expect(fm).toContain("[[article-one]]");
    expect(fm).toContain("[[article-two]]");
    expect(fm).toMatch(/^---\n[\s\S]*\n---$/);
  });

  test("builds frontmatter without sources", () => {
    const fm = buildReportFrontmatter("test", "Test", [], [], new Date(2026, 3, 4));
    expect(fm).not.toContain("sources:");
  });

  test("builds frontmatter with related", () => {
    const fm = buildReportFrontmatter(
      "multi agent patterns",
      "Multi Agent Patterns",
      ["[[article-one]]"],
      ["[[related-concept]]"],
      new Date(2026, 3, 4),
    );
    expect(fm).toContain("related:");
    expect(fm).toContain("[[related-concept]]");
  });

  test("omits related when empty", () => {
    const fm = buildReportFrontmatter("test", "Test", [], [], new Date(2026, 3, 4));
    expect(fm).not.toContain("related:");
  });

  test("escapes quotes in title", () => {
    const fm = buildReportFrontmatter('the "RAG" approach', 'The "RAG" Approach', [], [], new Date(2026, 3, 4));
    expect(fm).toContain('\\"RAG\\"');
  });
});

describe("extractSources", () => {
  test("extracts wikilinks from Sources consulted section", () => {
    const body = `# Report

Some text here.

## Sources consulted
- [[multi-agent-patterns]] — orchestration concepts
- [[claude-code-subagents]] — delegation patterns
`;
    const sources = extractSources(body);
    expect(sources).toEqual(["[[multi-agent-patterns]]", "[[claude-code-subagents]]"]);
  });

  test("returns empty array when no sources section", () => {
    const body = "# Report\n\nJust some text.";
    expect(extractSources(body)).toEqual([]);
  });

  test("handles sources section at end of file", () => {
    const body = `# Report

Text.

## Sources consulted
- [[only-source]] — the only one`;
    const sources = extractSources(body);
    expect(sources).toEqual(["[[only-source]]"]);
  });
});

describe("extractRelated", () => {
  test("extracts wikilinks from body not in sources", () => {
    const body = `# Report

This relates to [[concept-a]] and [[concept-b]].

## Sources consulted
- [[concept-a]] — main source
`;
    const sources = ["[[concept-a]]"];
    const related = extractRelated(body, sources);
    expect(related).toEqual(["[[concept-b]]"]);
  });

  test("returns empty when all links are in sources", () => {
    const body = `# Report

Text referencing [[concept-a]].

## Sources consulted
- [[concept-a]] — main source
`;
    const related = extractRelated(body, ["[[concept-a]]"]);
    expect(related).toEqual([]);
  });

  test("deduplicates related links", () => {
    const body = `# Report

See [[concept-b]] for details. Also check [[concept-b]] again.

## Sources consulted
- [[concept-a]] — main source
`;
    const related = extractRelated(body, ["[[concept-a]]"]);
    expect(related).toEqual(["[[concept-b]]"]);
  });

  test("returns empty when no wikilinks in body", () => {
    const body = "# Report\n\nJust plain text.";
    expect(extractRelated(body, [])).toEqual([]);
  });
});

describe("extractTitle", () => {
  test("capitalizes words", () => {
    expect(extractTitle("multi agent orchestration patterns")).toBe("Multi Agent Orchestration Patterns");
  });

  test("strips trailing question mark", () => {
    expect(extractTitle("what is RAG?")).toBe("What Is RAG");
  });
});

describe("extractSummary", () => {
  test("extracts first paragraph after heading", () => {
    const body = `# My Report

This is the executive summary of the report. It covers the key findings.

This is the second paragraph.`;
    const summary = extractSummary(body);
    expect(summary).toBe("This is the executive summary of the report. It covers the key findings.");
  });

  test("truncates long paragraphs", () => {
    const longPara = "Word ".repeat(100).trim();
    const body = `# Title\n\n${longPara}\n\nSecond paragraph.`;
    const summary = extractSummary(body, 50);
    expect(summary.length).toBeLessThanOrEqual(55); // 50 + "..."
    expect(summary).toEndWith("...");
  });

  test("returns empty string when no heading", () => {
    expect(extractSummary("Just text, no heading.")).toBe("");
  });
});

describe("ensureReporterAgent", () => {
  test("creates reporter.md with read-only tools", async () => {
    const agentPath = await ensureReporterAgent(vault.config.vault, "sonnet");
    const content = await Bun.file(agentPath).text();

    expect(agentPath).toEndWith(".claude/agents/reporter.md");
    expect(content).toContain("model: sonnet");
    expect(content).toContain("- Read");
    expect(content).toContain("- Glob");
    expect(content).toContain("- Grep");
    // Tools section should only have read-only tools
    const toolsMatch = content.match(/tools:\n([\s\S]*?)\n---/);
    expect(toolsMatch).not.toBeNull();
    expect(toolsMatch![1]).not.toContain("Write");
    expect(toolsMatch![1]).not.toContain("Edit");
  });

  test("uses specified model", async () => {
    const agentPath = await ensureReporterAgent(vault.config.vault, "opus");
    const content = await Bun.file(agentPath).text();
    expect(content).toContain("model: opus");
  });
});

describe("run", () => {
  const originalLog = console.log;
  const originalError = console.error;
  const originalClaudeBin = process.env.BRAIN_CLAUDE_BIN;

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    if (originalClaudeBin === undefined) {
      delete process.env.BRAIN_CLAUDE_BIN;
    } else {
      process.env.BRAIN_CLAUDE_BIN = originalClaudeBin;
    }
  });

  test("print-only mode keeps markdown on stdout and progress on stderr", async () => {
    const fakeClaude = await createFakeExecutable(
      "claude",
      "#!/bin/sh\nprintf '# Report\\n\\nBody text.\\n'\n",
    );

    const logs: string[] = [];
    const errors: string[] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    process.env.BRAIN_CLAUDE_BIN = join(fakeClaude.dir, "claude");

    try {
      await run(["-p", "test topic"], vault.config);
    } finally {
      await fakeClaude.cleanup();
    }

    expect(logs).toEqual(["# Report\n\nBody text."]);
    expect(errors.join("\n")).toContain("Generating report...");
  });

  test("--stdout mode outputs only markdown, zero stderr, no file written", async () => {
    const fakeClaude = await createFakeExecutable(
      "claude",
      "#!/bin/sh\nprintf '# Report\\n\\nClean markdown body.\\n'\n",
    );

    const logs: string[] = [];
    const errors: string[] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    process.env.BRAIN_CLAUDE_BIN = join(fakeClaude.dir, "claude");

    try {
      await run(["--stdout", "test topic"], vault.config);
    } finally {
      await fakeClaude.cleanup();
    }

    // Only the raw markdown should be on stdout
    expect(logs).toEqual(["# Report\n\nClean markdown body."]);
    // Zero stderr output
    expect(errors).toEqual([]);

    // No file should be written
    const outputDir = join(vault.config.vault, "output", "reports");
    const glob = new Bun.Glob("*.md");
    const files: string[] = [];
    try {
      for await (const f of glob.scan({ cwd: outputDir, absolute: false })) {
        files.push(f);
      }
    } catch {
      // Directory may not exist, that's expected
    }
    expect(files).toHaveLength(0);
  });

  test("--stdout with --model still respects model", async () => {
    const fakeClaude = await createFakeExecutable(
      "claude",
      "#!/bin/sh\nprintf '# Report\\n\\nBody.\\n'\n",
    );

    const logs: string[] = [];
    const errors: string[] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    process.env.BRAIN_CLAUDE_BIN = join(fakeClaude.dir, "claude");

    try {
      await run(["--stdout", "--model", "opus", "test topic"], vault.config);
    } finally {
      await fakeClaude.cleanup();
    }

    // Verify model was passed to agent config
    const agentContent = await Bun.file(
      join(vault.config.vault, ".claude", "agents", "reporter.md"),
    ).text();
    expect(agentContent).toContain("model: opus");

    // Still only markdown on stdout, no stderr
    expect(logs).toEqual(["# Report\n\nBody."]);
    expect(errors).toEqual([]);
  });

  test("default mode writes file with related field in frontmatter", async () => {
    const fakeClaude = await createFakeExecutable(
      "claude",
      `#!/bin/sh
printf '# Report\\n\\nThis relates to [[other-concept]].\\n\\n## Sources consulted\\n- [[main-source]] — main ref\\n'`,
    );

    const logs: string[] = [];
    const errors: string[] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    process.env.BRAIN_CLAUDE_BIN = join(fakeClaude.dir, "claude");

    try {
      await run(["test topic"], vault.config);
    } finally {
      await fakeClaude.cleanup();
    }

    // Check that the file was written with related field
    const outputDir = join(vault.config.vault, "output", "reports");
    const glob = new Bun.Glob("*.md");
    const files: string[] = [];
    for await (const f of glob.scan({ cwd: outputDir, absolute: false })) {
      files.push(f);
    }
    expect(files).toHaveLength(1);

    const content = await Bun.file(join(outputDir, files[0]!)).text();
    expect(content).toContain("sources:");
    expect(content).toContain("[[main-source]]");
    expect(content).toContain("related:");
    expect(content).toContain("[[other-concept]]");
  });
});
