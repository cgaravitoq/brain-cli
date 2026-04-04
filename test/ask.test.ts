import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createTestVault, createFakeExecutable, type TestVault } from "./helpers";
import {
  parseAskArgs,
  generateAskFilename,
  resolveAskOutputPath,
  buildAskFrontmatter,
  extractSources,
  extractRelated,
  extractTitle,
  extractSummary,
  ensureResearcherAgent,
  run,
} from "../src/commands/ask";

let vault: TestVault;

beforeEach(async () => {
  vault = await createTestVault();
});

afterEach(async () => {
  await vault.cleanup();
});

describe("parseAskArgs", () => {
  test("parses a simple question", () => {
    const { options, question } = parseAskArgs(["how", "does", "X", "work"]);
    expect(question).toBe("how does X work");
    expect(options.printOnly).toBe(false);
    expect(options.model).toBe("sonnet");
    expect(options.verbose).toBe(false);
  });

  test("parses quoted question as single arg", () => {
    const { question } = parseAskArgs(["how does X work?"]);
    expect(question).toBe("how does X work?");
  });

  test("parses -p flag", () => {
    const { options, question } = parseAskArgs(["-p", "what is RAG"]);
    expect(options.printOnly).toBe(true);
    expect(question).toBe("what is RAG");
  });

  test("parses --model flag", () => {
    const { options } = parseAskArgs(["--model", "opus", "test question"]);
    expect(options.model).toBe("opus");
  });

  test("parses --verbose flag", () => {
    const { options } = parseAskArgs(["--verbose", "test question"]);
    expect(options.verbose).toBe(true);
  });

  test("parses --stdout flag", () => {
    const { options, question } = parseAskArgs(["--stdout", "what is RAG"]);
    expect(options.stdout).toBe(true);
    expect(options.printOnly).toBe(true); // --stdout implies --print
    expect(options.verbose).toBe(false); // --stdout suppresses verbose
    expect(question).toBe("what is RAG");
  });

  test("--stdout overrides --verbose", () => {
    const { options } = parseAskArgs(["--stdout", "--verbose", "test question"]);
    expect(options.stdout).toBe(true);
    expect(options.verbose).toBe(false);
  });

  test("--stdout can combine with --model", () => {
    const { options } = parseAskArgs(["--stdout", "--model", "opus", "test question"]);
    expect(options.stdout).toBe(true);
    expect(options.model).toBe("opus");
  });

  test("throws on empty question", () => {
    expect(() => parseAskArgs([])).toThrow();
  });
});

describe("generateAskFilename", () => {
  test("generates YYYY-MM-DD-slug.md", () => {
    const date = new Date(2026, 3, 4); // April 4, 2026
    const filename = generateAskFilename("how does context routing work", date);
    expect(filename).toBe("2026-04-04-how-does-context-routing-work.md");
  });

  test("truncates long slugs to 60 chars", () => {
    const date = new Date(2026, 3, 4);
    const longQ = "what are the key differences between all the major orchestration frameworks for multi agent systems in production";
    const filename = generateAskFilename(longQ, date);
    const slug = filename.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/\.md$/, "");
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  test("handles special characters", () => {
    const date = new Date(2026, 3, 4);
    const filename = generateAskFilename("what's the deal with C++ templates?", date);
    expect(filename).toMatch(/^2026-04-04-.+\.md$/);
    expect(filename).not.toMatch(/[?']/);
  });
});

describe("resolveAskOutputPath", () => {
  test("keeps the base filename when unused", async () => {
    const outputDir = join(vault.config.vault, "output", "asks");
    await mkdir(outputDir, { recursive: true });

    const result = await resolveAskOutputPath(
      outputDir,
      "how does context routing work",
      new Date(2026, 3, 4),
    );

    expect(result.filename).toBe("2026-04-04-how-does-context-routing-work.md");
  });

  test("adds a numeric suffix when the filename already exists", async () => {
    const outputDir = join(vault.config.vault, "output", "asks");
    await mkdir(outputDir, { recursive: true });
    await Bun.write(
      join(outputDir, "2026-04-04-how-does-context-routing-work.md"),
      "existing",
    );

    const result = await resolveAskOutputPath(
      outputDir,
      "how does context routing work",
      new Date(2026, 3, 4),
    );

    expect(result.filename).toBe("2026-04-04-how-does-context-routing-work-2.md");
  });
});

describe("buildAskFrontmatter", () => {
  test("builds frontmatter with sources", () => {
    const fm = buildAskFrontmatter(
      "how does X work?",
      "How Does X Work",
      ["[[article-one]]", "[[article-two]]"],
      [],
      new Date(2026, 3, 4),
    );
    expect(fm).toContain("title:");
    expect(fm).toContain("type: ask");
    expect(fm).toContain("question:");
    expect(fm).toContain("created: 2026-04-04");
    expect(fm).toContain("sources:");
    expect(fm).toContain("[[article-one]]");
    expect(fm).toContain("[[article-two]]");
    expect(fm).toMatch(/^---\n[\s\S]*\n---$/);
  });

  test("builds frontmatter without sources", () => {
    const fm = buildAskFrontmatter("test", "Test", [], [], new Date(2026, 3, 4));
    expect(fm).not.toContain("sources:");
  });

  test("builds frontmatter with related", () => {
    const fm = buildAskFrontmatter(
      "how does X work?",
      "How Does X Work",
      ["[[article-one]]"],
      ["[[related-concept]]"],
      new Date(2026, 3, 4),
    );
    expect(fm).toContain("related:");
    expect(fm).toContain("[[related-concept]]");
  });

  test("omits related when empty", () => {
    const fm = buildAskFrontmatter("test", "Test", [], [], new Date(2026, 3, 4));
    expect(fm).not.toContain("related:");
  });

  test("escapes quotes in title", () => {
    const fm = buildAskFrontmatter('what is "RAG"?', 'What Is "RAG"', [], [], new Date(2026, 3, 4));
    expect(fm).toContain('\\"RAG\\"');
  });
});

describe("extractSources", () => {
  test("extracts wikilinks from Sources consulted section", () => {
    const body = `# Answer

Some text here.

## Sources consulted
- [[multi-agent-patterns]] — orchestration concepts
- [[claude-code-subagents]] — delegation patterns
`;
    const sources = extractSources(body);
    expect(sources).toEqual(["[[multi-agent-patterns]]", "[[claude-code-subagents]]"]);
  });

  test("returns empty array when no sources section", () => {
    const body = "# Answer\n\nJust some text.";
    expect(extractSources(body)).toEqual([]);
  });

  test("handles sources section at end of file", () => {
    const body = `# Answer

Text.

## Sources consulted
- [[only-source]] — the only one`;
    const sources = extractSources(body);
    expect(sources).toEqual(["[[only-source]]"]);
  });
});

describe("extractRelated", () => {
  test("extracts wikilinks from body not in sources", () => {
    const body = `# Answer

This relates to [[concept-a]] and [[concept-b]].

## Sources consulted
- [[concept-a]] — main source
`;
    const sources = ["[[concept-a]]"];
    const related = extractRelated(body, sources);
    expect(related).toEqual(["[[concept-b]]"]);
  });

  test("returns empty when all links are in sources", () => {
    const body = `# Answer

Text referencing [[concept-a]].

## Sources consulted
- [[concept-a]] — main source
`;
    const related = extractRelated(body, ["[[concept-a]]"]);
    expect(related).toEqual([]);
  });

  test("deduplicates related links", () => {
    const body = `# Answer

See [[concept-b]] for details. Also check [[concept-b]] again.

## Sources consulted
- [[concept-a]] — main source
`;
    const related = extractRelated(body, ["[[concept-a]]"]);
    expect(related).toEqual(["[[concept-b]]"]);
  });

  test("returns empty when no wikilinks in body", () => {
    const body = "# Answer\n\nJust plain text.";
    expect(extractRelated(body, [])).toEqual([]);
  });
});

describe("extractTitle", () => {
  test("capitalizes words", () => {
    expect(extractTitle("how does context routing work")).toBe("How Does Context Routing Work");
  });

  test("strips trailing question mark", () => {
    expect(extractTitle("what is RAG?")).toBe("What Is RAG");
  });
});

describe("extractSummary", () => {
  test("extracts first paragraph after heading", () => {
    const body = `# My Answer

This is the first paragraph of the answer. It explains the key concept.

This is the second paragraph.`;
    const summary = extractSummary(body);
    expect(summary).toBe("This is the first paragraph of the answer. It explains the key concept.");
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

describe("ensureResearcherAgent", () => {
  test("creates researcher.md with read-only tools", async () => {
    const agentPath = await ensureResearcherAgent(vault.config.vault, "sonnet");
    const content = await Bun.file(agentPath).text();

    expect(agentPath).toEndWith(".claude/agents/researcher.md");
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
    const agentPath = await ensureResearcherAgent(vault.config.vault, "opus");
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
      "#!/bin/sh\nprintf '# Answer\\n\\nBody text.\\n'\n",
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
      await run(["-p", "test question"], vault.config);
    } finally {
      await fakeClaude.cleanup();
    }

    expect(logs).toEqual(["# Answer\n\nBody text."]);
    expect(errors.join("\n")).toContain("Researching...");
  });

  test("--stdout mode outputs only markdown, zero stderr, no file written", async () => {
    const fakeClaude = await createFakeExecutable(
      "claude",
      "#!/bin/sh\nprintf '# Answer\\n\\nClean markdown body.\\n'\n",
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
      await run(["--stdout", "test question"], vault.config);
    } finally {
      await fakeClaude.cleanup();
    }

    // Only the raw markdown should be on stdout
    expect(logs).toEqual(["# Answer\n\nClean markdown body."]);
    // Zero stderr output
    expect(errors).toEqual([]);

    // No file should be written
    const outputDir = join(vault.config.vault, "output", "asks");
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
      "#!/bin/sh\nprintf '# Answer\\n\\nBody.\\n'\n",
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
      await run(["--stdout", "--model", "opus", "test question"], vault.config);
    } finally {
      await fakeClaude.cleanup();
    }

    // Verify model was passed to agent config
    const agentContent = await Bun.file(
      join(vault.config.vault, ".claude", "agents", "researcher.md"),
    ).text();
    expect(agentContent).toContain("model: opus");

    // Still only markdown on stdout, no stderr
    expect(logs).toEqual(["# Answer\n\nBody."]);
    expect(errors).toEqual([]);
  });

  test("default mode writes file with related field in frontmatter", async () => {
    const fakeClaude = await createFakeExecutable(
      "claude",
      `#!/bin/sh
printf '# Answer\\n\\nThis relates to [[other-concept]].\\n\\n## Sources consulted\\n- [[main-source]] — main ref\\n'`,
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
      await run(["test question"], vault.config);
    } finally {
      await fakeClaude.cleanup();
    }

    // Check that the file was written with related field
    const outputDir = join(vault.config.vault, "output", "asks");
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
