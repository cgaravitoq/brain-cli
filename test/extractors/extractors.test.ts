import { describe, test, expect } from "bun:test";
import { ExtractorRegistry } from "../../src/extractors/registry";
import { hostMatches, normalizeHost } from "../../src/extractors/url";
import { parseExternalOutput } from "../../src/extractors/external";
import { redditExtractor } from "../../src/extractors/builtins/reddit";
import { twitterSyndicationExtractor } from "../../src/extractors/builtins/twitter";

describe("hostMatches", () => {
  test("exact host", () => {
    expect(hostMatches("reddit.com", "reddit.com")).toBe(true);
  });
  test("subdomain", () => {
    expect(hostMatches("old.reddit.com", "reddit.com")).toBe(true);
  });
  test("strips www", () => {
    expect(hostMatches("www.x.com", "x.com")).toBe(true);
  });
  test("rejects unrelated", () => {
    expect(hostMatches("evil.com", "x.com")).toBe(false);
  });
  test("does not match suffix collision", () => {
    expect(hostMatches("notx.com", "x.com")).toBe(false);
  });
  test("normalizeHost lowercases and strips www", () => {
    expect(normalizeHost("WWW.Example.COM")).toBe("example.com");
  });
});

describe("redditExtractor.canHandle", () => {
  test("matches comment URLs", () => {
    const u = new URL("https://www.reddit.com/r/programming/comments/abc/title/");
    expect(redditExtractor.canHandle(u)).toBe(true);
  });
  test("matches old.reddit.com", () => {
    const u = new URL("https://old.reddit.com/r/programming/comments/abc/title/");
    expect(redditExtractor.canHandle(u)).toBe(true);
  });
  test("rejects subreddit listing", () => {
    const u = new URL("https://www.reddit.com/r/programming/");
    expect(redditExtractor.canHandle(u)).toBe(false);
  });
});

describe("twitterSyndicationExtractor.canHandle", () => {
  test("matches x.com status", () => {
    const u = new URL("https://x.com/jack/status/20");
    expect(twitterSyndicationExtractor.canHandle(u)).toBe(true);
  });
  test("matches twitter.com status", () => {
    const u = new URL("https://twitter.com/jack/status/20");
    expect(twitterSyndicationExtractor.canHandle(u)).toBe(true);
  });
  test("rejects profile URL", () => {
    const u = new URL("https://x.com/jack");
    expect(twitterSyndicationExtractor.canHandle(u)).toBe(false);
  });
});

describe("ExtractorRegistry.pick", () => {
  test("picks reddit for /comments/", () => {
    const r = new ExtractorRegistry();
    const e = r.pick(new URL("https://www.reddit.com/r/x/comments/abc/y/"));
    expect(e.name).toBe("reddit");
  });
  test("picks twitter-syndication for x.com/status/", () => {
    const r = new ExtractorRegistry();
    const e = r.pick(new URL("https://x.com/foo/status/123"));
    expect(e.name).toBe("twitter-syndication");
  });
  test("picks default for generic URL", () => {
    const r = new ExtractorRegistry();
    const e = r.pick(new URL("https://example.com/blog/post"));
    expect(e.name).toBe("default");
  });
  test("raw mode picks raw extractor regardless", () => {
    const r = new ExtractorRegistry({ raw: true });
    const e = r.pick(new URL("https://x.com/foo/status/123"));
    expect(e.name).toBe("raw");
  });
  test("external extractor takes precedence over built-in", () => {
    const r = new ExtractorRegistry({
      external: { "x.com": "my-x-cmd" },
    });
    const e = r.pick(new URL("https://x.com/foo/status/123"));
    expect(e.name).toBe("external:my-x-cmd@x.com");
  });
  test("external extractor for unknown domain still wins", () => {
    const r = new ExtractorRegistry({
      external: { "linkedin.com": "li-cmd" },
    });
    const e = r.pick(new URL("https://linkedin.com/in/foo/posts/123"));
    expect(e.name).toBe("external:li-cmd@linkedin.com");
  });
});

describe("parseExternalOutput", () => {
  const url = new URL("https://example.com/x");

  test("parses JSON with all fields", () => {
    const out = JSON.stringify({
      title: "Hello",
      content: "# Body",
      author: "Bob",
      site: "Site",
      excerpt: "summary",
    });
    const page = parseExternalOutput(out, url, "test");
    expect(page.title).toBe("Hello");
    expect(page.content).toBe("# Body");
    expect(page.author).toBe("Bob");
    expect(page.site).toBe("Site");
    expect(page.excerpt).toBe("summary");
  });

  test("rejects JSON missing title", () => {
    expect(() => parseExternalOutput('{"content":"x"}', url, "test")).toThrow();
  });

  test("falls back to markdown H1 when not JSON", () => {
    const out = "# My Article\n\nBody paragraph here.";
    const page = parseExternalOutput(out, url, "test");
    expect(page.title).toBe("My Article");
    expect(page.content).toContain("Body paragraph here.");
  });

  test("uses first line as title when no H1", () => {
    const out = "Just a title\nThen body.";
    const page = parseExternalOutput(out, url, "test");
    expect(page.title).toBe("Just a title");
    expect(page.content).toContain("Just a title");
  });

  test("rejects empty output", () => {
    expect(() => parseExternalOutput("", url, "test")).toThrow();
    expect(() => parseExternalOutput("   \n\n", url, "test")).toThrow();
  });
});
