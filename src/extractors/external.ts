/**
 * External extractor: invokes a user-configured shell command and parses
 * its stdout as either:
 *   1. A JSON object matching `ExtractedPage` (preferred), or
 *   2. Raw markdown — the first H1 (or first non-empty line) becomes the title.
 *
 * Configured per-domain in ~/.config/brain/config.json:
 *
 *   "extractors": {
 *     "x.com":      "hermes-x-extractor",
 *     "linkedin.com": ["my-helper", "--mode=article"]
 *   }
 *
 * The command receives the URL as its final positional argument. Stdout is
 * captured; stderr is forwarded to the user. A non-zero exit code raises
 * `ExtractorError`.
 *
 * Security note: this is `eval`-equivalent — only register commands you
 * trust, the same way you'd trust a `pre-commit` hook.
 */

import type { Extractor, ExtractedPage } from "./types";
import { ExtractorError } from "./types";
import { hostMatches } from "./url";
import { spawnCapture } from "../spawn";

export type ExternalExtractorSpec = string | string[];

export interface ExternalExtractorMap {
  [domain: string]: ExternalExtractorSpec;
}

/** Build extractor instances from the user's config map. */
export function buildExternalExtractors(
  map: ExternalExtractorMap | undefined,
): Extractor[] {
  if (!map) return [];
  return Object.entries(map).map(([domain, spec]) => makeExternal(domain, spec));
}

function makeExternal(domain: string, spec: ExternalExtractorSpec): Extractor {
  const argv = Array.isArray(spec) ? [...spec] : spec.split(/\s+/).filter(Boolean);
  const cmdName = argv[0] ?? "";

  return {
    name: `external:${cmdName}@${domain}`,

    canHandle(url: URL): boolean {
      return hostMatches(url.hostname, domain);
    },

    async extract(url: URL): Promise<ExtractedPage> {
      if (!cmdName) {
        throw new ExtractorError(
          `Empty command for extractor ${domain}`,
          this.name,
        );
      }

      const fullArgs = [...argv, url.toString()];
      let result;
      try {
        result = await spawnCapture(fullArgs, { stderrMode: "inherit" });
      } catch (err) {
        throw new ExtractorError(
          `External extractor "${cmdName}" failed to start: ${
            err instanceof Error ? err.message : String(err)
          }`,
          this.name,
          err,
        );
      }

      if (result.exitCode !== 0) {
        throw new ExtractorError(
          `External extractor "${cmdName}" exited with code ${result.exitCode}`,
          this.name,
        );
      }

      return parseExternalOutput(result.stdout, url, this.name);
    },
  };
}

export function parseExternalOutput(
  stdout: string,
  url: URL,
  extractorName: string,
): ExtractedPage {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new ExtractorError(
      "External extractor produced no output",
      extractorName,
    );
  }

  // Try JSON first.
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // fall through to markdown parsing
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const title = typeof obj.title === "string" ? obj.title.trim() : "";
      const content = typeof obj.content === "string" ? obj.content : "";
      if (title && content) {
        return {
          title,
          content,
          author: typeof obj.author === "string" ? obj.author : undefined,
          site: typeof obj.site === "string" ? obj.site : undefined,
          excerpt: typeof obj.excerpt === "string" ? obj.excerpt : undefined,
        };
      }
      throw new ExtractorError(
        "External extractor JSON missing required fields {title, content}",
        extractorName,
      );
    }
  }

  // Fallback: treat output as raw markdown, derive title from first H1 / line.
  const h1Match = trimmed.match(/^#\s+(.+?)\s*$/m);
  let title: string;
  let content: string;
  if (h1Match && h1Match.index !== undefined) {
    title = h1Match[1]!.trim();
    content = (trimmed.slice(0, h1Match.index) + trimmed.slice(h1Match.index + h1Match[0].length)).trim();
  } else {
    const firstLine = trimmed.split("\n").find((l) => l.trim()) || "untitled";
    title = firstLine.replace(/^#+\s*/, "").trim().slice(0, 120);
    content = trimmed;
  }

  if (!content) {
    throw new ExtractorError(
      "External extractor produced empty content after title extraction",
      extractorName,
    );
  }

  return { title, content, site: url.hostname };
}
