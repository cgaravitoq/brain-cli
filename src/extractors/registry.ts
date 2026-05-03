/**
 * Extractor registry: dispatches a URL to the first matching extractor.
 *
 * Order of precedence (highest first):
 *   1. External extractors from user config (per-domain, user explicitly
 *      registered them)
 *   2. Built-in domain-specific extractors (Reddit, Twitter syndication, …)
 *   3. Default extractor (HTTP fetch + Readability)
 *
 * The `--raw` flag bypasses everything and just runs raw HTML→markdown.
 */

import type { Extractor, ExtractedPage } from "./types";
import { ExtractorError } from "./types";
import { defaultExtractor, rawExtractor } from "./builtins/default";
import { redditExtractor } from "./builtins/reddit";
import { twitterSyndicationExtractor } from "./builtins/twitter";
import { buildExternalExtractors, type ExternalExtractorMap } from "./external";

export const BUILTIN_EXTRACTORS: Extractor[] = [
  redditExtractor,
  twitterSyndicationExtractor,
];

export interface RegistryOptions {
  external?: ExternalExtractorMap;
  /** If true, return only the rawExtractor regardless of URL. */
  raw?: boolean;
}

export class ExtractorRegistry {
  private readonly chain: Extractor[];
  public readonly raw: boolean;

  constructor(opts: RegistryOptions = {}) {
    this.raw = opts.raw === true;
    this.chain = this.raw
      ? [rawExtractor]
      : [...buildExternalExtractors(opts.external), ...BUILTIN_EXTRACTORS, defaultExtractor];
  }

  pick(url: URL): Extractor {
    for (const e of this.chain) {
      if (e.canHandle(url)) return e;
    }
    // defaultExtractor's canHandle is unconditionally true, so this is unreachable
    // unless someone passes an empty chain.
    throw new ExtractorError(`No extractor available for ${url.toString()}`, "registry");
  }

  /** Try the picked extractor; fall back to the default extractor on failure
   *  (so a flaky external/built-in doesn't kill the whole `brain clip`). */
  async extract(url: URL): Promise<{ page: ExtractedPage; usedExtractor: string }> {
    const primary = this.pick(url);
    try {
      const page = await primary.extract(url);
      return { page, usedExtractor: primary.name };
    } catch (err) {
      // Don't fall back if the user explicitly asked for --raw, if the
      // primary extractor *was* the default (no point retrying the same path),
      // or if the extractor explicitly said "do not fall back" (e.g. X Article
      // detected — the default would just hit a login wall).
      if (
        this.raw ||
        primary.name === "default" ||
        (err instanceof ExtractorError && err.noFallback)
      ) {
        throw err;
      }
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`⚠️  ${primary.name} failed (${reason}); falling back to default extractor`);
      const page = await defaultExtractor.extract(url);
      return { page, usedExtractor: `default (fallback after ${primary.name})` };
    }
  }
}
