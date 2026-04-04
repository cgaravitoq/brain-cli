import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createTestVault, createFakeExecutable, type TestVault } from "./helpers";
import {
  parseChartArgs,
  generateChartFilename,
  resolveChartOutputPath,
  buildChartFrontmatter,
  buildMarkdownWrapper,
  parseChartJson,
  ensureChartistAgent,
  run,
} from "../src/commands/chart";

let vault: TestVault;

beforeEach(async () => {
  vault = await createTestVault();
});

afterEach(async () => {
  await vault.cleanup();
});

describe("parseChartArgs", () => {
  test("parses a simple query", () => {
    const { options, question } = parseChartArgs(["show", "usage", "over", "time"]);
    expect(question).toBe("show usage over time");
    expect(options.printOnly).toBe(false);
    expect(options.model).toBe("sonnet");
    expect(options.verbose).toBe(false);
  });

  test("parses -p flag", () => {
    const { options, question } = parseChartArgs(["-p", "chart topic counts"]);
    expect(options.printOnly).toBe(true);
    expect(question).toBe("chart topic counts");
  });

  test("parses --model flag", () => {
    const { options } = parseChartArgs(["--model", "opus", "test query"]);
    expect(options.model).toBe("opus");
  });

  test("parses --verbose flag", () => {
    const { options } = parseChartArgs(["--verbose", "test query"]);
    expect(options.verbose).toBe(true);
  });

  test("parses --stdout flag", () => {
    const { options, question } = parseChartArgs(["--stdout", "test query"]);
    expect(options.stdout).toBe(true);
    expect(options.printOnly).toBe(true);
    expect(options.verbose).toBe(false);
    expect(question).toBe("test query");
  });

  test("throws on empty query", () => {
    expect(() => parseChartArgs([])).toThrow();
  });
});

describe("generateChartFilename", () => {
  test("produces stem without extension", () => {
    const date = new Date(2026, 3, 4);
    const stem = generateChartFilename("topic distribution", date);
    expect(stem).toBe("2026-04-04-topic-distribution");
    expect(stem).not.toContain(".md");
    expect(stem).not.toContain(".png");
  });

  test("truncates long slugs to 60 chars", () => {
    const date = new Date(2026, 3, 4);
    const longQ = "what are the key differences between all the major orchestration frameworks for multi agent systems in production";
    const stem = generateChartFilename(longQ, date);
    const slug = stem.replace(/^\d{4}-\d{2}-\d{2}-/, "");
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  test("handles special characters", () => {
    const date = new Date(2026, 3, 4);
    const stem = generateChartFilename("what's the trend in C++?", date);
    expect(stem).toMatch(/^2026-04-04-.+$/);
    expect(stem).not.toMatch(/[?']/);
  });
});

describe("resolveChartOutputPath", () => {
  test("returns both .md and .png paths", async () => {
    const outputDir = join(vault.config.vault, "output", "charts");
    await mkdir(outputDir, { recursive: true });

    const result = await resolveChartOutputPath(
      outputDir,
      "topic distribution",
      new Date(2026, 3, 4),
    );

    expect(result.stem).toBe("2026-04-04-topic-distribution");
    expect(result.mdPath).toEndWith("2026-04-04-topic-distribution.md");
    expect(result.pngPath).toEndWith("2026-04-04-topic-distribution.png");
  });

  test("adds numeric suffix when md already exists", async () => {
    const outputDir = join(vault.config.vault, "output", "charts");
    await mkdir(outputDir, { recursive: true });
    await Bun.write(join(outputDir, "2026-04-04-topic-distribution.md"), "existing");

    const result = await resolveChartOutputPath(
      outputDir,
      "topic distribution",
      new Date(2026, 3, 4),
    );

    expect(result.stem).toBe("2026-04-04-topic-distribution-2");
    expect(result.mdPath).toEndWith("2026-04-04-topic-distribution-2.md");
    expect(result.pngPath).toEndWith("2026-04-04-topic-distribution-2.png");
  });

  test("adds numeric suffix when png already exists", async () => {
    const outputDir = join(vault.config.vault, "output", "charts");
    await mkdir(outputDir, { recursive: true });
    await Bun.write(join(outputDir, "2026-04-04-topic-distribution.png"), "existing");

    const result = await resolveChartOutputPath(
      outputDir,
      "topic distribution",
      new Date(2026, 3, 4),
    );

    expect(result.stem).toBe("2026-04-04-topic-distribution-2");
  });
});

describe("buildChartFrontmatter", () => {
  test("builds frontmatter with type: chart", () => {
    const fm = buildChartFrontmatter(
      "topic distribution",
      "Topic Distribution",
      ["[[article-one]]", "[[article-two]]"],
      [],
      new Date(2026, 3, 4),
    );
    expect(fm).toContain("title:");
    expect(fm).toContain("type: chart");
    expect(fm).toContain("question:");
    expect(fm).toContain("created: 2026-04-04");
    expect(fm).toContain("sources:");
    expect(fm).toContain("[[article-one]]");
    expect(fm).toContain("[[article-two]]");
    expect(fm).toMatch(/^---\n[\s\S]*\n---$/);
  });

  test("builds frontmatter without sources", () => {
    const fm = buildChartFrontmatter("test", "Test", [], [], new Date(2026, 3, 4));
    expect(fm).not.toContain("sources:");
  });

  test("builds frontmatter with related", () => {
    const fm = buildChartFrontmatter(
      "topic distribution",
      "Topic Distribution",
      ["[[article-one]]"],
      ["[[related-concept]]"],
      new Date(2026, 3, 4),
    );
    expect(fm).toContain("related:");
    expect(fm).toContain("[[related-concept]]");
  });

  test("omits related when empty", () => {
    const fm = buildChartFrontmatter("test", "Test", [], [], new Date(2026, 3, 4));
    expect(fm).not.toContain("related:");
  });

  test("escapes quotes in title", () => {
    const fm = buildChartFrontmatter('show "RAG" stats', 'Show "RAG" Stats', [], [], new Date(2026, 3, 4));
    expect(fm).toContain('\\"RAG\\"');
  });
});

describe("buildMarkdownWrapper", () => {
  test("includes image embed", () => {
    const md = buildMarkdownWrapper("chart.png", "My Chart", "| A | B |\n|---|---|\n| 1 | 2 |", "");
    expect(md).toContain("![[chart.png]]");
  });

  test("includes title as heading", () => {
    const md = buildMarkdownWrapper("chart.png", "My Chart", "", "");
    expect(md).toContain("# My Chart");
  });

  test("includes data table", () => {
    const table = "| X | Y |\n|---|---|\n| A | 1 |\n| B | 2 |";
    const md = buildMarkdownWrapper("chart.png", "My Chart", table, "");
    expect(md).toContain("## Data");
    expect(md).toContain(table);
  });

  test("includes sources text", () => {
    const sources = "## Sources consulted\n- [[test-article]] — data source";
    const md = buildMarkdownWrapper("chart.png", "My Chart", "", sources);
    expect(md).toContain("## Sources consulted");
    expect(md).toContain("[[test-article]]");
  });

  test("omits data section when empty", () => {
    const md = buildMarkdownWrapper("chart.png", "My Chart", "", "");
    expect(md).not.toContain("## Data");
  });

  test("omits sources section when empty", () => {
    const md = buildMarkdownWrapper("chart.png", "My Chart", "", "");
    expect(md).not.toContain("## Sources");
  });
});

describe("parseChartJson", () => {
  test("parses valid JSON", () => {
    const json = JSON.stringify({
      title: "Test Chart",
      chart_type: "bar",
      python_code: "import matplotlib.pyplot as plt\nimport sys\nplt.bar(['A','B'],[1,2])\nplt.tight_layout()\nplt.savefig(sys.argv[1])",
      data_table: "| X | Y |\n|---|---|\n| A | 1 |\n| B | 2 |",
      sources: "## Sources consulted\n- [[test-article]] — data source",
    });
    const result = parseChartJson(json);
    expect(result.title).toBe("Test Chart");
    expect(result.chart_type).toBe("bar");
    expect(result.python_code).toContain("matplotlib");
    expect(result.data_table).toContain("| X | Y |");
    expect(result.sources).toContain("[[test-article]]");
  });

  test("throws on invalid JSON", () => {
    expect(() => parseChartJson("not json")).toThrow("chart agent returned invalid JSON");
  });

  test("throws on missing required fields", () => {
    const incomplete = JSON.stringify({ title: "Test" });
    expect(() => parseChartJson(incomplete)).toThrow("chart agent response missing required fields");
  });

  test("throws when field is wrong type", () => {
    const wrongType = JSON.stringify({
      title: "Test",
      chart_type: "bar",
      python_code: 123,
      data_table: "table",
      sources: "sources",
    });
    expect(() => parseChartJson(wrongType)).toThrow("chart agent response missing required fields");
  });
});

describe("ensureChartistAgent", () => {
  test("creates chartist.md with read-only tools", async () => {
    const agentPath = await ensureChartistAgent(vault.config.vault, "sonnet");
    const content = await Bun.file(agentPath).text();

    expect(agentPath).toEndWith(".claude/agents/chartist.md");
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
    const agentPath = await ensureChartistAgent(vault.config.vault, "opus");
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

  const hasMpl = Bun.spawnSync(["python3", "-c", "import matplotlib"]).exitCode === 0;

  (hasMpl ? test : test.skip)("run generates chart files", async () => {
    const fakeClaude = await createFakeExecutable(
      "claude",
      `#!/bin/sh
printf '{"title":"Test Chart","chart_type":"bar","python_code":"import matplotlib.pyplot as plt\\nimport sys\\nplt.bar([\\"A\\",\\"B\\"],[1,2])\\nplt.tight_layout()\\nplt.savefig(sys.argv[1])","data_table":"| X | Y |\\n|---|---|\\n| A | 1 |\\n| B | 2 |","sources":"## Sources consulted\\n- [[test-article]] — data source"}'`,
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
      await run(["test chart query"], vault.config);
    } finally {
      await fakeClaude.cleanup();
    }

    // Check that files were written
    const outputDir = join(vault.config.vault, "output", "charts");
    const mdGlob = new Bun.Glob("*.md");
    const pngGlob = new Bun.Glob("*.png");
    const mdFiles: string[] = [];
    const pngFiles: string[] = [];
    for await (const f of mdGlob.scan({ cwd: outputDir, absolute: false })) {
      mdFiles.push(f);
    }
    for await (const f of pngGlob.scan({ cwd: outputDir, absolute: false })) {
      pngFiles.push(f);
    }
    expect(mdFiles).toHaveLength(1);
    expect(pngFiles).toHaveLength(1);

    // Check markdown content
    const mdContent = await Bun.file(join(outputDir, mdFiles[0]!)).text();
    expect(mdContent).toContain("type: chart");
    expect(mdContent).toContain("![[");
    expect(mdContent).toContain(".png]]");
    expect(mdContent).toContain("[[test-article]]");

    // Check logs
    const logsStr = logs.join("\n");
    expect(logsStr).toContain("Chart saved:");
    expect(logsStr).toContain("Image saved:");
  });

  (hasMpl ? test : test.skip)("--stdout mode outputs markdown only", async () => {
    const fakeClaude = await createFakeExecutable(
      "claude",
      `#!/bin/sh
printf '{"title":"Test Chart","chart_type":"bar","python_code":"import matplotlib.pyplot as plt\\nimport sys\\nplt.bar([\\"A\\",\\"B\\"],[1,2])\\nplt.tight_layout()\\nplt.savefig(sys.argv[1])","data_table":"| X | Y |\\n|---|---|\\n| A | 1 |\\n| B | 2 |","sources":"## Sources consulted\\n- [[test-article]] — data source"}'`,
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
      await run(["--stdout", "test chart query"], vault.config);
    } finally {
      await fakeClaude.cleanup();
    }

    // Only markdown on stdout, no stderr
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0]).toContain("# Test Chart");
    expect(errors).toEqual([]);

    // No files should be written
    const outputDir = join(vault.config.vault, "output", "charts");
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

  (hasMpl ? test : test.skip)("-p mode outputs markdown to stdout with progress on stderr", async () => {
    const fakeClaude = await createFakeExecutable(
      "claude",
      `#!/bin/sh
printf '{"title":"Test Chart","chart_type":"bar","python_code":"import matplotlib.pyplot as plt\\nimport sys\\nplt.bar([\\"A\\",\\"B\\"],[1,2])\\nplt.tight_layout()\\nplt.savefig(sys.argv[1])","data_table":"| X | Y |\\n|---|---|\\n| A | 1 |\\n| B | 2 |","sources":"## Sources consulted\\n- [[test-article]] — data source"}'`,
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
      await run(["-p", "test chart query"], vault.config);
    } finally {
      await fakeClaude.cleanup();
    }

    expect(logs[0]).toContain("# Test Chart");
    expect(errors.join("\n")).toContain("Generating chart...");
  });
});
