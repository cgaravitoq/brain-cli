/**
 * Default extractor: plain HTTP fetch + Mozilla Readability + Turndown.
 * Handles ~80% of the web (blogs, news sites, MDN, GitHub READMEs).
 */

import type { Extractor, ExtractedPage } from "../types";
import { ExtractorError } from "../types";
import { extractArticle } from "../../readability";
import { htmlToMarkdown, extractTitle } from "../../html";
import { titleFromUrl } from "../url";

export const defaultExtractor: Extractor = {
  name: "default",

  canHandle(_url: URL): boolean {
    // The default extractor matches everything; the registry only falls
    // through to it after every other extractor has declined.
    return true;
  },

  async extract(url: URL): Promise<ExtractedPage> {
    let html: string;
    try {
      const response = await fetch(url.toString(), {
        signal: AbortSignal.timeout(30_000),
        headers: {
          // Some sites (Medium, dev.to) gate plain fetch with no UA.
          "User-Agent":
            "Mozilla/5.0 (compatible; brain-cli/1.0; +https://github.com/cgaravito/brain-cli)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
      if (!response.ok) {
        throw new ExtractorError(
          `HTTP ${response.status} ${response.statusText}`,
          "default",
        );
      }
      html = await response.text();
    } catch (err) {
      if (err instanceof ExtractorError) throw err;
      throw new ExtractorError(
        `Fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        "default",
        err,
      );
    }

    const article = extractArticle(html, url.toString());
    if (article) {
      return {
        title: article.title || extractTitle(html) || titleFromUrl(url),
        content: htmlToMarkdown(article.content),
        author: article.byline?.trim() || undefined,
        site: article.siteName?.trim() || undefined,
        excerpt: article.excerpt?.trim() || undefined,
      };
    }

    return {
      title: extractTitle(html) || titleFromUrl(url),
      content: htmlToMarkdown(html),
    };
  },
};

/** Raw fetch-only extractor used by `--raw`: no Readability, full HTML→md. */
export const rawExtractor: Extractor = {
  name: "raw",
  canHandle: () => true,
  async extract(url: URL): Promise<ExtractedPage> {
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(30_000),
      headers: { "User-Agent": "brain-cli/1.0" },
    });
    if (!response.ok) {
      throw new ExtractorError(
        `HTTP ${response.status} ${response.statusText}`,
        "raw",
      );
    }
    const html = await response.text();
    return {
      title: extractTitle(html) || titleFromUrl(url),
      content: htmlToMarkdown(html),
    };
  },
};
