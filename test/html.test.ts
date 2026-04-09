import { describe, test, expect } from "bun:test";
import { htmlToMarkdown, extractTitle } from "../src/html";
import { extractArticle } from "../src/readability";

describe("extractTitle", () => {
  test("extracts title from HTML", () => {
    expect(extractTitle("<html><head><title>Hello World</title></head></html>")).toBe("Hello World");
  });

  test("returns null when no title", () => {
    expect(extractTitle("<html><body>No title</body></html>")).toBeNull();
  });

  test("decodes entities in title", () => {
    expect(extractTitle("<title>Foo &amp; Bar</title>")).toBe("Foo & Bar");
  });
});

describe("htmlToMarkdown", () => {
  test("converts headings", () => {
    const html = "<body><h1>Title</h1><h2>Subtitle</h2><h3>Section</h3></body>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("# Title");
    expect(md).toContain("## Subtitle");
    expect(md).toContain("### Section");
  });

  test("converts paragraphs", () => {
    const html = "<body><p>First paragraph.</p><p>Second paragraph.</p></body>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("First paragraph.");
    expect(md).toContain("Second paragraph.");
  });

  test("converts links", () => {
    const html = '<body><p><a href="https://example.com">Click here</a></p></body>';
    const md = htmlToMarkdown(html);
    expect(md).toContain("[Click here](https://example.com)");
  });

  test("converts bold and italic", () => {
    const html = "<body><p><strong>Bold</strong> and <em>italic</em></p></body>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("**Bold**");
    expect(md).toContain("*italic*");
  });

  test("converts inline code", () => {
    const html = "<body><p>Use <code>console.log</code> for debugging.</p></body>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("`console.log`");
  });

  test("converts code blocks", () => {
    const html = "<body><pre><code>const x = 1;\nconst y = 2;</code></pre></body>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("```\nconst x = 1;\nconst y = 2;\n```");
  });

  test("converts list items", () => {
    const html = "<body><ul><li>First</li><li>Second</li></ul></body>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("- First");
    expect(md).toContain("- Second");
  });

  test("converts blockquotes", () => {
    const html = "<body><blockquote>A wise quote.</blockquote></body>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("> A wise quote.");
  });

  test("strips script and style", () => {
    const html = "<body><script>alert('x')</script><style>.x{}</style><p>Keep this.</p></body>";
    const md = htmlToMarkdown(html);
    expect(md).not.toContain("alert");
    expect(md).not.toContain(".x{}");
    expect(md).toContain("Keep this.");
  });

  test("strips nav, header, footer", () => {
    const html = "<body><nav>Nav</nav><header>Header</header><p>Content</p><footer>Footer</footer></body>";
    const md = htmlToMarkdown(html);
    expect(md).not.toContain("Nav");
    expect(md).not.toContain("Header");
    expect(md).not.toContain("Footer");
    expect(md).toContain("Content");
  });

  test("prefers article content", () => {
    const html = "<body><div>Outside</div><article><p>Inside article.</p></article></body>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("Inside article.");
  });

  test("decodes HTML entities", () => {
    const html = "<body><p>2 &gt; 1 &amp; 0 &lt; 1</p></body>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("2 > 1 & 0 < 1");
  });

  test("collapses excessive newlines", () => {
    const html = "<body><p>One</p><p></p><p></p><p>Two</p></body>";
    const md = htmlToMarkdown(html);
    expect(md).not.toMatch(/\n{4,}/);
  });

  test("converts images", () => {
    const html = '<body><p><img src="https://x.test/a.png" alt="Alt text"></p></body>';
    const md = htmlToMarkdown(html);
    expect(md).toContain("![Alt text](https://x.test/a.png)");
  });

  test("converts GFM tables", () => {
    const html =
      "<body><table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></body>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("| A");
    expect(md).toContain("| 1");
  });

  test("converts nested and ordered lists", () => {
    const html =
      "<body><ol><li>One<ul><li>sub</li></ul></li><li>Two</li></ol></body>";
    const md = htmlToMarkdown(html);
    expect(md).toContain("1. One");
    expect(md).toContain("2. Two");
    expect(md).toMatch(/- sub/);
  });
});

describe("extractArticle (Readability)", () => {
  test("extracts main content, title, and byline from an article page", () => {
    const html = `<!doctype html><html><head><title>The Headline</title></head>
      <body>
        <nav>Home | About | Contact</nav>
        <header><h1>Site Name</h1></header>
        <article>
          <h1>The Headline</h1>
          <p class="byline">By Jane Doe</p>
          <p>${"This is a reasonably long first paragraph that should be picked up by Readability because it has enough text density to be considered actual article content and not a navigation snippet or sidebar fragment that would otherwise be discarded. ".repeat(3)}</p>
          <p>${"A second paragraph keeps the scoring confident — Readability likes multiple paragraphs with substantive prose rather than link-heavy boilerplate that sits in sidebars. ".repeat(3)}</p>
        </article>
        <aside>Unrelated sidebar garbage that should not appear.</aside>
        <footer>Copyright junk</footer>
      </body></html>`;
    const result = extractArticle(html, "https://example.com/post");
    expect(result).not.toBeNull();
    expect(result!.title).toContain("Headline");
    expect(result!.content).toContain("first paragraph");
    expect(result!.content).not.toContain("sidebar garbage");
  });
});
