import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { createTestVault, type TestVault } from "./helpers";
import {
  parseAskArgs,
  generateAskFilename,
  buildAskFrontmatter,
  extractSources,
  extractTitle,
  extractSummary,
  ensureResearcherAgent,
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

describe("buildAskFrontmatter", () => {
  test("builds frontmatter with sources", () => {
    const fm = buildAskFrontmatter(
      "how does X work?",
      "How Does X Work",
      ["[[article-one]]", "[[article-two]]"],
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
    const fm = buildAskFrontmatter("test", "Test", [], new Date(2026, 3, 4));
    expect(fm).not.toContain("sources:");
  });

  test("escapes quotes in title", () => {
    const fm = buildAskFrontmatter('what is "RAG"?', 'What Is "RAG"', [], new Date(2026, 3, 4));
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
