/**
 * Minimal HTML-to-markdown converter. Zero dependencies.
 * Handles the 90% case for blog posts and articles.
 */

export function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1]!.trim()) : null;
}

export function htmlToMarkdown(html: string): string {
  let text = html;

  // Remove non-content elements
  text = stripTag(text, "script");
  text = stripTag(text, "style");
  text = stripTag(text, "nav");
  text = stripTag(text, "header");
  text = stripTag(text, "footer");
  text = stripTag(text, "aside");
  text = stripTag(text, "noscript");

  // Try to extract article/main content
  const article =
    extractTagContent(text, "article") ||
    extractTagContent(text, "main") ||
    extractTagContent(text, "body") ||
    text;

  text = article;

  // Convert block elements before stripping tags
  // Headings
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, c) => `\n# ${inlineClean(c)}\n\n`);
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, c) => `\n## ${inlineClean(c)}\n\n`);
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, c) => `\n### ${inlineClean(c)}\n\n`);
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, c) => `\n#### ${inlineClean(c)}\n\n`);
  text = text.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, c) => `\n##### ${inlineClean(c)}\n\n`);
  text = text.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, c) => `\n###### ${inlineClean(c)}\n\n`);

  // Code blocks (pre > code)
  text = text.replace(
    /<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi,
    (_, c) => `\n\`\`\`\n${decodeEntities(c).trim()}\n\`\`\`\n\n`,
  );

  // Standalone pre
  text = text.replace(
    /<pre[^>]*>([\s\S]*?)<\/pre>/gi,
    (_, c) => `\n\`\`\`\n${decodeEntities(c).trim()}\n\`\`\`\n\n`,
  );

  // Blockquotes
  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, c) => {
    const clean = inlineClean(c).trim();
    const quoted = clean
      .split("\n")
      .map((line: string) => `> ${line}`)
      .join("\n");
    return `\n${quoted}\n\n`;
  });

  // List items
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, c) => `- ${inlineClean(c).trim()}\n`);

  // Paragraphs and divs
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<p[^>]*>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<div[^>]*>/gi, "\n");

  // Line breaks
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Inline elements
  text = text.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, content) => {
    const clean = stripTags(content).trim();
    return `[${clean}](${href})`;
  });
  text = text.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, c) => `**${stripTags(c).trim()}**`);
  text = text.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, c) => `*${stripTags(c).trim()}*`);
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => `\`${decodeEntities(c).trim()}\``);

  // Strip remaining tags
  text = stripTags(text);

  // Decode HTML entities
  text = decodeEntities(text);

  // Clean up whitespace
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/[ \t]+$/gm, "");
  text = text.trim();

  return text;
}

function stripTag(html: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
  return html.replace(re, "");
}

function extractTagContent(html: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = html.match(re);
  return match ? match[1]! : null;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

function inlineClean(html: string): string {
  // Process inline markdown-convertible tags, then strip the rest
  let text = html;
  text = text.replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, c) => `[${stripTags(c).trim()}](${href})`);
  text = text.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, c) => `**${stripTags(c).trim()}**`);
  text = text.replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, c) => `*${stripTags(c).trim()}*`);
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, c) => `\`${decodeEntities(c).trim()}\``);
  text = stripTags(text);
  text = decodeEntities(text);
  return text;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
