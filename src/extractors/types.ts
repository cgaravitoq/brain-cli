/**
 * Extractor system: pluggable per-domain content extraction.
 *
 * Each extractor turns a URL into an `ExtractedPage` (title + markdown
 * content + optional metadata). The registry picks one based on hostname,
 * with a `default` Readability-based extractor as the fallback for the
 * generic web.
 *
 * For sites that block plain HTTP fetches (X.com, LinkedIn, …) users can
 * register external commands in their config:
 *
 *   { "extractors": { "x.com": "my-x-extractor" } }
 *
 * The command is invoked with the URL as its single argument and is expected
 * to print JSON `ExtractedPage` to stdout.
 */

export interface ExtractedPage {
  /** Article/page title. Required. */
  title: string;
  /** Main content as markdown. Required. */
  content: string;
  /** Author / byline. */
  author?: string;
  /** Site name (e.g. "Reddit", "X"). */
  site?: string;
  /** Short description / dek. */
  excerpt?: string;
}

export interface Extractor {
  /** Stable identifier shown in logs (e.g. "default", "reddit", "twitter-syndication"). */
  name: string;
  /** Return true if this extractor wants to handle the URL. */
  canHandle(url: URL): boolean;
  /** Perform extraction. Throw `ExtractorError` on hard failure. */
  extract(url: URL): Promise<ExtractedPage>;
}

export class ExtractorError extends Error {
  /** If true, the registry should NOT fall back to the default extractor;
   *  the error is meant to be surfaced to the user as-is (e.g. "register
   *  an external extractor — the default fetch will only see a login wall"). */
  public readonly noFallback: boolean;

  constructor(
    message: string,
    public readonly extractor: string,
    public override readonly cause?: unknown,
    opts: { noFallback?: boolean } = {},
  ) {
    super(message);
    this.name = "ExtractorError";
    this.noFallback = opts.noFallback === true;
  }
}
