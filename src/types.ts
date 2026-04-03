/** Persisted config from ~/.config/brain/config.json */
export interface Config {
  /** Absolute path to the vault (~ already expanded) */
  vault: string;
}

/** Raw config as stored on disk (vault may contain ~) */
export interface RawConfig {
  vault: string;
}

/** Frontmatter fields for a note */
export interface Frontmatter {
  title: string;
  created: string; // YYYY-MM-DD
  tags: string[];
  source?: string; // URL, only for clip command
}

/** A command handler function */
export type CommandHandler = (
  args: string[],
  config: Config,
) => Promise<void>;
