/**
 * Main-content extraction using Mozilla Readability on a linkedom DOM.
 * Used by `brain clip` to isolate the article body before HTML→markdown
 * conversion.
 */

import { parseHTML } from "linkedom";
import { Readability } from "@mozilla/readability";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

export interface ExtractedArticle {
  title: string | null;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  /** Cleaned article HTML (safe to pass to htmlToMarkdown) */
  content: string;
}

/**
 * Run Readability on an HTML string. Returns null if no article could be
 * extracted (e.g. the page is not article-shaped). The `url` is used to set
 * the document base so relative links resolve correctly.
 */
export function extractArticle(
  html: string,
  url: string,
): ExtractedArticle | null {
  let doc: AnyDoc;
  try {
    const withBase = injectBase(html, url);
    const { document } = parseHTML(withBase);
    doc = document;
  } catch {
    return null;
  }

  try {
    const reader = new Readability(doc);
    const parsed = reader.parse();
    if (!parsed || !parsed.content) return null;
    return {
      title: parsed.title ?? null,
      byline: parsed.byline ?? null,
      siteName: parsed.siteName ?? null,
      excerpt: parsed.excerpt ?? null,
      content: parsed.content,
    };
  } catch {
    return null;
  }
}

/** Insert a <base href> so Readability can resolve relative URLs. */
function injectBase(html: string, url: string): string {
  if (/<base\s/i.test(html)) return html;
  const tag = `<base href="${url.replace(/"/g, "&quot;")}">`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}${tag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${tag}</head>`);
  }
  return `<!doctype html><html><head>${tag}</head><body>${html}</body></html>`;
}
