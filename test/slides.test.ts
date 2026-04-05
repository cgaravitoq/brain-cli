import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createTestVault, createFakeExecutable, type TestVault } from "./helpers";
import {
  parseSlidesArgs,
  generateSlidesFilename,
  resolveSlidesOutputPath,
  buildSlidesFrontmatter,
  ensurePresenterAgent,
  run,
} from "../src/commands/slides";
import { extractSources, extractRelated, extractTitle } from "../src/commands/shared";

let vault: TestVault;

beforeEach(async () => {
  vault = await createTestVault();
});

afterEach(async () => {
  await vault.cleanup();
});

describe("parseSlidesArgs", () => {
  test("parses a simple topic", () => {
    const { options, question } = parseSlidesArgs(["intro", "to", "RAG"]);
    expect(question).toBe("intro to RAG");
    expect(options.printOnly).toBe(false);
    expect(options.model).toBe("sonnet");
    expect(options.verbose).toBe(false);
    expect(options.count).toBe(10);
  });

  test("parses -p flag", () => {
    const { options, question } = parseSlidesArgs(["-p", "multi-agent systems"]);
    expect(options.printOnly).toBe(true);
    expect(question).toBe("multi-agent systems");
  });

  test("parses --model flag", () => {
    const { options } = parseSlidesArgs(["--model", "opus", "test topic"]);
    expect(options.model).toBe("opus");
  });

  test("parses --verbose flag", () => {
    const { options } = parseSlidesArgs(["--verbose", "test topic"]);
    expect(options.verbose).toBe(true);
  });

  test("parses --stdout flag", () => {
    const { options, question } = parseSlidesArgs(["--stdout", "test topic"]);
    expect(options.stdout).toBe(true);
    expect(options.printOnly).toBe(true);
    expect(options.verbose).toBe(false);
    expect(question).toBe("test topic");
  });

  test("parses --count flag", () => {
    const { options } = parseSlidesArgs(["--count", "15", "test topic"]);
    expect(options.count).toBe(15);
  });

  test("default count is 10", () => {
    const { options } = parseSlidesArgs(["test topic"]);
    expect(options.count).toBe(10);
  });

  test("throws on empty topic", () => {
    expect(() => parseSlidesArgs([])).toThrow();
  });
});

describe("generateSlidesFilename", () => {
  test("generates YYYY-MM-DD-slug.md", () => {
    const date = new Date(2026, 3, 4);
    const filename = generateSlidesFilename("intro to RAG pipelines", date);
    expect(filename).toBe("2026-04-04-intro-to-rag-pipelines.md");
  });

  test("truncates long slugs to 60 chars", () => {
    const date = new Date(2026, 3, 4);
    const longTopic = "a comprehensive overview of all the major orchestration frameworks for multi agent systems in production environments";
    const filename = generateSlidesFilename(longTopic, date);
    const slug = filename.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/\.md$/, "");
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  test("handles special characters", () => {
    const date = new Date(2026, 3, 4);
    const filename = generateSlidesFilename("what's new in C++ templates?", date);
    expect(filename).toMatch(/^2026-04-04-.+\.md$/);
    expect(filename).not.toMatch(/[?']/);
  });
});

describe("resolveSlidesOutputPath", () => {
  test("keeps the base filename when unused", async () => {
    const outputDir = join(vault.config.vault, "output", "slides");
    await mkdir(outputDir, { recursive: true });

    const result = await resolveSlidesOutputPath(
      outputDir,
      "intro to RAG pipelines",
      new Date(2026, 3, 4),
    );

    expect(result.filename).toBe("2026-04-04-intro-to-rag-pipelines.md");
  });

  test("adds a numeric suffix when the filename already exists", async () => {
    const outputDir = join(vault.config.vault, "output", "slides");
    await mkdir(outputDir, { recursive: true });
    await Bun.write(
      join(outputDir, "2026-04-04-intro-to-rag-pipelines.md"),
      "existing",
    );

    const result = await resolveSlidesOutputPath(
      outputDir,
      "intro to RAG pipelines",
      new Date(2026, 3, 4),
    );

    expect(result.filename).toBe("2026-04-04-intro-to-rag-pipelines-2.md");
  });
});

describe("buildSlidesFrontmatter", () => {
  test("includes marp: true", () => {
    const fm = buildSlidesFrontmatter("test topic", "Test Topic", [], [], new Date(2026, 3, 4));
    expect(fm).toContain("marp: true");
  });

  test("includes theme: default", () => {
    const fm = buildSlidesFrontmatter("test topic", "Test Topic", [], [], new Date(2026, 3, 4));
    expect(fm).toContain("theme: default");
  });

  test("includes paginate: true", () => {
    const fm = buildSlidesFrontmatter("test topic", "Test Topic", [], [], new Date(2026, 3, 4));
    expect(fm).toContain("paginate: true");
  });

  test("includes title", () => {
    const fm = buildSlidesFrontmatter("test topic", "Test Topic", [], [], new Date(2026, 3, 4));
    expect(fm).toContain("title:");
    expect(fm).toContain("Test Topic");
  });

  test("includes type: slides", () => {
    const fm = buildSlidesFrontmatter("test topic", "Test Topic", [], [], new Date(2026, 3, 4));
    expect(fm).toContain("type: slides");
  });

  test("includes question", () => {
    const fm = buildSlidesFrontmatter("test topic", "Test Topic", [], [], new Date(2026, 3, 4));
    expect(fm).toContain("question:");
    expect(fm).toContain("test topic");
  });

  test("includes created date", () => {
    const fm = buildSlidesFrontmatter("test topic", "Test Topic", [], [], new Date(2026, 3, 4));
    expect(fm).toContain("created: 2026-04-04");
  });

  test("builds frontmatter with sources", () => {
    const fm = buildSlidesFrontmatter(
      "intro to RAG",
      "Intro To RAG",
      ["[[rag-overview]]", "[[vector-search]]"],
      [],
      new Date(2026, 3, 4),
    );
    expect(fm).toContain("sources:");
    expect(fm).toContain("[[rag-overview]]");
    expect(fm).toContain("[[vector-search]]");
    expect(fm).toMatch(/^---\n[\s\S]*\n---$/);
  });

  test("builds frontmatter without sources", () => {
    const fm = buildSlidesFrontmatter("test", "Test", [], [], new Date(2026, 3, 4));
    expect(fm).not.toContain("sources:");
  });

  test("builds frontmatter with related", () => {
    const fm = buildSlidesFrontmatter(
      "intro to RAG",
      "Intro To RAG",
      ["[[rag-overview]]"],
      ["[[related-concept]]"],
      new Date(2026, 3, 4),
    );
    expect(fm).toContain("related:");
    expect(fm).toContain("[[related-concept]]");
  });

  test("omits related when empty", () => {
    const fm = buildSlidesFrontmatter("test", "Test", [], [], new Date(2026, 3, 4));
    expect(fm).not.toContain("related:");
  });

  test("escapes quotes in title", () => {
    const fm = buildSlidesFrontmatter('what is "RAG"?', 'What Is "RAG"', [], [], new Date(2026, 3, 4));
    expect(fm).toContain('\\"RAG\\"');
  });
});

describe("extractSources (slides context)", () => {
  test("extracts wikilinks from Sources consulted section", () => {
    const body = `# Title Slide

---

## Key Concepts

- Point one referencing [[concept-a]]
- Point two

---

## Sources consulted
- [[concept-a]] — overview
- [[concept-b]] — details
`;
    const sources = extractSources(body);
    expect(sources).toEqual(["[[concept-a]]", "[[concept-b]]"]);
  });

  test("returns empty array when no sources section", () => {
    const body = "# Title\n\nJust some slides.";
    expect(extractSources(body)).toEqual([]);
  });
});

describe("extractRelated (slides context)", () => {
  test("extracts wikilinks from body not in sources", () => {
    const body = `# Title

---

## Content

- See [[concept-a]] and [[concept-b]]

---

## Sources consulted
- [[concept-a]] — main source
`;
    const sources = ["[[concept-a]]"];
    const related = extractRelated(body, sources);
    expect(related).toEqual(["[[concept-b]]"]);
  });
});

describe("extractTitle (slides context)", () => {
  test("capitalizes words", () => {
    expect(extractTitle("intro to rag pipelines")).toBe("Intro To Rag Pipelines");
  });

  test("strips trailing question mark", () => {
    expect(extractTitle("what is RAG?")).toBe("What Is RAG");
  });
});

describe("ensurePresenterAgent", () => {
  test("creates presenter.md with read-only tools", async () => {
    const agentPath = await ensurePresenterAgent(vault.config.vault, "sonnet");
    const content = await Bun.file(agentPath).text();

    expect(agentPath).toEndWith(".claude/agents/presenter.md");
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
    const agentPath = await ensurePresenterAgent(vault.config.vault, "opus");
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
      "#!/bin/sh\nprintf '# Title Slide\\n\\n---\\n\\n## Content\\n\\n- Point one\\n'\n",
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

    expect(logs).toEqual(["# Title Slide\n\n---\n\n## Content\n\n- Point one"]);
    expect(errors.join("\n")).toContain("Generating slides...");
  });

  test("--stdout mode outputs only markdown, zero stderr, no file written", async () => {
    const fakeClaude = await createFakeExecutable(
      "claude",
      "#!/bin/sh\nprintf '# Title Slide\\n\\n---\\n\\n## Content\\n\\n- Point one\\n'\n",
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

    expect(logs).toEqual(["# Title Slide\n\n---\n\n## Content\n\n- Point one"]);
    expect(errors).toEqual([]);

    // No file should be written
    const outputDir = join(vault.config.vault, "output", "slides");
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

  test("default mode writes file with marp frontmatter", async () => {
    const fakeClaude = await createFakeExecutable(
      "claude",
      `#!/bin/sh
printf '# Title Slide\\n\\n---\\n\\n## Key Points\\n\\n- See [[concept-a]] for details\\n\\n---\\n\\n## Sources consulted\\n- [[main-source]] — main ref\\n'`,
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

    // Check that the file was written
    const outputDir = join(vault.config.vault, "output", "slides");
    const glob = new Bun.Glob("*.md");
    const files: string[] = [];
    for await (const f of glob.scan({ cwd: outputDir, absolute: false })) {
      files.push(f);
    }
    expect(files).toHaveLength(1);

    const content = await Bun.file(join(outputDir, files[0]!)).text();
    // Marp-specific fields
    expect(content).toContain("marp: true");
    expect(content).toContain("theme: default");
    expect(content).toContain("paginate: true");
    // brain-cli fields
    expect(content).toContain("type: slides");
    expect(content).toContain("sources:");
    expect(content).toContain("[[main-source]]");
    expect(content).toContain("related:");
    expect(content).toContain("[[concept-a]]");
  });
});
