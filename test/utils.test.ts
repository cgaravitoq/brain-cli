import { describe, test, expect } from "bun:test";
import {
  slugify,
  formatDate,
  formatTime,
  generateFilename,
  expandHome,
} from "../src/utils";

describe("slugify", () => {
  test("lowercases and replaces spaces with hyphens", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  test("strips non-alphanumeric characters", () => {
    expect(slugify("What's up?")).toBe("whats-up");
  });

  test("collapses multiple hyphens", () => {
    expect(slugify("foo---bar")).toBe("foo-bar");
  });

  test("trims leading and trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  test("replaces underscores with hyphens", () => {
    expect(slugify("foo_bar_baz")).toBe("foo-bar-baz");
  });

  test("truncates to maxLength", () => {
    const long = "a".repeat(100);
    expect(slugify(long, 50).length).toBeLessThanOrEqual(50);
  });

  test("returns 'note' for empty input", () => {
    expect(slugify("")).toBe("note");
    expect(slugify("!!!")).toBe("note");
  });

  test("handles real-world title", () => {
    const slug = slugify(
      "Braintrust allows full LLM observability including traces and evals",
    );
    expect(slug).toBe("braintrust-allows-full-llm-observability-including");
  });

  test("does not end with a hyphen after truncation", () => {
    const slug = slugify("hello-world-this-is-a-test", 11);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("formatDate", () => {
  test("formats date as YYYY-MM-DD", () => {
    const d = new Date(2026, 3, 3); // April 3, 2026
    expect(formatDate(d)).toBe("2026-04-03");
  });

  test("pads single-digit month and day", () => {
    const d = new Date(2026, 0, 5); // January 5
    expect(formatDate(d)).toBe("2026-01-05");
  });
});

describe("formatTime", () => {
  test("formats time as HHmm", () => {
    const d = new Date(2026, 0, 1, 21, 20);
    expect(formatTime(d)).toBe("2120");
  });

  test("pads single-digit hours and minutes", () => {
    const d = new Date(2026, 0, 1, 3, 5);
    expect(formatTime(d)).toBe("0305");
  });
});

describe("generateFilename", () => {
  test("produces correct format", () => {
    const date = new Date(2026, 3, 3, 21, 20);
    const name = generateFilename("Retry Pattern", date);
    expect(name).toBe("2026-04-03-2120-retry-pattern.md");
  });

  test("slugifies long titles", () => {
    const date = new Date(2026, 3, 3, 21, 20);
    const name = generateFilename(
      "Braintrust allows full LLM observability including traces and evals",
      date,
    );
    expect(name).toBe(
      "2026-04-03-2120-braintrust-allows-full-llm-observability-including.md",
    );
  });
});

describe("expandHome", () => {
  test("expands ~/path", () => {
    const result = expandHome("~/Documents");
    expect(result).not.toStartWith("~");
    expect(result).toEndWith("/Documents");
  });

  test("expands bare ~", () => {
    const result = expandHome("~");
    expect(result).not.toBe("~");
  });

  test("does not modify absolute paths", () => {
    expect(expandHome("/usr/local")).toBe("/usr/local");
  });

  test("does not modify relative paths", () => {
    expect(expandHome("foo/bar")).toBe("foo/bar");
  });
});
