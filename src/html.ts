/**
 * HTML → Markdown conversion.
 *
 * Backed by Turndown (+ GFM plugin) over a linkedom DOM. We pre-strip
 * obvious non-content elements and prefer <article>/<main> when Readability
 * hasn't already isolated the body for us.
 */

import { parseHTML } from "linkedom";
import TurndownService from "turndown";
// @ts-expect-error — no bundled types for turndown-plugin-gfm
import { gfm } from "turndown-plugin-gfm";

const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "iframe",
  "svg",
];

/** Extract the document <title> from a raw HTML string. */
export function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1]!.trim()) : null;
}

/**
 * Convert an HTML string to Markdown. If the HTML contains noise elements
 * (nav, header, footer, scripts, ...) they are stripped first; if there is
 * an <article> or <main>, that subtree is preferred over the full body.
 */
export function htmlToMarkdown(html: string): string {
  const wrapped = /<html[\s>]/i.test(html)
    ? html
    : `<!doctype html><html><body>${html}</body></html>`;

  const { document } = parseHTML(wrapped);

  for (const sel of NOISE_SELECTORS) {
    document.querySelectorAll(sel).forEach((n: { remove: () => void }) => n.remove());
  }

  const root =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.body ||
    document.documentElement;

  if (!root) return "";

  const td = makeTurndown();
  let md = td.turndown((root as unknown as { innerHTML: string }).innerHTML);

  // Turndown emits "-   item" (3 spaces) for list markers; normalize.
  md = md.replace(/^(\s*)[-*]\s{2,}/gm, "$1- ");
  // Normalize ordered list marker spacing ("1.  foo" → "1. foo").
  md = md.replace(/^(\s*\d+\.)\s{2,}/gm, "$1 ");
  // Collapse excessive blank lines.
  md = md.replace(/\n{3,}/g, "\n\n");
  md = md.replace(/[ \t]+$/gm, "");
  return md.trim();
}

function makeTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    fence: "```",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });
  td.use(gfm);

  // Strip residual <figure>/<figcaption> wrappers but keep their content.
  td.addRule("figure", {
    filter: ["figure", "figcaption"],
    replacement: (content: string) => content,
  });

  return td;
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
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}
