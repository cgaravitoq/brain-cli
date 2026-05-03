/**
 * Reddit extractor: uses Reddit's public `.json` endpoint to fetch a post +
 * top-level comments without an OAuth token. Works for `/r/<sub>/comments/...`
 * URLs (the only Reddit URL shape worth clipping into a knowledge base).
 *
 * Reddit blocks unfriendly User-Agents with 429, so we send a polite one.
 */

import type { Extractor, ExtractedPage } from "../types";
import { ExtractorError } from "../types";
import { hostMatches } from "../url";

interface RedditPost {
  title: string;
  author: string;
  subreddit: string;
  selftext?: string;
  url?: string;
  permalink: string;
  score?: number;
  num_comments?: number;
}

interface RedditComment {
  author: string;
  body?: string;
  score?: number;
  replies?: { data?: { children?: Array<{ kind: string; data: RedditComment }> } } | "";
}

export const redditExtractor: Extractor = {
  name: "reddit",

  canHandle(url: URL): boolean {
    return (
      (hostMatches(url.hostname, "reddit.com") ||
        hostMatches(url.hostname, "redd.it") ||
        hostMatches(url.hostname, "old.reddit.com")) &&
      /\/comments\//.test(url.pathname)
    );
  },

  async extract(url: URL): Promise<ExtractedPage> {
    // Force the JSON endpoint by appending `.json` before the query string.
    const u = new URL(url.toString());
    u.hostname = "www.reddit.com";
    if (!u.pathname.endsWith(".json")) {
      u.pathname = u.pathname.replace(/\/?$/, ".json");
    }
    u.searchParams.set("raw_json", "1");
    u.searchParams.set("limit", "20");

    let payload: unknown;
    try {
      const res = await fetch(u.toString(), {
        signal: AbortSignal.timeout(30_000),
        headers: {
          "User-Agent": "brain-cli/1.0 (knowledge base ingest)",
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        throw new ExtractorError(
          `Reddit responded ${res.status} ${res.statusText}`,
          "reddit",
        );
      }
      payload = await res.json();
    } catch (err) {
      if (err instanceof ExtractorError) throw err;
      throw new ExtractorError(
        `Reddit fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        "reddit",
        err,
      );
    }

    if (!Array.isArray(payload) || payload.length < 1) {
      throw new ExtractorError("Reddit returned unexpected payload shape", "reddit");
    }

    const postListing = (payload[0] as { data?: { children?: Array<{ data: RedditPost }> } })
      ?.data?.children;
    const post = postListing?.[0]?.data;
    if (!post) {
      throw new ExtractorError("No post found in Reddit response", "reddit");
    }

    const commentListing = (payload[1] as {
      data?: { children?: Array<{ kind: string; data: RedditComment }> };
    })?.data?.children;

    const lines: string[] = [];

    if (post.url && post.url !== `https://www.reddit.com${post.permalink}`) {
      lines.push(`**Link:** <${post.url}>`);
      lines.push("");
    }
    const meta: string[] = [];
    meta.push(`**Posted by** u/${post.author}`);
    meta.push(`in r/${post.subreddit}`);
    if (typeof post.score === "number") meta.push(`${post.score} points`);
    if (typeof post.num_comments === "number") meta.push(`${post.num_comments} comments`);
    lines.push(meta.join(" · "));
    lines.push("");

    if (post.selftext && post.selftext.trim()) {
      lines.push(post.selftext.trim());
      lines.push("");
    }

    if (commentListing && commentListing.length > 0) {
      lines.push("---");
      lines.push("");
      lines.push("## Top comments");
      lines.push("");
      for (const child of commentListing) {
        if (child.kind !== "t1") continue;
        const c = child.data;
        if (!c.body || !c.body.trim()) continue;
        const score = typeof c.score === "number" ? ` (${c.score})` : "";
        lines.push(`### u/${c.author}${score}`);
        lines.push("");
        lines.push(c.body.trim());
        lines.push("");
      }
    }

    return {
      title: post.title,
      content: lines.join("\n").trim(),
      author: `u/${post.author}`,
      site: "Reddit",
    };
  },
};
