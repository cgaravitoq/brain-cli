import { describe, test, expect } from "bun:test";
import { generateFrontmatter, parseFrontmatter } from "../src/frontmatter";
import type { Frontmatter } from "../src/types";

describe("generateFrontmatter", () => {
  test("generates basic frontmatter", () => {
    const fm: Frontmatter = {
      title: "Test Note",
      created: "2026-04-03",
      tags: ["raw", "unprocessed"],
    };
    const result = generateFrontmatter(fm);
    expect(result).toBe(
      `---\ntitle: "Test Note"\ncreated: 2026-04-03\ntags: [raw, unprocessed]\n---`,
    );
  });

  test("includes source when provided", () => {
    const fm: Frontmatter = {
      title: "Article",
      created: "2026-04-03",
      tags: ["raw", "unprocessed"],
      source: "https://example.com",
    };
    const result = generateFrontmatter(fm);
    expect(result).toContain('source: "https://example.com"');
  });

  test("escapes quotes in title", () => {
    const fm: Frontmatter = {
      title: 'He said "hello"',
      created: "2026-04-03",
      tags: ["raw", "unprocessed"],
    };
    const result = generateFrontmatter(fm);
    expect(result).toContain('title: "He said \\"hello\\""');
  });
});

describe("parseFrontmatter", () => {
  test("parses standard frontmatter", () => {
    const content = `---\ntitle: "Test Note"\ncreated: 2026-04-03\ntags: [raw, unprocessed]\n---\n\nBody text here.`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.frontmatter.title).toBe("Test Note");
    expect(result!.frontmatter.created).toBe("2026-04-03");
    expect(result!.body).toBe("Body text here.");
  });

  test("returns null for content without frontmatter", () => {
    expect(parseFrontmatter("Just some text")).toBeNull();
  });

  test("handles empty body", () => {
    const content = `---\ntitle: "Note"\ncreated: 2026-04-03\ntags: [raw]\n---\n`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.body).toBe("");
  });

  test("round-trips with generateFrontmatter", () => {
    const fm: Frontmatter = {
      title: "Round Trip",
      created: "2026-04-03",
      tags: ["raw", "unprocessed"],
    };
    const generated = generateFrontmatter(fm) + "\n\nBody content.";
    const parsed = parseFrontmatter(generated);
    expect(parsed).not.toBeNull();
    expect(parsed!.frontmatter.title).toBe("Round Trip");
    expect(parsed!.body).toBe("Body content.");
  });
});
