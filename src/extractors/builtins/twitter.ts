/**
 * Twitter/X extractor using the public CDN syndication endpoint
 * (`cdn.syndication.twimg.com`). This is the same endpoint that powers
 * `react-tweet` and `oembed` widgets — it returns a tweet's text, author,
 * media URLs and (sometimes) a quoted tweet, without any auth.
 *
 * Limitations:
 *   - Long-form X "Articles" (the new Premium publishing format) are NOT
 *     covered: the syndication endpoint returns the launcher text only,
 *     not the article body. For those, register an external extractor.
 *   - Threads: only the focal tweet is returned. Reconstructing the full
 *     thread requires multiple calls and best-effort heuristics.
 *
 * The token is a deterministic function of the tweet ID (same algorithm
 * used by react-tweet's `getToken`).
 */

import type { Extractor, ExtractedPage } from "../types";
import { ExtractorError } from "../types";
import { hostMatches } from "../url";

interface SyndicationTweet {
  id_str: string;
  text?: string;
  full_text?: string;
  user: { name: string; screen_name: string };
  created_at?: string;
  favorite_count?: number;
  conversation_count?: number;
  mediaDetails?: Array<{ media_url_https: string; type: string }>;
  photos?: Array<{ url: string }>;
  video?: { variants?: Array<{ src: string; type?: string }> };
  quoted_tweet?: SyndicationTweet;
  is_long_form?: boolean;
  note_tweet?: { text?: string };
}

const STATUS_RE = /\/status(?:es)?\/(\d+)/;

export const twitterSyndicationExtractor: Extractor = {
  name: "twitter-syndication",

  canHandle(url: URL): boolean {
    if (!hostMatches(url.hostname, "twitter.com") && !hostMatches(url.hostname, "x.com")) {
      return false;
    }
    return STATUS_RE.test(url.pathname);
  },

  async extract(url: URL): Promise<ExtractedPage> {
    const m = url.pathname.match(STATUS_RE);
    if (!m || !m[1]) {
      throw new ExtractorError("URL does not contain a tweet ID", "twitter-syndication");
    }
    const id = m[1];

    const endpoint = new URL("https://cdn.syndication.twimg.com/tweet-result");
    endpoint.searchParams.set("id", id);
    endpoint.searchParams.set("token", computeToken(id));
    endpoint.searchParams.set("lang", "en");
    endpoint.searchParams.set(
      "features",
      [
        "tfw_timeline_list:",
        "tfw_follower_count_sunset:true",
        "tfw_tweet_edit_backend:on",
        "tfw_refsrc_session:on",
        "tfw_show_business_verified_badge:on",
      ].join(";"),
    );

    let tweet: SyndicationTweet;
    try {
      const res = await fetch(endpoint.toString(), {
        signal: AbortSignal.timeout(15_000),
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; brain-cli/1.0)",
          Accept: "application/json",
        },
      });
      if (res.status === 404) {
        throw new ExtractorError(
          "Tweet not found via syndication (deleted, private, or X Article)",
          "twitter-syndication",
        );
      }
      if (!res.ok) {
        throw new ExtractorError(
          `Syndication responded ${res.status} ${res.statusText}`,
          "twitter-syndication",
        );
      }
      tweet = (await res.json()) as SyndicationTweet;
    } catch (err) {
      if (err instanceof ExtractorError) throw err;
      throw new ExtractorError(
        `Syndication fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        "twitter-syndication",
        err,
      );
    }

    if (!tweet || !tweet.user) {
      throw new ExtractorError("Empty tweet payload from syndication", "twitter-syndication");
    }

    // Long-form articles: syndication returns truncated text and `is_long_form: true`.
    // Surface that explicitly so the user knows to register an external extractor.
    if (tweet.is_long_form && !tweet.note_tweet?.text) {
      throw new ExtractorError(
        "X Article (long-form) detected — syndication only returns the teaser. " +
          "Register an external extractor for x.com to capture the full article body.",
        "twitter-syndication",
        undefined,
        { noFallback: true },
      );
    }

    const text =
      tweet.note_tweet?.text?.trim() ||
      tweet.full_text?.trim() ||
      tweet.text?.trim() ||
      "";

    // Heuristic for X Articles whose `is_long_form` flag isn't set: the
    // syndication payload contains only a t.co shortlink (the launcher) and
    // no media/quoted-tweet — that's a paid Article we can't fetch here.
    const stripped = text.replace(/https?:\/\/\S+/g, "").trim();
    const hasMedia = (tweet.photos?.length ?? 0) > 0 || (tweet.mediaDetails?.length ?? 0) > 0;
    const hasQuoted = !!tweet.quoted_tweet;
    if (!stripped && !hasMedia && !hasQuoted) {
      throw new ExtractorError(
        "Tweet payload appears to be an X Article launcher (t.co link only). " +
          "Register an external extractor for x.com to capture the full article body.",
        "twitter-syndication",
        undefined,
        { noFallback: true },
      );
    }

    const lines: string[] = [];
    lines.push(text);

    const media: string[] = [];
    if (tweet.photos) {
      for (const p of tweet.photos) media.push(`![](${p.url})`);
    } else if (tweet.mediaDetails) {
      for (const md of tweet.mediaDetails) {
        if (md.type === "photo") media.push(`![](${md.media_url_https})`);
      }
    }
    if (media.length > 0) {
      lines.push("");
      lines.push(...media);
    }

    if (tweet.video?.variants && tweet.video.variants.length > 0) {
      const mp4 = tweet.video.variants.find((v) => v.type === "video/mp4") ??
        tweet.video.variants[0];
      if (mp4) lines.push("", `**Video:** ${mp4.src}`);
    }

    if (tweet.quoted_tweet) {
      lines.push("", "---", "", `**Quoting @${tweet.quoted_tweet.user.screen_name}:**`, "");
      lines.push(
        tweet.quoted_tweet.note_tweet?.text?.trim() ||
          tweet.quoted_tweet.full_text?.trim() ||
          tweet.quoted_tweet.text?.trim() ||
          "",
      );
    }

    const stats: string[] = [];
    if (typeof tweet.favorite_count === "number") stats.push(`${tweet.favorite_count} ❤`);
    if (typeof tweet.conversation_count === "number") stats.push(`${tweet.conversation_count} 💬`);
    if (stats.length > 0) {
      lines.push("", "---", "", stats.join(" · "));
    }

    const title = buildTitle(tweet, text);

    return {
      title,
      content: lines.join("\n").trim(),
      author: `${tweet.user.name} (@${tweet.user.screen_name})`,
      site: "X",
      excerpt: shorten(text, 200),
    };
  },
};

/**
 * Token used by Twitter's syndication endpoint. Derived from the tweet ID:
 * mirrors `react-tweet/api/fetch-tweet.ts` (MIT, Vercel).
 */
function computeToken(id: string): string {
  // (Number(id) / 1e15) * Math.PI → toString(36) → strip leading "0." or "-0."
  const n = (Number(id) / 1e15) * Math.PI;
  return n.toString(6 ** 2).replace(/(0+|\.)/g, "");
}

function buildTitle(tweet: SyndicationTweet, text: string): string {
  const handle = tweet.user.screen_name;
  const firstLine = text.split("\n")[0]?.trim() || "";
  const headline = shorten(firstLine, 80);
  if (headline) return `@${handle}: ${headline}`;
  return `@${handle} tweet ${tweet.id_str}`;
}

function shorten(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}
