/** Shared URL utilities for extractors. */

export function titleFromUrl(url: URL): string {
  const last = url.pathname.split("/").filter(Boolean).pop() || "article";
  return last.replace(/[-_]/g, " ").replace(/\.\w+$/, "");
}

/** Normalize a hostname for matching: lowercase + strip leading "www.". */
export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/** True if `host` equals `domain` or is a subdomain of it. */
export function hostMatches(host: string, domain: string): boolean {
  const h = normalizeHost(host);
  const d = normalizeHost(domain);
  return h === d || h.endsWith(`.${d}`);
}
