/**
 * Minimal suffix-stripping stemmer for fuzzy search.
 * Not a full Porter stemmer — just handles common English suffixes
 * so that "orchestrate" and "orchestration" reduce to the same root.
 */

/** Suffixes ordered longest-first so longer matches win. */
const suffixes = [
  "ating",
  "ation",
  "ator",
  "ated",
  "tion",
  "ment",
  "ness",
  "able",
  "ible",
  "ing",
  "est",
  "ate",
  "ed",
  "er",
  "ly",
  "s",
];

/** Minimum stem length after stripping — avoids over-reduction. */
const MIN_STEM = 3;

/**
 * Strip one common English suffix from a word to get an approximate root.
 *
 * Examples:
 *   stem("orchestration") → "orchestr"
 *   stem("orchestrate")   → "orchestr"
 *   stem("running")       → "run"
 */
export function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.length <= MIN_STEM) return w;

  for (const suffix of suffixes) {
    if (w.endsWith(suffix) && w.length - suffix.length >= MIN_STEM) {
      const root = w.slice(0, -suffix.length);
      return dedup(root);
    }
  }

  return w;
}

/** Collapse a trailing doubled consonant: "runn" → "run". */
function dedup(s: string): string {
  if (s.length >= 2) {
    const last = s[s.length - 1]!;
    if (last === s[s.length - 2] && !/[aeiou]/.test(last)) {
      return s.slice(0, -1);
    }
  }
  return s;
}
