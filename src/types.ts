import type { ExternalExtractorMap } from "./extractors/external";

/** Persisted config from ~/.config/brain/config.json */
export interface Config {
  /** Absolute path to the vault (~ already expanded) */
  vault: string;
  /** Optional per-domain external extractor commands. */
  extractors?: ExternalExtractorMap;
}

/** Raw config as stored on disk (vault may contain ~) */
export interface RawConfig {
  vault: string;
  extractors?: ExternalExtractorMap;
}

/** Frontmatter fields for a note */
export interface Frontmatter {
  title: string;
  created: string; // YYYY-MM-DD
  tags: string[];
  source?: string; // URL, only for clip command
  author?: string; // byline, only for clip command
  site?: string; // siteName, only for clip command
  excerpt?: string; // short description, only for clip command
}

/** A command handler function */
export type CommandHandler = (
  args: string[],
  config: Config,
) => Promise<void>;
